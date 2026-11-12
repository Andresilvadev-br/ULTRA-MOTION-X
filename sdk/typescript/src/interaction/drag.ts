/**
 * Draggable elements with direct manipulation, rubber-banded bounds, momentum (inertia),
 * snap points, magnetic snapping, axis locking, keyboard support and gesture → animation
 * continuity (the release velocity becomes the initial velocity of the settle animation).
 */
import { type Engine, getEngine } from "../core/engine.ts";
import type { MotionValue } from "../core/motion-value.ts";
import { resolveSpec } from "../core/spec.ts";
import { ElementTarget } from "../dom/element-target.ts";
import { classifyIntent, type Intent, rubberBandClamp } from "../math/gesture.ts";
import { PointerTracker } from "./pointer.ts";

export interface Bounds {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export interface DragInfo {
  x: number;
  y: number;
  vx: number;
  vy: number;
  intent: Intent;
}

export interface DragOptions {
  engine?: Engine;
  axis?: "x" | "y" | "both";
  /** Pixel bounds relative to the starting transform, or an element to stay within. */
  bounds?: Bounds | HTMLElement | "parent";
  /** 0 = hard stop, 1 = free; default from Motion DNA elasticity. */
  elastic?: number;
  momentum?: boolean;
  /** Snap targets per axis (px). */
  snapX?: number[];
  snapY?: number[];
  /** Minimum movement (px) before a drag starts (keeps clicks working). */
  threshold?: number;
  /** Arrow-key step (px) for keyboard dragging; 0 disables. */
  keyboardStep?: number;
  disabled?: boolean;
  onStart?: (info: DragInfo) => void;
  onMove?: (info: DragInfo) => void;
  onEnd?: (info: DragInfo) => void;
}

export interface DragController {
  readonly x: MotionValue;
  readonly y: MotionValue;
  readonly dragging: boolean;
  setDisabled(disabled: boolean): void;
  /** Animate to a position (respects bounds). */
  moveTo(x: number, y: number): void;
  destroy(): void;
}

export function drag(el: HTMLElement, opts: DragOptions = {}): DragController {
  const engine = opts.engine ?? getEngine();
  const target = ElementTarget.for(el, engine);
  const x = target.value("x", "px");
  const y = target.value("y", "px");
  const axis = opts.axis ?? "both";
  const threshold = opts.threshold ?? 3;
  let disabled = opts.disabled ?? false;
  let dragging = false;
  let origin = { x: 0, y: 0 };
  let suppressClick = false;

  const elastic = () => opts.elastic ?? engine.dna.data.elasticity;
  const resolveBounds = (): Required<Bounds> => {
    const inf = {
      left: Number.NEGATIVE_INFINITY,
      right: Number.POSITIVE_INFINITY,
      top: Number.NEGATIVE_INFINITY,
      bottom: Number.POSITIVE_INFINITY,
    };
    const b = opts.bounds;
    if (!b) return inf;
    if (b === "parent" || b instanceof HTMLElement) {
      const container = b === "parent" ? el.parentElement : b;
      if (!container) return inf;
      const c = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const cx = x.get();
      const cy = y.get();
      return {
        left: c.left - (r.left - cx),
        right: c.right - (r.right - cx),
        top: c.top - (r.top - cy),
        bottom: c.bottom - (r.bottom - cy),
      };
    }
    return { ...inf, ...b };
  };
  let bounds = resolveBounds();

  const prevTouchAction = el.style.touchAction;
  el.style.touchAction = axis === "x" ? "pan-y" : axis === "y" ? "pan-x" : "none";

  const info = (vx: number, vy: number, intent: Intent): DragInfo => ({ x: x.get(), y: y.get(), vx, vy, intent });

  const settle = (vx: number, vy: number) => {
    const momentum = opts.momentum !== false;
    const tau = engine.dna.data.flingTimeConstant * 1000;
    for (const [mv, v, lo, hi, snaps, active] of [
      [x, vx, bounds.left, bounds.right, opts.snapX, axis !== "y"],
      [y, vy, bounds.top, bounds.bottom, opts.snapY, axis !== "x"],
    ] as const) {
      if (!active) continue;
      mv.jump(mv.get(), momentum ? v : 0);
      const spec = momentum
        ? resolveSpec(
            {
              type: "inertia",
              timeConstant: tau,
              min: Number.isFinite(lo) ? lo : undefined,
              max: Number.isFinite(hi) ? hi : undefined,
              snapTo: snaps,
            },
            engine.dna,
          )
        : resolveSpec({ spring: "snappy" }, engine.dna);
      const clamped = Math.min(hi, Math.max(lo, mv.get()));
      mv.animate(clamped, spec, { priority: "interaction" });
    }
  };

  const tracker = new PointerTracker(el, {
    onInput: (ts) => engine.telemetry.noteInput(ts),
    onDown: () => {
      if (disabled) return false;
      bounds = resolveBounds();
      origin = { x: x.get(), y: y.get() };
      // Catch the element mid-flight: stop its animation exactly where it is.
      x.stop();
      y.stop();
      origin = { x: x.get(), y: y.get() };
      return undefined;
    },
    onMove: (p) => {
      const dx = p.x - p.startX;
      const dy = p.y - p.startY;
      if (!dragging) {
        const dist = axis === "x" ? Math.abs(dx) : axis === "y" ? Math.abs(dy) : Math.hypot(dx, dy);
        if (dist < threshold) return;
        dragging = true;
        suppressClick = true;
        el.dataset.umxDragging = "";
        opts.onStart?.(info(0, 0, "drag"));
      }
      const e = elastic();
      const w = el.offsetWidth || 100;
      const h = el.offsetHeight || 100;
      if (axis !== "y") x.jump(rubberBandClamp(origin.x + dx, bounds.left, bounds.right, w, e));
      if (axis !== "x") y.jump(rubberBandClamp(origin.y + dy, bounds.top, bounds.bottom, h, e));
      // Direct manipulation owns the values: claim them at gesture priority.
      const v = PointerTracker.velocity(p);
      opts.onMove?.(info(v.x, v.y, "drag"));
    },
    onUp: (p) => {
      const v = PointerTracker.velocity(p);
      const dist = Math.hypot(p.x - p.startX, p.y - p.startY);
      const intent = classifyIntent(dist, p.lastTime - p.startTime, Math.hypot(v.x, v.y), false);
      if (dragging) {
        dragging = false;
        delete el.dataset.umxDragging;
        settle(axis === "y" ? 0 : v.x, axis === "x" ? 0 : v.y);
        opts.onEnd?.(info(v.x, v.y, intent));
      }
    },
    onCancel: () => {
      if (!dragging) return;
      dragging = false;
      delete el.dataset.umxDragging;
      // Cancelled gestures return to where they started.
      x.animate(origin.x, resolveSpec({ spring: "snappy" }, engine.dna), { priority: "interaction" });
      y.animate(origin.y, resolveSpec({ spring: "snappy" }, engine.dna), { priority: "interaction" });
      opts.onEnd?.(info(0, 0, "cancel"));
    },
  });

  const onClick = (e: MouseEvent) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
    }
  };
  el.addEventListener("click", onClick, true);
  const onPointerDown = () => {
    suppressClick = false;
  };
  el.addEventListener("pointerdown", onPointerDown, true);

  const step = opts.keyboardStep ?? 16;
  const onKey = (e: KeyboardEvent) => {
    if (disabled || !step || e.target !== el) return;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = map[e.key];
    if (!d) return;
    if ((axis === "x" && d[1]) || (axis === "y" && d[0])) return;
    e.preventDefault();
    engine.telemetry.noteInput(e.timeStamp);
    controller.moveTo(x.get() + d[0], y.get() + d[1]);
  };
  el.addEventListener("keydown", onKey);

  const controller: DragController = {
    x,
    y,
    get dragging() {
      return dragging;
    },
    setDisabled(d: boolean) {
      disabled = d;
    },
    moveTo(nx: number, ny: number) {
      bounds = resolveBounds();
      const spec = resolveSpec({ spring: "snappy" }, engine.dna);
      if (axis !== "y") x.animate(Math.min(bounds.right, Math.max(bounds.left, nx)), spec, { priority: "interaction" });
      if (axis !== "x") y.animate(Math.min(bounds.bottom, Math.max(bounds.top, ny)), spec, { priority: "interaction" });
    },
    destroy() {
      tracker.destroy();
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("keydown", onKey);
      el.style.touchAction = prevTouchAction;
    },
  };
  return controller;
}
