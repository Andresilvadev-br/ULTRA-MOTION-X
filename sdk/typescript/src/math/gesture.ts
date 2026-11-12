/** Gesture math: velocity tracking, rubber banding, snap selection, magnetism. */

export const VELOCITY_HORIZON = 0.1;
export const STOP_THRESHOLD = 0.04;

/** Weighted least-squares velocity estimator over the last 100 ms (times in seconds). */
export class VelocityTracker {
  private readonly t = new Float64Array(20);
  private readonly x = new Float64Array(20);
  private len = 0;
  private head = 0;

  reset(): void {
    this.len = 0;
    this.head = 0;
  }

  add(time: number, position: number): void {
    if (!Number.isFinite(time) || !Number.isFinite(position)) return;
    if (this.len > 0) {
      const last = (this.head + 19) % 20;
      if (time < this.t[last]!) this.reset();
      else if (time === this.t[last]) {
        this.x[last] = position;
        return;
      }
    }
    this.t[this.head] = time;
    this.x[this.head] = position;
    this.head = (this.head + 1) % 20;
    this.len = Math.min(this.len + 1, 20);
  }

  velocity(now: number): number {
    if (this.len < 2) return 0;
    const newestIdx = (this.head + 19) % 20;
    const tn = this.t[newestIdx]!;
    if (now - tn > STOP_THRESHOLD) return 0;
    let sw = 0;
    let st = 0;
    let sx = 0;
    let stt = 0;
    let stx = 0;
    let count = 0;
    for (let i = 0; i < this.len; i++) {
      const idx = (this.head + 19 - i) % 20;
      const age = tn - this.t[idx]!;
      if (age > VELOCITY_HORIZON) break;
      const w = 1 - (0.5 * age) / VELOCITY_HORIZON;
      const rt = this.t[idx]! - tn;
      const x = this.x[idx]!;
      sw += w;
      st += w * rt;
      sx += w * x;
      stt += w * rt * rt;
      stx += w * rt * x;
      count++;
    }
    if (count < 2) return 0;
    const denom = sw * stt - st * st;
    if (Math.abs(denom) < 1e-18) return 0;
    return (sw * stx - st * sx) / denom;
  }
}

export function rubberBand(overshoot: number, dimension: number, coefficient = 0.55): number {
  if (dimension <= 0 || overshoot === 0) return 0;
  const sign = Math.sign(overshoot);
  const x = Math.abs(overshoot);
  return sign * (1 - 1 / ((x * coefficient) / dimension + 1)) * dimension;
}

export function rubberBandClamp(
  value: number,
  min: number,
  max: number,
  dimension: number,
  coefficient = 0.55,
): number {
  if (value < min) return min + rubberBand(value - min, dimension, coefficient);
  if (value > max) return max + rubberBand(value - max, dimension, coefficient);
  return value;
}

export function selectSnapPoint(projected: number, points: readonly number[]): number | null {
  let best: number | null = null;
  for (const p of points) {
    if (!Number.isFinite(p)) continue;
    if (best === null || Math.abs(p - projected) < Math.abs(best - projected)) best = p;
  }
  return best;
}

export function magneticOffset(distance: number, radius: number, strength: number): number {
  if (radius <= 0 || Math.abs(distance) >= radius) return 0;
  const t = 1 - Math.abs(distance) / radius;
  const s = t * t * (3 - 2 * t);
  return distance * Math.min(1, Math.max(0, strength)) * s;
}

export function magneticOffset2D(dx: number, dy: number, radius: number, strength: number): [number, number] {
  const d = Math.hypot(dx, dy);
  if (d === 0) return [0, 0];
  const m = magneticOffset(d, radius, strength);
  return [(dx / d) * m, (dy / d) * m];
}

export type Intent = "tap" | "longPress" | "drag" | "swipe" | "cancel";

export interface IntentThresholds {
  dragDistance: number;
  longPress: number;
  swipeSpeed: number;
}

export const DEFAULT_INTENT: Readonly<IntentThresholds> = Object.freeze({
  dragDistance: 6,
  longPress: 0.5,
  swipeSpeed: 500,
});

export function classifyIntent(
  distance: number,
  duration: number,
  releaseSpeed: number,
  cancelled: boolean,
  th: IntentThresholds = DEFAULT_INTENT,
): Intent {
  if (cancelled) return "cancel";
  if (distance < th.dragDistance) return duration >= th.longPress ? "longPress" : "tap";
  return releaseSpeed >= th.swipeSpeed ? "swipe" : "drag";
}
