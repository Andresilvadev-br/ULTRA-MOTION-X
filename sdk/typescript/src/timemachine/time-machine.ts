/**
 * Motion Time Machine: records motion sessions (frames, animated values, animation events
 * and coarse input events), plays them back frame by frame, compares runs and detects
 * inconsistencies. Recordings contain no text content, form values or element contents —
 * only property names, numbers and element descriptors (`tag#id`).
 */

import { ManualDriver } from "../core/driver.ts";
import { createEngine, type Engine } from "../core/engine.ts";
import type { MotionValue, ValueAnimation } from "../core/motion-value.ts";

export interface RecordedFrame {
  t: number;
  dt: number;
  values: Record<string, [number, number]>;
}

export interface RecordedEvent {
  t: number;
  kind: string;
  value?: string;
  detail?: Record<string, number | string>;
}

export interface Recording {
  format: "umx-recording/1";
  createdAt: string;
  meta: Record<string, string | number>;
  frames: RecordedFrame[];
  events: RecordedEvent[];
}

export interface RecorderOptions {
  /** Maximum frames kept (ring buffer). */
  maxFrames?: number;
  /** Record pointer/keyboard events (type, time and coordinates only). */
  inputs?: boolean;
  /** Restrict to values whose name matches. */
  filter?: (name: string) => boolean;
}

const describe = (t: EventTarget | null): string => {
  const el = t as Element | null;
  if (!el || !("tagName" in el)) return "unknown";
  return `${el.tagName.toLowerCase()}${(el as HTMLElement).id ? `#${(el as HTMLElement).id}` : ""}`;
};

export class MotionRecorder {
  readonly engine: Engine;
  private frames: RecordedFrame[] = [];
  private events: RecordedEvent[] = [];
  private tracked = new Map<string, MotionValue>();
  private disposers: Array<() => void> = [];
  private opts: RecorderOptions;
  private lastTime = 0;
  recording = false;

  constructor(engine: Engine, opts: RecorderOptions = {}) {
    this.engine = engine;
    this.opts = opts;
  }

  track(mv: MotionValue): void {
    if (this.opts.filter && !this.opts.filter(mv.name)) return;
    this.tracked.set(mv.name, mv);
  }

  start(): void {
    if (this.recording) return;
    this.recording = true;
    this.lastTime = this.engine.time;
    this.disposers.push(
      this.engine.on("animation", (p) => {
        const { event, value, animation } = p as { event: string; value: MotionValue; animation: ValueAnimation };
        this.track(value);
        this.events.push({
          t: this.engine.time,
          kind: `animation:${event}`,
          value: value.name,
          detail: { id: animation.id, priority: animation.priority, to: animation.to },
        });
      }),
    );
    this.disposers.push(
      this.engine.on("frame", () => {
        const values: Record<string, [number, number]> = {};
        for (const [name, mv] of this.tracked) values[name] = [round(mv.get()), round(mv.velocity)];
        this.frames.push({ t: this.engine.time, dt: this.engine.time - this.lastTime, values });
        this.lastTime = this.engine.time;
        const max = this.opts.maxFrames ?? 3600;
        if (this.frames.length > max) this.frames.splice(0, this.frames.length - max);
      }),
    );
    if (this.opts.inputs && typeof addEventListener === "function") {
      const types = ["pointerdown", "pointerup", "pointercancel", "keydown"];
      const fn = (e: Event) => {
        const pe = e as PointerEvent;
        const detail: Record<string, number | string> = { target: describe(e.target) };
        if ("clientX" in pe) {
          detail.x = Math.round(pe.clientX);
          detail.y = Math.round(pe.clientY);
        }
        // Keys are recorded only as navigation keys; printable characters are never stored.
        if (e.type === "keydown")
          detail.key = /^(Arrow|Escape|Enter|Tab|Home|End| )/.test((e as KeyboardEvent).key)
            ? (e as KeyboardEvent).key
            : "other";
        this.events.push({ t: this.engine.time, kind: `input:${e.type}`, detail });
      };
      for (const t of types) addEventListener(t, fn, { capture: true, passive: true });
      this.disposers.push(() => types.forEach((t) => removeEventListener(t, fn, { capture: true })));
    }
  }

  stop(meta: Record<string, string | number> = {}): Recording {
    this.recording = false;
    for (const d of this.disposers) d();
    this.disposers = [];
    return {
      format: "umx-recording/1",
      createdAt: new Date().toISOString(),
      meta: { refreshHz: this.engine.refresh.hz, ...meta },
      frames: this.frames.slice(),
      events: this.events.slice(),
    };
  }
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** Frame-by-frame playback of a recording onto live values (matched by name). */
export class MotionPlayer {
  readonly recording: Recording;
  index = 0;
  private targets = new Map<string, MotionValue>();

  constructor(recording: Recording) {
    if (recording.format !== "umx-recording/1") throw new Error("unsupported recording format");
    this.recording = recording;
  }

  bind(mv: MotionValue, name = mv.name): void {
    this.targets.set(name, mv);
  }

