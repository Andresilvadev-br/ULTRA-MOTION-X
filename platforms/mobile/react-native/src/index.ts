/**
 * @ultra-motion-x/react-native — uses the framework-agnostic core (springs, decay, inertia,
 * motion graphs, arbitration) and pushes values into React Native's own animation system:
 * `Animated.Value#setValue` (JS-driven) or a `setNativeProps` callback. React Native keeps
 * rendering and gestures; the core only computes motion.
 *
 * The frame driver uses RN's global requestAnimationFrame. Types are structural so the
 * package does not pin a React Native version.
 */
import {
  createEngine,
  type Engine,
  type FrameDriver,
  MotionValue,
  resolveSpec,
  type TransitionOptions,
} from "@ultra-motion-x/web";

export interface AnimatedValueLike {
  setValue(v: number): void;
}

/** Frame driver backed by React Native's requestAnimationFrame. */
type Raf = (cb: (t: number) => void) => number;
const rnGlobal = globalThis as unknown as {
  requestAnimationFrame?: Raf;
  cancelAnimationFrame?: (h: number) => void;
  performance?: { now(): number };
};

export function reactNativeDriver(
  raf: Raf | undefined = rnGlobal.requestAnimationFrame,
  caf: ((h: number) => void) | undefined = rnGlobal.cancelAnimationFrame,
): FrameDriver {
  if (!raf || !caf) throw new Error("requestAnimationFrame is not available in this runtime");
  const now = () => (rnGlobal.performance ? rnGlobal.performance.now() : Date.now());
  return { kind: "react-native", now, request: (cb) => raf((t) => cb(t)), cancel: (h) => caf(h as number) };
}

let shared: Engine | null = null;
/** Shared engine using the RN frame driver (power/visibility handled by RN AppState if wired). */
export function getNativeEngine(driver?: FrameDriver): Engine {
  shared ??= createEngine({ driver: driver ?? reactNativeDriver(), powerAware: false });
  return shared;
}

/**
 * Binds a MotionValue to an `Animated.Value` (or any sink). Returns a disposer.
 * Use the Animated.Value in styles as usual: `transform: [{ translateX: animated }]`.
 */
export function bindAnimated(value: MotionValue, target: AnimatedValueLike | ((v: number) => void)): () => void {
  const push = typeof target === "function" ? target : (v: number) => target.setValue(v);
  push(value.get());
  return value.on("change", (v) => push(v));
}

/** A spring-driven value mirrored into `target`, retargeting with momentum on every `to`. */
export class SpringValue {
  readonly value: MotionValue;
  private readonly options: TransitionOptions;
  private dispose: () => void;
  constructor(
    initial: number,
    target: AnimatedValueLike | ((v: number) => void),
    options: TransitionOptions = {},
    engine: Engine = getNativeEngine(),
  ) {
    this.options = options;
    this.value = new MotionValue(initial, engine);
    this.dispose = bindAnimated(this.value, target);
  }
  to(target: number, options: TransitionOptions = this.options): Promise<unknown> {
    return this.value.animate(target, resolveSpec({ type: "spring", ...options }, this.value.engine.dna), {
      priority: "interaction",
    }).finished;
  }
  /** Continue a gesture: release velocity (units/s) carries into an inertia animation. */
  fling(velocity: number, opts: { min?: number; max?: number; snapTo?: number[] } = {}): Promise<unknown> {
    this.value.jump(this.value.get(), velocity);
    return this.value.animate(Number.NaN, resolveSpec({ type: "inertia", ...opts }, this.value.engine.dna), {
      priority: "interaction",
    }).finished;
  }
  /** Follow a finger directly (gesture priority). */
  track(position: number, velocity = 0): void {
    this.value.stop();
    this.value.jump(position, velocity);
  }
  destroy(): void {
    this.dispose();
    this.value.destroy();
  }
}
