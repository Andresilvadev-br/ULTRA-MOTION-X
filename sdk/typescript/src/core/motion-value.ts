/**
 * MotionValue: a numeric value with velocity, an owning animation and temporal-coherence
 * arbitration (one owner, explicit priority and interruption policy — same semantics as
 * `umx_core::arbitration`). Interruptions retarget from the current position *and* velocity.
 */
import { MotionError } from "../math/spring.ts";
import { type Engine, getEngine, nextId, type Tickable } from "./engine.ts";
import { type AnimationSpec, Generator, preservesVelocity } from "./generator.ts";
import { reportError, type TaskPriority } from "./scheduler.ts";

export type Priority = "decorative" | "ambient" | "normal" | "interaction" | "gesture";
export type InterruptPolicy = "replace" | "queue" | "reject" | "additive";
export type AnimationOutcome = "completed" | "interrupted" | "cancelled" | "rejected";
export type AnimationState = "pending" | "running" | "paused" | "completed" | "interrupted" | "cancelled" | "rejected";

export const PRIORITY_RANK: Record<Priority, number> = {
  decorative: 0,
  ambient: 1,
  normal: 2,
  interaction: 3,
  gesture: 4,
};

export interface ValueAnimateOptions {
  priority?: Priority;
  policy?: InterruptPolicy;
  /** Engine-level tick class; defaults from priority. */
  tickPriority?: TaskPriority;
}

/** Shared arbitration statistics (exposed in telemetry/DevTools). */
export const arbitrationStats = { acquisitions: 0, interruptions: 0, rejections: 0, queued: 0, additive: 0 };

export class ValueAnimation {
  readonly id = nextId();
  state: AnimationState = "pending";
  readonly finished: Promise<AnimationOutcome>;
  gen: Generator;
  readonly priority: Priority;
  readonly spec: AnimationSpec;
  readonly to: number;
  /** Where the animation started (used by `reverse()` for physical animations). */
  origin: number;
  rate = 1;
  private anchorTime = 0;
  private anchorElapsed = 0;
  private resolveFn!: (o: AnimationOutcome) => void;
  /** Set by additive layers: current offset contribution. */
  offset = 0;
  readonly additive: boolean;
  owner: MotionValue | null = null;

  constructor(spec: AnimationSpec, gen: Generator, to: number, priority: Priority, additive: boolean) {
    this.spec = spec;
    this.gen = gen;
    this.to = to;
    this.origin = gen.from;
    this.priority = priority;
    this.additive = additive;
    this.finished = new Promise((r) => {
      this.resolveFn = r;
    });
  }

  start(time: number): void {
    this.anchorTime = time;
    this.anchorElapsed = 0;
    this.state = "running";
  }

  elapsed(time: number): number {
    if (this.state === "paused") return this.anchorElapsed;
    return this.anchorElapsed + (time - this.anchorTime) * this.rate;
  }

  private reanchor(time: number): void {
    this.anchorElapsed = this.elapsed(time);
    this.anchorTime = time;
  }

  pause(): void {
    if (this.state !== "running" || !this.owner) return;
    this.reanchor(this.owner.engine.time);
    this.state = "paused";
  }

  play(): void {
    if (this.state !== "paused" || !this.owner) return;
    this.anchorTime = this.owner.engine.time;
    this.state = "running";
    this.owner.engine.add(this.owner);
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate) || !this.owner) return;
    if (this.state === "running") this.reanchor(this.owner.engine.time);
    this.rate = rate;
  }

  /** Seeks to `seconds` of elapsed animation time. */
  seek(seconds: number): void {
    if (!this.owner || !Number.isFinite(seconds)) return;
    this.anchorElapsed = Math.max(0, seconds);
    this.anchorTime = this.owner.engine.time;
    this.owner.applyOwnerSample(this.owner.engine.time);
    this.owner.engine.add(this.owner);
  }

  /**
   * Reverses: time-based animations play backwards from where they are; physical
   * animations retarget to their origin carrying the current velocity (no jump).
   */
  reverse(): void {
    const v = this.owner;
    if (!v || (this.state !== "running" && this.state !== "paused")) return;
    if (preservesVelocity(this.spec) && this.spec.type === "spring") {
      const t = v.engine.time;
      const target = this.origin;
      this.origin = this.gen.target;
      this.gen = this.gen.retarget(this.elapsed(t), this.spec, target);
      this.anchorElapsed = 0;
      this.anchorTime = t;
    } else {
      this.setRate(-this.rate);
    }
    v.engine.add(v);
  }

  /** Jumps to the final value. */
  complete(): void {
    if (!this.owner) return;
    this.anchorElapsed = Number.isFinite(this.gen.duration) ? this.gen.duration : this.anchorElapsed;
    this.anchorTime = this.owner.engine.time;
    if (this.state === "paused") this.state = "running";
    this.owner.engine.add(this.owner);
  }

  cancel(): void {
    this.owner?.cancelAnimation(this, "cancelled");
  }

  /** @internal */
  settle(outcome: AnimationOutcome): void {
    if (
      this.state === "completed" ||
      this.state === "interrupted" ||
      this.state === "cancelled" ||
      this.state === "rejected"
    )
      return;
    this.state = outcome;
    this.resolveFn(outcome);
  }
}

