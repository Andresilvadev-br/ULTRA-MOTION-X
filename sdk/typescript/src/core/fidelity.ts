/** Adaptive Fidelity controller (mirror of umx-scheduler::fidelity) with hysteresis. */

export type FidelityLevel = 0 | 1 | 2 | 3 | 4;

export interface FidelityConfig {
  min: FidelityLevel;
  max: FidelityLevel;
  initial: FidelityLevel;
  smoothing: number;
  downgradeThreshold: number;
  upgradeThreshold: number;
  upgradeAfter: number;
  cooldown: number;
  locked: boolean;
}

export const DEFAULT_FIDELITY: Readonly<FidelityConfig> = Object.freeze({
  min: 0,
  max: 4,
  initial: 3,
  smoothing: 0.08,
  downgradeThreshold: 0.2,
  upgradeThreshold: 0.02,
  upgradeAfter: 180,
  cooldown: 45,
  locked: false,
});

export interface FidelitySettings {
  level: FidelityLevel;
  particles: number;
  blur: number;
  effectResolution: number;
  maxDecorativeLayers: number;
  /** Decorative work runs every N-th frame (0 = never). */
  decorativeFrameDivisor: number;
  shadows: boolean;
  lighting: boolean;
  shaders: boolean;
}

const SETTINGS: FidelitySettings[] = [
  {
    level: 0,
    particles: 0,
    blur: 0,
    effectResolution: 0,
    maxDecorativeLayers: 0,
    decorativeFrameDivisor: 0,
    shadows: false,
    lighting: false,
    shaders: false,
  },
  {
    level: 1,
    particles: 0.25,
    blur: 0.4,
    effectResolution: 0.35,
    maxDecorativeLayers: 2,
    decorativeFrameDivisor: 3,
    shadows: true,
    lighting: false,
    shaders: false,
  },
  {
    level: 2,
    particles: 0.5,
    blur: 0.7,
    effectResolution: 0.5,
    maxDecorativeLayers: 6,
    decorativeFrameDivisor: 2,
    shadows: true,
    lighting: true,
    shaders: true,
  },
  {
    level: 3,
    particles: 0.8,
    blur: 1,
    effectResolution: 0.75,
    maxDecorativeLayers: 12,
    decorativeFrameDivisor: 1,
    shadows: true,
    lighting: true,
    shaders: true,
  },
  {
    level: 4,
    particles: 1,
    blur: 1,
    effectResolution: 1,
    maxDecorativeLayers: 32,
    decorativeFrameDivisor: 1,
    shadows: true,
    lighting: true,
    shaders: true,
  },
];

export const fidelitySettings = (level: FidelityLevel): FidelitySettings => ({ ...SETTINGS[level]! });

export interface FidelityChange {
  from: FidelityLevel;
  to: FidelityLevel;
  reason: "load" | "recovered" | "ceiling" | "manual";
}

export class FidelityController {
  config: FidelityConfig;
  level: FidelityLevel;
  missRate = 0;
  private stable = 0;
  private cooldown = 0;
  private penalty = 1;
  private sinceUpgrade = Number.POSITIVE_INFINITY;
  private sinceFailure = 0;
  private ceiling: FidelityLevel = 4;
  readonly history: FidelityChange[] = [];

  constructor(config: Partial<FidelityConfig> = {}) {
    this.config = { ...DEFAULT_FIDELITY, ...config };
    this.level = clampLevel(this.config.initial, this.config.min, this.config.max);
  }

  get settings(): FidelitySettings {
    return fidelitySettings(this.level);
  }

  private get effectiveMax(): FidelityLevel {
    return Math.max(this.config.min, Math.min(this.config.max, this.ceiling)) as FidelityLevel;
  }

  setCeiling(c: FidelityLevel): FidelityChange | null {
    this.ceiling = c;
    if (this.level > this.effectiveMax) return this.change(this.effectiveMax, "ceiling");
    return null;
  }

  setManual(level: FidelityLevel | null): FidelityChange | null {
    if (level === null) {
      this.config.locked = false;
      return null;
    }
    this.config.locked = true;
    return this.change(clampLevel(level, this.config.min, this.effectiveMax), "manual");
  }

  private change(to: FidelityLevel, reason: FidelityChange["reason"]): FidelityChange | null {
    if (to === this.level) return null;
    const c = { from: this.level, to, reason };
    this.level = to;
    this.history.push(c);
    if (this.history.length > 100) this.history.shift();
    return c;
  }

  observe(missed: boolean): FidelityChange | null {
    const a = Math.min(1, Math.max(0.001, this.config.smoothing));
    this.missRate = this.missRate * (1 - a) + (missed ? a : 0);
    this.sinceUpgrade++;
    this.sinceFailure++;
    if (this.sinceFailure === this.config.upgradeAfter * 512) this.penalty = 1;
    if (this.cooldown > 0) {
      this.cooldown--;
      return null;
    }
    if (this.config.locked) return null;
    if (this.missRate > this.config.downgradeThreshold && this.level > this.config.min) {
      this.cooldown = this.config.cooldown;
      this.stable = 0;
      if (this.sinceUpgrade < this.config.upgradeAfter) {
        this.penalty = Math.min(this.penalty * 4, 256);
        this.sinceFailure = 0;
      }
      this.missRate *= 0.5;
      return this.change((this.level - 1) as FidelityLevel, "load");
    }
    if (this.missRate < this.config.upgradeThreshold) {
      this.stable++;
      if (this.stable >= this.config.upgradeAfter * this.penalty && this.level < this.effectiveMax) {
        this.cooldown = this.config.cooldown;
        this.stable = 0;
        this.sinceUpgrade = 0;
        return this.change((this.level + 1) as FidelityLevel, "recovered");
      }
    } else {
      this.stable = 0;
    }
    return null;
  }
}

function clampLevel(l: number, min: number, max: number): FidelityLevel {
  return Math.round(Math.min(max, Math.max(min, l))) as FidelityLevel;
}
