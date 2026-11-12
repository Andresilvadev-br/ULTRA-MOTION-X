import { DEFAULT_DECAY, Decay, type DecayParams } from "./decay.ts";
import { selectSnapPoint } from "./gesture.ts";
import { Spring, type SpringParams, springParams } from "./spring.ts";

export interface InertiaParams {
  decay: DecayParams;
  bounceSpring: SpringParams;
  min?: number;
  max?: number;
  snapPoints?: readonly number[];
}

export const defaultInertia = (): InertiaParams => ({
  decay: { ...DEFAULT_DECAY },
  bounceSpring: springParams({ stiffness: 500, damping: 40 }),
});

type Phase =
  | { kind: "spring"; spring: Spring }
  | { kind: "decay"; decay: Decay }
  | { kind: "decayThenSpring"; decay: Decay; switchTime: number; spring: Spring };

/** Piecewise-analytic inertia: decay → boundary spring (rubber band) or snap spring. */
export class Inertia {
  readonly target: number;
  readonly finishTime: number;
  private readonly phase: Phase;

  constructor(p: InertiaParams, from: number, velocity: number) {
    const min = p.min ?? Number.NEGATIVE_INFINITY;
    const max = p.max ?? Number.POSITIVE_INFINITY;
    if (from < min || from > max) {
      const bound = from < min ? min : max;
      this.phase = { kind: "spring", spring: new Spring(p.bounceSpring, from, bound, velocity) };
      this.target = bound;
    } else {
      const decay = new Decay(p.decay, from, velocity);
      if (p.snapPoints?.length) {
        const projected = Math.min(max, Math.max(min, decay.projectedEnd));
        const snap = Math.min(max, Math.max(min, selectSnapPoint(projected, p.snapPoints) ?? projected));
        this.phase = { kind: "spring", spring: new Spring(p.bounceSpring, from, snap, velocity) };
        this.target = snap;
      } else {
        const end = decay.projectedEnd;
        const bound = end > max ? max : end < min ? min : null;
        const t = bound === null ? null : decay.timeToReach(bound);
        if (bound !== null && t !== null) {
          const v = decay.sample(t).velocity;
          this.phase = {
            kind: "decayThenSpring",
            decay,
            switchTime: t,
            spring: new Spring(p.bounceSpring, bound, bound, v),
          };
          this.target = bound;
        } else {
          this.phase = { kind: "decay", decay };
          this.target = end;
        }
      }
    }
    const ph = this.phase;
    this.finishTime =
      ph.kind === "spring"
        ? ph.spring.finishTime
        : ph.kind === "decay"
          ? ph.decay.finishTime
          : ph.switchTime + ph.spring.finishTime;
  }

  sample(t: number): { value: number; velocity: number; done: boolean } {
    const ph = this.phase;
    if (ph.kind === "spring") return ph.spring.sample(t);
    if (ph.kind === "decay") return ph.decay.sample(t);
    if (t < ph.switchTime) return { ...ph.decay.sample(t), done: false };
    return ph.spring.sample(t - ph.switchTime);
  }
}