export interface MotionValueOptions {
  min?: number;
  max?: number;
  /** Debug name shown in DevTools. */
  name?: string;
}

type ChangeListener = (value: number, velocity: number) => void;

export class MotionValue implements Tickable {
  readonly id = nextId();
  readonly engine: Engine;
  name: string;
  private value: number;
  private vel = 0;
  private owner: ValueAnimation | null = null;
  private queue: ValueAnimation[] = [];
  private layers: ValueAnimation[] = [];
  private listeners = new Set<ChangeListener>();
  private eventListeners = new Map<string, Set<(a: ValueAnimation) => void>>();
  min: number;
  max: number;
  private destroyed = false;
  /** When set, rendering of this value is delegated (e.g. to the compositor). */
  delegated = false;

  constructor(initial: number, engine: Engine = getEngine(), opts: MotionValueOptions = {}) {
    if (!Number.isFinite(initial)) throw new MotionError("E_NOT_FINITE", "initial value must be finite");
    this.engine = engine;
    this.min = opts.min ?? Number.NEGATIVE_INFINITY;
    this.max = opts.max ?? Number.POSITIVE_INFINITY;
    this.value = clamp(initial, this.min, this.max);
    this.name = opts.name ?? `value#${this.id}`;
    engine.valueCount++;
  }

  get tickPriority(): TaskPriority {
    const p = this.owner?.priority ?? this.layers[0]?.priority ?? "normal";
    return p === "gesture" || p === "interaction" ? "interaction" : p === "decorative" ? "decorative" : "animation";
  }

  get(): number {
    let v = this.value;
    for (const l of this.layers) v += l.offset;
    return clamp(v, this.min, this.max);
  }

  /** Base value without additive layers. */
  getBase(): number {
    return this.value;
  }

  get velocity(): number {
    return this.vel;
  }

  get isAnimating(): boolean {
    return this.owner !== null || this.layers.length > 0;
  }

  get currentAnimation(): ValueAnimation | null {
    return this.owner;
  }

  /** Sets the value immediately (cancelling the owner) and records `velocity`. */
  set(value: number, velocity = 0): void {
    if (!Number.isFinite(value)) return;
    if (this.owner) this.cancelAnimation(this.owner, "cancelled");
    this.value = clamp(value, this.min, this.max);
    this.vel = Number.isFinite(velocity) ? velocity : 0;
    this.notify();
  }

  /** Updates the value while keeping the current owner (used by gesture tracking). */
  jump(value: number, velocity = this.vel): void {
    if (!Number.isFinite(value)) return;
    this.value = clamp(value, this.min, this.max);
    this.vel = velocity;
    this.notify();
  }

  animate(to: number, spec: AnimationSpec, opts: ValueAnimateOptions = {}): ValueAnimation {
    if (this.destroyed) throw new MotionError("E_DESTROYED", "MotionValue was destroyed");
    const priority = opts.priority ?? "normal";
    const policy = opts.policy ?? "replace";
    if (!Number.isFinite(to) && spec.type !== "decay" && spec.type !== "inertia")
      throw new MotionError("E_NOT_FINITE", "target must be finite");
    const target = Number.isFinite(to) ? clamp(to, this.min, this.max) : to;
    const reduced = this.engine.reducedMotion && spec.type !== "instant";
    const current = this.owner;

    if (policy === "additive" && current) {
      const gen = new Generator(reduced ? { type: "instant" } : spec, 0, target - this.value, 0);
      const anim = new ValueAnimation(spec, gen, target, priority, true);
      anim.owner = this;
      anim.start(this.engine.time);
      this.layers.push(anim);
      arbitrationStats.additive++;
      this.engine.telemetry.counters.animationsStarted++;
      this.engine.add(this);
      this.fire("start", anim);
      return anim;
    }
    if (current) {
      const higher = PRIORITY_RANK[current.priority] > PRIORITY_RANK[priority];
      if (policy === "queue") {
        const gen = new Generator({ type: "instant" }, this.value, target);
        const anim = new ValueAnimation(spec, gen, target, priority, false);
        anim.owner = this;
        this.queue.push(anim);
        arbitrationStats.queued++;
        return anim;
      }
      if (policy === "reject" || higher) {
        const anim = new ValueAnimation(
          spec,
          new Generator({ type: "instant" }, this.value, this.value),
          target,
          priority,
          false,
        );
        anim.settle("rejected");
        arbitrationStats.rejections++;
        this.engine.telemetry.counters.animationsRejected++;
        return anim;
      }
    }
    // Acquire (possibly interrupting), retargeting from the live state.
    let gen: Generator;
    if (reduced) {
      // Reduced motion: decay/inertia still resolve their physical destination.
      const probe = new Generator(spec, this.value, target, this.vel);
      gen = new Generator({ type: "instant" }, this.value, probe.target);
    } else {
      gen = new Generator(spec, this.value, target, preservesVelocity(spec) ? this.vel : 0);
    }
    const anim = new ValueAnimation(spec, gen, gen.target, priority, false);
    anim.owner = this;
    if (current) {
      arbitrationStats.interruptions++;
      this.engine.telemetry.counters.animationsInterrupted++;
      this.owner = null;
      current.settle("interrupted");
      this.fire("interrupt", current);
    }
    arbitrationStats.acquisitions++;
    this.owner = anim;
    anim.start(this.engine.time);
    this.engine.telemetry.counters.animationsStarted++;
    this.fire("start", anim);
    if (reduced) this.applyOwnerSample(this.engine.time);
    this.engine.add(this);
    return anim;
  }

