import { MotionError } from "./spring.ts";

export interface DecayParams {
  /** Time constant τ (s). */
  timeConstant: number;
  /** Speed (units/s) under which the motion finishes. */
  restSpeed: number;
}

export const DEFAULT_DECAY: Readonly<DecayParams> = Object.freeze({ timeConstant: 0.325, restSpeed: 0.5 });

export function decayFromRate(rate: number): DecayParams {
  if (!(rate >= 0.5 && rate <= 0.999999))
    throw new MotionError("E_RANGE", "deceleration rate must be within [0.5, 0.999999]");
  return { timeConstant: -1 / (1000 * Math.log(rate)), restSpeed: DEFAULT_DECAY.restSpeed };
}

/** Exponential momentum decay: v(t) = v0·e^(−t/τ), x(t) = x0 + v0·τ·(1 − e^(−t/τ)). */
export class Decay {
  readonly params: DecayParams;
  readonly from: number;
  readonly velocity: number;
  readonly finishTime: number;

  constructor(params: DecayParams, from: number, velocity: number) {
    if (!(params.timeConstant >= 1e-4 && params.timeConstant <= 1e3))
      throw new MotionError("E_RANGE", "timeConstant must be within [1e-4, 1e3] s");
    if (!(params.restSpeed > 0)) throw new MotionError("E_RANGE", "restSpeed must be > 0");
    if (!Number.isFinite(from) || !Number.isFinite(velocity))
      throw new MotionError("E_NOT_FINITE", "from/velocity must be finite");
    this.params = params;
    this.from = from;
    this.velocity = velocity;
    this.finishTime =
      Math.abs(velocity) <= params.restSpeed
        ? 0
        : params.timeConstant * Math.log(Math.abs(velocity) / params.restSpeed);
  }

  get projectedEnd(): number {
    return this.from + this.velocity * this.params.timeConstant;
  }

  sample(t: number): { value: number; velocity: number; done: boolean } {
    const tau = this.params.timeConstant;
    const tt = Math.max(0, t);
    if (tt >= this.finishTime) {
      const e = Math.exp(-this.finishTime / tau);
      return { value: this.from + this.velocity * tau * (1 - e), velocity: 0, done: true };
    }
    const e = Math.exp(-tt / tau);
    return { value: this.from + this.velocity * tau * (1 - e), velocity: this.velocity * e, done: false };
  }

  timeToReach(x: number): number | null {
    const tau = this.params.timeConstant;
    const d = x - this.from;
    if (this.velocity === 0) return d === 0 ? 0 : null;
    const frac = d / (this.velocity * tau);
    if (!(frac >= 0 && frac < 1)) return null;
    return -tau * Math.log(1 - frac);
  }
}
