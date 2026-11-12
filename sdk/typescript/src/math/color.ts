/** sRGB ⇄ OKLab conversion and perceptual colour interpolation (mirrors umx-core). */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function rgbaToOklab(c: Rgba): [number, number, number, number] {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    c.a,
  ];
}

export function oklabToRgba([L, A, B, alpha]: [number, number, number, number]): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: clamp01(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    a: clamp01(alpha),
  };
}

/** Parses hex, rgb()/rgba() and `transparent`. Returns null for unsupported syntax. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const hex = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join("") : h;
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) return null;
    const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) : 1 };
  }
  const m = s.match(/^rgba?\(\s*([^)]+)\)$/);
  if (m) {
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (p: string) => (p.endsWith("%") ? Number.parseFloat(p) / 100 : Number.parseFloat(p) / 255);
    const a =
      parts[3] === undefined
        ? 1
        : parts[3].endsWith("%")
          ? Number.parseFloat(parts[3]) / 100
          : Number.parseFloat(parts[3]);
    const c = { r: ch(parts[0]!), g: ch(parts[1]!), b: ch(parts[2]!), a };
    return [c.r, c.g, c.b, c.a].every(Number.isFinite) ? c : null;
  }
  return null;
}

export function formatColor(c: Rgba): string {
  const to255 = (v: number) => Math.round(clamp01(v) * 255);
  return `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${Math.round(clamp01(c.a) * 1000) / 1000})`;
}

/** Interpolates two colours in OKLab (progress may overshoot for springs; output is clamped). */
export function mixColor(a: Rgba, b: Rgba, t: number): Rgba {
  const x = rgbaToOklab(a);
  const y = rgbaToOklab(b);
  return oklabToRgba([
    x[0] + (y[0] - x[0]) * t,
    x[1] + (y[1] - x[1]) * t,
    x[2] + (y[2] - x[2]) * t,
    x[3] + (y[3] - x[3]) * t,
  ]);
}
