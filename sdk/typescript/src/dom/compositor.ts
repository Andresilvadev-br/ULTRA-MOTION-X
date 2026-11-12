/**
 * Compositor path: hands an animation to the Web Animations API so the browser compositor
 * keeps it smooth even if the main thread is busy. The MotionValues keep sampling the same
 * analytic generators, so an interruption can hand control back to the frame loop with the
 * exact current position and velocity. Only compositor-friendly properties are eligible:
 * `opacity` (auto) and full transform groups (explicit opt-in).
 */
import type { ValueAnimation } from "../core/motion-value.ts";
import type { ElementTarget } from "./element-target.ts";
import { composeTransform, type NumericValue } from "./props.ts";

const SAMPLES_PER_SECOND = 60;
const active = new WeakMap<ElementTarget, CompositorRun>();

export class CompositorRun {
  readonly target: ElementTarget;
  readonly props: string[];
  readonly waapi: Animation;
  private done = false;

  constructor(target: ElementTarget, props: string[], waapi: Animation) {
    this.target = target;
    this.props = props;
    this.waapi = waapi;
  }

  /** Returns control to the frame loop (interruption or completion). */
  release(): void {
    if (this.done) return;
    this.done = true;
    for (const p of this.props) this.target.setDelegated(p, false);
    this.target.setDelegated("transform", false);
    this.target.flush();
    try {
      this.waapi.cancel();
    } catch {
      /* already finished */
    }
    if (active.get(this.target) === this) active.delete(this.target);
  }
}

export function activeCompositorRun(t: ElementTarget): CompositorRun | undefined {
  return active.get(t);
}

/** Bakes generators into WAAPI keyframes; returns null when not eligible. */
export function startCompositor(
  target: ElementTarget,
  entries: Array<{ prop: string; unit: string; anim: ValueAnimation }>,
  kind: "opacity" | "transform",
): CompositorRun | null {
  const el = target.el as Element & { animate?: Element["animate"] };
  if (typeof el.animate !== "function") return null;
  const gens = entries.map((e) => e.anim.gen);
  if (gens.some((g) => !Number.isFinite(g.duration) || g.duration <= 0)) return null;
  const duration = Math.max(...gens.map((g) => g.duration));
  const n = Math.min(240, Math.max(2, Math.ceil(duration * SAMPLES_PER_SECOND)));
  const frames: Keyframe[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (duration * i) / n;
    if (kind === "opacity") {
      frames.push({ opacity: String(clamp01(gens[0]!.sample(t).value)) });
    } else {
      const map = new Map<string, NumericValue>();
      for (const [prop, mv] of target.values()) map.set(prop, { value: mv.get(), unit: "px" });
      entries.forEach((e, k) => map.set(e.prop, { value: gens[k]!.sample(t).value, unit: e.unit }));
      frames.push({ transform: composeTransform((p) => map.get(p)) || "none" });
    }
  }
  previous(target)?.release();
  const waapi = el.animate(frames, { duration: duration * 1000, easing: "linear", fill: "forwards" });
  const run = new CompositorRun(
    target,
    entries.map((e) => e.prop),
    waapi,
  );
  for (const e of entries) target.setDelegated(e.prop, true);
  if (kind === "transform") target.setDelegated("transform", true);
  active.set(target, run);
  let remaining = entries.length;
  for (const e of entries) {
    e.anim.finished.then(() => {
      remaining--;
      if (remaining === 0 || e.anim.state !== "completed") run.release();
    });
  }
  return run;
}

function previous(t: ElementTarget): CompositorRun | undefined {
  return active.get(t);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
