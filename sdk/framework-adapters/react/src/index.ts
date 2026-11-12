/**
 * @ultra-motion-x/react — idiomatic hooks over the framework-agnostic Web SDK. Every hook
 * cleans up on unmount (animations cancelled, listeners removed, values destroyed).
 */
import {
  type AnimateOptions,
  type AnimationControls,
  animate,
  type DragController,
  type DragOptions,
  drag,
  type Engine,
  type GestureOptions,
  type GraphDef,
  getEngine,
  gestures,
  hover,
  LayoutTracker,
  MotionGraph,
  MotionValue,
  press,
  type PressOptions,
  type TransitionOptions,
  resolveSpec,
} from "@ultra-motion-x/web";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

type PressOpts = Parameters<typeof press>[1];
export type { PressOptions };

/** The shared engine. */
export function useEngine(): Engine {
  return getEngine();
}

/** A MotionValue owned by the component (destroyed on unmount). */
export function useMotionValue(initial: number): MotionValue {
  const ref = useRef<MotionValue | null>(null);
  if (!ref.current) ref.current = new MotionValue(initial);
  useEffect(() => {
    const v = ref.current!;
    return () => v.destroy();
  }, []);
  return ref.current;
}

/** Subscribes React state to a MotionValue (re-renders on change — prefer refs for styles). */
export function useMotionValueState(value: MotionValue): number {
  return useSyncExternalStore(
    (cb) => value.on("change", cb),
    () => value.get(),
    () => value.get(),
  );
}

/** A value that springs to `target` whenever it changes (velocity preserved). */
export function useSpring(target: number, options: TransitionOptions = {}): MotionValue {
  const v = useMotionValue(target);
  const opts = useRef(options);
  opts.current = options;
  useEffect(() => {
    v.animate(target, resolveSpec({ type: "spring", ...opts.current }, v.engine.dna));
  }, [target, v]);
  return v;
}

/**
 * Returns a ref for a scope element and an `animate` bound to it; selectors resolve inside the
 * scope. Running animations are cancelled on unmount.
 */
export function useAnimate<T extends Element = HTMLElement>(): [RefObject<T | null>, (target: Element | string, values: Parameters<typeof animate>[1], opts?: AnimateOptions) => AnimationControls] {
  const scope = useRef<T | null>(null);
  const running = useRef(new Set<AnimationControls>());
  useEffect(() => {
    const set = running.current;
    return () => {
      for (const c of set) c.cancel();
      set.clear();
    };
  }, []);
  const run = useCallback((target: Element | string, values: Parameters<typeof animate>[1], opts?: AnimateOptions) => {
    const t = typeof target === "string" && scope.current ? scope.current.querySelectorAll(target) : target;
    const c = animate(t as Element, values, opts);
    running.current.add(c);
    c.finished.then(() => running.current.delete(c));
    return c;
  }, []);
  return [scope, run];
}

function useAttach<T extends HTMLElement, R>(ref: RefObject<T | null>, attach: (el: T) => R, cleanup: (r: R) => void, deps: unknown[]): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = attach(el);
    return () => cleanup(r);
    // biome-ignore lint/correctness/useExhaustiveDependencies: caller-provided deps
  }, deps);
}

export function usePress<T extends HTMLElement>(ref: RefObject<T | null>, opts: PressOpts = {}): void {
  useAttach(ref, (el) => press(el, opts), (d) => d(), [ref, opts.scale]);
}

export function useHover<T extends HTMLElement>(ref: RefObject<T | null>, opts: Parameters<typeof hover>[1] = {}): void {
  useAttach(ref, (el) => hover(el, opts), (d) => d(), [ref, opts.lift, opts.scale]);
}

export function useDrag<T extends HTMLElement>(ref: RefObject<T | null>, opts: DragOptions = {}): RefObject<DragController | null> {
  const ctrl = useRef<DragController | null>(null);
  useAttach(
    ref,
    (el) => (ctrl.current = drag(el, opts)),
    (c) => {
      c.destroy();
      ctrl.current = null;
    },
    [ref, opts.axis],
  );
  return ctrl;
}

export function useGestures<T extends HTMLElement>(ref: RefObject<T | null>, opts: GestureOptions): void {
  const latest = useRef(opts);
  latest.current = opts;
  useAttach(
    ref,
    (el) =>
      gestures(el, {
        onTap: (e) => latest.current.onTap?.(e),
        onDoubleTap: (e) => latest.current.onDoubleTap?.(e),
        onLongPress: (e) => latest.current.onLongPress?.(e),
        onPanStart: (e) => latest.current.onPanStart?.(e),
        onPan: (e) => latest.current.onPan?.(e),
        onPanEnd: (e) => latest.current.onPanEnd?.(e),
        onSwipe: (e) => latest.current.onSwipe?.(e),
        onPinch: (e) => latest.current.onPinch?.(e),
        onPinchEnd: (e) => latest.current.onPinchEnd?.(e),
        onWheel: (e) => latest.current.onWheel?.(e),
      }),
    (d) => d(),
    [ref],
  );
}

/**
 * FLIP layout animation for a container whose children React re-orders/inserts: call with
 * the data that drives the list as `deps`.
 */
export function useLayoutTransition<T extends Element>(ref: RefObject<T | null>, deps: unknown[]): void {
  const tracker = useRef<LayoutTracker | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    if (!tracker.current || tracker.current.container !== ref.current) {
      tracker.current = new LayoutTracker(ref.current);
      return;
    }
    tracker.current.measure();
    // biome-ignore lint/correctness/useExhaustiveDependencies: caller-provided deps
  }, deps);
}

/** A MotionGraph bound to the component; `send` is stable. */
export function useMotionGraph(def: GraphDef, bindTo?: RefObject<Element | null>, map?: Record<string, string>): { graph: MotionGraph; send: (event: string) => boolean; state: string } {
  const g = useRef<MotionGraph | null>(null);
  if (!g.current) g.current = new MotionGraph(def);
  const [state, setState] = useState(g.current.state);
  useEffect(() => {
    const graph = g.current!;
    const off = graph.on((e) => {
      if (e.type === "transitionstart" || e.type === "transitionend") setState(graph.state);
    });
    const unbind = bindTo?.current ? graph.bind(bindTo.current, map) : undefined;
    return () => {
      off();
      unbind?.();
    };
  }, [bindTo, map]);
  useEffect(() => () => g.current?.destroy(), []);
  const send = useCallback((event: string) => g.current!.send(event), []);
  return { graph: g.current, send, state };
}

/** Live reduced-motion preference (respects the engine's accessibility settings). */
export function useReducedMotion(): boolean {
  const engine = getEngine();
  return useSyncExternalStore(
    (cb) => engine.on("reducedmotion", cb),
    () => engine.reducedMotion,
    () => false,
  );
}
