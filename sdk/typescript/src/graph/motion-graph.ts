/**
 * Universal Motion Graph (web runtime). Same semantics as `umx-graph` (Rust): states,
 * transitions with guards and interruption policies, relations evaluated in topological
 * order, gesture hand-off and live mutation that only retargets properties whose goal
 * changed. Accepts graph definitions produced by the MDL compiler (`compileMDL`).
 */
import { type Engine, getEngine } from "../core/engine.ts";
import type { AnimationSpec } from "../core/generator.ts";
import { MotionValue, type Priority, type ValueAnimation } from "../core/motion-value.ts";
import { ElementTarget } from "../dom/element-target.ts";
import { MotionError } from "../math/spring.ts";

export type Interrupt = "retarget" | "queue" | "ignore" | "snap";

export interface PropertyDef {
  initial: number;
  min?: number | null;
  max?: number | null;
}

export interface TransitionDef {
  from: string;
  to: string;
  event: string;
  spec?: AnimationSpec | null;
  propertySpecs?: Record<string, AnimationSpec>;
  /** Seconds. */
  delays?: Record<string, number>;
  guard?: string | null;
  interrupt?: Interrupt;
}

export interface Relation {
  source: string;
  target: string;
  input: [number, number];
  output: [number, number];
  clamp?: boolean;
}

export interface GraphDef {
  properties: Record<string, PropertyDef>;
  states: Record<string, Record<string, number>>;
  initial: string;
  transitions: TransitionDef[];
  defaultSpec: AnimationSpec;
  relations?: Relation[];
}

