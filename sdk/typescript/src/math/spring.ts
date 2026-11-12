/**
 * Closed-form damped harmonic oscillator — TypeScript implementation of the Ultra Motion X
 * spring specification (identical formulas to `engine/physics/src/spring.rs`, verified by
 * the cross-implementation conformance vectors in `tests/conformance`).
 *
 * The state is an exact function of elapsed time, so the trajectory does not depend on the
 * display refresh rate, and any instant can be queried (scrubbing, retargeting).
 */

const CRITICAL_EPSILON = 1e-6;

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
  /** Distance from target under which the spring may rest. */
  restDelta: number;
  /** Speed (units/s) under which the spring may rest. */
  restSpeed: number;
  /** Finish at the first target crossing (no overshoot). */
  clampOvershoot: boolean;
  /** Maximum number of target crossings; 0 = unlimited. */
  maxOscillations: number;
}

export const DEFAULT_SPRING: Readonly<SpringParams> = Object.freeze({
  stiffness: 170,
  damping: 26,
  mass: 1,
  restDelta: 0.001,
  restSpeed: 0.01,
  clampOvershoot: false,
  maxOscillations: 0,
});

export class MotionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MotionError";
    this.code = code;
  }
}

function checkRange(name: string, v: number, min: number, max: number): void {
  if (!Number.isFinite(v)) throw new MotionError("E_NOT_FINITE", `parameter \`${name}\` must be a finite number`);
  if (v < min || v > max) throw new MotionError("E_RANGE", `parameter \`${name}\` = ${v} is outside [${min}, ${max}]`);
}

export function validateSpring(p: SpringParams): void {
  checkRange("stiffness", p.stiffness, 1e-6, 1e9);
  checkRange("damping", p.damping, 0, 1e9);
  checkRange("mass", p.mass, 1e-6, 1e9);
  checkRange("restDelta", p.restDelta, 0, 1e9);
  checkRange("restSpeed", p.restSpeed, 0, 1e9);
}

/** Builds spring parameters from any supported parametrisation. */
export function springParams(
  input: Partial<SpringParams> & { response?: number; dampingRatio?: number; duration?: number; bounce?: number } = {},
): SpringParams {
  let base: Pick<SpringParams, "stiffness" | "damping" | "mass">;
  if (input.response !== undefined && input.dampingRatio !== undefined) {
    base = fromResponse(input.response, input.dampingRatio);
  } else if (input.duration !== undefined && input.stiffness === undefined) {
    base = fromDurationBounce(input.duration / 1000, input.bounce ?? 0);
  } else {
    base = {
      stiffness: input.stiffness ?? DEFAULT_SPRING.stiffness,
      damping: input.damping ?? DEFAULT_SPRING.damping,
      mass: input.mass ?? DEFAULT_SPRING.mass,
    };
  }
  const p: SpringParams = {
    ...base,
    restDelta: input.restDelta ?? DEFAULT_SPRING.restDelta,
    restSpeed: input.restSpeed ?? DEFAULT_SPRING.restSpeed,
    clampOvershoot: input.clampOvershoot ?? false,
    maxOscillations: input.maxOscillations ?? 0,
  };
  validateSpring(p);
  return p;
}

/** Perceptual parametrisation: response = undamped period (s), dampingRatio = ζ. */
export function fromResponse(
  response: number,
  dampingRatio: number,
): Pick<SpringParams, "stiffness" | "damping" | "mass"> {
  checkRange("response", response, 1e-4, 1e4);
  checkRange("dampingRatio", dampingRatio, 0, 1e3);
  const mass = 1;
  const omega = (2 * Math.PI) / response;
  const stiffness = omega * omega * mass;
  return { stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness * mass), mass };
}

