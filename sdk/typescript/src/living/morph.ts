/**
 * Fluid Morphing Engine: container morphs (size, position, corner radius, colour) and SVG
 * path morphing with continuous velocity and interruption support.
 */
import { type Engine, getEngine } from "../core/engine.ts";
import { MotionValue } from "../core/motion-value.ts";
import type { TransitionOptions } from "../core/spec.ts";
import { type AnimationControls, animate } from "../dom/animate.ts";
import { layoutTransition } from "./layout.ts";

export interface MorphOptions extends TransitionOptions {
  engine?: Engine;
}

/**
 * Morphs a container into a new layout state (class/style change) while keeping its corner
 * radius and colours continuous. `apply` performs the state change (e.g. toggles a class).
 */
export async function morphContainer(
  el: HTMLElement,
  apply: () => void,
  opts: MorphOptions & { radius?: number; background?: string } = {},
): Promise<void> {
  const engine = opts.engine ?? getEngine();
  const jobs: Array<PromiseLike<unknown>> = [
    layoutTransition([el], apply, { ...opts, engine, mode: "size", preserveRadius: opts.radius === undefined }),
  ];
  const extra: Record<string, number | string> = {};
  if (opts.radius !== undefined) extra.borderRadius = `${opts.radius}px`;
  if (opts.background) extra.backgroundColor = opts.background;
  if (Object.keys(extra).length) jobs.push(animate(el, extra, { ...opts, engine }));
  await Promise.all(jobs);
}

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;

/** Splits a path into its command skeleton and numeric arguments. */
export function parsePath(d: string): { skeleton: string; numbers: number[] } {
  const numbers = (d.match(NUM) ?? []).map(Number);
  return { skeleton: d.replace(NUM, "#").replace(/\s+/g, " ").trim(), numbers };
}

export function pathsCompatible(a: string, b: string): boolean {
  const pa = parsePath(a);
  const pb = parsePath(b);
  return pa.skeleton === pb.skeleton && pa.numbers.length === pb.numbers.length;
}

/** Interpolates two compatible paths (same command structure). */
export function interpolatePath(a: string, b: string, t: number): string {
  const pa = parsePath(a);
  const pb = parsePath(b);
  if (pa.skeleton !== pb.skeleton || pa.numbers.length !== pb.numbers.length)
    throw new Error("paths are not compatible");
  let i = 0;
  return pa.skeleton.replace(/#/g, () => {
    const v = pa.numbers[i]! + (pb.numbers[i]! - pa.numbers[i]!) * t;
    i++;
    return String(Math.round(v * 1000) / 1000);
  });
}

/** Resamples any path to `n` points (browser geometry API) for incompatible morphs. */
export function samplePath(d: string, n = 64): Array<[number, number]> {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.setAttribute("d", d);
  const len = svg.getTotalLength();
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const p = svg.getPointAtLength((len * i) / n);
    pts.push([p.x, p.y]);
  }
  return pts;
}

const polygon = (pts: Array<[number, number]>) =>
  `M${pts.map(([x, y]) => `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`).join(" L")} Z`;

/**
 * Morphs an SVG `<path>` to `to`. Compatible paths interpolate their numbers directly;
 * otherwise both shapes are resampled to polygons. Interrupting with a new call continues
 * from the current shape.
 */
export function morphPath(
  path: SVGPathElement,
  to: string,
  opts: MorphOptions & { samples?: number } = {},
): AnimationControls {
  const engine = opts.engine ?? getEngine();
  const from = path.getAttribute("d") ?? "";
  let a = from;
  let b = to;
  if (!pathsCompatible(from, to)) {
    a = polygon(samplePath(from, opts.samples ?? 64));
    b = polygon(samplePath(to, opts.samples ?? 64));
  }
  const progress = new MotionValue(0, engine, { name: "morph" });
  const unsub = progress.on("change", (t) =>
    engine.write(() => path.setAttribute("d", interpolatePath(a, b, t)), { key: `morph:${pathId(path)}` }),
  );
  const controls = animate(progress, 1, {
    ...opts,
    engine,
    ...(opts.type || opts.duration ? {} : { spring: opts.spring ?? "standard" }),
  });
  controls.finished.then((o) => {
    unsub();
    if (o.every((x) => x === "completed")) path.setAttribute("d", to);
    progress.destroy();
  });
  return controls;
}

const ids = new WeakMap<Element, number>();
let seq = 0;
function pathId(el: Element): number {
  let id = ids.get(el);
  if (!id) ids.set(el, (id = ++seq));
  return id;
}
