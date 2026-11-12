import { applyEasing, type Easing, type EasingFn, easingDerivative } from "./easing.ts";
import { MotionError } from "./spring.ts";

export interface KeyframesSpec {
  values: number[];
  /** Offsets in [0, 1], non-decreasing. Omitted = evenly spaced. */
  offsets?: number[];
  /** One easing for all segments or one per segment. */
  easings?: Array<Easing | EasingFn>;
}

export class Keyframes {
  readonly values: number[];
  readonly offsets: number[];
  readonly easings: Array<Easing | EasingFn>;

  constructor(spec: KeyframesSpec) {
    const { values } = spec;
    if (!values.length) throw new MotionError("E_KEYFRAMES", "at least one value is required");
    if (!values.every(Number.isFinite)) throw new MotionError("E_KEYFRAMES", "values must be finite");
    const n = values.length;
    const offsets = spec.offsets?.length ? spec.offsets : values.map((_, i) => (n === 1 ? 1 : i / (n - 1)));
    if (offsets.length !== n) throw new MotionError("E_KEYFRAMES", "offsets must match values length");
    let last = 0;
    for (const o of offsets) {
      if (!(o >= 0 && o <= 1) || o < last)
        throw new MotionError("E_KEYFRAMES", "offsets must be non-decreasing within [0, 1]");
      last = o;
    }
    const easings = spec.easings ?? [];
    if (easings.length > 1 && easings.length !== n - 1)
      throw new MotionError("E_KEYFRAMES", `expected 1 or ${n - 1} easings`);
    this.values = values;
    this.offsets = offsets;
    this.easings = easings;
  }

  /** [value, d(value)/d(progress)] at linear progress p. */
  sample(p: number): [number, number] {
    const q = Math.min(1, Math.max(0, p));
    const n = this.values.length;
    if (n === 1) return [this.values[0]!, 0];
    let seg = n - 2;
    for (let i = 0; i < n - 1; i++) {
      if (q <= this.offsets[i + 1]!) {
        seg = i;
        break;
      }
    }
    const o0 = this.offsets[seg]!;
    const span = this.offsets[seg + 1]! - o0;
    const local = span <= 0 ? 1 : (q - o0) / span;
    const e = this.easings.length === 0 ? null : this.easings.length === 1 ? this.easings[0]! : this.easings[seg]!;
    const eased = e ? applyEasing(e, local) : local;
    const d = e ? easingDerivative(e, local) : 1;
    const a = this.values[seg]!;
    const b = this.values[seg + 1]!;
    return [a + (b - a) * eased, span <= 0 ? 0 : ((b - a) * d) / span];
  }
}