/** Designer parametrisation: duration (s) and bounce ∈ [-1, 1]. */
export function fromDurationBounce(
  duration: number,
  bounce: number,
): Pick<SpringParams, "stiffness" | "damping" | "mass"> {
  checkRange("bounce", bounce, -1, 1);
  const ratio = bounce >= 0 ? 1 - bounce : 1 / Math.max(1 + bounce, 1e-3);
  return fromResponse(duration, ratio);
}

export const naturalFrequency = (p: Pick<SpringParams, "stiffness" | "mass">): number =>
  Math.sqrt(p.stiffness / p.mass);
export const dampingRatio = (p: Pick<SpringParams, "stiffness" | "damping" | "mass">): number =>
  p.damping / (2 * Math.sqrt(p.stiffness * p.mass));

type Solution =
  | { kind: "under"; alpha: number; wd: number; a: number; b: number }
  | { kind: "critical"; w: number; a: number; b: number }
  | { kind: "over"; r1: number; r2: number; c1: number; c2: number };

export interface SpringSample {
  value: number;
  velocity: number;
  done: boolean;
}

export class Spring {
  readonly params: SpringParams;
  readonly from: number;
  readonly to: number;
  readonly initialVelocity: number;
  readonly finishTime: number;
  private readonly sol: Solution;

  constructor(params: SpringParams, from: number, to: number, initialVelocity = 0) {
    validateSpring(params);
    for (const [n, v] of [
      ["from", from],
      ["to", to],
      ["initialVelocity", initialVelocity],
    ] as const) {
      if (!Number.isFinite(v)) throw new MotionError("E_NOT_FINITE", `\`${n}\` must be finite`);
    }
    this.params = params;
    this.from = from;
    this.to = to;
    this.initialVelocity = initialVelocity;
    const x0 = from - to;
    const v0 = initialVelocity;
    const w0 = naturalFrequency(params);
    const zeta = dampingRatio(params);
    if (Math.abs(zeta - 1) < CRITICAL_EPSILON) {
      this.sol = { kind: "critical", w: w0, a: x0, b: v0 + w0 * x0 };
    } else if (zeta < 1) {
      const alpha = zeta * w0;
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      this.sol = { kind: "under", alpha, wd, a: x0, b: (v0 + alpha * x0) / wd };
    } else {
      const s = Math.sqrt(zeta * zeta - 1);
      const r1 = -w0 * (zeta - s);
      const r2 = -w0 * (zeta + s);
      const c1 = (v0 - r2 * x0) / (r1 - r2);
      this.sol = { kind: "over", r1, r2, c1, c2: x0 - c1 };
    }
    this.finishTime = this.computeFinishTime();
  }

  /** Displacement from target and velocity at time t (s), without completion logic. */
  displacement(t: number): [number, number] {
    const s = this.sol;
    switch (s.kind) {
      case "under": {
        const e = Math.exp(-s.alpha * t);
        const c = Math.cos(s.wd * t);
        const sn = Math.sin(s.wd * t);
        return [e * (s.a * c + s.b * sn), e * ((s.b * s.wd - s.alpha * s.a) * c - (s.a * s.wd + s.alpha * s.b) * sn)];
      }
      case "critical": {
        const e = Math.exp(-s.w * t);
        return [e * (s.a + s.b * t), e * (s.b - s.w * (s.a + s.b * t))];
      }
      case "over": {
        const e1 = Math.exp(s.r1 * t);
        const e2 = Math.exp(s.r2 * t);
        return [s.c1 * e1 + s.c2 * e2, s.c1 * s.r1 * e1 + s.c2 * s.r2 * e2];
      }
    }
  }

  sample(t: number): SpringSample {
    const tt = Number.isFinite(t) ? Math.max(0, t) : Number.POSITIVE_INFINITY;
    if (tt >= this.finishTime) return { value: this.to, velocity: 0, done: true };
    const [x, v] = this.displacement(tt);
    return { value: this.to + x, velocity: v, done: false };
  }

  /** New spring towards `to` starting from this spring's exact state at `t`. */
  retarget(t: number, to: number, params: SpringParams = this.params): Spring {
    const s = this.sample(t);
    return new Spring(params, s.value, to, s.velocity);
  }

