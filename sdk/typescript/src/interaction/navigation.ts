/**
 * Focus navigation helpers (roving tabindex) and a gamepad bridge that maps D-pad / stick
 * input to focus movement. Native keyboard behaviour and screen readers are untouched:
 * these helpers only move focus between focusable elements.
 */

export interface RovingOptions {
  orientation?: "horizontal" | "vertical" | "grid";
  columns?: number;
  loop?: boolean;
  selector?: string;
}

const FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

export function rovingFocus(container: HTMLElement, opts: RovingOptions = {}): () => void {
  const items = () => Array.from(container.querySelectorAll<HTMLElement>(opts.selector ?? FOCUSABLE));
  const onKey = (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const cols = opts.orientation === "grid" ? (opts.columns ?? 1) : 1;
    const deltas: Record<string, number> =
      opts.orientation === "vertical"
        ? { ArrowUp: -1, ArrowDown: 1 }
        : opts.orientation === "grid"
          ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }
          : { ArrowLeft: -1, ArrowRight: 1 };
    let next: number | undefined;
    if (e.key in deltas) next = i + deltas[e.key]!;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    if (next === undefined) return;
    if (opts.loop !== false) next = (next + list.length) % list.length;
    next = Math.min(list.length - 1, Math.max(0, next));
    e.preventDefault();
    list[next]?.focus();
  };
  container.addEventListener("keydown", onKey);
  return () => container.removeEventListener("keydown", onKey);
}

export interface GamepadOptions {
  /** Container whose focusable children are navigated. */
  root?: HTMLElement;
  deadzone?: number;
  repeatMs?: number;
}

/**
 * Polls connected gamepads only while one is connected (no idle polling) and moves focus
 * spatially toward the pressed direction; button 0 (A / Cross) clicks the focused element.
 */
export function gamepadNavigation(opts: GamepadOptions = {}): () => void {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return () => undefined;
  const dead = opts.deadzone ?? 0.5;
  const repeat = opts.repeatMs ?? 180;
  let raf = 0;
  let last = 0;
  let aDown = false;
  const root = opts.root ?? document.body;
  const move = (dx: number, dy: number) => {
    const current = document.activeElement as HTMLElement | null;
    const list = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!current || !list.includes(current)) {
      list[0]?.focus();
      return;
    }
    const c = current.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const el of list) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const vx = r.left + r.width / 2 - (c.left + c.width / 2);
      const vy = r.top + r.height / 2 - (c.top + c.height / 2);
      const along = vx * dx + vy * dy;
      if (along <= 0) continue;
      const across = Math.abs(vx * dy - vy * dx);
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    best?.focus();
  };
  const poll = (t: number) => {
    const pads = navigator.getGamepads().filter(Boolean) as Gamepad[];
    if (!pads.length) {
      raf = 0;
      return;
    }
    for (const pad of pads) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const b = pad.buttons;
      const dx = (b[15]?.pressed ? 1 : 0) - (b[14]?.pressed ? 1 : 0) || (Math.abs(ax) > dead ? Math.sign(ax) : 0);
      const dy = (b[13]?.pressed ? 1 : 0) - (b[12]?.pressed ? 1 : 0) || (Math.abs(ay) > dead ? Math.sign(ay) : 0);
      if ((dx || dy) && t - last > repeat) {
        last = t;
        move(dx, dy);
      }
      const a = !!b[0]?.pressed;
      if (a && !aDown) (document.activeElement as HTMLElement | null)?.click();
      aDown = a;
    }
    raf = requestAnimationFrame(poll);
  };
  const connected = () => {
    if (!raf) raf = requestAnimationFrame(poll);
  };
  addEventListener("gamepadconnected", connected);
  if (navigator.getGamepads().some(Boolean)) connected();
  return () => {
    removeEventListener("gamepadconnected", connected);
    if (raf) cancelAnimationFrame(raf);
  };
}
