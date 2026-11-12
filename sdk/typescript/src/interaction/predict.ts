/**
 * Predictive interaction. Predictions are only used to *prepare* (warm caches, promote
 * layers, prefetch) — never to execute irreversible actions.
 */
import { VelocityTracker } from "../math/gesture.ts";

/** Linear extrapolation of a pointer `aheadMs` into the future. */
export function predictPosition(
  x: number,
  y: number,
  vx: number,
  vy: number,
  aheadMs: number,
): { x: number; y: number } {
  return { x: x + (vx * aheadMs) / 1000, y: y + (vy * aheadMs) / 1000 };
}

/** Where a fling released now would come to rest (exponential decay projection). */
export function projectRelease(position: number, velocity: number, timeConstant = 0.325): number {
  return position + velocity * timeConstant;
}

export interface IntentTowardOptions {
  /** How far ahead (ms) to project the pointer. */
  horizon?: number;
  /** Minimum speed (px/s) for a prediction to count. */
  minSpeed?: number;
  /** Called once when the pointer is predicted to reach the element (non-destructive work only). */
  onPredict: (el: Element) => void;
}

/**
 * Hover-intent prediction: fires `onPredict` when the pointer trajectory is heading into one
 * of `elements` within `horizon` ms, typically to warm resources before the actual hover.
 */
export function predictIntent(elements: Iterable<Element>, opts: IntentTowardOptions): () => void {
  const vx = new VelocityTracker();
  const vy = new VelocityTracker();
  const fired = new WeakSet<Element>();
  const horizon = opts.horizon ?? 200;
  const minSpeed = opts.minSpeed ?? 150;
  const list = [...elements];
  const move = (e: PointerEvent) => {
    const t = e.timeStamp / 1000;
    vx.add(t, e.clientX);
    vy.add(t, e.clientY);
    const sx = vx.velocity(t);
    const sy = vy.velocity(t);
    if (Math.hypot(sx, sy) < minSpeed) return;
    const p = predictPosition(e.clientX, e.clientY, sx, sy, horizon);
    for (const el of list) {
      if (fired.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (segmentHitsRect(e.clientX, e.clientY, p.x, p.y, r)) {
        fired.add(el);
        opts.onPredict(el);
      }
    }
  };
  addEventListener("pointermove", move, { passive: true });
  return () => removeEventListener("pointermove", move);
}

export function segmentHitsRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: { left: number; top: number; right: number; bottom: number },
): boolean {
  // Liang–Barsky clipping.
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const checks: Array<[number, number]> = [
    [-dx, x0 - r.left],
    [dx, r.right - x0],
    [-dy, y0 - r.top],
    [dy, r.bottom - y0],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}
