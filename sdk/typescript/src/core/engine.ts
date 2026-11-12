/**
 * Ultra Motion Runtime (web). One engine drives every animation of a document through a
 * single on-demand frame loop: no frame is requested while nothing moves.
 */
import { Accessibility, type ReducedMotionSetting } from "../a11y/accessibility.ts";
import { PowerMonitor, type PowerPolicy } from "../adaptive/power.ts";
import { Telemetry, type TelemetryReport } from "../telemetry/telemetry.ts";
import { MotionDNA, type ProfileName } from "../tokens/dna.ts";
import { createDefaultDriver, type FrameDriver } from "./driver.ts";
import { type FidelityConfig, FidelityController, type FidelityLevel, type FidelitySettings } from "./fidelity.ts";
import { RefreshEstimator } from "./refresh.ts";
import {
  FrameScheduler,
  type Phase,
  PRIORITY_ORDER,
  reportError,
  type ScheduleOptions,
  type TaskPriority,
} from "./scheduler.ts";

export interface Tickable {
  /** Ordering and deferral class. */
  readonly tickPriority: TaskPriority;
  /** Advances to engine `time` (s). Return `false` when inactive (it is then removed). */
  tick(time: number, dt: number): boolean;
}

export interface EngineOptions {
  driver?: FrameDriver;
  /** Longest frame delta (ms) applied in one step; longer stalls act as a pause. */
  maxDelta?: number;
  /** Deterministic mode: every frame advances exactly this many ms. */
  fixedStep?: number;
  profile?: ProfileName | MotionDNA;
  reducedMotion?: ReducedMotionSetting;
  maxIntensity?: number;
  fidelity?: Partial<FidelityConfig>;
  /** Fraction of the refresh interval the engine aims to stay within. */
  budgetFraction?: number;
  telemetry?: boolean | "detailed";
  /** Compositor (Web Animations API) offloading: "auto" (opacity-only), "always" or "never". */
  compositor?: "auto" | "always" | "never";
  /** Observe visibility / battery / compute pressure. Default true in browsers. */
  powerAware?: boolean;
  /** Expose the engine on `globalThis.__ULTRA_MOTION_X__` for DevTools. */
  devtoolsHook?: boolean;
}

export type EngineEvent = "frame" | "idle" | "fidelity" | "power" | "reducedmotion" | "warning" | "animation";

type Listener = (payload: unknown) => void;

let idCounter = 0;
export const nextId = (): number => ++idCounter;

export class Engine {
  readonly id = nextId();
  readonly driver: FrameDriver;
  readonly scheduler = new FrameScheduler();
  readonly telemetry: Telemetry;
  readonly fidelity: FidelityController;
  readonly refresh = new RefreshEstimator();
  readonly a11y: Accessibility;
  readonly power = new PowerMonitor();
  dna: MotionDNA;
  options: Required<Pick<EngineOptions, "maxDelta" | "budgetFraction" | "compositor">> & EngineOptions;

  /** Engine time in seconds (sum of applied frame deltas). */
  time = 0;
  /** Global time scale (DevTools slow motion / Studio playback). 1 = real time. */
  timeScale = 1;
  frameCount = 0;
  /** Number of live MotionValues (maintained by MotionValue). */
  valueCount = 0;
  private readonly tickables = new Set<Tickable>();
  private frameHandle: unknown = null;
  private lastTimestamp: number | null = null;
  private suspended = false;
  private destroyed = false;
  private listeners = new Map<EngineEvent, Set<Listener>>();
  private frameStart = 0;
  private powerPolicy: PowerPolicy | null = null;

