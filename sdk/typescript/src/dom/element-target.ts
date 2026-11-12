/**
 * ElementTarget: binds MotionValues to one DOM element and renders them with batched,
 * minimal style writes (partial updates: only properties whose serialized value changed
 * are written). Transforms and filters are composed in a fixed order. Existing CSS
 * transforms present before Ultra Motion X touched the element are preserved.
 */
import type { Engine } from "../core/engine.ts";
import { MotionValue } from "../core/motion-value.ts";
import { formatColor, mixColor, parseColor as parseColorInternal, type Rgba } from "../math/color.ts";
import {
  canonical,
  composeFilter,
  composeTransform,
  identityValue,
  kebab,
  kindOf,
  type NumericValue,
  type PropKind,
} from "./props.ts";

interface NumericSlot {
  kind: Exclude<PropKind, "color">;
  mv: MotionValue;
  unit: string;
}

interface ColorSlot {
  kind: "color";
  mv: MotionValue;
  from: Rgba;
  to: Rgba;
}

type Slot = NumericSlot | ColorSlot;

const targets = new WeakMap<Element, ElementTarget>();
/** Elements currently promoted with `will-change` (bounded). */
let promoted = 0;
const MAX_PROMOTED = 64;

export class ElementTarget {
  readonly el: HTMLElement | SVGElement;
  readonly engine: Engine;
  private slots = new Map<string, Slot>();
  private written = new Map<string, string>();
  private dirty = false;
  private baseTransform: string | null = null;
  private baseFilter: string | null = null;
  private willChange = false;
  private authorWillChange: string;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: Array<() => void> = [];
  private delegated = new Set<string>();
  private readonly writeKey: string;
  private static seq = 0;

  static for(el: Element, engine: Engine): ElementTarget {
    let t = targets.get(el);
    if (!t || t.engine !== engine) {
      t?.destroy();
      t = new ElementTarget(el as HTMLElement, engine);
      targets.set(el, t);
    }
    return t;
  }

  static peek(el: Element): ElementTarget | undefined {
    return targets.get(el);
  }

  private constructor(el: HTMLElement | SVGElement, engine: Engine) {
    this.el = el;
    this.engine = engine;
    this.writeKey = `umx:el:${++ElementTarget.seq}`;
    this.authorWillChange = el.style.willChange;
    if (typeof getComputedStyle === "function" && el.isConnected) {
      const cs = getComputedStyle(el);
      if (cs.transform && cs.transform !== "none" && !el.style.transform) this.baseTransform = cs.transform;
      if (cs.filter && cs.filter !== "none" && !el.style.filter) this.baseFilter = cs.filter;
    }
  }

  /** Current numeric value of a property (reads the DOM on first access). */
  read(prop: string): NumericValue {
    const p = canonical(prop);
    const slot = this.slots.get(p);
    if (slot && slot.kind !== "color") return { value: slot.mv.get(), unit: slot.unit };
    const kind = kindOf(p);
    if (kind === "transform" || kind === "filter") return { value: identityValue(p), unit: "" };
    if (typeof getComputedStyle !== "function") return { value: identityValue(p), unit: "" };
    const raw =
      kind === "var"
        ? getComputedStyle(this.el).getPropertyValue(p)
        : (getComputedStyle(this.el) as unknown as Record<string, string>)[p];
    const n = raw === undefined ? Number.NaN : Number.parseFloat(raw);
    const unit = typeof raw === "string" ? (raw.trim().match(/[a-z%]+$/i)?.[0] ?? "") : "";
    return { value: Number.isFinite(n) ? n : identityValue(p), unit };
  }

  readColor(prop: string): Rgba | null {
    const slot = this.slots.get(prop);
    if (slot?.kind === "color") return mixColor(slot.from, slot.to, slot.mv.get());
    if (typeof getComputedStyle !== "function") return null;
    const raw = (getComputedStyle(this.el) as unknown as Record<string, string>)[prop];
    return raw ? parseColorSafe(raw) : null;
  }

  /** Returns (creating if needed) the MotionValue for a numeric property. */
  value(prop: string, unit?: string): MotionValue {
    const p = canonical(prop);
    const existing = this.slots.get(p);
    if (existing && existing.kind !== "color") {
      if (unit !== undefined && unit !== "" && unit !== existing.unit) existing.unit = unit;
      return existing.mv;
    }
    const current = this.read(p);
    const kind = kindOf(p) as Exclude<PropKind, "color">;
    const mv = new MotionValue(current.value, this.engine, {
      name: `${describe(this.el)}.${p}`,
      ...(p === "opacity" ? { min: 0, max: 1 } : {}),
    });
    this.slots.set(p, { kind, mv, unit: unit || current.unit });
    this.watch(mv);
    return mv;
  }

  /** Prepares a colour transition and returns its progress value (0 → 1). */
  colorValue(prop: string, to: Rgba): MotionValue {
    const from = this.readColor(prop) ?? to;
    const existing = this.slots.get(prop);
    if (existing?.kind === "color") {
      existing.from = mixColor(existing.from, existing.to, existing.mv.get());
      existing.to = to;
      existing.mv.set(0);
      return existing.mv;
    }
    const mv = new MotionValue(0, this.engine, { name: `${describe(this.el)}.${prop}` });
    this.slots.set(prop, { kind: "color", mv, from, to });
    this.watch(mv);
    return mv;
  }

