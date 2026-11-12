/**
 * Spatial UI: depth layers, controlled perspective, pointer tilt and parallax. Everything is
 * optional, scaled by Motion DNA intensity and the accessibility intensity cap, and disabled
 * under reduced motion.
 */
import { type Engine, getEngine } from "../core/engine.ts";
import { resolveSpec } from "../core/spec.ts";
import { ElementTarget } from "../dom/element-target.ts";

export interface TiltOptions {
  engine?: Engine;
  /** Maximum rotation in degrees. */
  max?: number;
  perspective?: number;
  /** Lift towards the viewer (px) while hovered. */
  lift?: number;
}

export function tilt(el: HTMLElement, opts: TiltOptions = {}): () => void {
  const engine = opts.engine ?? getEngine();
  const t = ElementTarget.for(el, engine);
  const intensity = () => engine.dna.data.intensity * engine.a11y.options.maxIntensity;
  t.value("transformPerspective", "px").set(opts.perspective ?? 800);
  const spec = () => resolveSpec({ spring: "gentle" }, engine.dna);
  const move = (e: PointerEvent) => {
    if (!engine.a11y.allows("spatial") || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    const max = (opts.max ?? 8) * intensity();
    t.value("rotateY", "deg").animate(nx * max, spec(), { priority: "decorative" });
    t.value("rotateX", "deg").animate(-ny * max, spec(), { priority: "decorative" });
    t.value("z", "px").animate((opts.lift ?? engine.dna.data.depth / 2) * intensity(), spec(), {
      priority: "decorative",
    });
  };
  const leave = () => {
    for (const p of ["rotateX", "rotateY", "z"]) t.value(p).animate(0, spec(), { priority: "decorative" });
  };
  el.addEventListener("pointermove", move, { passive: true });
  el.addEventListener("pointerleave", leave);
  return () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerleave", leave);
    leave();
  };
}

export interface ParallaxOptions {
  engine?: Engine;
  source?: "pointer" | "scroll";
  /** Maximum translation (px) for depth 1. */
  range?: number;
}

/**
 * Parallax for elements with `data-depth` (0 = static, 1 = full range, negative = opposite).
 * Scroll parallax reads scroll position once per frame (batched read phase).
 */
export function parallax(layers: Iterable<HTMLElement>, opts: ParallaxOptions = {}): () => void {
  const engine = opts.engine ?? getEngine();
  const list = [...layers];
  const range = () => (opts.range ?? 40) * engine.dna.data.parallax * engine.a11y.options.maxIntensity;
  const spec = () => resolveSpec({ spring: "gentle" }, engine.dna);
  const apply = (nx: number, ny: number) => {
    if (!engine.a11y.allows("parallax")) return;
    for (const el of list) {
      const depth = Number.parseFloat(el.dataset.depth ?? "0.5");
      const t = ElementTarget.for(el, engine);
      t.value("x", "px").animate(nx * depth * range(), spec(), { priority: "decorative" });
      t.value("y", "px").animate(ny * depth * range(), spec(), { priority: "decorative" });
    }
  };
  if ((opts.source ?? "pointer") === "pointer") {
    const move = (e: PointerEvent) => apply((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    addEventListener("pointermove", move, { passive: true });
    return () => removeEventListener("pointermove", move);
  }
  const scroll = () =>
    engine.read(
      () => {
        const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
        apply(0, (scrollY / max) * 2 - 1);
      },
      { key: "umx:parallax:scroll", priority: "decorative" },
    );
  addEventListener("scroll", scroll, { passive: true });
  return () => removeEventListener("scroll", scroll);
}

/** Assigns depth (translateZ + subtle scale) to children of a `preserve-3d` container by `data-layer`. */
export function depthStack(container: HTMLElement, opts: { engine?: Engine; perspective?: number } = {}): void {
  const engine = opts.engine ?? getEngine();
  container.style.perspective = `${opts.perspective ?? 1000}px`;
  container.style.transformStyle = "preserve-3d";
  const depth = engine.a11y.allows("spatial") ? engine.dna.data.depth : 0;
  container.querySelectorAll<HTMLElement>("[data-layer]").forEach((el) => {
    const layer = Number.parseFloat(el.dataset.layer ?? "0");
    const t = ElementTarget.for(el, engine);
    t.value("z", "px").animate(layer * depth, resolveSpec({ spring: "gentle" }, engine.dna));
  });
}
