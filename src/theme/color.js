// Matemática de cor (sRGB ↔ OKLab/OKLCH, contraste WCAG). Sem dependências.

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`Cor inválida: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }) {
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
};

export function rgbToOklab({ r, g, b }) {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export const hexToOklab = (hex) => rgbToOklab(parseHex(hex));
export const oklabToHex = (lab) => toHex(clampRgb(oklabToRgb(lab)));

function clampRgb({ r, g, b }) {
  return { r: Math.min(255, Math.max(0, r)), g: Math.min(255, Math.max(0, g)), b: Math.min(255, Math.max(0, b)) };
}

/** Mistura perceptual (OKLab) entre duas cores, t ∈ [0,1]. */
export function mix(hexA, hexB, t) {
  const a = hexToOklab(hexA), b = hexToOklab(hexB);
  return oklabToHex({ L: a.L + (b.L - a.L) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t });
}

/** Ajusta a luminosidade OKLab mantendo matiz/croma. */
export function withLightness(hex, L) {
  const lab = hexToOklab(hex);
  return oklabToHex({ ...lab, L: Math.min(1, Math.max(0, L)) });
}

export function shiftLightness(hex, delta) {
  return withLightness(hex, hexToOklab(hex).L + delta);
}

export function luminance(hex) {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(hexA, hexB) {
  const a = luminance(hexA), b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Menor ajuste de luminosidade para atingir o contraste mínimo contra o fundo.
 * Mantém a identidade da cor (matiz) e só clareia/escurece o necessário.
 */
export function ensureContrast(hex, background, min = 4.5) {
  if (contrast(hex, background) >= min) return toHex(parseHex(hex));
  const lab = hexToOklab(hex);
  const lighter = luminance(background) < 0.5;
  for (let i = 1; i <= 100; i++) {
    const L = lab.L + (lighter ? i : -i) * 0.01;
    if (L < 0 || L > 1) break;
    const candidate = oklabToHex({ ...lab, L });
    if (contrast(candidate, background) >= min) return candidate;
  }
  return lighter ? '#ffffff' : '#000000';
}

export function rgbTriplet(hex) {
  const { r, g, b } = parseHex(hex);
  return `${r} ${g} ${b}`;
}
