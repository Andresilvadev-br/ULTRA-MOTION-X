import { Emitter } from '../core/emitter.js';
import { hasDocument } from '../core/env.js';
import { MotionValue } from '../animate/motion-value.js';
import { contrast, ensureContrast, mix, parseHex, rgbTriplet, shiftLightness } from './color.js';

export const DEFAULT_SURFACES = Object.freeze({ dark: '#11141b', light: '#f4f6fa' });

/** Cores funcionais: gravação continua vermelha mesmo com acento personalizado. */
export const FUNCTIONAL = Object.freeze({ success: '#2fbf71', warning: '#f0a020', danger: '#ef4b4b', rec: '#ff3b30' });

/**
 * Tokens derivados da cor de destaque (puro, testável).
 * Tudo que brilha, realça ou faz sombra vem daqui — nenhuma cor fixa conflitante.
 */
export function themeTokens(accent, { mode = 'dark', surface, profile } = {}) {
  parseHex(accent);
  const bg = surface ?? DEFAULT_SURFACES[mode] ?? DEFAULT_SURFACES.dark;
  const dark = mode !== 'light';
  const glow = profile?.glow ?? 1;
  const onAccent = contrast('#ffffff', accent) >= contrast('#0b0d12', accent) ? '#ffffff' : '#0b0d12';
  const text = ensureContrast(accent, bg, 4.5);
  const fn = {};
  for (const [name, hex] of Object.entries(FUNCTIONAL)) fn[`--umx-${name}`] = ensureContrast(hex, bg, 3);
  return {
    '--umx-accent': accent.toLowerCase(),
    '--umx-accent-rgb': rgbTriplet(accent),
    '--umx-accent-hover': shiftLightness(accent, dark ? 0.06 : -0.05),
    '--umx-accent-press': shiftLightness(accent, dark ? -0.06 : -0.1),
    '--umx-accent-text': text,
    '--umx-on-accent': onAccent,
    '--umx-accent-soft': `rgb(${rgbTriplet(accent)} / ${dark ? 0.16 : 0.12})`,
    '--umx-ring': `rgb(${rgbTriplet(text)} / 0.7)`,
    '--umx-glow': `rgb(${rgbTriplet(accent)} / ${(0.55 * glow).toFixed(3)})`,
    '--umx-glow-size': `${Math.round(18 * glow)}px`,
    '--umx-shadow': `0 8px 24px rgb(${rgbTriplet(mix(accent, '#000000', 0.75))} / ${dark ? 0.45 : 0.18})`,
    '--umx-light': `rgb(${rgbTriplet(mix(accent, '#ffffff', 0.35))} / ${(0.22 * glow).toFixed(3)})`,
    ...fn,
  };
}

/**
 * ThemeMotionBridge — aplica os tokens na raiz e anima a troca de cor
 * em OKLab (sem piscar nem estourar brilho). No perfil Performance a troca é imediata.
 */
export class ThemeMotionBridge extends Emitter {
  constructor({ root = hasDocument ? document.documentElement : null, scheduler, budget = null, accent = '#2f8cff', mode = 'dark', surface } = {}) {
    super();
    this.root = root;
    this.scheduler = scheduler;
    this.budget = budget;
    this.accent = accent;
    this.mode = mode;
    this.surface = surface;
    this._progress = new MotionValue(1, { scheduler, spring: 'gentle', rest: 0.002 });
    this._from = accent;
    this._progress.on('change', (p) => this._apply(mix(this._from, this.accent, Math.min(1, Math.max(0, p)))));
    this._offProfile = budget?.on('profile', () => this.refresh());
  }

  tokens(accent = this.accent) {
    return themeTokens(accent, { mode: this.mode, surface: this.surface, profile: this.budget?.profile });
  }

  setAccent(hex, { animate = true } = {}) {
    parseHex(hex);
    const current = this.currentAccent();
    this.accent = hex;
    const instant = !animate || !this.budget?.allowDecor?.() || !this.root;
    if (instant) {
      this._progress.jump(1);
      this._apply(hex);
    } else {
      this._from = current;
      this._progress.set(1, { from: 0 });
    }
    this.emit('accent', { accent: hex });
  }

  setMode(mode, surface) {
    this.mode = mode === 'light' ? 'light' : 'dark';
    if (surface) this.surface = surface;
    this.refresh();
    this.emit('mode', { mode: this.mode });
  }

  currentAccent() {
    if (!this._progress.animating) return this.accent;
    return mix(this._from, this.accent, Math.min(1, Math.max(0, this._progress.get())));
  }

  refresh() { this._apply(this.currentAccent()); }

  _apply(accent) {
    if (!this.root?.style) return;
    const tokens = this.tokens(accent);
    for (const [name, value] of Object.entries(tokens)) this.root.style.setProperty(name, value);
    this.root.dataset && (this.root.dataset.umxTheme = this.mode);
  }

  destroy() {
    this._offProfile?.();
    this._progress.destroy();
    this.removeAllListeners();
  }
}
