/**
 * Official motion preset library. Every preset is built from the same core and the shared
 * Motion DNA, is light by default (no infinite decorative loops unless asked) and returns a
 * disposer or controls so it can be removed cleanly.
 */
import { type Engine, getEngine } from "../core/engine.ts";
import { MotionValue } from "../core/motion-value.ts";
import { resolveSpec } from "../core/spec.ts";
import { type AnimationControls, animate } from "../dom/animate.ts";
import { ElementTarget } from "../dom/element-target.ts";
import { type DragOptions, drag } from "../interaction/drag.ts";
import { hover, magnetic, press } from "../interaction/feedback.ts";
import { layoutTransition } from "../living/layout.ts";
import { viewTransition } from "../living/shared.ts";
import { tilt } from "../living/spatial.ts";
import { closeDialog, enter, exit, openDialog, progressTo } from "../semantic/semantic.ts";

type Ctx = { engine?: Engine };
const eng = (c?: Ctx) => c?.engine ?? getEngine();

/** Animated tab indicator: moves/resizes `indicator` under `tab` (FLIP on x and width). */
export function tabIndicator(indicator: HTMLElement, tab: HTMLElement, ctx?: Ctx): AnimationControls {
  const engine = eng(ctx);
  const parent = indicator.offsetParent as HTMLElement | null;
  const base = parent?.getBoundingClientRect().left ?? 0;
  const r = tab.getBoundingClientRect();
  indicator.style.transformOrigin = "0 0";
  const width = indicator.offsetWidth || 1;
  return animate(indicator, { x: r.left - base, scaleX: r.width / width }, { engine, spring: "snappy" });
}

/** Expands/collapses an element's height (measures content; ends on `height: auto`). */
export async function expand(el: HTMLElement, open: boolean, ctx?: Ctx): Promise<void> {
  const engine = eng(ctx);
  const from = el.getBoundingClientRect().height;
  el.style.overflow = "hidden";
  const to = open ? el.scrollHeight : 0;
  el.style.height = `${from}px`;
  const t = ElementTarget.for(el, engine);
  const h = t.value("height", "px");
  h.set(from);
  await h.animate(to, resolveSpec({ spring: "standard", clamp: true }, engine.dna)).finished;
  if (open) {
    el.style.height = "";
    el.style.overflow = "";
  }
}

/** Smooth programmatic scrolling with a spring (instant under reduced motion). */
export function scrollToY(y: number, ctx?: Ctx & { container?: HTMLElement }): Promise<unknown> {
  const engine = eng(ctx);
  const c = ctx?.container;
  const current = c ? c.scrollTop : scrollY;
  if (engine.reducedMotion) {
    c ? (c.scrollTop = y) : scrollTo(0, y);
    return Promise.resolve();
  }
  const mv = new MotionValue(current, engine, { name: "scroll" });
  const off = mv.on("change", (v) =>
    engine.write(() => (c ? (c.scrollTop = v) : scrollTo(0, v)), { key: "umx:scroll" }),
  );
  // Any user scroll input cancels the programmatic scroll immediately.
  const cancel = () => mv.stop();
  const target: EventTarget = c ?? globalThis;
  target.addEventListener("wheel", cancel, { passive: true, once: true });
  target.addEventListener("touchstart", cancel, { passive: true, once: true });
  return mv
    .animate(y, resolveSpec({ spring: "gentle", clamp: true }, engine.dna), { priority: "interaction" })
    .finished.then((o) => {
      off();
      mv.destroy();
      target.removeEventListener("wheel", cancel);
      target.removeEventListener("touchstart", cancel);
      return o;
    });
}

/** Skeleton/loading shimmer: decorative, paused while offscreen, stopped by the disposer. */
export function loadingPulse(el: HTMLElement, ctx?: Ctx): () => void {
  const engine = eng(ctx);
  let controls: AnimationControls | null = null;
  const start = () => {
    if (controls || engine.reducedMotion) return;
    controls = animate(
      el,
      { opacity: [1, 0.55, 1] },
      {
        engine,
        duration: 1400,
        ease: "easeInOut",
        repeat: Number.POSITIVE_INFINITY,
        priority: "decorative",
        compositor: true,
      },
    );
  };
  const stop = () => {
    controls?.cancel();
    controls = null;
    ElementTarget.peek(el)?.value("opacity").set(1);
  };
  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((e) => (e[0]?.isIntersecting ? start() : stop()))
      : null;
  io ? io.observe(el) : start();
  return () => {
    io?.disconnect();
    stop();
  };
}