  private watch(mv: MotionValue): void {
    this.unsubs.push(mv.on("change", () => this.invalidate()));
    this.unsubs.push(mv.on("start", () => this.promote()));
  }

  /** Marks the element dirty; one write per element per frame. */
  invalidate(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.engine.write(() => this.flush(), { key: this.writeKey, priority: "animation" });
  }

  setDelegated(prop: string, on: boolean): void {
    if (on) this.delegated.add(canonical(prop));
    else this.delegated.delete(canonical(prop));
  }

  /** Writes the composed styles. Normally called from the engine's write phase. */
  flush(): void {
    this.dirty = false;
    const style = this.el.style;
    let hasTransform = false;
    let hasFilter = false;
    const counters = this.engine.telemetry.counters;
    for (const [prop, slot] of this.slots) {
      if (this.delegated.has(prop)) continue;
      if (slot.kind === "transform") hasTransform = true;
      else if (slot.kind === "filter") hasFilter = true;
      else if (slot.kind === "color")
        this.put(kebab(prop), formatColor(mixColor(slot.from, slot.to, slot.mv.get())), style, counters);
      else this.put(kebab(prop), `${round(slot.mv.get())}${slot.unit}`, style, counters);
    }
    if (hasTransform && !this.delegated.has("transform")) {
      const t = composeTransform((p) => this.numeric(p, "transform"));
      this.put("transform", [t, this.baseTransform].filter(Boolean).join(" ") || "none", style, counters);
    }
    if (hasFilter) {
      const f = composeFilter((p) => this.numeric(p, "filter"));
      this.put("filter", [f, this.baseFilter].filter(Boolean).join(" ") || "none", style, counters);
    }
  }

  private numeric(p: string, kind: PropKind): NumericValue | undefined {
    const s = this.slots.get(p);
    return s && s.kind !== "color" && s.kind === kind ? { value: round(s.mv.get()), unit: s.unit } : undefined;
  }

  private put(
    name: string,
    value: string,
    style: CSSStyleDeclaration,
    counters: { writes: number; redundantWritesSkipped: number },
  ): void {
    if (this.written.get(name) === value) {
      counters.redundantWritesSkipped++;
      return;
    }
    this.written.set(name, value);
    style.setProperty(name, value);
    counters.writes++;
  }

  /** Transient compositor promotion while animating transforms/opacity. */
  private promote(): void {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    if (this.willChange || this.authorWillChange || promoted >= MAX_PROMOTED) return;
    const props = new Set<string>();
    for (const [p, s] of this.slots) {
      if (s.kind === "transform") props.add("transform");
      else if (p === "opacity") props.add("opacity");
      else if (s.kind === "filter") props.add("filter");
    }
    if (!props.size) return;
    this.el.style.willChange = [...props].join(", ");
    this.willChange = true;
    promoted++;
    this.scheduleRelease();
  }

  private scheduleRelease(): void {
    const check = () => {
      this.releaseTimer = null;
      if ([...this.slots.values()].some((s) => s.mv.isAnimating)) {
        this.releaseTimer = setTimeout(check, 250);
        return;
      }
      if (this.willChange) {
        this.el.style.willChange = this.authorWillChange;
        this.willChange = false;
        promoted--;
      }
    };
    this.releaseTimer = setTimeout(check, 250);
  }

  get animating(): boolean {
    for (const s of this.slots.values()) if (s.mv.isAnimating) return true;
    return false;
  }

  /** Current numeric values with their units (colour slots excluded). */
  numericSnapshot(): Map<string, NumericValue> {
    const m = new Map<string, NumericValue>();
    for (const [k, s] of this.slots) if (s.kind !== "color") m.set(k, { value: s.mv.get(), unit: s.unit });
    return m;
  }

  values(): Map<string, MotionValue> {
    const m = new Map<string, MotionValue>();
    for (const [k, s] of this.slots) m.set(k, s.mv);
    return m;
  }

  stop(): void {
    for (const s of this.slots.values()) s.mv.stop();
  }

  /** Detaches from the element (unmount). Leaves the last written styles in place. */
  destroy(): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    if (this.willChange) {
      this.el.style.willChange = this.authorWillChange;
      promoted--;
      this.willChange = false;
    }
    for (const u of this.unsubs) u();
    for (const s of this.slots.values()) s.mv.destroy();
    this.slots.clear();
    this.unsubs = [];
    if (targets.get(this.el) === this) targets.delete(this.el);
  }
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function describe(el: Element): string {
  const id = (el as HTMLElement).id;
  return id ? `#${id}` : el.tagName.toLowerCase();
}

function parseColorSafe(raw: string): Rgba | null {
  const m = raw.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i);
  if (!m) return null;
  return parseColorInternal(m[0]);
}

/** Number of elements currently promoted with will-change (for telemetry). */
export function promotedCount(): number {
  return promoted;
}
