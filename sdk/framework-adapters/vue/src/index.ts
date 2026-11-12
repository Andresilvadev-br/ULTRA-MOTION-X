/**
 * @ultra-motion-x/vue — directives (`v-umx-press`, `v-umx-hover`, `v-umx-drag`,
 * `v-umx-enter`, `v-umx-layout`) and composables. Install with `app.use(UltraMotion)`.
 */
import {
  type AnimateOptions,
  animate,
  type DragController,
  type DragOptions,
  drag,
  enter,
  hover,
  LayoutTracker,
  MotionValue,
  press,
  resolveSpec,
  type SemanticRole,
  type TransitionOptions,
} from "@ultra-motion-x/web";
import { type App, type Directive, onBeforeUnmount, type Ref, ref, watch } from "vue";

const disposers = new WeakMap<Element, () => void>();
const store = (el: Element, d: () => void) => {
  disposers.get(el)?.();
  disposers.set(el, d);
};
const dispose = (el: Element) => {
  disposers.get(el)?.();
  disposers.delete(el);
};

export const vUmxPress: Directive<HTMLElement, { scale?: number } | undefined> = {
  mounted: (el, b) => store(el, press(el, b.value ?? {})),
  unmounted: dispose,
};

export const vUmxHover: Directive<HTMLElement, { lift?: number; scale?: number } | undefined> = {
  mounted: (el, b) => store(el, hover(el, b.value ?? {})),
  unmounted: dispose,
};

export const vUmxDrag: Directive<HTMLElement, DragOptions | undefined> = {
  mounted: (el, b) => {
    const c: DragController = drag(el, b.value ?? {});
    store(el, () => c.destroy());
  },
  unmounted: dispose,
};

/** Plays the semantic entrance for a role when mounted: `v-umx-enter="'modal'"`. */
export const vUmxEnter: Directive<HTMLElement, SemanticRole | undefined> = {
  mounted: (el, b) => {
    enter(el, b.value ?? "page");
  },
};

/** FLIP children of a container on every update (v-for re-orders). */
export const vUmxLayout: Directive<HTMLElement, unknown> = {
  mounted: (el) => {
    (el as HTMLElement & { __umxLayout?: LayoutTracker }).__umxLayout = new LayoutTracker(el);
  },
  updated: (el) => {
    (el as HTMLElement & { __umxLayout?: LayoutTracker }).__umxLayout?.measure();
  },
};

export function useMotionValue(initial: number): MotionValue {
  const v = new MotionValue(initial);
  onBeforeUnmount(() => v.destroy());
  return v;
}

/** Reactive spring: returns a ref updated every frame while `source` animates. */
export function useSpring(source: Ref<number>, options: TransitionOptions = {}): Ref<number> {
  const v = useMotionValue(source.value);
  const out = ref(v.get());
  const off = v.on("change", (x) => {
    out.value = x;
  });
  watch(source, (to) => {
    v.animate(to, resolveSpec({ type: "spring", ...options }, v.engine.dna));
  });
  onBeforeUnmount(off);
  return out;
}

export function useAnimate(): (
  target: Element | string,
  values: Parameters<typeof animate>[1],
  opts?: AnimateOptions,
) => ReturnType<typeof animate> {
  const running = new Set<ReturnType<typeof animate>>();
  onBeforeUnmount(() => running.forEach((c) => c.cancel()));
  return (target, values, opts) => {
    const c = animate(target, values, opts);
    running.add(c);
    c.finished.then(() => running.delete(c));
    return c;
  };
}

export const UltraMotion = {
  install(app: App): void {
    app.directive("umx-press", vUmxPress);
    app.directive("umx-hover", vUmxHover);
    app.directive("umx-drag", vUmxDrag);
    app.directive("umx-enter", vUmxEnter);
    app.directive("umx-layout", vUmxLayout);
  },
};
