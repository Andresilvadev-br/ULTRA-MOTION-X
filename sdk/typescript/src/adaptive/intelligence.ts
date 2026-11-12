/**
 * Reactive Intelligence (Neural Motion Intelligence layer). Version 1 uses lightweight,
 * verifiable statistics — no generative AI and no model runs per frame. The module
 * interface accepts optional learned modules later; their output is the same bounded
 * profile adjustment, applied only between interactions.
 */
import type { Engine } from "../core/engine.ts";
import { percentile } from "../core/stats.ts";
import { MotionDNA } from "../tokens/dna.ts";
import type { MotionProfileData } from "../tokens/types.ts";

export interface InteractionSample {
  kind: "press" | "drag" | "cancel" | "key" | "scroll";
  time: number;
  /** Optional measured value (e.g. release speed). */
  value?: number;
}

/** A pluggable intelligence module. `suggest` returns a speed factor in (0, 1] or null. */
export interface IntelligenceModule {
  readonly name: string;
  observe(sample: InteractionSample): void;
  suggest(): { speed?: number; softness?: number } | null;
}

/** Users interacting rapidly get shorter motion (never longer than the profile). */
export class TempoModule implements IntelligenceModule {
  readonly name = "tempo";
  private times: number[] = [];
  observe(s: InteractionSample): void {
    if (s.kind !== "press" && s.kind !== "key") return;
    this.times.push(s.time);
    if (this.times.length > 20) this.times.shift();
  }
  suggest(): { speed: number } | null {
    if (this.times.length < 5) return null;
    const gaps = this.times.slice(1).map((t, i) => t - this.times[i]!);
    const median = percentile(gaps, 0.5);
    // ≤ 250 ms between actions → 0.65×; ≥ 900 ms → 1×; linear in between.
    const f = 0.65 + (0.35 * Math.min(1, Math.max(0, median - 250))) / 650;
    return { speed: Math.round(f * 100) / 100 };
  }
}

/** Frequent gesture cancellations suggest the motion feels too aggressive: soften springs. */
export class CancellationModule implements IntelligenceModule {
  readonly name = "cancellations";
  private recent: Array<0 | 1> = [];
  observe(s: InteractionSample): void {
    if (s.kind !== "drag" && s.kind !== "cancel") return;
    this.recent.push(s.kind === "cancel" ? 1 : 0);
    if (this.recent.length > 20) this.recent.shift();
  }
  suggest(): { softness: number } | null {
    if (this.recent.length < 6) return null;
    const rate = this.recent.reduce<number>((a, b) => a + b, 0) / this.recent.length;
    return rate > 0.3 ? { softness: Math.min(0.15, rate - 0.3) } : null;
  }
}

export interface IntelligenceOptions {
  modules?: IntelligenceModule[];
  /** Minimum relative change before the profile is updated (hysteresis). */
  threshold?: number;
}

export class MotionIntelligence {
  readonly engine: Engine;
  readonly modules: IntelligenceModule[];
  private base: MotionDNA;
  private applied = { speed: 1, softness: 0 };
  private threshold: number;
  private disposers: Array<() => void> = [];

  constructor(engine: Engine, opts: IntelligenceOptions = {}) {
    this.engine = engine;
    this.base = engine.dna;
    this.modules = opts.modules ?? [new TempoModule(), new CancellationModule()];
    this.threshold = opts.threshold ?? 0.08;
  }

  /** Listens to document input (no data leaves the page). */
  attach(target: EventTarget = globalThis as unknown as EventTarget): this {
    const on = (type: string, kind: InteractionSample["kind"]) => {
      const fn = (e: Event) => this.observe({ kind, time: e.timeStamp });
      target.addEventListener(type, fn, { passive: true, capture: true });
      this.disposers.push(() => target.removeEventListener(type, fn, { capture: true }));
    };
    on("pointerdown", "press");
    on("keydown", "key");
    on("pointercancel", "cancel");
    return this;
  }

  observe(sample: InteractionSample): void {
    for (const m of this.modules) m.observe(sample);
    this.update();
  }

  get adjustment(): { speed: number; softness: number } {
    return { ...this.applied };
  }

  /** Recomputes the adapted profile; applied only when the engine is idle. */
  private update(): void {
    let speed = 1;
    let softness = 0;
    for (const m of this.modules) {
      const s = m.suggest();
      if (s?.speed !== undefined) speed = Math.min(speed, s.speed);
      if (s?.softness !== undefined) softness = Math.max(softness, s.softness);
    }
    const delta = Math.abs(speed - this.applied.speed) + Math.abs(softness - this.applied.softness);
    if (delta < this.threshold) return;
    const apply = () => {
      this.applied = { speed, softness };
      this.engine.setProfile(adaptProfile(this.base, speed, softness));
    };
    if (this.engine.isIdle) apply();
    else {
      const off = this.engine.on("idle", () => {
        off();
        apply();
      });
    }
  }

  /** Restores the original profile and stops observing. */
  detach(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.engine.setProfile(this.base);
  }
}

/** Derives a profile: durations and spring responses × speed; damping ratios + softness. */
export function adaptProfile(base: MotionDNA, speed: number, softness = 0): MotionDNA {
  const s = Math.min(1, Math.max(0.5, speed));
  const d = base.data;
  const scaleSpring = (t: { response: number; dampingRatio: number }) => ({
    response: t.response * s,
    dampingRatio: Math.min(1.2, t.dampingRatio + softness),
  });
  const data: MotionProfileData = {
    ...d,
    duration: {
      instant: d.duration.instant,
      fast: d.duration.fast * s,
      normal: d.duration.normal * s,
      slow: d.duration.slow * s,
      page: d.duration.page * s,
    },
    spring: {
      snappy: scaleSpring(d.spring.snappy),
      standard: scaleSpring(d.spring.standard),
      gentle: scaleSpring(d.spring.gentle),
      bouncy: scaleSpring(d.spring.bouncy),
    },
  };
  return new MotionDNA(`${base.name}+adaptive`, data);
}
