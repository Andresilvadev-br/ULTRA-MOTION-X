/**
 * Gesture recognition with intent classification: tap, double tap, long press, pan, swipe,
 * pinch/rotate (two pointers) and normalised wheel/trackpad input.
 */
import { type Engine, getEngine } from "../core/engine.ts";
import { classifyIntent, DEFAULT_INTENT, type IntentThresholds } from "../math/gesture.ts";
import { type PointerPoint, PointerTracker } from "./pointer.ts";

export interface PanInfo {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
}

export interface GestureHandlers {
  onTap?: (e: { x: number; y: number }) => void;
  onDoubleTap?: (e: { x: number; y: number }) => void;
  onLongPress?: (e: { x: number; y: number }) => void;
  onPanStart?: (i: PanInfo) => void;
  onPan?: (i: PanInfo) => void;
  onPanEnd?: (i: PanInfo) => void;
  onSwipe?: (e: { direction: "left" | "right" | "up" | "down"; velocity: number }) => void;
  onPinch?: (e: { scale: number; rotation: number; cx: number; cy: number }) => void;
  onPinchEnd?: (e: { scale: number; rotation: number }) => void;
  onWheel?: (e: { dx: number; dy: number; zoom: boolean }) => void;
  onCancel?: () => void;
}

export interface GestureOptions extends GestureHandlers {
  engine?: Engine;
  thresholds?: Partial<IntentThresholds>;
  doubleTapMs?: number;
}

export function gestures(el: HTMLElement, opts: GestureOptions): () => void {
  const engine = opts.engine ?? getEngine();
  const th = { ...DEFAULT_INTENT, ...opts.thresholds };
  let panning = false;
  let longTimer: ReturnType<typeof setTimeout> | null = null;
  let longFired = false;
  let lastTap = 0;
  let pinchStart: { d: number; a: number } | null = null;
  let pinch = { scale: 1, rotation: 0 };

  const pan = (p: PointerPoint): PanInfo => {
    const v = PointerTracker.velocity(p);
    return { dx: p.x - p.startX, dy: p.y - p.startY, vx: v.x, vy: v.y, x: p.x, y: p.y };
  };
  const two = (all: Map<number, PointerPoint>) => {
    const [a, b] = [...all.values()];
    return a && b
      ? {
          d: Math.hypot(b.x - a.x, b.y - a.y),
          a: Math.atan2(b.y - a.y, b.x - a.x),
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        }
      : null;
  };
  const clearLong = () => {
    if (longTimer) clearTimeout(longTimer);
    longTimer = null;
  };

  const tracker = new PointerTracker(el, {
    onInput: (ts) => engine.telemetry.noteInput(ts),
    onDown: (p, _e, all) => {
      longFired = false;
      if (all.size === 1) {
        // Second pointer joins: start pinch.
        const g = two(new Map([...all, [p.id, p]]));
        if (g) pinchStart = { d: g.d, a: g.a };
        panning = false;
        clearLong();
        return undefined;
      }
      if (opts.onLongPress) {
        longTimer = setTimeout(() => {
          if (!panning) {
            longFired = true;
            opts.onLongPress?.({ x: p.x, y: p.y });
          }
        }, th.longPress * 1000);
      }
      return undefined;
    },
    onMove: (p, _e, all) => {
      if (all.size >= 2 && pinchStart) {
        const g = two(all);
        if (g && pinchStart.d > 0) {
          pinch = { scale: g.d / pinchStart.d, rotation: ((g.a - pinchStart.a) * 180) / Math.PI };
          opts.onPinch?.({ ...pinch, cx: g.cx, cy: g.cy });
        }
        return;
      }
      const info = pan(p);
      if (!panning && Math.hypot(info.dx, info.dy) >= th.dragDistance) {
        panning = true;
        clearLong();
        opts.onPanStart?.(info);
      }
      if (panning) opts.onPan?.(info);
    },
    onUp: (p, _e, all) => {
      clearLong();
      if (pinchStart && all.size <= 2) {
        if (all.size === 2) {
          opts.onPinchEnd?.(pinch);
          pinchStart = null;
          pinch = { scale: 1, rotation: 0 };
          return;
        }
      }
      const info = pan(p);
      const speed = Math.hypot(info.vx, info.vy);
      const intent = classifyIntent(Math.hypot(info.dx, info.dy), p.lastTime - p.startTime, speed, false, th);
      if (panning) {
        panning = false;
        opts.onPanEnd?.(info);
      }
      if (intent === "swipe") {
        const horizontal = Math.abs(info.vx) > Math.abs(info.vy);
        opts.onSwipe?.({
          direction: horizontal ? (info.vx > 0 ? "right" : "left") : info.vy > 0 ? "down" : "up",
          velocity: speed,
        });
      } else if (intent === "tap" && !longFired) {
        const now = p.lastTime * 1000;
        if (opts.onDoubleTap && now - lastTap < (opts.doubleTapMs ?? 300)) {
          lastTap = 0;
          opts.onDoubleTap({ x: p.x, y: p.y });
        } else {
          lastTap = now;
          opts.onTap?.({ x: p.x, y: p.y });
        }
      }
    },
    onCancel: () => {
      clearLong();
      panning = false;
      pinchStart = null;
      opts.onCancel?.();
    },
  });

  const onWheel = (e: WheelEvent) => {
    if (!opts.onWheel) return;
    // Normalise line/page deltas to pixels; ctrlKey marks trackpad pinch-zoom.
    const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight || 800 : 1;
    opts.onWheel({ dx: e.deltaX * mult, dy: e.deltaY * mult, zoom: e.ctrlKey });
  };
  el.addEventListener("wheel", onWheel, { passive: true });
  return () => {
    clearLong();
    tracker.destroy();
    el.removeEventListener("wheel", onWheel);
  };
}