export interface GraphDiagnostic {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export type GraphEvent =
  | { type: "transitionstart"; from: string; to: string; event: string }
  | { type: "transitionend"; to: string }
  | { type: "interrupt"; from: string; to: string; by: string }
  | { type: "ignored"; event: string; reason: string }
  | { type: "queued"; event: string };

/** Validation mirroring `GraphDef::validate` in Rust. */
export function validateGraph(def: GraphDef): GraphDiagnostic[] {
  const d: GraphDiagnostic[] = [];
  const err = (code: string, path: string, message: string) => d.push({ severity: "error", code, path, message });
  const warn = (code: string, path: string, message: string) => d.push({ severity: "warning", code, path, message });
  if (!def.states[def.initial]) err("E_INITIAL", "initial", `initial state \`${def.initial}\` is not defined`);
  const relTargets = new Set((def.relations ?? []).map((r) => r.target));
  for (const [s, goals] of Object.entries(def.states)) {
    for (const [p, v] of Object.entries(goals)) {
      if (!def.properties[p]) err("E_UNKNOWN_PROPERTY", `states.${s}.${p}`, `property \`${p}\` is not declared`);
      else if (!Number.isFinite(v)) err("E_VALUE", `states.${s}.${p}`, "value must be finite");
      if (relTargets.has(p))
        err("E_OWNERSHIP", `states.${s}.${p}`, `\`${p}\` is driven by a relation and cannot also be set by states`);
    }
  }
  def.transitions.forEach((t, i) => {
    if (t.from !== "*" && !def.states[t.from])
      err("E_UNKNOWN_STATE", `transitions[${i}].from`, `state \`${t.from}\` is not defined`);
    if (!def.states[t.to]) err("E_UNKNOWN_STATE", `transitions[${i}].to`, `state \`${t.to}\` is not defined`);
    if (!t.event) err("E_EVENT", `transitions[${i}].event`, "event name must not be empty");
  });
  (def.relations ?? []).forEach((r, i) => {
    for (const p of [r.source, r.target])
      if (!def.properties[p]) err("E_UNKNOWN_PROPERTY", `relations[${i}]`, `property \`${p}\` is not declared`);
  });
  if (relationOrder(def.relations ?? []) === null) err("E_CYCLE", "relations", "relations contain a dependency cycle");
  if (def.states[def.initial]) {
    const reach = new Set([def.initial]);
    const queue = [def.initial];
    while (queue.length) {
      const s = queue.shift()!;
      for (const t of def.transitions) {
        if ((t.from === s || t.from === "*") && !reach.has(t.to)) {
          reach.add(t.to);
          queue.push(t.to);
        }
      }
    }
    for (const s of Object.keys(def.states))
      if (!reach.has(s))
        warn("W_UNREACHABLE", `states.${s}`, `state \`${s}\` is not reachable from \`${def.initial}\``);
  }
  return d;
}

function relationOrder(rels: Relation[]): number[] | null {
  const n = rels.length;
  const indeg = new Array<number>(n).fill(0);
  const edges: number[][] = rels.map(() => []);
  for (let i = 0; i < n; i++) {
    if (rels[i]!.source === rels[i]!.target) return null;
    for (let j = 0; j < n; j++) {
      if (i !== j && rels[i]!.target === rels[j]!.source) {
        edges[i]!.push(j);
        indeg[j]!++;
      }
    }
  }
  const q = indeg.flatMap((d, i) => (d === 0 ? [i] : []));
  const out: number[] = [];
  while (q.length) {
    const i = q.shift()!;
    out.push(i);
    for (const j of edges[i]!) if (--indeg[j]! === 0) q.push(j);
  }
  return out.length === n ? out : null;
}

const mapRelation = (r: Relation, v: number) => {
  const [i0, i1] = r.input;
  const [o0, o1] = r.output;
  if (i1 === i0) return o0;
  let t = (v - i0) / (i1 - i0);
  if (r.clamp !== false) t = Math.min(1, Math.max(0, t));
  return o0 + (o1 - o0) * t;
};

const withDelay = (spec: AnimationSpec, delay: number): AnimationSpec =>
  spec.type === "tween" || spec.type === "spring" || spec.type === "keyframes" ? { ...spec, delay } : spec;

export interface MotionGraphOptions {
  engine?: Engine;
  priority?: Priority;
  name?: string;
}

export class MotionGraph {
  readonly engine: Engine;
  readonly name: string;
  def: GraphDef;
  readonly values: Record<string, MotionValue> = {};
  private goals: Record<string, number> = {};
  private settled: string;
  private active: { from: string; to: string; interrupt: Interrupt; pending: Set<string> } | null = null;
  private conditions = new Set<string>();
  private pendingEvents: string[] = [];
  private gestures = new Set<string>();
  private listeners = new Set<(e: GraphEvent) => void>();
  private order: number[];
  private unsubs: Array<() => void> = [];
  private priority: Priority;
  /** Number of generator (re)builds — verifies incremental retargeting. */
  rebuilds = 0;

  constructor(def: GraphDef, opts: MotionGraphOptions = {}) {
    const diags = validateGraph(def).filter((x) => x.severity === "error");
    if (diags.length)
      throw new MotionError("E_GRAPH", diags.map((x) => `[${x.code}] ${x.path}: ${x.message}`).join("; "));
    this.def = structuredClone(def);
    this.engine = opts.engine ?? getEngine();
    this.name = opts.name ?? "graph";
    this.priority = opts.priority ?? "normal";
    this.settled = def.initial;
    this.order = relationOrder(def.relations ?? []) ?? [];
    const init = def.states[def.initial] ?? {};
    for (const [p, pd] of Object.entries(def.properties)) {
      const v = this.clamp(p, init[p] ?? pd.initial);
      this.values[p] = new MotionValue(v, this.engine, { name: `${this.name}.${p}` });
      this.goals[p] = v;
    }
    for (const r of def.relations ?? []) {
      this.unsubs.push(this.values[r.source]!.on("change", () => this.applyRelations()));
    }
    this.applyRelations();
  }

  /** Destination state during a transition, otherwise the settled state. */
  get state(): string {
    return this.active?.to ?? this.settled;
  }
  get settledState(): string {
    return this.settled;
  }
  get isTransitioning(): boolean {
    return this.active !== null;
  }

