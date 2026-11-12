/** Converts user-facing transition options (milliseconds, tokens) into AnimationSpecs. */
import { DEFAULT_DECAY, type DecayParams } from "../math/decay.ts";
import { type EasingInput, resolveEasing } from "../math/easing.ts";
import { defaultInertia } from "../math/inertia.ts";
import { MotionError, type SpringParams, springParams } from "../math/spring.ts";
import type { MotionDNA, SpringTokenName } from "../tokens/dna.ts";
import type { AnimationSpec } from "./generator.ts";

export interface TransitionOptions {
  type?: "spring" | "tween" | "keyframes" | "decay" | "inertia" | "instant";
  /** ms */
  duration?: number;
  /** ms */
  delay?: number;
  ease?: EasingInput | EasingInput[];
  /** Spring token (`snappy`, `standard`, `gentle`, `bouncy`) or explicit parameters. */
  spring?: SpringTokenName | Partial<SpringParams>;
  stiffness?: number;
  damping?: number;
  mass?: number;
  /** Perceptual spring: period in seconds. */
  response?: number;
  dampingRatio?: number;
  /** -1..1 with `duration` (ms) for duration-based springs. */
  bounce?: number;
  restDelta?: number;
  restSpeed?: number;
  /** Stop at the first target crossing. */
  clamp?: boolean;
  /** Initial velocity override (units/s). */
  velocity?: number;
  /** Keyframe offsets 0..1. */
  times?: number[];
  /** Decay/inertia time constant (ms). */
  timeConstant?: number;
  min?: number;
  max?: number;
  snapTo?: number[];
  bounceStiffness?: number;
  bounceDamping?: number;
}

const SPRING_KEYS = [
  "stiffness",
  "damping",
  "mass",
  "response",
  "dampingRatio",
  "bounce",
  "restDelta",
  "restSpeed",
] as const;

export function resolveSpring(opts: TransitionOptions, dna: MotionDNA): SpringParams {
  if (typeof opts.spring === "string") return { ...dna.spring(opts.spring), clampOvershoot: opts.clamp ?? false };
  const explicit: Record<string, number | boolean | undefined> = { ...(opts.spring ?? {}) };
  for (const k of SPRING_KEYS) if (opts[k] !== undefined) explicit[k] = opts[k];
  const hasPhysical = SPRING_KEYS.some((k) => explicit[k] !== undefined);
  if (!hasPhysical && opts.duration === undefined)
    return { ...dna.spring("standard"), clampOvershoot: opts.clamp ?? false };
  return springParams({
    ...(explicit as Partial<SpringParams>),
    ...(opts.duration !== undefined && explicit.stiffness === undefined && explicit.response === undefined
      ? { duration: opts.duration }
      : {}),
    clampOvershoot: opts.clamp ?? false,
  });
}

/** Resolves a transition for a single scalar. `keyframeCount > 1` selects keyframes. */
export function resolveSpec(opts: TransitionOptions, dna: MotionDNA, keyframeValues?: number[]): AnimationSpec {
  const delay = (opts.delay ?? 0) / 1000;
  if (delay < 0 || !Number.isFinite(delay)) throw new MotionError("E_RANGE", "delay must be ≥ 0");
  let type = opts.type;
  if (!type) {
    if (keyframeValues && keyframeValues.length > 2) type = "keyframes";
    else if (
      opts.ease !== undefined ||
      (opts.duration !== undefined && opts.bounce === undefined && opts.spring === undefined)
    )
      type = "tween";
    else type = "spring";
  }
  switch (type) {
    case "instant":
      return { type: "instant" };
    case "tween": {
      const easing = resolveEasing(
        Array.isArray(opts.ease) && typeof opts.ease[0] !== "number"
          ? (opts.ease[0] as EasingInput)
          : (opts.ease as EasingInput | undefined),
        dna.easing("standard"),
      );
      return { type: "tween", duration: (opts.duration ?? dna.duration("normal")) / 1000, easing, delay };
    }
    case "spring":
      return { type: "spring", spring: resolveSpring(opts, dna), delay };
    case "keyframes": {
      if (!keyframeValues || keyframeValues.length < 1) throw new MotionError("E_KEYFRAMES", "keyframes need values");
      const eases =
        Array.isArray(opts.ease) && typeof opts.ease[0] !== "number"
          ? (opts.ease as EasingInput[])
          : opts.ease
            ? [opts.ease as EasingInput]
            : [];
      return {
        type: "keyframes",
        keyframes: { values: keyframeValues, offsets: opts.times, easings: eases.map((e) => resolveEasing(e)) },
        duration: (opts.duration ?? dna.duration("slow")) / 1000,
        delay,
      };
    }
    case "decay": {
      const decay: DecayParams = {
        ...DEFAULT_DECAY,
        timeConstant: opts.timeConstant !== undefined ? opts.timeConstant / 1000 : dna.data.flingTimeConstant,
      };
      return { type: "decay", decay };
    }
    case "inertia": {
      const base = defaultInertia();
      return {
        type: "inertia",
        inertia: {
          decay: {
            ...base.decay,
            timeConstant: opts.timeConstant !== undefined ? opts.timeConstant / 1000 : dna.data.flingTimeConstant,
          },
          bounceSpring: springParams({ stiffness: opts.bounceStiffness ?? 500, damping: opts.bounceDamping ?? 40 }),
          min: opts.min,
          max: opts.max,
          snapPoints: opts.snapTo,
        },
      };
    }
    default:
      throw new MotionError("E_SPEC_TYPE", `unknown transition type \`${String(type)}\``);
  }
}
