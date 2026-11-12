/**
 * Accessibility engine. The engine never imposes motion the user asked to reduce:
 * with `reducedMotion: "user"` the platform preference is followed live.
 */
import { REDUCED_MOTION_POLICY } from "../tokens/dna.ts";

export type ReducedMotionSetting = "user" | "always" | "never";

export interface AccessibilityOptions {
  reducedMotion: ReducedMotionSetting;
  /** Global multiplier on spatial intensity (parallax, depth, tilt), 0..1. */
  maxIntensity: number;
}

export class Accessibility {
  options: AccessibilityOptions;
  private systemReduced = false;
  private mql: MediaQueryList | null = null;
  private listeners = new Set<(reduced: boolean) => void>();
  private readonly onMql = (e: MediaQueryListEvent) => {
    this.systemReduced = e.matches;
    this.emit();
  };

  constructor(options: Partial<AccessibilityOptions> = {}) {
    this.options = { reducedMotion: "user", maxIntensity: 1, ...options };
    if (typeof matchMedia === "function") {
      this.mql = matchMedia("(prefers-reduced-motion: reduce)");
      this.systemReduced = this.mql.matches;
      this.mql.addEventListener?.("change", this.onMql);
    }
  }

  get reduced(): boolean {
    const s = this.options.reducedMotion;
    return s === "always" || (s === "user" && this.systemReduced);
  }

  get policy(): typeof REDUCED_MOTION_POLICY {
    return REDUCED_MOTION_POLICY;
  }

  /** Whether a category of motion is allowed right now. */
  allows(kind: "spatial" | "parallax" | "particles" | "scale"): boolean {
    if (!this.reduced) return true;
    const p = REDUCED_MOTION_POLICY;
    return kind === "spatial"
      ? p.allowSpatial
      : kind === "parallax"
        ? p.allowParallax
        : kind === "particles"
          ? p.allowParticles
          : p.allowScale;
  }

  set(options: Partial<AccessibilityOptions>): void {
    const before = this.reduced;
    this.options = { ...this.options, ...options };
    if (before !== this.reduced) this.emit();
  }

  /** For tests and hosts without matchMedia (e.g. native webviews bridging the OS flag). */
  setSystemPreference(reduced: boolean): void {
    this.systemReduced = reduced;
    this.emit();
  }

  onChange(cb: (reduced: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.reduced);
  }

  destroy(): void {
    this.mql?.removeEventListener?.("change", this.onMql);
    this.listeners.clear();
  }
}