  constructor(opts: EngineOptions = {}) {
    this.driver = opts.driver ?? createDefaultDriver();
    this.options = { maxDelta: 100, budgetFraction: 0.5, compositor: "auto", ...opts };
    this.telemetry = new Telemetry(240, opts.telemetry === "detailed");
    this.fidelity = new FidelityController(opts.fidelity);
    this.a11y = new Accessibility({
      reducedMotion: opts.reducedMotion ?? "user",
      maxIntensity: opts.maxIntensity ?? 1,
    });
    this.dna = opts.profile instanceof MotionDNA ? opts.profile : MotionDNA.profile(opts.profile);
    this.scheduler.onSchedule = () => this.wake();
    this.a11y.onChange((r) => this.emit("reducedmotion", r));
    const browser = typeof document !== "undefined";
    if (opts.powerAware ?? browser) {
      this.power.onChange((p) => this.applyPower(p));
      this.power.start();
    }
    if (opts.devtoolsHook) (globalThis as Record<string, unknown>).__ULTRA_MOTION_X__ = this;
  }

  get reducedMotion(): boolean {
    return this.a11y.reduced;
  }

  get fidelitySettings(): FidelitySettings {
    return this.fidelity.settings;
  }

  get activeCount(): number {
    return this.tickables.size;
  }

  get isIdle(): boolean {
    return this.tickables.size === 0 && this.scheduler.pending === 0;
  }

  setProfile(profile: ProfileName | MotionDNA): void {
    this.dna = profile instanceof MotionDNA ? profile : MotionDNA.profile(profile);
  }

  setFidelity(level: FidelityLevel | null): void {
    const c = this.fidelity.setManual(level);
    if (c) this.emit("fidelity", c);
  }

  add(t: Tickable): void {
    if (this.destroyed) return;
    this.tickables.add(t);
    this.wake();
  }

  remove(t: Tickable): void {
    this.tickables.delete(t);
  }

  has(t: Tickable): boolean {
    return this.tickables.has(t);
  }

  read(fn: (budgetLeftMs: number) => void, opts?: ScheduleOptions): () => void {
    return this.scheduler.schedule("read", fn, opts);
  }
  write(fn: (budgetLeftMs: number) => void, opts?: ScheduleOptions): () => void {
    return this.scheduler.schedule("write", fn, opts);
  }
  schedule(phase: Phase, fn: (budgetLeftMs: number) => void, opts?: ScheduleOptions): () => void {
    return this.scheduler.schedule(phase, fn, opts);
  }

  /** Requests a frame if needed. */
  wake(): void {
    if (this.frameHandle !== null || this.suspended || this.destroyed) return;
    this.frameHandle = this.driver.request(this.onFrame);
  }

  private readonly onFrame = (ts: number): void => {
    this.frameHandle = null;
    this.frame(ts);
  };

  /** Remaining budget (ms) in the current frame. */
  budgetLeft(): number {
    const budget = this.refresh.intervalMs * this.options.budgetFraction;
    return budget - (this.driver.now() - this.frameStart);
  }

