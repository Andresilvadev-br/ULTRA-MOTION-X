/**
 * Motion Orchestration: timelines (scrubbable, stateless sampling), sequences, parallel
 * groups, barriers, collective cancellation and cross-component choreography.
 */
import { type Engine, getEngine, type Tickable } from "../core/engine.ts";
import { Generator } from "../core/generator.ts";
import type { AnimationOutcome, MotionValue } from "../core/motion-value.ts";
import type { TaskPriority } from "../core/scheduler.ts";
import { resolveSpec, type TransitionOptions } from "../core/spec.ts";
import { type AnimationControls, resolveElements, type StaggerFn, staggerDelay } from "../dom/animate.ts";
import { ElementTarget } from "../dom/element-target.ts";
import { canonical, parseNumeric } from "../dom/props.ts";
import { MotionError } from "../math/spring.ts";

/** Position: ms number (absolute), "+=ms" after previous, "-=ms" overlap, "<" with previous,
 * "<+=ms", a label name, or "label+=ms". */
export type At = number | string;

export interface TimelineSegmentOptions extends TransitionOptions {
  at?: At;
  stagger?: number | StaggerFn;
}

export type TimelineSegment =
  | [
      Element | string | ArrayLike<Element> | MotionValue,
      Record<string, number | string | Array<number | string>> | number,
      TimelineSegmentOptions?,
    ]
  | { label: string; at?: At };

interface Track {
  mv: MotionValue;
  entries: Array<{ start: number; gen: Generator }>;
}

export interface TimelineOptions {
  engine?: Engine;
  /** Extra plays (Infinity loops). */
  repeat?: number;
  repeatType?: "loop" | "reverse";
  autoplay?: boolean;
  onUpdate?: (timeMs: number) => void;
  onComplete?: () => void;
}

export class Timeline implements Tickable {
  readonly engine: Engine;
  readonly tickPriority: TaskPriority = "animation";
  readonly labels = new Map<string, number>();
  private tracks = new Map<MotionValue, Track>();
  /** Total duration in seconds. */
  duration = 0;
  /** Current time within one iteration (s). */
  private t = 0;
  private iteration = 0;
  private lastTime: number | null = null;
  rate = 1;
  private playing = false;
  private opts: TimelineOptions;
  private resolveFinished!: (o: AnimationOutcome) => void;
  finished: Promise<AnimationOutcome>;

  constructor(segments: TimelineSegment[], opts: TimelineOptions = {}) {
    this.engine = opts.engine ?? getEngine();
    this.opts = opts;
    this.finished = new Promise((r) => {
      this.resolveFinished = r;
    });
    this.build(segments);
    if (opts.autoplay !== false) this.play();
  }

