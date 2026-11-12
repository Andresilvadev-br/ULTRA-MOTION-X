/**
 * Public animation API for DOM elements, MotionValues and plain objects.
 *
 *   animate(el, { x: 100, opacity: 1 })                       // DNA "standard" spring
 *   animate(".card", { scale: [1, 1.05, 1] }, { duration: 400 })
 *   animate(el, { backgroundColor: "#3b82f6" }, { type: "tween", ease: "easeOut" })
 *   const c = animate(el, { y: 0 }, { spring: "bouncy" }); c.reverse(); await c;
 */
import { type Engine, getEngine } from "../core/engine.ts";
import type { AnimationSpec } from "../core/generator.ts";
import {
  type AnimationOutcome,
  type InterruptPolicy,
  MotionValue,
  type Priority,
  type ValueAnimation,
} from "../core/motion-value.ts";
import { resolveSpec, type TransitionOptions } from "../core/spec.ts";
import { parseColor } from "../math/color.ts";
import { MotionError } from "../math/spring.ts";
import { activeCompositorRun, startCompositor } from "./compositor.ts";
import { ElementTarget } from "./element-target.ts";
import { canonical, kindOf, parseNumeric } from "./props.ts";

export type AnimationTarget = Element | string | ArrayLike<Element> | MotionValue | Record<string, unknown>;
export type ValueInput = number | string | null | Array<number | string | null>;
export type StaggerFn = (index: number, total: number) => number;

export interface AnimateOptions extends TransitionOptions {
  engine?: Engine;
  priority?: Priority;
  policy?: InterruptPolicy;
  /** ms between successive targets, or a function returning the delay (ms). */
  stagger?: number | StaggerFn;
  /** Extra repetitions (Infinity for endless loops of time-based animations). */
  repeat?: number;
  repeatType?: "loop" | "reverse";
  /** Per-property transition overrides. */
  transitions?: Record<string, TransitionOptions>;
  /** Run on the compositor via WAAPI when eligible (`true` also allows transforms). */
  compositor?: boolean;
  onUpdate?: (latest: Record<string, number>) => void;
  onComplete?: () => void;
}

export interface AnimationControls extends PromiseLike<AnimationOutcome[]> {
  readonly finished: Promise<AnimationOutcome[]>;
  readonly animations: readonly ValueAnimation[];
  readonly state: "running" | "paused" | "finished";
  play(): void;
  pause(): void;
  /** Stops where it is and settles as cancelled. */
  cancel(): void;
  stop(): void;
  /** Jumps to the end. */
  complete(): void;
  reverse(): void;
  /** Seek to `ms` of animation time. */
  seek(ms: number): void;
  speed: number;
}

const isElementLike = (t: unknown): t is Element => typeof Element !== "undefined" && t instanceof Element;

export function resolveElements(target: Element | string | ArrayLike<Element>): Element[] {
  if (typeof target === "string") {
    if (typeof document === "undefined") return [];
    return Array.from(document.querySelectorAll(target));
  }
  if (isElementLike(target)) return [target];
  return Array.from(target as ArrayLike<Element>);
}

export function staggerDelay(stagger: AnimateOptions["stagger"], i: number, n: number): number {
  if (stagger === undefined) return 0;
  return typeof stagger === "function" ? stagger(i, n) : stagger * i;
}

/** Stagger helper: `stagger(40, { from: "center" })`. */
export function stagger(
  each: number,
  opts: { from?: "first" | "last" | "center" | number; ease?: (p: number) => number } = {},
): StaggerFn {
  return (i, n) => {
    const origin =
      opts.from === "last"
        ? n - 1
        : opts.from === "center"
          ? (n - 1) / 2
          : typeof opts.from === "number"
            ? opts.from
            : 0;
    const d = Math.abs(i - origin);
    const max = Math.max(origin, n - 1 - origin) || 1;
    return opts.ease ? opts.ease(d / max) * max * each : d * each;
  };
}

class Controls implements AnimationControls {
  readonly animations: ValueAnimation[] = [];
  private readonly settled: Promise<AnimationOutcome[]>;
  private resolve!: (v: AnimationOutcome[]) => void;
  private pending: Array<Promise<AnimationOutcome>> = [];
  private sealed = false;
  private rate = 1;
  private paused = false;
  restarts: Array<() => void> = [];