/** Window/panel opening from a source element (shared-element style), e.g. desktop apps. */
export function openWindow(win: HTMLElement, origin?: Element, ctx?: Ctx): AnimationControls {
  const engine = eng(ctx);
  if (origin && !engine.reducedMotion) {
    const a = origin.getBoundingClientRect();
    const b = win.getBoundingClientRect();
    win.style.transformOrigin = `${a.left + a.width / 2 - b.left}px ${a.top + a.height / 2 - b.top}px`;
  }
  return animate(win, engine.reducedMotion ? { opacity: [0, 1] } : { opacity: [0, 1], scale: [0.9, 1] }, {
    engine,
    spring: "standard",
    transitions: { opacity: { duration: engine.dna.duration("fast") } },
  });
}

export const presets = {
  button: (el: HTMLElement, ctx?: Ctx) => press(el, { engine: eng(ctx) }),
  card: (el: HTMLElement, ctx?: Ctx) => {
    const a = hover(el, { engine: eng(ctx) });
    const b = press(el, { engine: eng(ctx), scale: 0.985 });
    return () => {
      a();
      b();
    };
  },
  menu: {
    enter: (el: Element, ctx?: Ctx) => enter(el, "menu", ctx),
    exit: (el: Element, ctx?: Ctx) => exit(el, "menu", ctx),
  },
  modal: {
    open: openDialog,
    close: closeDialog,
    enter: (el: Element, ctx?: Ctx) => enter(el, "modal", ctx),
    exit: (el: Element, ctx?: Ctx) => exit(el, "modal", ctx),
  },
  drawer: {
    enter: (el: Element, ctx?: Ctx) => enter(el, "drawer", ctx),
    exit: (el: Element, ctx?: Ctx) => exit(el, "drawer", ctx),
  },
  notification: {
    enter: (el: Element, ctx?: Ctx) => enter(el, "notification", ctx),
    exit: (el: Element, ctx?: Ctx) => exit(el, "notification", ctx),
  },
  tooltip: {
    enter: (el: Element, ctx?: Ctx) => enter(el, "tooltip", ctx),
    exit: (el: Element, ctx?: Ctx) => exit(el, "tooltip", ctx),
  },
  overlay: {
    enter: (el: Element, ctx?: Ctx) =>
      animate(el, { opacity: [0, 1] }, { engine: eng(ctx), duration: eng(ctx).dna.duration("fast") }),
    exit: (el: Element, ctx?: Ctx) =>
      animate(el, { opacity: 0 }, { engine: eng(ctx), duration: eng(ctx).dna.duration("fast") }),
  },
  list: (container: Element, mutate: () => void | Promise<void>, ctx?: Ctx) =>
    layoutTransition(container, mutate, { engine: eng(ctx), mode: "position", stagger: eng(ctx).dna.data.stagger / 4 }),
  tabs: tabIndicator,
  page: (update: () => void | Promise<void>, ctx?: Ctx) => viewTransition(update, { engine: eng(ctx) }),
  window: openWindow,
  draggable: (el: HTMLElement, opts?: DragOptions) => drag(el, opts),
  scroll: scrollToY,
  loading: loadingPulse,
  progress: progressTo,
  expand,
  magnetic: (el: HTMLElement, ctx?: Ctx & { radius?: number; strength?: number }) =>
    magnetic(el, { ...ctx, engine: eng(ctx) }),
  spatial: (el: HTMLElement, ctx?: Ctx & { max?: number }) => tilt(el, { ...ctx, engine: eng(ctx) }),
  /** Forms: intentionally no decorative motion; only a focus ring transition via CSS tokens. */
  form: (form: HTMLElement) => {
    form.style.setProperty("--umx-focus-transition", "box-shadow var(--umx-duration-fast, 120ms) ease-out");
    return () => form.style.removeProperty("--umx-focus-transition");
  },
} as const;
