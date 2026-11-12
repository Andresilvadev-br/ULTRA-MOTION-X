/**
 * Semantic Motion Engine: chooses motion by the *function* of an element. Every preset
 * uses the shared Motion DNA, respects reduced motion and never changes colours, fonts,
 * layout rules or behaviour of the host application.
 */
import { type Engine, getEngine } from "../core/engine.ts";
import { type AnimationControls, animate } from "../dom/animate.ts";
import { ElementTarget } from "../dom/element-target.ts";
import { hover, press } from "../interaction/feedback.ts";

export type SemanticRole =
  | "button"
  | "card"
  | "menu"
  | "tabs"
  | "modal"
  | "drawer"
  | "notification"
  | "tooltip"
  | "overlay"
  | "list"
  | "navigation"
  | "disclosure"
  | "form"
  | "progress"
  | "page";

const ROLE_ATTR: Record<string, SemanticRole> = {
  button: "button",
  menu: "menu",
  menubar: "menu",
  listbox: "menu",
  tablist: "tabs",
  dialog: "modal",
  alertdialog: "modal",
  status: "notification",
  alert: "notification",
  tooltip: "tooltip",
  list: "list",
  navigation: "navigation",
  progressbar: "progress",
};

/** Classifies an element (explicit `data-umx` wins over ARIA, ARIA over tag/class heuristics). */
export function detectRole(el: Element): SemanticRole | null {
  const explicit = (el as HTMLElement).dataset?.umx;
  if (explicit === "off") return null;
  if (explicit && explicit !== "auto") return explicit as SemanticRole;
  const aria = el.getAttribute("role");
  if (aria && ROLE_ATTR[aria]) return ROLE_ATTR[aria]!;
  const tag = el.tagName.toLowerCase();
  if (
    tag === "button" ||
    (tag === "a" && el.classList.contains("btn")) ||
    (tag === "input" && /^(button|submit|reset)$/.test((el as HTMLInputElement).type))
  )
    return "button";
  if (tag === "dialog") return "modal";
  if (tag === "details") return "disclosure";
  if (tag === "nav") return "navigation";
  if (tag === "progress") return "progress";
  if (tag === "form" || tag === "input" || tag === "textarea" || tag === "select") return "form";
  const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
  if (/\b(card|tile)\b/.test(cls)) return "card";
  if (/\b(toast|snackbar|notification)\b/.test(cls)) return "notification";
  if (/\b(drawer|sidebar|offcanvas)\b/.test(cls)) return "drawer";
  if (/\b(modal)\b/.test(cls)) return "modal";
  if (/\b(dropdown|menu|popover)\b/.test(cls)) return "menu";
  if (/\b(tooltip)\b/.test(cls)) return "tooltip";
  return null;
}

export interface PresetContext {
  engine?: Engine;
}

/** Entrance motion for overlays by role; returns controls (instant under reduced motion). */
export function enter(el: Element, role: SemanticRole, ctx: PresetContext = {}): AnimationControls {
  const engine = ctx.engine ?? getEngine();
  const dna = engine.dna;
  const reduced = engine.reducedMotion;
  const fade = { opacity: [0, 1] };
  switch (role) {
    case "modal":
      return animate(el, reduced ? fade : { opacity: [0, 1], scale: [0.94, 1], y: [16, 0] }, {
        engine,
        spring: "standard",
        transitions: { opacity: { duration: dna.duration("fast"), ease: dna.data.easing.enter } },
      });
    case "drawer":
      return animate(
        el,
        reduced ? fade : { x: [-Math.min(360, (el as HTMLElement).offsetWidth || 320), 0], opacity: [0.6, 1] },
        { engine, spring: "standard" },
      );
    case "menu":
      (el as HTMLElement).style.transformOrigin ||= "top center";
      return animate(el, reduced ? fade : { opacity: [0, 1], y: [-6, 0], scale: [0.96, 1] }, {
        engine,
        spring: "snappy",
        transitions: { opacity: { duration: dna.duration("fast") } },
      });
    case "notification":
      return animate(el, reduced ? fade : { opacity: [0, 1], y: [24, 0], scale: [0.96, 1] }, {
        engine,
        spring: "bouncy",
        transitions: { opacity: { duration: dna.duration("fast") } },
      });
    case "tooltip":
      return animate(el, reduced ? fade : { opacity: [0, 1], scale: [0.96, 1] }, {
        engine,
        duration: dna.duration("fast"),
        ease: dna.data.easing.enter,
      });
    case "page":
      return animate(el, reduced ? fade : { opacity: [0, 1], y: [8, 0] }, {
        engine,
        duration: dna.duration("page"),
        ease: dna.data.easing.enter,
      });
    default:
      return animate(el, fade, { engine, duration: dna.duration("normal"), ease: dna.data.easing.enter });
  }
}

/** Exit motion; resolves when finished. The caller hides/removes the element afterwards. */
export function exit(el: Element, role: SemanticRole, ctx: PresetContext = {}): AnimationControls {
  const engine = ctx.engine ?? getEngine();
  const dna = engine.dna;
  const base = { engine, duration: dna.duration("fast"), ease: dna.data.easing.exit };
  if (engine.reducedMotion) return animate(el, { opacity: 0 }, base);
  switch (role) {
    case "modal":
      return animate(el, { opacity: 0, scale: 0.96, y: 8 }, base);
    case "drawer":
      return animate(
        el,
        { x: -Math.min(360, (el as HTMLElement).offsetWidth || 320) },
        { ...base, duration: dna.duration("normal") },
      );
    case "menu":
      return animate(el, { opacity: 0, y: -4, scale: 0.98 }, base);
    case "notification":
      return animate(el, { opacity: 0, y: 12, scale: 0.98 }, base);
    default:
      return animate(el, { opacity: 0 }, base);
  }
}

/** Interaction presets (press/hover) — returns a disposer. */
export function attachInteraction(el: HTMLElement, role: SemanticRole, ctx: PresetContext = {}): () => void {
  const engine = ctx.engine ?? getEngine();
  const disposers: Array<() => void> = [];
  if (role === "button" || role === "navigation") disposers.push(press(el, { engine }));
  if (role === "card") {
    disposers.push(hover(el, { engine }));
    disposers.push(press(el, { engine, scale: 1 - (1 - engine.dna.data.pressScale) / 2 }));
  }
  return () => disposers.forEach((d) => d());
}

/** Animates a progress indicator's fill to a value in [0, 1] (scaleX on a fill element). */
export function progressTo(fill: HTMLElement, value: number, ctx: PresetContext = {}): AnimationControls {
  const engine = ctx.engine ?? getEngine();
  fill.style.transformOrigin = "left center";
  return animate(fill, { scaleX: Math.min(1, Math.max(0, value)) }, { engine, spring: "gentle" });
}

/** Opens a native `<dialog>` with motion. */
export function openDialog(dialog: HTMLDialogElement, modal = true, ctx: PresetContext = {}): AnimationControls {
  if (!dialog.open) modal ? dialog.showModal() : dialog.show();
  return enter(dialog, "modal", ctx);
}

/** Closes a native `<dialog>` after its exit motion (focus restoration stays native). */
export async function closeDialog(
  dialog: HTMLDialogElement,
  returnValue?: string,
  ctx: PresetContext = {},
): Promise<void> {
  await exit(dialog, "modal", ctx);
  dialog.close(returnValue);
  const t = ElementTarget.peek(dialog);
  t?.value("opacity").set(1);
  t?.value("scale").set(1);
  t?.value("y").set(0);
  t?.flush();
}