  constructor() {
    this.settled = new Promise((r) => {
      this.resolve = r;
    });
  }

  add(a: ValueAnimation): void {
    this.animations.push(a);
    this.pending.push(a.finished);
    if (this.rate !== 1) a.setRate(this.rate);
    if (this.paused) a.pause();
  }

  seal(onComplete?: () => void): void {
    if (this.sealed) return;
    this.sealed = true;
    const wait = async (): Promise<AnimationOutcome[]> => {
      let seen = 0;
      // Repeats can append animations while waiting.
      while (seen < this.pending.length) {
        const batch = this.pending.slice(seen);
        seen = this.pending.length;
        await Promise.all(batch);
      }
      return Promise.all(this.pending);
    };
    wait().then((outcomes) => {
      if (outcomes.every((o) => o === "completed")) onComplete?.();
      this.resolve(outcomes);
    });
  }

  get finished(): Promise<AnimationOutcome[]> {
    return this.settled;
  }
  // biome-ignore lint/suspicious/noThenProperty: controls are intentionally awaitable.
  then<A = AnimationOutcome[], B = never>(
    onfulfilled?: ((v: AnimationOutcome[]) => A | PromiseLike<A>) | null,
    onrejected?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.settled.then(onfulfilled, onrejected);
  }
  get state(): "running" | "paused" | "finished" {
    if (this.animations.every((a) => a.state !== "running" && a.state !== "paused" && a.state !== "pending"))
      return "finished";
    return this.paused ? "paused" : "running";
  }
  private live(): ValueAnimation[] {
    return this.animations.filter((a) => a.state === "running" || a.state === "paused");
  }
  play(): void {
    this.paused = false;
    for (const a of this.live()) a.play();
  }
  pause(): void {
    this.paused = true;
    for (const a of this.live()) a.pause();
  }
  cancel(): void {
    this.restarts = [];
    // Pending queued requests are owned by these controls too.
    for (const a of this.animations) {
      if (a.state === "pending" || a.state === "running" || a.state === "paused") a.cancel();
    }
  }
  stop(): void {
    this.cancel();
  }
  complete(): void {
    this.restarts = [];
    for (const a of this.live()) a.complete();
  }
  reverse(): void {
    for (const a of this.live()) a.reverse();
  }
  seek(ms: number): void {
    for (const a of this.live()) a.seek(ms / 1000);
  }
  get speed(): number {
    return this.rate;
  }
  set speed(r: number) {
    this.rate = r;
    for (const a of this.live()) a.setRate(r);
  }
}

function toNumbers(
  prop: string,
  input: ValueInput,
  current: number,
  unitHint: string,
): { values: number[]; unit: string } {
  const list = Array.isArray(input) ? input : [input];
  let unit = unitHint;
  const values = list.map((v, i) => {
    if (v === null) {
      if (i !== 0) throw new MotionError("E_VALUE", `only the first keyframe of \`${prop}\` may be null`);
      return current;
    }
    const n = parseNumeric(v, prop);
    if (!n) throw new MotionError("E_VALUE", `cannot animate \`${prop}\` to \`${String(v)}\``);
    if (n.unit) unit = n.unit;
    return n.value;
  });
  return { values, unit };
}

function startValue(
  mv: MotionValue,
  values: number[],
  spec: TransitionOptions,
  engine: Engine,
  opts: AnimateOptions,
  delayMs: number,
  explicitFrom: boolean,
): ValueAnimation {
  const delayed: TransitionOptions = { ...spec, delay: (spec.delay ?? 0) + delayMs };
  if (values.length === 1) {
    const s = resolveSpec(delayed, engine.dna);
    if (spec.velocity !== undefined) mv.jump(mv.get(), spec.velocity);
    return mv.animate(values[0]!, s, { priority: opts.priority, policy: opts.policy });
  }
  // Two values = from/to; more = keyframes (first keyframe NaN means "current").
  if (values.length === 2 && delayed.type !== "keyframes") {
    if (explicitFrom) mv.set(values[0]!);
    return mv.animate(values[1]!, resolveSpec(delayed, engine.dna), { priority: opts.priority, policy: opts.policy });
  }
  const s: AnimationSpec = resolveSpec({ ...delayed, type: "keyframes" }, engine.dna, values);
  if (explicitFrom) mv.set(values[0]!);
  return mv.animate(values[values.length - 1]!, s, { priority: opts.priority, policy: opts.policy });
}

