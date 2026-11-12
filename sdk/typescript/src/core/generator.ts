import { Decay, type DecayParams } from "../math/decay.ts";
import { applyEasing, type Easing, type EasingFn, easingDerivative } from "../math/easing.ts";
import { Inertia, type InertiaParams } from "../math/inertia.ts";
import { Keyframes, type KeyframesSpec } from "../math/keyframes.ts";
import { MotionError, Spring, type SpringParams } from "../math/spring.ts";

/** Declarative animation description. Times are in **seconds** (the DOM API uses ms). */
export type AnimationSpec =
  | { type: "tween"; duration: number; easing: Easing | EasingFn; delay?: number }
  | { type: "spring"; spring: SpringParams; delay?: number }
  | { type: "decay"; decay: DecayParams }
  | { type: "inertia"; inertia: InertiaParams }
  | { type: "keyframes"; keyframes: KeyframesSpec; duration: number; delay?: number }
  | { type: "instant" };

export interface Sample {
  value: number;
  velocity: number;
  done: boolean;
}

export const preservesVelocity = (s: AnimationSpec): boolean =>
  s.type === "spring" || s.type === "decay" || s.type === "inertia";

/** A pure, scrubbable curve for one scalar (mirrors `umx_core::Generator`). */
export class Generator {
  readonly spec: AnimationSpec;
  readonly from: number;
  readonly delay: number;
  readonly duration: number;
  readonly target: number;
  private readonly impl: (t: number) => Sample;

  constructor(spec: AnimationSpec, from: number, to: number, velocity = 0) {
    if (!Number.isFinite(from) || !Number.isFinite(velocity))
      throw new MotionError("E_NOT_FINITE", "from and velocity must be finite");
    this.spec = spec;
    this.from = from;
    this.delay = "delay" in spec && spec.delay ? Math.max(0, spec.delay) : 0;
    switch (spec.type) {
      case "instant":
        this.impl = () => ({ value: to, velocity: 0, done: true });
        this.duration = 0;
        this.target = to;
        break;
      case "tween": {
        if (!Number.isFinite(to)) throw new MotionError("E_NOT_FINITE", "target must be finite");
        if (!(spec.duration >= 0 && spec.duration <= 3600))
          throw new MotionError("E_RANGE", "duration must be within [0, 3600] s");
        const d = spec.duration;
        const e = spec.easing;
        this.impl =
          d === 0
            ? () => ({ value: to, velocity: 0, done: true })
            : (t) =>
                t >= d
                  ? { value: to, velocity: 0, done: true }
                  : {
                      value: from + (to - from) * applyEasing(e, t / d),
                      velocity: ((to - from) * easingDerivative(e, t / d)) / d,
                      done: false,
                    };
        this.duration = d;
        this.target = to;
        break;
      }
      case "spring": {
        const s = new Spring(spec.spring, from, to, velocity);
        this.impl = (t) => s.sample(t);
        this.duration = s.finishTime;
        this.target = to;
        break;
      }
      case "decay": {
        const s = new Decay(spec.decay, from, velocity);
        this.impl = (t) => s.sample(t);
        this.duration = s.finishTime;
        this.target = s.sample(Number.POSITIVE_INFINITY).value;
        break;
      }
      case "inertia": {
        const s = new Inertia(spec.inertia, from, velocity);
        this.impl = (t) => s.sample(t);
        this.duration = s.finishTime;
        this.target = s.target;
        break;
      }
      case "keyframes": {
        const values = spec.keyframes.values.map((v, i) => (i === 0 && Number.isNaN(v) ? from : v));
        const kf = new Keyframes({ ...spec.keyframes, values });
        const d = spec.duration;
        if (!(d > 0 && d <= 3600)) throw new MotionError("E_RANGE", "keyframes duration must be within (0, 3600] s");
        this.impl = (t) => {
          if (t >= d) return { value: kf.sample(1)[0], velocity: 0, done: true };
          const [v, dv] = kf.sample(t / d);
          return { value: v, velocity: dv / d, done: false };
        };
        this.duration = d;
        this.target = values[values.length - 1]!;
        break;
      }
    }
    this.duration += this.delay;
  }

  sample(t: number): Sample {
    const tt = Number.isNaN(t) ? 0 : t;
    if (tt < this.delay) return { value: this.from, velocity: 0, done: false };
    return this.impl(tt - this.delay);
  }

  /** New generator starting at this generator's state at `t` (velocity carried for physics). */
  retarget(t: number, spec: AnimationSpec, to: number): Generator {
    const s = this.sample(t);
    return new Generator(spec, s.value, to, preservesVelocity(spec) ? s.velocity : 0);
  }
}
