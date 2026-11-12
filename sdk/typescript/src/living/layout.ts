/**
 * Liquid Layout: FLIP-based layout transitions. Measure → mutate → measure → animate the
 * inverted transform back to identity with physics. Elements already moving keep their
 * velocity, so rapid successive layout changes stay continuous.
 */
import { type Engine, getEngine } from "../core/engine.ts";
import { resolveSpec, type TransitionOptions } from "../core/spec.ts";
import { ElementTarget } from "../dom/element-target.ts";

export interface LayoutOptions extends TransitionOptions {
  engine?: Engine;
  /** "position" only translates; "size" also scales from the old to the new box. */
  mode?: "position" | "size";
  /** Keep border-radius visually constant while scaling. */
  preserveRadius?: boolean;
  /** Stagger between elements (ms). */
  stagger?: number;
  /** Animate elements that appeared during the mutation. */
  enter?: Record<string, number> | false;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const rectOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

function resetLayoutTransform(t: ElementTarget): void {
  for (const p of ["x", "y", "scaleX", "scaleY"]) t.value(p).jump(p.startsWith("scale") ? 1 : 0, t.value(p).velocity);
  t.flush();
}

/**
 * Animates `elements` (or the children of a container) across a DOM/layout mutation.
 * Resolves when every layout animation settles.
 */
export async function layoutTransition(
  target: Element | Iterable<Element>,
  mutate: () => void | Promise<void>,
  opts: LayoutOptions = {},
): Promise<void> {
  const engine = opts.engine ?? getEngine();
  const collect = () => (target instanceof Element ? Array.from(target.children) : Array.from(target));
  const before = new Map<Element, Box>();
  for (const el of collect()) before.set(el, rectOf(el));
  await mutate();
  const after = collect();
  const mode = opts.mode ?? "size";
  const spec = resolveSpec(
    opts.type || opts.duration || opts.stiffness ? opts : { ...opts, spring: opts.spring ?? "standard" },
    engine.dna,
  );
  const anims: Array<Promise<unknown>> = [];
  // Phase 1 (writes): remove our layout transforms so we can read true layout boxes.
  const targets = after.map((el) => ElementTarget.for(el, engine));
  for (const t of targets) resetLayoutTransform(t);
  // Phase 2 (reads): measure all at once (single forced layout).
  const boxes = after.map(rectOf);
  // Phase 3 (writes): invert and play.
  after.forEach((el, i) => {
    const t = targets[i]!;
    const to = boxes[i]!;
    const from = before.get(el);
    const delayed = opts.stagger ? { ...spec, ...("delay" in spec ? { delay: (opts.stagger * i) / 1000 } : {}) } : spec;
    if (!from) {
      if (opts.enter !== false && !engine.reducedMotion) {
        const props = opts.enter ?? { opacity: 0, scale: 0.96 };
        for (const [p, v] of Object.entries(props)) {
          const mv = t.value(p);
          const final = p === "opacity" || p.startsWith("scale") ? 1 : 0;
          mv.set(v);
          anims.push(mv.animate(final, delayed).finished);
        }
      }
      return;
    }
    const sx = mode === "size" && to.width > 0 ? from.width / to.width : 1;
    const sy = mode === "size" && to.height > 0 ? from.height / to.height : 1;
    // Transform origin is the top-left corner for exact FLIP math.
    (el as HTMLElement).style.transformOrigin = "0 0";
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;
    const pairs: Array<[string, number, number]> = [
      ["x", dx, 0],
      ["y", dy, 0],
    ];
    if (mode === "size") pairs.push(["scaleX", sx, 1], ["scaleY", sy, 1]);
    for (const [p, inverted, final] of pairs) {
      const mv = t.value(p, p.startsWith("scale") ? "" : "px");
      mv.jump(inverted, mv.velocity);
      anims.push(mv.animate(final, delayed, { priority: "normal" }).finished);
    }
    if (opts.preserveRadius && mode === "size") preserveRadius(el as HTMLElement, t);
  });
  for (const t of targets) t.flush();
  await Promise.all(anims);
}

/** Keeps the visual corner radius constant while the element is scaled by FLIP. */
function preserveRadius(el: HTMLElement, t: ElementTarget): void {
  const r = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  if (!r) return;
  const sx = t.value("scaleX");
  const sy = t.value("scaleY");
  const update = () => {
    const a = sx.get() || 1;
    const b = sy.get() || 1;
    el.style.borderRadius = `${r / a}px / ${r / b}px`;
  };
  const u1 = sx.on("change", update);
  const u2 = sy.on("change", update);
  Promise.all([sx.currentAnimation?.finished, sy.currentAnimation?.finished]).then(() => {
    u1();
    u2();
    el.style.borderRadius = "";
  });
}

/** Plays an exit animation, then removes the element (presence handling). */
export async function exitAndRemove(
  el: Element,
  props: Record<string, number> = { opacity: 0, scale: 0.96 },
  opts: TransitionOptions & { engine?: Engine } = {},
): Promise<void> {
  const engine = opts.engine ?? getEngine();
  const t = ElementTarget.for(el, engine);
  (el as HTMLElement).setAttribute("inert", "");
  (el as HTMLElement).setAttribute("aria-hidden", "true");
  const spec = resolveSpec(
    { duration: engine.dna.duration("fast"), ease: engine.dna.data.easing.exit, ...opts },
    engine.dna,
  );
  await Promise.all(
    Object.entries(props).map(([p, v]) => t.value(p).animate(v, spec, { priority: "normal" }).finished),
  );
  t.destroy();
  el.remove();
}

/**
 * Tracks the layout of a container's children across renders (for frameworks that mutate
 * the DOM themselves, e.g. React/Vue). Call `measure()` after every commit: elements whose
 * layout position changed since the previous call animate from their old position (FLIP),
 * keeping any velocity they already had; new elements fade in.
 */
export class LayoutTracker {
  readonly container: Element;
  readonly engine: Engine;
  private last = new Map<Element, { x: number; y: number }>();
  enter: Record<string, number> | false;

