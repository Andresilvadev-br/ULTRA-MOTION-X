/**
 * Headless inspector: collects engine state for the overlay, the Studio and automated
 * tools (it has no DOM dependency, so it also works in tests).
 */
import {
  arbitrationStats,
  type Engine,
  type MotionValue,
  type TelemetryReport,
  type ValueAnimation,
} from "@ultra-motion-x/web";

export interface AnimationInfo {
  id: number;
  value: string;
  priority: string;
  state: string;
  spec: string;
  to: number;
  current: number;
  velocity: number;
}

export interface Snapshot {
  time: number;
  refreshHz: number;
  fidelity: number;
  reducedMotion: boolean;
  timeScale: number;
  profile: string;
  active: AnimationInfo[];
  report: TelemetryReport;
  arbitration: typeof arbitrationStats;
  power: unknown;
  warnings: Array<{ t: number; message: string }>;
  events: Array<{ t: number; event: string; value: string }>;
}

export class Inspector {
  readonly engine: Engine;
  private live = new Map<number, { anim: ValueAnimation; value: MotionValue }>();
  private warnings: Array<{ t: number; message: string }> = [];
  private events: Array<{ t: number; event: string; value: string }> = [];
  private power: unknown = null;
  private offs: Array<() => void> = [];

  constructor(engine: Engine) {
    this.engine = engine;
    this.offs.push(
      engine.on("animation", (p) => {
        const { event, value, animation } = p as { event: string; value: MotionValue; animation: ValueAnimation };
        if (event === "start") this.live.set(animation.id, { anim: animation, value });
        else this.live.delete(animation.id);
        this.events.push({ t: engine.time, event, value: value.name });
        if (this.events.length > 200) this.events.shift();
      }),
      engine.on("warning", (w) => {
        this.warnings.push({ t: engine.time, message: (w as { message: string }).message });
        if (this.warnings.length > 100) this.warnings.shift();
      }),
      engine.on("power", (p) => {
        this.power = p;
      }),
    );
  }

  snapshot(): Snapshot {
    for (const [id, { anim }] of this.live)
      if (anim.state !== "running" && anim.state !== "paused") this.live.delete(id);
    return {
      time: this.engine.time,
      refreshHz: this.engine.refresh.hz,
      fidelity: this.engine.fidelity.level,
      reducedMotion: this.engine.reducedMotion,
      timeScale: this.engine.timeScale,
      profile: this.engine.dna.name,
      active: [...this.live.values()].map(({ anim, value }) => ({
        id: anim.id,
        value: value.name,
        priority: anim.priority,
        state: anim.state,
        spec: anim.spec.type,
        to: anim.to,
        current: value.get(),
        velocity: value.velocity,
      })),
      report: this.engine.report(),
      arbitration: { ...arbitrationStats },
      power: this.power,
      warnings: this.warnings.slice(-20),
      events: this.events.slice(-40),
    };
  }

  destroy(): void {
    for (const o of this.offs) o();
    this.offs = [];
    this.live.clear();
  }
}
