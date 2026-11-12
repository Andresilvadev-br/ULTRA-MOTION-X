/**
 * Shared element transitions: one element keeps its identity across states or screens.
 * Uses the native View Transitions API when available (the platform mechanism is
 * preferred), otherwise a FLIP-based implementation driven by `data-umx-id` attributes.
 */
import { type Engine, getEngine } from "../core/engine.ts";
import { resolveSpec, type TransitionOptions } from "../core/spec.ts";
import { ElementTarget } from "../dom/element-target.ts";

export interface SharedOptions extends TransitionOptions {
  engine?: Engine;
  /** Cross-fade the outgoing element (when both remain in the DOM). */
  crossfade?: boolean;
}

interface Snapshot {
  rect: DOMRect;
  radius: string;
}

/** Animates `to` so that it appears to grow out of `from`'s position and size. */
export async function sharedTransition(from: Element, to: Element, opts: SharedOptions = {}): Promise<void> {
  const engine = opts.engine ?? getEngine();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!b.width || !b.height) return;
  const t = ElementTarget.for(to, engine);
  (to as HTMLElement).style.transformOrigin = "0 0";
  const spec = resolveSpec(
    opts.type || opts.duration ? opts : { ...opts, spring: opts.spring ?? "standard" },
    engine.dna,
  );
  const pairs: Array<[string, number, number]> = [
    ["x", a.left - b.left, 0],
    ["y", a.top - b.top, 0],
    ["scaleX", a.width / b.width, 1],
    ["scaleY", a.height / b.height, 1],
  ];
  const anims: Array<Promise<unknown>> = [];
  for (const [p, start, end] of pairs) {
    const mv = t.value(p, p.startsWith("scale") ? "" : "px");
    mv.set(start);
    anims.push(mv.animate(end, spec, { priority: "interaction" }).finished);
  }
  t.flush();
  if (opts.crossfade && from.isConnected && from !== to) {
    const f = ElementTarget.for(from, engine);
    anims.push(
      f.value("opacity").animate(0, resolveSpec({ duration: engine.dna.duration("fast") }, engine.dna)).finished,
    );
  }
  await Promise.all(anims);
}

/** Captures rects of every `[data-umx-id]` element under `root` (call before changing the DOM). */
export function captureShared(root: ParentNode = document): Map<string, Snapshot> {
  const map = new Map<string, Snapshot>();
  root.querySelectorAll<HTMLElement>("[data-umx-id]").forEach((el) => {
    map.set(el.dataset.umxId!, { rect: el.getBoundingClientRect(), radius: getComputedStyle(el).borderRadius });
  });
  return map;
}

/** After the DOM changed, animates every element whose `data-umx-id` existed before. */
export async function animateShared(
  snapshot: Map<string, Snapshot>,
  root: ParentNode = document,
  opts: SharedOptions = {},
): Promise<void> {
  const engine = opts.engine ?? getEngine();
  const jobs: Array<Promise<void>> = [];
  root.querySelectorAll<HTMLElement>("[data-umx-id]").forEach((el) => {
    const snap = snapshot.get(el.dataset.umxId!);
    if (!snap) return;
    const ghost = { getBoundingClientRect: () => snap.rect } as Element;
    jobs.push(sharedTransition(ghost, el, { ...opts, engine }));
  });
  await Promise.all(jobs);
}

/**
 * Runs `update` as a view transition: native `document.startViewTransition` when supported
 * and motion is allowed, otherwise the FLIP fallback using `data-umx-id` identities.
 */
export async function viewTransition(
  update: () => void | Promise<void>,
  opts: SharedOptions & { root?: ParentNode; native?: boolean } = {},
): Promise<void> {
  const engine = opts.engine ?? getEngine();
  if (engine.reducedMotion) {
    await update();
    return;
  }
  const doc =
    typeof document !== "undefined"
      ? (document as Document & {
          startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> };
        })
      : null;
  if (opts.native !== false && doc?.startViewTransition) {
    await doc.startViewTransition(update).finished.catch(() => undefined);
    return;
  }
  const snap = captureShared(opts.root);
  await update();
  await animateShared(snap, opts.root, opts);
}
