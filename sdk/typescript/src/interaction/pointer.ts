/**
 * Pointer tracking shared by all gestures: coalesced events, per-pointer velocity
 * (least squares over 100 ms), pointer capture, cancellation and multi-touch.
 */
import { VelocityTracker } from "../math/gesture.ts";

export interface PointerPoint {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  type: string;
  vx: VelocityTracker;
  vy: VelocityTracker;
  lastTime: number;
}

export interface PointerTrackerOptions {
  /** Capture the pointer on down (keeps receiving moves outside the element). */
  capture?: boolean;
  /** Mouse buttons accepted (bitmask of `event.button` values), default primary only. */
  buttons?: number[];
  onDown?: (p: PointerPoint, e: PointerEvent, all: Map<number, PointerPoint>) => boolean | void;
  onMove?: (p: PointerPoint, e: PointerEvent, all: Map<number, PointerPoint>) => void;
  onUp?: (p: PointerPoint, e: PointerEvent, all: Map<number, PointerPoint>) => void;
  onCancel?: (p: PointerPoint, e: Event | null, all: Map<number, PointerPoint>) => void;
  onInput?: (timeStamp: number) => void;
}

export class PointerTracker {
  readonly el: HTMLElement;
  readonly pointers = new Map<number, PointerPoint>();
  private opts: PointerTrackerOptions;
  private disposers: Array<() => void> = [];

  constructor(el: HTMLElement, opts: PointerTrackerOptions) {
    this.el = el;
    this.opts = opts;
    this.listen(el, "pointerdown", this.down as EventListener);
  }

  private listen(t: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions): void {
    t.addEventListener(type, fn, o);
    this.disposers.push(() => t.removeEventListener(type, fn, o));
  }

  private readonly down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && !(this.opts.buttons ?? [0]).includes(e.button)) return;
    this.opts.onInput?.(e.timeStamp);
    const t = e.timeStamp / 1000;
    const p: PointerPoint = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startTime: t,
      lastTime: t,
      type: e.pointerType,
      vx: new VelocityTracker(),
      vy: new VelocityTracker(),
    };
    p.vx.add(t, e.clientX);
    p.vy.add(t, e.clientY);
    if (this.opts.onDown?.(p, e, this.pointers) === false) return;
    this.pointers.set(e.pointerId, p);
    if (this.opts.capture !== false) {
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events cannot be captured */
      }
    }
    if (this.pointers.size === 1) {
      const doc = this.el.ownerDocument;
      const move = this.move as EventListener;
      const up = this.up as EventListener;
      const cancel = this.cancel as EventListener;
      const key = this.key as EventListener;
      doc.addEventListener("pointermove", move, { passive: true });
      doc.addEventListener("pointerup", up);
      doc.addEventListener("pointercancel", cancel);
      doc.addEventListener("keydown", key);
      this.detachGlobal = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", up);
        doc.removeEventListener("pointercancel", cancel);
        doc.removeEventListener("keydown", key);
      };
    }
  };

  private detachGlobal: (() => void) | null = null;

  private readonly move = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const c of events.length ? events : [e]) {
      const t = c.timeStamp / 1000;
      p.vx.add(t, c.clientX);
      p.vy.add(t, c.clientY);
      p.lastTime = t;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    this.opts.onMove?.(p, e, this.pointers);
  };

  private readonly up = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const t = e.timeStamp / 1000;
    p.vx.add(t, e.clientX);
    p.vy.add(t, e.clientY);
    p.lastTime = t;
    this.opts.onUp?.(p, e, this.pointers);
    this.release(e.pointerId);
  };

  private readonly cancel = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.opts.onCancel?.(p, e, this.pointers);
    this.release(e.pointerId);
  };

  /** Escape cancels an in-flight gesture (keyboard users can always back out). */
  private readonly key = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    for (const p of [...this.pointers.values()]) {
      this.opts.onCancel?.(p, e, this.pointers);
      this.release(p.id);
    }
  };

  private release(id: number): void {
    this.pointers.delete(id);
    try {
      if (this.el.hasPointerCapture?.(id)) this.el.releasePointerCapture(id);
    } catch {
      /* ignore */
    }
    if (this.pointers.size === 0) {
      this.detachGlobal?.();
      this.detachGlobal = null;
    }
  }

  /** Velocity (px/s) of a pointer at time `now` (s). */
  static velocity(p: PointerPoint, now = p.lastTime): { x: number; y: number } {
    return { x: p.vx.velocity(now), y: p.vy.velocity(now) };
  }

  destroy(): void {
    this.detachGlobal?.();
    for (const d of this.disposers) d();
    this.disposers = [];
    this.pointers.clear();
  }
}