  get(prop: string): number {
    const v = this.values[prop];
    if (!v) throw new MotionError("E_UNKNOWN_PROPERTY", `unknown property \`${prop}\``);
    return v.get();
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.values).map(([k, v]) => [k, v.get()]));
  }

  setCondition(name: string, on: boolean): void {
    if (on) this.conditions.add(name);
    else this.conditions.delete(name);
  }

  on(cb: (e: GraphEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: GraphEvent): void {
    for (const l of this.listeners) l(e);
  }

  private clamp(p: string, v: number): number {
    const d = this.def.properties[p];
    let x = v;
    if (d?.min !== undefined && d.min !== null) x = Math.max(d.min, x);
    if (d?.max !== undefined && d.max !== null) x = Math.min(d.max, x);
    return x;
  }

  private find(event: string): TransitionDef | undefined {
    const ok = (t: TransitionDef) => !t.guard || this.conditions.has(t.guard);
    return (
      this.def.transitions.find((t) => t.from === this.state && t.event === event && ok(t)) ??
      this.def.transitions.find((t) => t.from === "*" && t.event === event && ok(t))
    );
  }

  /** Dispatches an event; returns true when a transition started. */
  send(event: string): boolean {
    const t = this.find(event);
    if (!t) {
      this.emit({ type: "ignored", event, reason: "no matching transition" });
      return false;
    }
    if (this.active) {
      const policy = this.active.interrupt;
      if (policy === "queue") {
        this.pendingEvents.push(event);
        this.emit({ type: "queued", event });
        return false;
      }
      if (policy === "ignore") {
        this.emit({ type: "ignored", event, reason: "transition is not interruptible" });
        return false;
      }
      if (policy === "snap") this.snapToGoals();
      if (this.active) this.emit({ type: "interrupt", from: this.active.from, to: this.active.to, by: event });
    }
    this.start(t);
    return true;
  }

  private start(t: TransitionDef): void {
    const from = this.state;
    const goals = this.def.states[t.to] ?? {};
    const base = t.spec ?? this.def.defaultSpec;
    const pending = new Set<string>();
    const active = { from, to: t.to, interrupt: t.interrupt ?? "retarget", pending };
    this.active = active;
    for (const [p, raw] of Object.entries(goals)) {
      let spec = t.propertySpecs?.[p] ?? base;
      const delay = t.delays?.[p];
      if (delay) spec = withDelay(spec, delay);
      const anim = this.retarget(p, this.clamp(p, raw), spec);
      if (anim) {
        pending.add(p);
        anim.finished.then(() => {
          pending.delete(p);
          if (this.active === active && pending.size === 0 && !this.gestures.size) this.complete();
        });
      } else if (this.values[p]!.isAnimating) {
        // Goal unchanged and still in flight from a previous transition: wait for it.
        const cur = this.values[p]!.currentAnimation;
        if (cur) {
          pending.add(p);
          cur.finished.then(() => {
            pending.delete(p);
            if (this.active === active && pending.size === 0 && !this.gestures.size) this.complete();
          });
        }
      }
    }
    this.emit({ type: "transitionstart", from, to: t.to, event: t.event });
    if (pending.size === 0) this.complete();
  }

  /** Retargets one property; returns null when its goal is unchanged. */
  private retarget(p: string, goal: number, spec: AnimationSpec): ValueAnimation | null {
    const mv = this.values[p];
    if (!mv) throw new MotionError("E_UNKNOWN_PROPERTY", `unknown property \`${p}\``);
    if (this.gestures.has(p)) {
      this.goals[p] = goal;
      return null;
    }
    const same = Math.abs((this.goals[p] ?? Number.NaN) - goal) < 1e-12;
    if (same && (mv.isAnimating || Math.abs(mv.get() - goal) < 1e-12)) return null;
    this.goals[p] = goal;
    this.rebuilds++;
    return mv.animate(goal, spec, { priority: this.priority });
  }

  private complete(): void {
    if (!this.active) return;
    const to = this.active.to;
    this.active = null;
    this.settled = to;
    this.emit({ type: "transitionend", to });
    while (this.pendingEvents.length) {
      if (this.send(this.pendingEvents.shift()!)) break;
    }
  }

  private snapToGoals(): void {
    for (const [p, mv] of Object.entries(this.values)) if (!this.gestures.has(p)) mv.set(this.goals[p] ?? mv.get());
    if (this.active) {
      const to = this.active.to;
      this.active = null;
      this.settled = to;
      this.emit({ type: "transitionend", to });
    }
  }

  /** Jumps to a state without animating. */
  jumpTo(state: string): void {
    const goals = this.def.states[state];
    if (!goals) throw new MotionError("E_UNKNOWN_STATE", `unknown state \`${state}\``);
    for (const [p, v] of Object.entries(goals)) {
      const c = this.clamp(p, v);
      this.goals[p] = c;
      this.values[p]?.set(c);
    }
    this.active = null;
    this.pendingEvents = [];
    this.settled = state;
  }

  private applyRelations(): void {
    const rels = this.def.relations ?? [];
    for (const i of this.order) {
      const r = rels[i]!;
      const src = this.values[r.source]!;
      const dst = this.values[r.target]!;
      const v = mapRelation(r, src.get());
      const slope = r.input[1] === r.input[0] ? 0 : (r.output[1] - r.output[0]) / (r.input[1] - r.input[0]);
      if (dst.get() !== v) dst.jump(v, src.velocity * slope);
    }
  }

  // ---- gestures ---------------------------------------------------------------------------

  beginGesture(prop: string): void {
    const mv = this.values[prop];
    if (!mv) throw new MotionError("E_UNKNOWN_PROPERTY", `unknown property \`${prop}\``);
    this.gestures.add(prop);
    mv.stop();
  }

  setGestureValue(prop: string, value: number, velocity = 0): void {
    if (!this.gestures.has(prop)) this.beginGesture(prop);
    this.values[prop]!.jump(this.clamp(prop, value), velocity);
  }

  /**
   * Ends a gesture; dispatches `event` if given (e.g. picked from the release projection).
   * The release velocity carries into the resulting animation.
   */
  endGesture(prop: string, velocity: number, event?: string, spec?: AnimationSpec): void {
    const mv = this.values[prop];
    if (!mv) throw new MotionError("E_UNKNOWN_PROPERTY", `unknown property \`${prop}\``);
    this.gestures.delete(prop);
    mv.jump(mv.get(), velocity);
    const started = event ? this.send(event) : false;
    if (!started || !mv.isAnimating) {
      this.goals[prop] = Number.NaN;
      const goal = this.def.states[this.state]?.[prop] ?? mv.get();
      this.retarget(prop, this.clamp(prop, goal), spec ?? this.def.defaultSpec);
    }
  }

  // ---- live mutation ----------------------------------------------------------------------

  setStateValue(state: string, prop: string, value: number): void {
    if (!this.def.properties[prop]) throw new MotionError("E_UNKNOWN_PROPERTY", `unknown property \`${prop}\``);
    const s = this.def.states[state];
    if (!s) throw new MotionError("E_UNKNOWN_STATE", `unknown state \`${state}\``);
    s[prop] = value;
    if (this.state === state) this.retarget(prop, this.clamp(prop, value), this.def.defaultSpec);
  }

  addState(name: string, goals: Record<string, number>): void {
    for (const k of Object.keys(goals))
      if (!this.def.properties[k]) throw new MotionError("E_UNKNOWN_PROPERTY", `unknown property \`${k}\``);
    this.def.states[name] = { ...goals };
  }

  addTransition(t: TransitionDef): void {
    const candidate = { ...this.def, transitions: [...this.def.transitions, t] };
    const errs = validateGraph(candidate).filter((x) => x.severity === "error");
    if (errs.length) throw new MotionError("E_GRAPH", errs.map((x) => x.message).join("; "));
    this.def = candidate;
  }

  removeTransitions(event: string): number {
    const before = this.def.transitions.length;
    this.def.transitions = this.def.transitions.filter((t) => t.event !== event);
    return before - this.def.transitions.length;
  }

  // ---- rendering --------------------------------------------------------------------------

  /**
   * Renders graph properties onto an element. `map` renames graph properties to style
   * properties (`{ scrim: "opacity" }`); unmapped properties use their own name.
   */
  bind(el: Element, map: Record<string, string> = {}): () => void {
    const t = ElementTarget.for(el, this.engine);
    const unsubs: Array<() => void> = [];
    for (const [p, mv] of Object.entries(this.values)) {
      const styleProp = map[p] ?? p;
      if (styleProp === "") continue;
      const out = t.value(styleProp);
      out.set(mv.get());
      unsubs.push(mv.on("change", (v, vel) => out.jump(v, vel)));
    }
    t.flush();
    const off = () => unsubs.forEach((u) => u());
    this.unsubs.push(off);
    return off;
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const mv of Object.values(this.values)) mv.destroy();
    this.listeners.clear();
  }
}

