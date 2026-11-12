/**
 * Automatic Motion Discovery at runtime: finds eligible elements, attaches semantic presets
 * and keeps working as the DOM changes. Framework-agnostic: it only observes the DOM.
 *
 * Opt out per subtree with `data-umx="off"`; force a role with `data-umx="card"` etc.
 * Elements whose CSS already transitions `transform`/`opacity` are left alone (conflict
 * avoidance) and reported through `engine.warn`.
 */
import { type Engine, getEngine } from "../core/engine.ts";
import { ElementTarget } from "../dom/element-target.ts";
import { attachInteraction, detectRole, enter, type SemanticRole } from "./semantic.ts";

export interface AutoEnhanceOptions {
  engine?: Engine;
  root?: ParentNode & Node;
  /** Roles to enhance (default: all supported). */
  roles?: SemanticRole[];
  /** Animate list re-orders/insertions (FLIP) in `[data-umx="list"]` / `[role=list]`. */
  lists?: boolean;
}

export interface AutoEnhanceController {
  refresh(): void;
  destroy(): void;
  stats(): Record<string, number>;
}

const DEFAULT_ROLES: SemanticRole[] = [
  "button",
  "card",
  "menu",
  "modal",
  "drawer",
  "notification",
  "tooltip",
  "navigation",
  "list",
  "disclosure",
];
const CANDIDATES =
  "button,[role=button],a.btn,input[type=button],input[type=submit],[class*=card],[class*=tile],dialog,[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=status],[role=alert],[role=tooltip],[class*=toast],[class*=dropdown],[class*=drawer],[class*=modal],nav a,details,[role=list],[data-umx]";

function cssConflicts(el: Element): boolean {
  if (typeof getComputedStyle !== "function") return false;
  const cs = getComputedStyle(el);
  const props = cs.transitionProperty;
  const durs = cs.transitionDuration.split(",").map((d) => Number.parseFloat(d));
  if (!props || durs.every((d) => !d)) return false;
  return /\b(all|transform|opacity|scale|translate)\b/.test(props);
}

function visible(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.hidden || h.getAttribute("aria-hidden") === "true") return false;
  if (el.tagName === "DIALOG") return (el as HTMLDialogElement).open;
  return typeof getComputedStyle !== "function" || getComputedStyle(el).display !== "none";
}

export function autoEnhance(opts: AutoEnhanceOptions = {}): AutoEnhanceController {
  const engine = opts.engine ?? getEngine();
  const root = opts.root ?? document;
  const roles = new Set(opts.roles ?? DEFAULT_ROLES);
  const attached = new Map<Element, { role: SemanticRole; dispose: () => void }>();
  const stats: Record<string, number> = {};
  const lists = new Map<Element, Map<Element, { x: number; y: number }>>();

  const optedOut = (el: Element) => !!el.closest?.('[data-umx="off"]');

  const snapshotList = (list: Element) => {
    const base = list.getBoundingClientRect();
    const m = new Map<Element, { x: number; y: number }>();
    for (const c of Array.from(list.children)) {
      const r = c.getBoundingClientRect();
      const t = ElementTarget.peek(c);
      // Store the layout position (without our transform) relative to the list.
      m.set(c, {
        x: r.left - base.left - (t?.value("x").get() ?? 0),
        y: r.top - base.top - (t?.value("y").get() ?? 0),
      });
    }
    lists.set(list, m);
  };

  const animateList = (list: Element) => {
    const prev = lists.get(list);
    if (!prev) return snapshotList(list);
    const base = list.getBoundingClientRect();
    for (const c of Array.from(list.children)) {
      const t = ElementTarget.for(c, engine);
      const was = prev.get(c);
      const r = c.getBoundingClientRect();
      const nowX = r.left - base.left - t.value("x").get();
      const nowY = r.top - base.top - t.value("y").get();
      if (!was) {
        if (!engine.reducedMotion) enter(c, "notification", { engine });
        continue;
      }
      const dx = was.x - nowX;
      const dy = was.y - nowY;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const x = t.value("x", "px");
      const y = t.value("y", "px");
      x.jump(x.get() + dx, x.velocity);
      y.jump(y.get() + dy, y.velocity);
      const spec = { type: "spring" as const, spring: engine.dna.spring("standard") };
      x.animate(0, spec);
      y.animate(0, spec);
    }
    snapshotList(list);
  };

  const attach = (el: Element) => {
    if (attached.has(el) || optedOut(el)) return;
    const role = detectRole(el);
    if (!role || !roles.has(role)) return;
    if (role === "form") return; // Forms are never decorated.
    const html = el as HTMLElement;
    let dispose: () => void = () => undefined;
    if (role === "list" && opts.lists !== false) {
      snapshotList(el);
      dispose = () => lists.delete(el);
    } else if (role === "button" || role === "card" || role === "navigation") {
      if (cssConflicts(el)) {
        engine.warn("skipped element with CSS transform/opacity transition", el);
        stats.conflicts = (stats.conflicts ?? 0) + 1;
        return;
      }
      dispose = attachInteraction(html, role, { engine });
    } else if (role === "disclosure") {
      const onToggle = () => {
        if (!(el as HTMLDetailsElement).open) return;
        for (const c of Array.from(el.children)) if (c.tagName !== "SUMMARY") enter(c, "page", { engine });
      };
      el.addEventListener("toggle", onToggle);
      dispose = () => el.removeEventListener("toggle", onToggle);
    } else if (visible(el) && el.isConnected && (role === "notification" || role === "tooltip")) {
      // Newly inserted overlays animate in once.
      enter(el, role, { engine });
    }
    attached.set(el, { role, dispose });
    stats[role] = (stats[role] ?? 0) + 1;
  };

  const scan = (node: ParentNode) => {
    if (node instanceof Element && node.matches(CANDIDATES)) attach(node);
    node.querySelectorAll?.(CANDIDATES).forEach(attach);
  };

  const wasVisible = new WeakMap<Element, boolean>();
  const onAttr = (el: Element) => {
    const a = attached.get(el);
    const role = a?.role ?? detectRole(el);
    if (!role || !["modal", "drawer", "menu", "tooltip", "notification"].includes(role) || optedOut(el)) return;
    const vis = visible(el);
    if (vis && wasVisible.get(el) === false) enter(el, role, { engine });
    wasVisible.set(el, vis);
  };

  const observer =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver((records) => {
          const changedLists = new Set<Element>();
          for (const r of records) {
            if (r.type === "childList") {
              r.addedNodes.forEach((n) => {
                if (n instanceof Element) scan(n);
              });
              if (r.target instanceof Element && lists.has(r.target)) changedLists.add(r.target);
            } else if (r.type === "attributes" && r.target instanceof Element) {
              onAttr(r.target);
            }
          }
          if (changedLists.size) engine.read(() => changedLists.forEach(animateList), { key: "umx:auto:lists" });
        })
      : null;

  const start = () => {
    scan(root);
    root
      .querySelectorAll?.("dialog,[role=dialog],[role=menu],[role=tooltip],[class*=drawer],[class*=dropdown]")
      .forEach((el) => wasVisible.set(el, visible(el)));
    observer?.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open", "hidden", "aria-hidden", "aria-expanded", "class"],
    });
  };
  start();

  return {
    refresh() {
      scan(root);
      for (const l of lists.keys()) snapshotList(l);
    },
    destroy() {
      observer?.disconnect();
      for (const a of attached.values()) a.dispose();
      attached.clear();
      lists.clear();
    },
    stats: () => ({ ...stats, attached: attached.size }),
  };
}