  /** Stops all animation at the current value. */
  stop(): void {
    // Clear pending work first: cancelling the owner normally promotes the queue.
    // stop()/destroy() must never start a successor or leave its promise unresolved.
    for (const q of this.queue) q.settle("cancelled");
    this.queue = [];
    if (this.owner) this.cancelAnimation(this.owner, "cancelled");
    for (const l of [...this.layers]) this.cancelAnimation(l, "cancelled");
    this.vel = 0;
  }

  /** @internal */
  cancelAnimation(anim: ValueAnimation, outcome: AnimationOutcome): void {
    if (anim === this.owner) {
      this.owner = null;
      this.engine.telemetry.counters.animationsCancelled++;
      anim.settle(outcome);
      this.fire("cancel", anim);
      this.promote();
    } else if (this.layers.includes(anim)) {
      this.value += anim.offset;
      this.layers = this.layers.filter((l) => l !== anim);
      anim.settle(outcome);
    } else if (this.queue.includes(anim)) {
      this.queue = this.queue.filter((q) => q !== anim);
      anim.settle(outcome);
    }
  }

  private promote(): void {
    const next = this.queue.shift();
    if (!next) return;
    next.gen = new Generator(next.spec, this.value, next.to, preservesVelocity(next.spec) ? this.vel : 0);
    next.origin = this.value;
    this.owner = next;
    next.start(this.engine.time);
    arbitrationStats.acquisitions++;
    this.engine.telemetry.counters.animationsStarted++;
    this.fire("start", next);
    this.engine.add(this);
  }

  /** @internal Samples the owner at `time` and writes value/velocity. */
  applyOwnerSample(time: number): boolean {
    const a = this.owner;
    if (!a) return false;
    const e = a.elapsed(time);
    const s = a.gen.sample(Math.max(0, e));
    this.value = clamp(s.value, this.min, this.max);
    this.vel = s.done ? 0 : s.velocity * Math.sign(a.rate || 1);
    const finished = (a.rate > 0 && s.done) || (a.rate < 0 && e <= 0);
    if (finished) {
      if (a.rate < 0) this.value = clamp(a.gen.sample(0).value, this.min, this.max);
      this.vel = 0;
      this.owner = null;
      this.engine.telemetry.counters.animationsCompleted++;
      a.settle("completed");
      this.fire("complete", a);
      this.promote();
    }
    return true;
  }

  tick(time: number): boolean {
    if (this.destroyed) return false;
    const before = this.get();
    if (this.owner && this.owner.state !== "paused") this.applyOwnerSample(time);
    if (this.layers.length) {
      const done: ValueAnimation[] = [];
      for (const l of this.layers) {
        const s = l.gen.sample(l.elapsed(time));
        l.offset = s.value;
        if (s.done) done.push(l);
      }
      for (const l of done) {
        this.value += l.offset;
        this.layers = this.layers.filter((x) => x !== l);
        this.engine.telemetry.counters.animationsCompleted++;
        l.settle("completed");
        this.fire("complete", l);
      }
    }
    if (this.get() !== before) this.notify();
    return (this.owner !== null && this.owner.state === "running") || this.layers.length > 0;
  }

  on(event: "change", cb: ChangeListener): () => void;
  on(event: "start" | "complete" | "interrupt" | "cancel", cb: (a: ValueAnimation) => void): () => void;
  on(event: string, cb: ChangeListener | ((a: ValueAnimation) => void)): () => void {
    if (event === "change") {
      this.listeners.add(cb as ChangeListener);
      return () => this.listeners.delete(cb as ChangeListener);
    }
    let set = this.eventListeners.get(event);
    if (!set) this.eventListeners.set(event, (set = new Set()));
    set.add(cb as (a: ValueAnimation) => void);
    return () => set.delete(cb as (a: ValueAnimation) => void);
  }

  private fire(event: string, a: ValueAnimation): void {
    const set = this.eventListeners.get(event);
    if (set) for (const l of set) l(a);
    this.engine.emit("animation", { event, value: this, animation: a });
  }

  private notify(): void {
    const v = this.get();
    for (const l of this.listeners) {
      try {
        l(v, this.vel);
      } catch (err) {
        reportError(err);
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Releases all resources; further `animate` calls throw. */
  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.listeners.clear();
    this.eventListeners.clear();
    this.engine.remove(this);
    this.engine.valueCount--;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Convenience factory. */
export function motionValue(initial: number, opts?: MotionValueOptions & { engine?: Engine }): MotionValue {
  return new MotionValue(initial, opts?.engine ?? getEngine(), opts);
}