  /** Runs one frame at presentation timestamp `ts` (ms). Public for custom drivers. */
  frame(ts: number): void {
    if (this.destroyed) return;
    this.frameStart = this.driver.now();
    const fixed = this.options.fixedStep;
    let dtMs = fixed ?? (this.lastTimestamp === null ? 0 : ts - this.lastTimestamp);
    if (!(dtMs >= 0)) dtMs = 0;
    dtMs =
      Math.min(dtMs, this.options.maxDelta) *
      (Number.isFinite(this.timeScale) && this.timeScale >= 0 ? this.timeScale : 1);
    this.lastTimestamp = ts;
    if (this.refresh.sample(ts)) this.telemetry.expectedInterval = this.refresh.intervalMs;
    if (this.refresh.hasEstimate && dtMs > 0) {
      const change = this.fidelity.observe(dtMs > this.refresh.intervalMs * 1.5);
      if (change) this.emit("fidelity", change);
    }
    const dt = dtMs / 1000;
    this.time += dt;
    this.frameCount++;
    const remaining = () => this.budgetLeft();

    this.scheduler.run("input", remaining);
    const tUpdate = this.driver.now();
    const ordered = [...this.tickables].sort((a, b) => PRIORITY_ORDER[a.tickPriority] - PRIORITY_ORDER[b.tickPriority]);
    const divisor = this.fidelity.settings.decorativeFrameDivisor;
    const pauseDecorative = this.powerPolicy?.pauseDecorative ?? false;
    for (const t of ordered) {
      if (t.tickPriority === "decorative" || t.tickPriority === "idle") {
        // Decorative work yields to everything else: skipped over budget, throttled by fidelity.
        if (pauseDecorative || divisor === 0 || this.frameCount % divisor !== 0 || remaining() <= 0) {
          this.telemetry.counters.decorativeSkipped++;
          continue;
        }
      }
      let keep = false;
      try {
        keep = t.tick(this.time, dt);
      } catch (err) {
        reportError(err);
      }
      if (!keep) this.tickables.delete(t);
    }
    const updateMs = this.driver.now() - tUpdate;
    this.scheduler.run("update", remaining);
    this.scheduler.run("read", remaining);
    const tWrite = this.driver.now();
    this.scheduler.run("write", remaining);
    const writeMs = this.driver.now() - tWrite;
    this.scheduler.run("post", remaining);
    const work = this.driver.now() - this.frameStart;
    this.telemetry.counters.tasksDeferred = this.scheduler.deferred;
    this.telemetry.counters.tasksDroppedObsolete = this.scheduler.droppedObsolete;
    this.telemetry.record(ts, work, updateMs, writeMs);
    this.emit("frame", ts);
    if (this.tickables.size > 0 || this.scheduler.pending > 0) {
      this.wake();
    } else {
      // Idle: stop the loop entirely; the next interval series starts fresh.
      this.lastTimestamp = null;
      this.telemetry.markIdle();
      this.refresh.breakContinuity();
      this.emit("idle", ts);
    }
  }

  private applyPower(p: PowerPolicy): void {
    this.powerPolicy = p;
    const change = this.fidelity.setCeiling(p.maxFidelity);
    if (change) this.emit("fidelity", change);
    if (p.suspend && !this.suspended) {
      this.suspended = true;
      if (this.frameHandle !== null) this.driver.cancel(this.frameHandle);
      this.frameHandle = null;
      this.lastTimestamp = null;
      this.refresh.breakContinuity();
      this.telemetry.markIdle();
    } else if (!p.suspend && this.suspended) {
      this.suspended = false;
      if (this.tickables.size || this.scheduler.pending) this.wake();
    }
    this.emit("power", p);
  }

  on(event: EngineEvent, cb: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }

  emit(event: EngineEvent, payload: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const l of set) {
      try {
        l(payload);
      } catch (err) {
        reportError(err);
      }
    }
  }

  warn(message: string, detail?: unknown): void {
    this.emit("warning", { message, detail });
  }

  report(): TelemetryReport {
    return this.telemetry.report({
      refreshHz: this.refresh.hz,
      hasRefreshEstimate: this.refresh.hasEstimate,
      activeAnimations: this.tickables.size,
      activeValues: this.valueCount,
      fidelityLevel: this.fidelity.level,
    });
  }

  /** Stops the loop, detaches observers and drops all work. */
  destroy(): void {
    this.destroyed = true;
    if (this.frameHandle !== null) this.driver.cancel(this.frameHandle);
    this.frameHandle = null;
    this.tickables.clear();
    this.scheduler.clear();
    this.power.stop();
    this.a11y.destroy();
    this.listeners.clear();
    if ((globalThis as Record<string, unknown>).__ULTRA_MOTION_X__ === this)
      delete (globalThis as Record<string, unknown>).__ULTRA_MOTION_X__;
    if (defaultEngine === this) defaultEngine = null;
  }
}

let defaultEngine: Engine | null = null;

/** The shared engine (created lazily on first use). */
export function getEngine(): Engine {
  if (!defaultEngine) defaultEngine = new Engine();
  return defaultEngine;
}

/** Replaces the shared engine (e.g. to configure it before any animation starts). */
export function configureEngine(opts: EngineOptions): Engine {
  defaultEngine?.destroy();
  defaultEngine = new Engine(opts);
  return defaultEngine;
}

export function createEngine(opts: EngineOptions = {}): Engine {
  return new Engine(opts);
}
