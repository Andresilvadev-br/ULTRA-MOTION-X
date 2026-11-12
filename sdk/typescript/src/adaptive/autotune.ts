/**
 * Motion Autotuning: measures, diagnoses and proposes configuration changes. Nothing is
 * applied without `approve()`; approved settings are stored locally (localStorage when
 * available) and nothing is sent anywhere.
 */
import type { Engine } from "../core/engine.ts";
import type { FidelityLevel } from "../core/fidelity.ts";
import type { TelemetryReport } from "../telemetry/telemetry.ts";

export interface TuningConfig {
  initialFidelity: FidelityLevel;
  compositor: "auto" | "always" | "never";
  budgetFraction: number;
}

export interface Recommendation {
  id: string;
  severity: "info" | "suggestion" | "warning";
  message: string;
  change?: Partial<TuningConfig>;
  evidence: Record<string, number>;
}

export function diagnose(report: TelemetryReport, config: TuningConfig): Recommendation[] {
  const out: Recommendation[] = [];
  const expected = report.expectedIntervalMs;
  const p95 = report.frameInterval.p95;
  if (report.frames < 30) {
    out.push({
      id: "insufficient-data",
      severity: "info",
      message: "Not enough frames recorded to tune (need ≥ 30).",
      evidence: { frames: report.frames },
    });
    return out;
  }
  if (p95 > expected * 1.5) {
    const lower = Math.max(0, config.initialFidelity - 1) as FidelityLevel;
    out.push({
      id: "frame-irregularity",
      severity: "warning",
      message: `p95 frame interval ${p95.toFixed(1)} ms exceeds 1.5× the refresh interval (${expected.toFixed(1)} ms). Start at fidelity ${lower}.`,
      change: { initialFidelity: lower },
      evidence: { p95, expected },
    });
  }
  const budget = expected * config.budgetFraction;
  if (report.engineWork.p95 > budget) {
    out.push({
      id: "engine-over-budget",
      severity: "suggestion",
      message: `Engine work p95 ${report.engineWork.p95.toFixed(2)} ms exceeds its budget (${budget.toFixed(2)} ms). Offload opacity/transform tweens to the compositor.`,
      change: config.compositor === "always" ? undefined : { compositor: "always" },
      evidence: { workP95: report.engineWork.p95, budget },
    });
  }
  const c = report.counters;
  if (c.writes > 0 && c.redundantWritesSkipped / (c.writes + c.redundantWritesSkipped) > 0.6) {
    out.push({
      id: "redundant-updates",
      severity: "info",
      message: "Most style updates were redundant and skipped; animations may be retargeted more often than needed.",
      evidence: { skipped: c.redundantWritesSkipped, writes: c.writes },
    });
  }
  if (c.animationsInterrupted > c.animationsCompleted * 2 && c.animationsInterrupted > 20) {
    out.push({
      id: "interrupt-heavy",
      severity: "suggestion",
      message:
        "Animations are interrupted far more often than they complete; consider snappier springs for these interactions.",
      evidence: { interrupted: c.animationsInterrupted, completed: c.animationsCompleted },
    });
  }
  if (!out.length)
    out.push({
      id: "healthy",
      severity: "info",
      message: "No measurable bottleneck detected.",
      evidence: { p95, expected },
    });
  return out;
}

/** Lower is better: weighted p95/p99 frame interval and engine work. */
export function score(r: TelemetryReport): number {
  return r.frameInterval.p95 + 0.5 * r.frameInterval.p99 + 2 * r.engineWork.p95;
}

export class MotionAutotuner {
  readonly engine: Engine;
  readonly storageKey: string;
  private samples: Array<{ config: TuningConfig; report: TelemetryReport }> = [];

  constructor(engine: Engine, appId = "default") {
    this.engine = engine;
    this.storageKey = `umx:autotune:${appId}`;
  }

  get current(): TuningConfig {
    return {
      initialFidelity: this.engine.fidelity.level,
      compositor: this.engine.options.compositor,
      budgetFraction: this.engine.options.budgetFraction,
    };
  }

  /** Records the engine's current telemetry under the current configuration. */
  capture(): TelemetryReport {
    const report = this.engine.report();
    this.samples.push({ config: this.current, report });
    return report;
  }

  recommendations(): Recommendation[] {
    return diagnose(this.engine.report(), this.current);
  }

  /** Compares captured configurations; returns the best by `score`. */
  best(): { config: TuningConfig; score: number } | null {
    const valid = this.samples.filter((s) => s.report.frames >= 30);
    if (!valid.length) return null;
    const ranked = valid.map((s) => ({ config: s.config, score: score(s.report) })).sort((a, b) => a.score - b.score);
    return ranked[0]!;
  }

  /** Applies a configuration (between interactions, never mid-animation). */
  apply(change: Partial<TuningConfig>): Promise<void> {
    return new Promise((resolve) => {
      const run = () => {
        if (change.compositor) this.engine.options.compositor = change.compositor;
        if (change.budgetFraction)
          this.engine.options.budgetFraction = Math.min(0.9, Math.max(0.1, change.budgetFraction));
        if (change.initialFidelity !== undefined) this.engine.fidelity.level = change.initialFidelity;
        resolve();
      };
      if (this.engine.isIdle) run();
      else {
        const off = this.engine.on("idle", () => {
          off();
          run();
        });
      }
    });
  }

  /** Persists an approved configuration locally. */
  approve(config: TuningConfig = this.current): void {
    try {
      globalThis.localStorage?.setItem(this.storageKey, JSON.stringify({ config, approvedAt: Date.now() }));
    } catch {
      /* storage unavailable (private mode) — keep in memory only */
    }
  }

  loadApproved(): TuningConfig | null {
    try {
      const raw = globalThis.localStorage?.getItem(this.storageKey);
      return raw ? (JSON.parse(raw).config as TuningConfig) : null;
    } catch {
      return null;
    }
  }
}