  private build(segments: TimelineSegment[]): void {
    let prevStart = 0;
    let prevEnd = 0;
    const resolveAt = (at: At | undefined): number => {
      if (at === undefined) return prevEnd;
      if (typeof at === "number") return at / 1000;
      const ms = (x: string) => Number.parseFloat(x) / 1000;
      if (at.startsWith("+=")) return prevEnd + ms(at.slice(2));
      if (at.startsWith("-=")) return Math.max(0, prevEnd - ms(at.slice(2)));
      if (at.startsWith("<")) return prevStart + (at.startsWith("<+=") ? ms(at.slice(3)) : 0);
      const m = at.match(/^([^+-]+)([+-]=)?(.*)$/);
      const base = this.labels.get(m?.[1] ?? at);
      if (base === undefined) throw new MotionError("E_TIMELINE", `unknown timeline label \`${at}\``);
      const off = m?.[2] ? ms(m[3]!) * (m[2] === "-=" ? -1 : 1) : 0;
      return Math.max(0, base + off);
    };
    for (const seg of segments) {
      if (!Array.isArray(seg)) {
        this.labels.set(seg.label, resolveAt(seg.at));
        continue;
      }
      const [target, props, o = {}] = seg;
      const start = resolveAt(o.at);
      let end = start;
      const values: Array<{ mv: MotionValue; list: Array<number | string>; prop: string }> = [];
      if (typeof props === "number") {
        values.push({ mv: target as MotionValue, list: [props], prop: "value" });
      } else {
        const els = resolveElements(target as Element | string | ArrayLike<Element>);
        els.forEach((el, i) => {
          for (const [rawProp, input] of Object.entries(props)) {
            const prop = canonical(rawProp);
            const list = Array.isArray(input) ? input : [input];
            const first = parseNumeric(list[list.length - 1]!, prop);
            const mv = ElementTarget.for(el, this.engine).value(prop, first?.unit);
            values.push({ mv, list, prop: `${i}:${prop}` });
          }
        });
        // Stagger applies per element.
        let k = 0;
        for (const v of values)
          (v as { stagger?: number }).stagger =
            staggerDelay(o.stagger, Math.floor(k++ / Object.keys(props).length), els.length) / 1000;
      }
      for (const v of values) {
        const nums = v.list.map((x) => {
          const n = parseNumeric(x, v.prop.split(":").pop()!);
          if (!n) throw new MotionError("E_VALUE", `cannot animate to \`${String(x)}\``);
          return n.value;
        });
        const track = this.track(v.mv);
        const s = start + ((v as { stagger?: number }).stagger ?? 0);
        const from = nums.length > 1 ? nums[0]! : this.valueAt(track, s);
        const spec = resolveSpec(o, this.engine.dna, nums.length > 2 ? nums : undefined);
        const gen =
          nums.length > 2
            ? new Generator(spec, from, nums[nums.length - 1]!)
            : new Generator(spec, from, nums[nums.length - 1]!);
        if (!Number.isFinite(gen.duration))
          throw new MotionError("E_TIMELINE", "timeline entries need finite durations (damped springs or tweens)");
        track.entries.push({ start: s, gen });
        track.entries.sort((a, b) => a.start - b.start);
        end = Math.max(end, s + gen.duration);
      }
      prevStart = start;
      prevEnd = end;
      this.duration = Math.max(this.duration, end);
    }
  }

  private track(mv: MotionValue): Track {
    let t = this.tracks.get(mv);
    if (!t) this.tracks.set(mv, (t = { mv, entries: [] }));
    return t;
  }

  private valueAt(track: Track, time: number): number {
    let active: { start: number; gen: Generator } | undefined;
    for (const e of track.entries) if (e.start <= time && (!active || e.start >= active.start)) active = e;
    if (active) return active.gen.sample(time - active.start).value;
    return track.entries[0]?.gen.from ?? track.mv.get();
  }

  /** Applies the timeline state at time `t` (s) to every value. Pure: order-independent. */
  render(t: number): void {
    for (const track of this.tracks.values()) track.mv.jump(this.valueAt(track, t), 0);
    this.opts.onUpdate?.(t * 1000);
  }

  get currentTime(): number {
    return this.t * 1000;
  }

  /** Seek to `ms` (exact, renders immediately). */
  seek(ms: number): void {
    this.t = Math.min(this.duration, Math.max(0, ms / 1000));
    this.render(this.t);
  }

  /** Steps by `frames` at `hz` (frame-by-frame inspection). */
  step(frames = 1, hz = 60): void {
    this.pause();
    this.seek(this.currentTime + (frames * 1000) / hz);
  }

  play(): void {
    if (this.playing) return;
    for (const track of this.tracks.values()) track.mv.stop();
    this.playing = true;
    this.lastTime = null;
    this.engine.add(this);
  }

  pause(): void {
    this.playing = false;
    this.engine.remove(this);
  }

  reverse(): void {
    this.rate = -this.rate;
    if (!this.playing) this.play();
  }