  constructor(container: Element, opts: { engine?: Engine; enter?: Record<string, number> | false } = {}) {
    this.container = container;
    this.engine = opts.engine ?? getEngine();
    this.enter = opts.enter ?? { opacity: 0 };
    this.snapshot();
  }

  private positions(): Map<Element, { x: number; y: number }> {
    const base = this.container.getBoundingClientRect();
    const m = new Map<Element, { x: number; y: number }>();
    for (const c of Array.from(this.container.children)) {
      const r = c.getBoundingClientRect();
      const t = ElementTarget.peek(c);
      m.set(c, {
        x: r.left - base.left - (t?.value("x").get() ?? 0),
        y: r.top - base.top - (t?.value("y").get() ?? 0),
      });
    }
    return m;
  }

  snapshot(): void {
    this.last = this.positions();
  }

  /** Animates changes since the previous measurement; returns the number of moved elements. */
  measure(): number {
    const now = this.positions();
    let moved = 0;
    const spec = resolveSpec({ spring: "standard" }, this.engine.dna);
    for (const [el, p] of now) {
      const was = this.last.get(el);
      const t = ElementTarget.for(el, this.engine);
      if (!was) {
        if (this.enter && !this.engine.reducedMotion) {
          for (const [prop, v] of Object.entries(this.enter)) {
            const mv = t.value(prop);
            mv.set(v);
            mv.animate(prop === "opacity" || prop.startsWith("scale") ? 1 : 0, spec);
          }
        }
        continue;
      }
      const dx = was.x - p.x;
      const dy = was.y - p.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      moved++;
      for (const [prop, d] of [
        ["x", dx],
        ["y", dy],
      ] as const) {
        const mv = t.value(prop, "px");
        mv.jump(mv.get() + d, mv.velocity);
        mv.animate(0, spec);
      }
    }
    this.last = now;
    return moved;
  }
}