/** Animates one or many targets. Returns awaitable playback controls. */
export function animate(
  target: AnimationTarget,
  values: Record<string, ValueInput> | number,
  opts: AnimateOptions = {},
): AnimationControls {
  const engine = opts.engine ?? getEngine();
  const controls = new Controls();

  if (target instanceof MotionValue) {
    const v = typeof values === "number" ? values : (values as Record<string, ValueInput>).value;
    if (v === undefined) throw new MotionError("E_VALUE", "animate(motionValue, value) needs a number");
    const { values: nums } = toNumbers("value", v as ValueInput, target.get(), "");
    controls.add(startValue(target, nums, opts, engine, opts, 0, Array.isArray(v) && v[0] !== null));
    controls.seal(opts.onComplete);
    return controls;
  }
  if (typeof values === "number") throw new MotionError("E_VALUE", "property map expected");

  const isDom =
    typeof target === "string" ||
    isElementLike(target) ||
    Array.isArray(target) ||
    (typeof NodeList !== "undefined" && target instanceof NodeList) ||
    (typeof HTMLCollection !== "undefined" && target instanceof HTMLCollection);
  if (!isDom) {
    animateObject(target as Record<string, unknown>, values, opts, engine, controls);
    controls.seal(opts.onComplete);
    return controls;
  }

  const elements = resolveElements(target as Element | string | ArrayLike<Element>);
  const run = (repeatIndex: number) => {
    elements.forEach((el, i) => {
      const t = ElementTarget.for(el, engine);
      activeCompositorRun(t)?.release();
      const delayMs = staggerDelay(opts.stagger, i, elements.length);
      const compositorEntries: Array<{ prop: string; unit: string; anim: ValueAnimation }> = [];
      for (const [rawProp, input] of Object.entries(values)) {
        const prop = canonical(rawProp);
        const spec = { ...opts, ...(opts.transitions?.[rawProp] ?? opts.transitions?.[prop] ?? {}) };
        const reverse = opts.repeatType === "reverse" && repeatIndex % 2 === 1;
        if (kindOf(prop) === "color") {
          const list = Array.isArray(input) ? input : [input];
          const last = list[list.length - 1];
          const to = typeof last === "string" ? parseColor(last) : null;
          if (!to) throw new MotionError("E_VALUE", `cannot parse colour \`${String(last)}\` for \`${prop}\``);
          const firstColor = reverse ? (typeof list[0] === "string" ? parseColor(list[0]) : null) : null;
          const progress = t.colorValue(prop, firstColor ?? to);
          controls.add(
            progress.animate(1, resolveSpec({ ...spec, delay: (spec.delay ?? 0) + delayMs }, engine.dna), {
              priority: opts.priority,
              policy: opts.policy,
            }),
          );
          continue;
        }
        const current = t.read(prop);
        let { values: nums, unit } = toNumbers(prop, input, current.value, current.unit);
        let explicitFrom = Array.isArray(input) && input[0] !== null;
        if (reverse) {
          nums = [...nums].reverse();
          explicitFrom = true;
        }
        if (current.unit && unit && current.unit !== unit && current.value !== 0 && !explicitFrom) {
          engine.warn(`unit change on ${prop} (${current.unit} → ${unit}); animating from 0${unit}`);
          t.value(prop, unit).set(0);
        }
        const mv = t.value(prop, unit);
        const anim = startValue(mv, nums, spec, engine, opts, delayMs, explicitFrom);
        controls.add(anim);
        if (kindOf(prop) === "transform" || prop === "opacity") compositorEntries.push({ prop, unit, anim });
      }
      if (elements.length <= engine.options.compositorMaxElements) maybeCompositor(t, compositorEntries, opts, engine);
      if (opts.onUpdate) {
        const unsub = [...t.values().entries()].map(([k, mv]) =>
          mv.on("change", () => opts.onUpdate?.({ [k]: mv.get() })),
        );
        controls.finished.then(() => unsub.forEach((u) => u()));
      }
    });
  };
  run(0);
  const repeats = opts.repeat ?? 0;
  if (repeats > 0) {
    // Each completed round starts the next one; any non-completed outcome stops the chain.
    let done = 0;
    const schedule = (from: number) => {
      Promise.all(controls.animations.slice(from).map((a) => a.finished)).then((outcomes) => {
        if (outcomes.some((o) => o !== "completed") || done >= repeats) return;
        done++;
        const before = controls.animations.length;
        run(done);
        schedule(before);
      });
    };
    schedule(0);
  }
  controls.seal(opts.onComplete);
  return controls;
}

