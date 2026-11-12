import { percentile, Ring } from "./stats.ts";

const RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 300, 360, 480];

export function snapRate(raw: number): number {
  let best = Math.round(raw);
  let bestErr = Number.POSITIVE_INFINITY;
  for (const r of RATES) {
    const err = Math.abs(raw - r) / r;
    if (err < 0.06 && err < bestErr) {
      best = r;
      bestErr = err;
    }
  }
  return best;
}

/** Display refresh estimation from frame timestamps (mirror of umx-scheduler::refresh). */
export class RefreshEstimator {
  private readonly intervals = new Ring(90);
  private last: number | null = null;
  hz = 60;
  variable = false;
  changes = 0;

  sample(timestamp: number): boolean {
    if (this.last !== null) {
      const dt = timestamp - this.last;
      if (dt > 0.5 && dt < 100) this.intervals.push(dt);
    }
    this.last = timestamp;
    if (this.intervals.length < 8) return false;
    const recent = this.intervals.values().slice(-30);
    const lower = percentile(recent, 0.25);
    const median = percentile(recent, 0.5);
    const upper = percentile(recent, 0.75);
    const base = median > lower * 1.6 ? lower : median;
    const hz = snapRate(1000 / base);
    const ratio = median / lower;
    const frac = ratio - Math.floor(ratio);
    this.variable = (upper - lower) / median > 0.2 && Math.min(frac, 1 - frac) > 0.15;
    if (Math.abs(hz - this.hz) > 0.5) {
      this.hz = hz;
      this.changes++;
      return true;
    }
    return false;
  }

  breakContinuity(): void {
    this.last = null;
  }
  get intervalMs(): number {
    return 1000 / this.hz;
  }
  get hasEstimate(): boolean {
    return this.intervals.length >= 8;
  }
}