/** Minimal shape of a compiled plan (see `ExecutionPlan` in umx-compiler). */
export interface CompiledPlan {
  planVersion: number;
  profile: string;
  specs: Array<{ spec: AnimationSpec; compositor?: { easing: string; durationMs: number } | null }>;
  components: Record<
    string,
    {
      role?: string | null;
      priority?: Priority;
      properties: Record<string, PropertyDef>;
      units?: Record<string, string>;
      states: Record<string, Record<string, number>>;
      initial: string;
      defaultSpec: number;
      transitions: Array<{
        from: string;
        to: string;
        event: string;
        spec?: number | null;
        propertySpecs?: Record<string, number>;
        delays?: Record<string, number>;
        guard?: string | null;
        interrupt?: Interrupt;
      }>;
      relations?: Relation[];
      gestures?: Array<{
        kind: string;
        property: string;
        axis: string;
        min: number | null;
        max: number | null;
        rubberBand: number;
        snapPoints: number[];
        snapStates: string[];
        flingThreshold: number;
      }>;
      effects?: string[];
    }
  >;
  timelines?: Record<
    string,
    {
      duration: number;
      entries: Array<{
        component: string;
        property: string;
        start: number;
        duration: number;
        spec: number;
        from: number | null;
        to: number;
      }>;
      labels: Record<string, number>;
    }
  >;
  effects?: Record<string, unknown>;
  performance?: { fidelity: { min: number; max: number; initial: number }; budgetFraction: number };
  accessibility?: { reducedMotion: string; maxIntensity: number };
}

