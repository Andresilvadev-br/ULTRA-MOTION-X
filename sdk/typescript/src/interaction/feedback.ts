/**
 * Immediate interaction feedback: press, hover, focus and magnetic attraction.
 * Feedback starts on `pointerdown` (not `click`) so the response is visible on the very
 * next frame. Nothing here calls `preventDefault`: native behaviour is preserved.
 */
import { type Engine, getEngine } from "../core/engine.ts";
import { resolveSpec } from "../core/spec.ts";
import { ElementTarget } from "../dom/element-target.ts";
import { magneticOffset2D } from "../math/gesture.ts";

export interface PressOptions {
  engine?: Engine;
  /** Scale while pressed (default from Motion DNA). */
  scale?: number;
  /** Extra offset in px while pressed (e.g. 1 for a subtle push). */
  y?: number;
  onPress?: () => void;
  onRelease?: (cancelled: boolean) => void;
}

const isDisabled = (el: HTMLElement) => el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";

export function press(el: HTMLElement, opts: PressOptions = {}): () => void {
  const engine = opts.engine ?? getEngine();
  const t = ElementTarget.for(el, engine);
  let down = false;
  const pressScale = () => (engine.a11y.allows("scale") ? (opts.scale ?? engine.dna.data.pressScale) : 1);
  const begin = (ts: number) => {
    if (isDisabled(el)) return;
    engine.telemetry.noteInput(ts);
    down = true;
    t.value("scale").animate(pressScale(), resolveSpec({ spring: "snappy" }, engine.dna), { priority: "interaction" });
    if (opts.y)
      t.value("y", "px").animate(opts.y, resolveSpec({ spring: "snappy" }, engine.dna), { priority: "interaction" });
    opts.onPress?.();
  };
  const end = (cancelled: boolean) => {
    if (!down) return;
    down = false;
    t.value("scale").animate(1, resolveSpec({ spring: "bouncy" }, engine.dna), { priority: "interaction" });
    if (opts.y)
      t.value("y", "px").animate(0, resolveSpec({ spring: "bouncy" }, engine.dna), { priority: "interaction" });
    opts.onRelease?.(cancelled);
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    begin(e.timeStamp);
  };
  const onUp = () => end(false);
  const onCancel = () => end(true);
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === "Enter" || e.key === " ") && !e.repeat && e.target === el) begin(e.timeStamp);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") end(false);
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointerleave", onCancel);
  el.addEventListener("pointercancel", onCancel);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("keyup", onKeyUp);
  el.addEventListener("blur", onCancel);
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointerleave", onCancel);
    el.removeEventListener("pointercancel", onCancel);
    el.removeEventListener("keydown", onKeyDown);
    el.removeEventListener("keyup", onKeyUp);
    el.removeEventListener("blur", onCancel);
  };
}

export interface HoverOptions {
  engine?: Engine;
  lift?: number;
  scale?: number;
}

/** Hover lift for fine pointers only (touch devices never get stuck hover states). */
export function hover(el: HTMLElement, opts: HoverOptions = {}): () => void {
  const engine = opts.engine ?? getEngine();
  const t = ElementTarget.for(el, engine);
  const enter = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    const lift = engine.a11y.allows("spatial") ? (opts.lift ?? engine.dna.data.hoverLift) : 0;
    t.value("y", "px").animate(-lift, resolveSpec({ spring: "gentle" }, engine.dna), { priority: "normal" });
    if (opts.scale && engine.a11y.allows("scale"))
      t.value("scale").animate(opts.scale, resolveSpec({ spring: "gentle" }, engine.dna));
  };
  const leave = () => {
    t.value("y", "px").animate(0, resolveSpec({ spring: "gentle" }, engine.dna), { priority: "normal" });
    if (opts.scale) t.value("scale").animate(1, resolveSpec({ spring: "gentle" }, engine.dna));
  };
  el.addEventListener("pointerenter", enter);
  el.addEventListener("pointerleave", leave);
  return () => {
    el.removeEventListener("pointerenter", enter);
    el.removeEventListener("pointerleave", leave);
  };
}

export interface MagneticOptions {
  engine?: Engine;
  /** Activation radius in px around the element centre. */
  radius?: number;
  /** 0..1 */
  strength?: number;
}

/** Magnetic attraction toward the pointer (decorative; disabled under reduced motion). */
export function magnetic(el: HTMLElement, opts: MagneticOptions = {}): () => void {
  const engine = opts.engine ?? getEngine();
  const t = ElementTarget.for(el, engine);
  const radius = opts.radius ?? 80;
  const strength = opts.strength ?? 0.3;
  const spec = () => resolveSpec({ spring: "gentle" }, engine.dna);
  let rect: DOMRect | null = null;
  const move = (e: PointerEvent) => {
    if (!engine.a11y.allows("spatial") || e.pointerType === "touch") return;
    if (!rect) rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2 - t.value("x", "px").get();
    const cy = rect.top + rect.height / 2 - t.value("y", "px").get();
    const [dx, dy] = magneticOffset2D(
      e.clientX - cx,
      e.clientY - cy,
      radius + Math.max(rect.width, rect.height) / 2,
      strength,
    );
    t.value("x", "px").animate(dx, spec(), { priority: "decorative" });
    t.value("y", "px").animate(dy, spec(), { priority: "decorative" });
  };
  const leave = () => {
    rect = null;
    t.value("x", "px").animate(0, spec(), { priority: "decorative" });
    t.value("y", "px").animate(0, spec(), { priority: "decorative" });
  };
  const area = el.parentElement ?? el;
  area.addEventListener("pointermove", move, { passive: true });
  area.addEventListener("pointerleave", leave);
  const invalidate = () => {
    rect = null;
  };
  addEventListener("scroll", invalidate, { passive: true, capture: true });
  addEventListener("resize", invalidate, { passive: true });
  return () => {
    area.removeEventListener("pointermove", move);
    area.removeEventListener("pointerleave", leave);
    removeEventListener("scroll", invalidate, { capture: true });
    removeEventListener("resize", invalidate);
  };
}
