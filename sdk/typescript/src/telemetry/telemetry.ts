/**
 * Frame Intelligence Telemetry. Collection is cheap by default (ring buffers of numbers);
 * `detailed` mode additionally records per-phase timings. Every metric carries provenance:
 * measured, estimated or unavailable — nothing is invented.
 */
import { type Distribution, distribution, estimated, type Metric, measured, Ring, unavailable } from "../core/stats.ts";

export interface Counters {
  animationsStarted: number;
  animationsCompleted: number;
  animationsInterrupted: number;
  animationsCancelled: number;
  animationsRejected: number;
  writes: number;
  redundantWritesSkipped: number;
  tasksDeferred: number;
  tasksDroppedObsolete: number;
  decorativeSkipped: number;
}

export const emptyCounters = (): Counters => ({
  animationsStarted: 0,
  animationsCompleted: 0,
  animationsInterrupted: 0,
  animationsCancelled: 0,
  animationsRejected: 0,
  writes: 0,
  redundantWritesSkipped: 0,
  tasksDeferred: 0,
  tasksDroppedObsolete: 0,
  decorativeSkipped: 0,
});

export interface TelemetryReport {
  frames: number;
  frameInterval: Distribution;
  engineWork: Distribution;
  phaseUpdate: Distribution | null;
  phaseWrite: Distribution | null;
  inputToFrame: Distribution | null;
  estimatedFps: Metric;
  droppedFrames: Metric;
  regularity: Metric;
  refreshHz: Metric;
  memory: Metric;
  activeAnimations: number;
  activeValues: number;
  fidelityLevel: number;
  counters: Counters;
  expectedIntervalMs: number;
  detailed: boolean;
  timestamp: number;
}

export class Telemetry {
  readonly counters = emptyCounters();
  readonly intervals: Ring;
  private readonly work: Ring;
  private readonly update: Ring;
  private readonly write: Ring;
  private readonly inputLatency: Ring;
  private last: number | null = null;
  private dropped = 0;
  frames = 0;
  expectedInterval = 1000 / 60;
  detailed: boolean;
  private pendingInputs: number[] = [];

  constructor(window = 240, detailed = false) {
    this.intervals = new Ring(window);
    this.work = new Ring(window);
    this.update = new Ring(window);
    this.write = new Ring(window);
    this.inputLatency = new Ring(64);
    this.detailed = detailed;
  }

  /** Records an input event timestamp (event.timeStamp, same clock as rAF) so the next
   * frame can measure input → frame-start latency. This is *not* display latency. */
  noteInput(eventTimeStamp: number): void {
    if (Number.isFinite(eventTimeStamp) && eventTimeStamp > 0) this.pendingInputs.push(eventTimeStamp);
  }

  record(timestamp: number, workMs: number, updateMs?: number, writeMs?: number): void {
    if (this.last !== null) {
      const iv = timestamp - this.last;
      if (iv > 0 && iv < 1000) {
        this.intervals.push(iv);
        if (iv > this.expectedInterval * 1.5) this.dropped += Math.max(0, Math.round(iv / this.expectedInterval) - 1);
      }
    }
    this.last = timestamp;
    this.work.push(workMs);
    if (this.detailed) {
      if (updateMs !== undefined) this.update.push(updateMs);
      if (writeMs !== undefined) this.write.push(writeMs);
    }
    for (const t of this.pendingInputs) {
      const d = timestamp - t;
      if (d >= 0 && d < 1000) this.inputLatency.push(d);
    }
    this.pendingInputs.length = 0;
    this.frames++;
  }

  markIdle(): void {
    this.last = null;
  }

  reset(): void {
    this.intervals.clear();
    this.work.clear();
    this.update.clear();
    this.write.clear();
    this.inputLatency.clear();
    this.dropped = 0;
    this.frames = 0;
    this.last = null;
    Object.assign(this.counters, emptyCounters());
  }

  report(extra: {
    refreshHz?: number;
    hasRefreshEstimate?: boolean;
    activeAnimations: number;
    activeValues: number;
    fidelityLevel: number;
  }): TelemetryReport {
    const iv = this.intervals.values();
    const fi = distribution(iv);
    const mem = (globalThis.performance as (Performance & { memory?: { usedJSHeapSize: number } }) | undefined)?.memory;
    const regular = iv.length
      ? measured(iv.filter((x) => Math.abs(x / this.expectedInterval - 1) <= 0.25).length / iv.length)
      : unavailable();
    return {
      frames: this.frames,
      frameInterval: fi,
      engineWork: distribution(this.work.values()),
      phaseUpdate: this.detailed ? distribution(this.update.values()) : null,
      phaseWrite: this.detailed ? distribution(this.write.values()) : null,
      inputToFrame: this.inputLatency.length ? distribution(this.inputLatency.values()) : null,
      estimatedFps: fi.p50 > 0 ? estimated(1000 / fi.p50) : unavailable(),
      droppedFrames: iv.length ? estimated(this.dropped) : unavailable(),
      regularity: regular,
      refreshHz: extra.hasRefreshEstimate ? estimated(extra.refreshHz ?? 60) : unavailable(),
      // Whole-page JS heap (Chromium only); the engine's own share is not separable.
      memory: mem ? measured(mem.usedJSHeapSize) : unavailable(),
      activeAnimations: extra.activeAnimations,
      activeValues: extra.activeValues,
      fidelityLevel: extra.fidelityLevel,
      counters: { ...this.counters },
      expectedIntervalMs: this.expectedInterval,
      detailed: this.detailed,
      timestamp: Date.now(),
    };
  }
}

/** Relative regressions (lower is better) between two reports. */
export function compareReports(
  base: TelemetryReport,
  cur: TelemetryReport,
  tolerance = 0.1,
): Array<{ metric: string; baseline: number; current: number; change: number }> {
  const pairs: Array<[string, number, number]> = [
    ["frameInterval.p95", base.frameInterval.p95, cur.frameInterval.p95],
    ["frameInterval.p99", base.frameInterval.p99, cur.frameInterval.p99],
    ["engineWork.p50", base.engineWork.p50, cur.engineWork.p50],
    ["engineWork.p95", base.engineWork.p95, cur.engineWork.p95],
  ];
  return pairs
    .filter(([, b, c]) => b > 0 && (c - b) / b > tolerance)
    .map(([metric, baseline, current]) => ({ metric, baseline, current, change: (current - baseline) / baseline }));
}