  get length(): number {
    return this.recording.frames.length;
  }

  seek(index: number): RecordedFrame | undefined {
    this.index = Math.max(0, Math.min(this.length - 1, index));
    const f = this.recording.frames[this.index];
    if (f) for (const [name, [v]] of Object.entries(f.values)) this.targets.get(name)?.set(v);
    return f;
  }

  step(delta = 1): RecordedFrame | undefined {
    return this.seek(this.index + delta);
  }

  /** Time series of one value (for property-evolution charts). */
  series(name: string): Array<{ t: number; value: number; velocity: number }> {
    return this.recording.frames
      .filter((f) => name in f.values)
      .map((f) => ({ t: f.t, value: f.values[name]![0], velocity: f.values[name]![1] }));
  }

  eventsBetween(t0: number, t1: number): RecordedEvent[] {
    return this.recording.events.filter((e) => e.t >= t0 && e.t <= t1);
  }
}

export interface Anomaly {
  kind: "discontinuity" | "non-finite" | "conflict";
  value: string;
  t: number;
  detail: string;
}

/**
 * Detects jumps (displacement far larger than velocity·dt allows), non-finite values and
 * rapid ownership churn (many interruptions of one value within 100 ms).
 */
export function detectAnomalies(rec: Recording, opts: { jumpFactor?: number; minJump?: number } = {}): Anomaly[] {
  const out: Anomaly[] = [];
  const k = opts.jumpFactor ?? 4;
  const min = opts.minJump ?? 2;
  for (let i = 1; i < rec.frames.length; i++) {
    const a = rec.frames[i - 1]!;
    const b = rec.frames[i]!;
    const dt = b.t - a.t;
    for (const [name, [v, vel]] of Object.entries(b.values)) {
      if (!Number.isFinite(v)) {
        out.push({ kind: "non-finite", value: name, t: b.t, detail: String(v) });
        continue;
      }
      const prev = a.values[name];
      if (!prev || dt <= 0) continue;
      const allowed = Math.max(Math.abs(prev[1]), Math.abs(vel)) * dt * k + min;
      const jump = Math.abs(v - prev[0]);
      if (jump > allowed)
        out.push({
          kind: "discontinuity",
          value: name,
          t: b.t,
          detail: `Δ=${jump.toFixed(3)} > ${allowed.toFixed(3)}`,
        });
    }
  }
  const interrupts = rec.events.filter((e) => e.kind === "animation:interrupt");
  const byValue = new Map<string, number[]>();
  for (const e of interrupts) byValue.set(e.value ?? "", [...(byValue.get(e.value ?? "") ?? []), e.t]);
  for (const [name, ts] of byValue) {
    for (let i = 3; i < ts.length; i++) {
      if (ts[i]! - ts[i - 3]! < 0.1) {
        out.push({ kind: "conflict", value: name, t: ts[i]!, detail: "≥ 4 interruptions within 100 ms" });
        break;
      }
    }
  }
  return out;
}

/** Compares two recordings value-by-value at matching times (nearest frame). */
export function compareRecordings(a: Recording, b: Recording): Record<string, { maxDiff: number; at: number }> {
  const res: Record<string, { maxDiff: number; at: number }> = {};
  let j = 0;
  for (const fa of a.frames) {
    while (j + 1 < b.frames.length && Math.abs(b.frames[j + 1]!.t - fa.t) <= Math.abs(b.frames[j]!.t - fa.t)) j++;
    const fb = b.frames[j];
    if (!fb) break;
    for (const [name, [va]] of Object.entries(fa.values)) {
      const vb = fb.values[name]?.[0];
      if (vb === undefined) continue;
      const d = Math.abs(va - vb);
      if (!res[name] || d > res[name].maxDiff) res[name] = { maxDiff: d, at: fa.t };
    }
  }
  return res;
}

export interface ScenarioStep {
  /** ms from scenario start */
  at: number;
  run: (engine: Engine) => void;
}

/**
 * Re-runs a scripted scenario deterministically at a given refresh rate with a manual
 * driver (no DOM needed) — the basis for motion regression tests.
 */
export function replayScenario(
  setup: (engine: Engine) => MotionValue[],
  steps: ScenarioStep[],
  opts: { hz?: number; durationMs?: number } = {},
): Recording {
  const driver = new ManualDriver();
  const engine = createEngine({ driver, powerAware: false });
  const values = setup(engine);
  const rec = new MotionRecorder(engine);
  for (const v of values) rec.track(v);
  rec.start();
  const hz = opts.hz ?? 60;
  const frame = 1000 / hz;
  const end = opts.durationMs ?? Math.max(1000, ...steps.map((s) => s.at + 1000));
  const pending = steps.slice().sort((x, y) => x.at - y.at);
  for (let t = 0; t <= end; t += frame) {
    while (pending.length && pending[0]!.at <= t) pending.shift()!.run(engine);
    engine.wake();
    driver.step(frame);
  }
  const out = rec.stop({ hz });
  engine.destroy();
  return out;
}
