/** DOM property model: classification, parsing and formatting of animatable values. */
import { parseColor, type Rgba } from "../math/color.ts";

export const TRANSFORM_PROPS = [
  "x",
  "y",
  "z",
  "translateX",
  "translateY",
  "translateZ",
  "scale",
  "scaleX",
  "scaleY",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
  "skewX",
  "skewY",
  "transformPerspective",
] as const;
export type TransformProp = (typeof TRANSFORM_PROPS)[number];

export const FILTER_PROPS = [
  "blur",
  "brightness",
  "contrast",
  "saturate",
  "grayscale",
  "hueRotate",
  "sepia",
  "invert",
] as const;
export type FilterProp = (typeof FILTER_PROPS)[number];

const TRANSFORM_SET = new Set<string>(TRANSFORM_PROPS);
const FILTER_SET = new Set<string>(FILTER_PROPS);

const ALIASES: Record<string, string> = { translateX: "x", translateY: "y", translateZ: "z", rotateZ: "rotate" };

export const COLOR_PROPS = new Set([
  "color",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "fill",
  "stroke",
  "caretColor",
  "textDecorationColor",
]);

export type PropKind = "transform" | "filter" | "opacity" | "color" | "css" | "var";

export function canonical(prop: string): string {
  return ALIASES[prop] ?? prop;
}

export function kindOf(prop: string): PropKind {
  const p = canonical(prop);
  if (TRANSFORM_SET.has(p)) return "transform";
  if (FILTER_SET.has(p)) return "filter";
  if (p === "opacity") return "opacity";
  if (p.startsWith("--")) return "var";
  if (COLOR_PROPS.has(p)) return "color";
  return "css";
}

const DEFAULT_UNITS: Record<string, string> = {
  x: "px",
  y: "px",
  z: "px",
  rotate: "deg",
  rotateX: "deg",
  rotateY: "deg",
  skewX: "deg",
  skewY: "deg",
  transformPerspective: "px",
  blur: "px",
  hueRotate: "deg",
};

const UNITLESS = new Set([
  "opacity",
  "scale",
  "scaleX",
  "scaleY",
  "zIndex",
  "fontWeight",
  "lineHeight",
  "flexGrow",
  "flexShrink",
  "order",
  "brightness",
  "contrast",
  "saturate",
  "grayscale",
  "sepia",
  "invert",
  "fillOpacity",
  "strokeOpacity",
]);

export function defaultUnit(prop: string): string {
  const p = canonical(prop);
  if (p in DEFAULT_UNITS) return DEFAULT_UNITS[p]!;
  if (UNITLESS.has(p) || p.startsWith("--")) return "";
  return "px";
}

export function identityValue(prop: string): number {
  const p = canonical(prop);
  if (
    p === "scale" ||
    p === "scaleX" ||
    p === "scaleY" ||
    p === "opacity" ||
    p === "brightness" ||
    p === "contrast" ||
    p === "saturate"
  )
    return 1;
  return 0;
}

export interface NumericValue {
  value: number;
  unit: string;
}

/** Parses numbers and `"<number><unit>"`. Returns null for non-numeric strings. */
export function parseNumeric(input: number | string, prop: string): NumericValue | null {
  if (typeof input === "number") return Number.isFinite(input) ? { value: input, unit: defaultUnit(prop) } : null;
  const m = input.trim().match(/^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i);
  if (!m) return null;
  return { value: Number.parseFloat(m[1]!), unit: m[2] || defaultUnit(prop) };
}

export function parseColorValue(input: string | number): Rgba | null {
  return typeof input === "string" ? parseColor(input) : null;
}

const kebabCache = new Map<string, string>();
export function kebab(prop: string): string {
  let k = kebabCache.get(prop);
  if (!k) {
    k = prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    kebabCache.set(prop, k);
  }
  return k;
}

/** Fixed composition order for transforms (documented & shared with umx-render). */
export function composeTransform(get: (p: string) => NumericValue | undefined): string {
  const parts: string[] = [];
  const v = (p: string) => get(p);
  const persp = v("transformPerspective");
  if (persp?.value) parts.push(`perspective(${persp.value}${persp.unit})`);
  const x = v("x");
  const y = v("y");
  const z = v("z");
  if (x?.value || y?.value || z?.value) {
    parts.push(
      `translate3d(${x?.value ?? 0}${x?.unit ?? "px"}, ${y?.value ?? 0}${y?.unit ?? "px"}, ${z?.value ?? 0}${z?.unit ?? "px"})`,
    );
  }
  for (const r of ["rotateX", "rotateY", "rotate"]) {
    const a = v(r);
    if (a?.value) parts.push(`${r === "rotate" ? "rotate" : r}(${a.value}${a.unit})`);
  }
  for (const s of ["skewX", "skewY"]) {
    const a = v(s);
    if (a?.value) parts.push(`${s}(${a.value}${a.unit})`);
  }
  const sc = v("scale")?.value ?? 1;
  const sx = (v("scaleX")?.value ?? 1) * sc;
  const sy = (v("scaleY")?.value ?? 1) * sc;
  if (sx !== 1 || sy !== 1) parts.push(sx === sy ? `scale(${sx})` : `scale(${sx}, ${sy})`);
  return parts.join(" ");
}

export function composeFilter(get: (p: string) => NumericValue | undefined): string {
  const parts: string[] = [];
  for (const f of FILTER_PROPS) {
    const val = get(f);
    if (!val) continue;
    const isIdentity = val.value === identityValue(f);
    if (isIdentity) continue;
    parts.push(`${f === "hueRotate" ? "hue-rotate" : f}(${val.value}${val.unit})`);
  }
  return parts.join(" ");
}