  crossingTimes(limit: number): number[] {
    const out: number[] = [];
    const s = this.sol;
    if (s.kind === "under") {
      if (s.a === 0 && s.b === 0) return out;
      const phi = Math.atan2(s.b, s.a);
      let n = Math.floor((-phi - Math.PI / 2) / Math.PI);
      while (out.length < limit && n < 1e7) {
        const t = (phi + Math.PI / 2 + n * Math.PI) / s.wd;
        if (t > 1e-12) out.push(t);
        n += 1;
      }
    } else if (s.kind === "critical") {
      if (s.b !== 0) {
        const t = -s.a / s.b;
        if (t > 1e-12 && limit > 0) out.push(t);
      }
    } else if (s.c1 !== 0) {
      const ratio = -s.c2 / s.c1;
      if (ratio > 0) {
        const t = Math.log(ratio) / (s.r1 - s.r2);
        if (t > 1e-12 && limit > 0) out.push(t);
      }
    }
    return out;
  }

  private computeFinishTime(): number {
    const p = this.params;
    if (this.from === this.to && this.initialVelocity === 0) return 0;
    if (p.clampOvershoot) {
      const c = this.crossingTimes(1);
      if (c.length) return c[0]!;
    }
    if (p.maxOscillations > 0) {
      const c = this.crossingTimes(p.maxOscillations);
      if (c.length === p.maxOscillations) return Math.min(c[c.length - 1]!, this.envelopeRestTime());
    }
    return this.envelopeRestTime();
  }

  /** Earliest time after which the envelope of |x| and |v| stays under the rest thresholds. */
  private envelopeRestTime(): number {
    const delta = Math.max(this.params.restDelta, 1e-12);
    const speed = Math.max(this.params.restSpeed, 1e-12);
    const s = this.sol;
    if (s.kind === "under") {
      if (s.alpha <= 0) return Number.POSITIVE_INFINITY;
      const r = Math.hypot(s.a, s.b);
      const w0 = Math.hypot(s.wd, s.alpha);
      const tx = r > delta ? Math.log(r / delta) / s.alpha : 0;
      const tv = r * w0 > speed ? Math.log((r * w0) / speed) / s.alpha : 0;
      return Math.max(tx, tv);
    }
    if (s.kind === "over") {
      const bx = Math.abs(s.c1) + Math.abs(s.c2);
      const bv = Math.abs(s.c1 * s.r1) + Math.abs(s.c2 * s.r2);
      const tx = bx > delta ? Math.log(bx / delta) / -s.r1 : 0;
      const tv = bv > speed ? Math.log(bv / speed) / -s.r1 : 0;
      return Math.max(tx, tv);
    }
    const { w, a, b } = s;
    const f = (t: number) =>
      Math.max(
        (Math.abs(a) + Math.abs(b) * t) * Math.exp(-w * t) - delta,
        (Math.abs(b) + w * Math.abs(a) + w * Math.abs(b) * t) * Math.exp(-w * t) - speed,
      );
    if (f(0) <= 0 && f(1 / w) <= 0) return 0;
    let lo = 1 / w;
    let hi = Math.max(lo, 1e-3);
    let guard = 0;
    while (f(hi) > 0 && guard++ < 200) {
      lo = hi;
      hi *= 2;
    }
    for (let i = 0; i < 80; i++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) > 0) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  /** Samples normalised progress for baking into CSS `linear()` (compositor path). */
  bakeProgress(count: number): number[] {
    const span = this.to - this.from;
    const end = Number.isFinite(this.finishTime) ? this.finishTime : 10;
    const n = Math.max(1, count);
    const out: number[] = [];
    for (let i = 0; i <= n; i++) {
      const p = this.sample((end * i) / n).value;
      out.push(span === 0 ? 1 : (p - this.from) / span);
    }
    return out;
  }
}