  cancel(): void {
    this.pause();
    this.resolveFinished("cancelled");
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  tick(time: number): boolean {
    if (!this.playing) return false;
    const dt = this.lastTime === null ? 0 : time - this.lastTime;
    this.lastTime = time;
    this.t += dt * this.rate;
    const repeat = this.opts.repeat ?? 0;
    let finished = false;
    if (this.t >= this.duration && this.rate > 0) {
      if (this.iteration < repeat) {
        this.iteration++;
        if (this.opts.repeatType === "reverse") {
          this.t = this.duration;
          this.rate = -this.rate;
        } else this.t -= this.duration;
      } else {
        this.t = this.duration;
        finished = true;
      }
    } else if (this.t <= 0 && this.rate < 0) {
      if (this.iteration < repeat && this.opts.repeatType === "reverse") {
        this.iteration++;
        this.t = 0;
        this.rate = -this.rate;
      } else {
        this.t = 0;
        finished = true;
      }
    }
    this.render(this.t);
    if (finished) {
      this.playing = false;
      this.opts.onComplete?.();
      this.resolveFinished("completed");
      return false;
    }
    return true;
  }
}

export function timeline(segments: TimelineSegment[], opts?: TimelineOptions): Timeline {
  return new Timeline(segments, opts);
}

type Step = () => PromiseLike<unknown> | AnimationControls | undefined | void;

/** Coordinates many animations: collective cancel/pause/resume and completion barrier. */
export class MotionGroup {
  private members = new Set<AnimationControls | Timeline>();

  add<T extends AnimationControls | Timeline>(c: T): T {
    this.members.add(c);
    const p = c instanceof Timeline ? c.finished : c.finished;
    p.then(() => this.members.delete(c));
    return c;
  }
  cancelAll(): void {
    for (const m of this.members) m.cancel();
    this.members.clear();
  }
  pauseAll(): void {
    for (const m of this.members) m.pause();
  }
  playAll(): void {
    for (const m of this.members) m.play();
  }
  get size(): number {
    return this.members.size;
  }
  /** Barrier: resolves when every current member settled. */
  async settled(): Promise<void> {
    await Promise.all([...this.members].map((m) => m.finished));
  }
}

/** Runs steps one after another (each step may return controls or a promise). */
export async function sequence(...steps: Step[]): Promise<void> {
  for (const s of steps) {
    const r = s();
    if (r && typeof (r as PromiseLike<unknown>).then === "function") await r;
  }
}

/** Runs steps concurrently and waits for all (barrier). */
export async function parallel(...steps: Step[]): Promise<void> {
  await Promise.all(steps.map((s) => s()));
}

/** Waits for the first step to settle (race barrier). */
export async function race(...steps: Step[]): Promise<void> {
  await Promise.race(steps.map((s) => Promise.resolve(s())));
}

export interface ChoreographyPhase {
  /** Name of the phase (for debugging / DevTools). */
  name: string;
  run: Step;
  /** Start relative to previous phase start (ms); default: after it finishes. */
  offset?: number;
  /** Only run when the predicate is true (conditional animation). */
  when?: () => boolean;
}

/**
 * Choreography across components: phases run in order, optionally overlapping by `offset`,
 * with conditional phases. Returns a handle that cancels pending phases.
 */
export function choreograph(phases: ChoreographyPhase[]): { finished: Promise<void>; cancel(): void } {
  let cancelled = false;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const finished = (async () => {
    let previous: Promise<unknown> = Promise.resolve();
    const all: Array<Promise<unknown>> = [];
    for (const ph of phases) {
      if (cancelled) break;
      if (ph.when && !ph.when()) continue;
      if (ph.offset === undefined) await previous;
      else await new Promise((r) => timers.push(setTimeout(r, Math.max(0, ph.offset!))));
      if (cancelled) break;
      previous = Promise.resolve(ph.run());
      all.push(previous);
    }
    await Promise.all(all);
  })();
  return {
    finished,
    cancel() {
      cancelled = true;
      timers.forEach(clearTimeout);
    },
  };
}