function maybeCompositor(
  t: ElementTarget,
  entries: Array<{ prop: string; unit: string; anim: ValueAnimation }>,
  opts: AnimateOptions,
  engine: Engine,
): void {
  const mode = opts.compositor === true ? "always" : opts.compositor === false ? "never" : engine.options.compositor;
  if (mode === "never" || engine.reducedMotion || !entries.length) return;
  const running = entries.filter((e) => e.anim.state === "running");
  const opacity = running.filter((e) => e.prop === "opacity");
  const transforms = running.filter((e) => e.prop !== "opacity");
  if (opacity.length === 1 && (mode === "auto" || mode === "always")) startCompositor(t, opacity, "opacity");
  if (mode === "always" && transforms.length) {
    // Only when no other transform value of this element is animating outside this call.
    const others = [...t.values().entries()].filter(
      ([k, mv]) => kindOf(k) === "transform" && mv.isAnimating && !transforms.some((e) => e.prop === k),
    );
    if (!others.length) startCompositor(t, transforms, "transform");
  }
}

function animateObject(
  obj: Record<string, unknown>,
  values: Record<string, ValueInput>,
  opts: AnimateOptions,
  engine: Engine,
  controls: Controls,
): void {
  for (const [prop, input] of Object.entries(values)) {
    const cur = obj[prop];
    if (typeof cur !== "number") throw new MotionError("E_VALUE", `object property \`${prop}\` must be a number`);
    const mv = new MotionValue(cur, engine, { name: prop });
    const unsub = mv.on("change", (v) => {
      obj[prop] = v;
      opts.onUpdate?.({ [prop]: v });
    });
    const { values: nums } = toNumbers(prop, input, cur, "");
    const anim = startValue(
      mv,
      nums,
      { ...opts, ...(opts.transitions?.[prop] ?? {}) },
      engine,
      opts,
      0,
      Array.isArray(input) && input[0] !== null,
    );
    anim.finished.then(() => {
      obj[prop] = mv.get();
      unsub();
      mv.destroy();
    });
    controls.add(anim);
  }
}

/** Sets values immediately (no animation), cancelling running animations on them. */
export function set(
  target: Element | string | ArrayLike<Element>,
  values: Record<string, number | string>,
  engine: Engine = getEngine(),
): void {
  for (const el of resolveElements(target)) {
    const t = ElementTarget.for(el, engine);
    activeCompositorRun(t)?.release();
    for (const [rawProp, v] of Object.entries(values)) {
      const prop = canonical(rawProp);
      if (kindOf(prop) === "color") {
        const c = typeof v === "string" ? parseColor(v) : null;
        if (!c) throw new MotionError("E_VALUE", `cannot parse colour for \`${prop}\``);
        t.colorValue(prop, c).set(1);
        continue;
      }
      const n = parseNumeric(v, prop);
      if (!n) throw new MotionError("E_VALUE", `cannot set \`${prop}\` to \`${String(v)}\``);
      t.value(prop, n.unit).set(n.value);
    }
    t.flush();
  }
}

/** Stops every animation on the given elements. */
export function stop(target: Element | string | ArrayLike<Element>): void {
  for (const el of resolveElements(target)) {
    const t = ElementTarget.peek(el);
    if (!t) continue;
    activeCompositorRun(t)?.release();
    t.stop();
  }
}

/** Returns the live MotionValue driving `prop` of an element (creating it if needed). */
export function motionValueOf(el: Element, prop: string, engine: Engine = getEngine()): MotionValue {
  return ElementTarget.for(el, engine).value(canonical(prop));
}
