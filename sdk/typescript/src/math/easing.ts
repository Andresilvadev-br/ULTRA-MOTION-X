import { MotionError } from "./spring.ts";

export type EasingFn = (p: number) => number;

export type Easing =
  | { type: "linear" }
  | { type: "cubicBezier"; x1: number; y1: number; x2: number; y2: number }
  | { type: "steps"; count: number; jumpStart: boolean }
  | { type: "points"; values: number[] };

/** Accepted easing inputs throughout the public API. */
export type EasingInput = EasingName | [number, number, number, number] | Easing | EasingFn;

export type EasingName =
  | "linear"
  | "ease"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "standard"
  | "emphasized"
  | "decelerate"
  | "accelerate"
  | "backOut"
  | "backIn"
  | "circOut"
  | "expoOut"
  | "stepEnd"
  | "stepStart";

const NAMED: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  "ease-in": [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  "ease-out": [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
  standard: [0.2, 0, 0, 1],
  emphasized: [0.05, 0.7, 0.1, 1],
  decelerate: [0, 0, 0.2, 1],
  accelerate: [0.4, 0, 1, 1],
  backOut: [0.34, 1.56, 0.64, 1],
  backIn: [0.36, 0, 0.66, -0.56],
  circOut: [0, 0.55, 0.45, 1],
  expoOut: [0.16, 1, 0.3, 1],
};

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const e: Easing = { type: "cubicBezier", x1, y1, x2, y2 };
  validateEasing(e);
  return e;
}

export function namedEasing(name: string): Easing | null {
  if (name === "linear") return { type: "linear" };
  if (name === "stepEnd" || name === "step-end") return { type: "steps", count: 1, jumpStart: false };
  if (name === "stepStart" || name === "step-start") return { type: "steps", count: 1, jumpStart: true };
  const c = NAMED[name];
  return c ? { type: "cubicBezier", x1: c[0], y1: c[1], x2: c[2], y2: c[3] } : null;
}

export function validateEasing(e: Easing): void {
  if (e.type === "cubicBezier") {
    if (![e.x1, e.y1, e.x2, e.y2].every(Number.isFinite))
      throw new MotionError("E_EASING", "bezier control points must be finite");
    if (e.x1 < 0 || e.x1 > 1 || e.x2 < 0 || e.x2 > 1)
      throw new MotionError("E_EASING", "bezier x1/x2 must be within [0, 1]");
  } else if (e.type === "steps" && !(e.count >= 1)) {
    throw new MotionError("E_EASING", "steps count must be ≥ 1");
  } else if (e.type === "points" && (e.values.length < 2 || !e.values.every(Number.isFinite))) {
    throw new MotionError("E_EASING", "linear() needs ≥ 2 finite points");
  }
}

/** Normalises any easing input. Functions are wrapped as opaque (not serialisable). */
export function resolveEasing(
  input: EasingInput | undefined,
  fallback: Easing = namedEasing("standard")!,
): Easing | EasingFn {
  if (input === undefined) return fallback;
  if (typeof input === "function") return input;
  if (typeof input === "string") {
    const e = namedEasing(input);
    if (!e) throw new MotionError("E_EASING", `unknown easing \`${input}\``);
    return e;
  }
  if (Array.isArray(input)) return cubicBezier(input[0], input[1], input[2], input[3]);
  validateEasing(input);
  return input;
}

const bez = (t: number, p1: number, p2: number) => {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
};
const bezD = (t: number, p1: number, p2: number) => {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
};

function solveX(x: number, x1: number, x2: number): number {
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = bez(t, x1, x2) - x;
    if (Math.abs(err) < 1e-9) return t;
    const d = bezD(t, x1, x2);
    if (Math.abs(d) < 1e-7) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 60; i++) {
    const v = bez(t, x1, x2);
    if (Math.abs(v - x) < 1e-10) break;
    if (v < x) lo = t;
    else hi = t;
    t = 0.5 * (lo + hi);
  }
  return t;
}

export function applyEasing(e: Easing | EasingFn, p: number): number {
  const q = Number.isNaN(p) ? 0 : Math.min(1, Math.max(0, p));
  if (typeof e === "function") return e(q);
  switch (e.type) {
    case "linear":
      return q;
    case "cubicBezier":
      if (q === 0 || q === 1) return q;
      return bez(solveX(q, e.x1, e.x2), e.y1, e.y2);
    case "steps": {
      if (q >= 1) return 1;
      let step = Math.floor(q * e.count);
      if (e.jumpStart) step += 1;
      return Math.min(1, Math.max(0, step / e.count));
    }
    case "points": {
      const n = e.values.length - 1;
      const x = q * n;
      const i = Math.min(Math.floor(x), n - 1);
      return e.values[i]! + (e.values[i + 1]! - e.values[i]!) * (x - i);
    }
  }
}

export function easingDerivative(e: Easing | EasingFn, p: number): number {
  const q = Math.min(1, Math.max(0, p));
  if (typeof e === "function") {
    const h = 1e-4;
    const a = Math.max(0, q - h);
    const b = Math.min(1, q + h);
    return (e(b) - e(a)) / (b - a);
  }
  switch (e.type) {
    case "linear":
      return 1;
    case "cubicBezier": {
      const t = solveX(q, e.x1, e.x2);
      const dx = bezD(t, e.x1, e.x2);
      return Math.abs(dx) < 1e-12 ? 0 : bezD(t, e.y1, e.y2) / dx;
    }
    case "steps":
      return 0;
    case "points": {
      const n = e.values.length - 1;
      const i = Math.min(Math.floor(q * n), n - 1);
      return (e.values[i + 1]! - e.values[i]!) * n;
    }
  }
}

/** CSS easing string; `null` for JS functions (no CSS equivalent). */
export function easingToCss(e: Easing | EasingFn): string | null {
  if (typeof e === "function") return null;
  switch (e.type) {
    case "linear":
      return "linear";
    case "cubicBezier":
      return `cubic-bezier(${e.x1}, ${e.y1}, ${e.x2}, ${e.y2})`;
    case "steps":
      return `steps(${e.count}, ${e.jumpStart ? "jump-start" : "jump-end"})`;
    case "points":
      return `linear(${e.values.map((v) => Math.round(v * 10000) / 10000).join(", ")})`;
  }
}