/** Builds a GraphDef for a component of a compiled plan. */
export function graphDefFromPlan(plan: CompiledPlan, component: string): GraphDef {
  const c = plan.components[component];
  if (!c) throw new MotionError("E_UNKNOWN_COMPONENT", `plan has no component \`${component}\``);
  const spec = (i: number | null | undefined) => (i === null || i === undefined ? null : (plan.specs[i]?.spec ?? null));
  return {
    properties: c.properties,
    states: c.states,
    initial: c.initial,
    defaultSpec: spec(c.defaultSpec)!,
    relations: c.relations ?? [],
    transitions: c.transitions.map((t) => ({
      from: t.from,
      to: t.to,
      event: t.event,
      spec: spec(t.spec),
      propertySpecs: Object.fromEntries(Object.entries(t.propertySpecs ?? {}).map(([k, i]) => [k, spec(i)!])),
      delays: t.delays ?? {},
      guard: t.guard ?? null,
      interrupt: t.interrupt ?? "retarget",
    })),
  };
}

export function graphFromPlan(plan: CompiledPlan, component: string, opts: MotionGraphOptions = {}): MotionGraph {
  return new MotionGraph(graphDefFromPlan(plan, component), {
    name: component,
    priority: plan.components[component]?.priority,
    ...opts,
  });
}
