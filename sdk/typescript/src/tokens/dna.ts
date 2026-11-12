/**
 * Universal Motion DNA — shared motion identity (tokens + profiles) across projects.
 * The data comes from `presets/profiles.json`, shared with the Rust runtime.
 */
import { cubicBezier, type Easing } from "../math/easing.ts";
import { fromResponse, MotionError, type SpringParams, springParams } from "../math/spring.ts";
import { PROFILES_DATA } from "./profiles.generated.ts";
import type { MotionProfileData } from "./types.ts";

export type ProfileName =
  | "minimal"
  | "professional"
  | "cinematic"
  | "dynamic"
  | "fluid"
  | "sport"
  | "elegant"
  | "ultraResponsive"
  | "singularity";

export const PROFILE_NAMES = Object.keys(PROFILES_DATA.profiles) as ProfileName[];
export type SpringTokenName = "snappy" | "standard" | "gentle" | "bouncy";
export type DurationTokenName = "instant" | "fast" | "normal" | "slow" | "page";
export type EasingTokenName = "standard" | "enter" | "exit";

export class MotionDNA {
  readonly name: string;
  readonly data: MotionProfileData;

  constructor(name: string, data: MotionProfileData) {
    this.name = name;
    this.data = data;
  }

  static profile(name: ProfileName | string = PROFILES_DATA.default): MotionDNA {
    const d = PROFILES_DATA.profiles[name];
    if (!d)
      throw new MotionError("E_PROFILE", `unknown motion profile \`${name}\`; available: ${PROFILE_NAMES.join(", ")}`);
    return new MotionDNA(name, d);
  }

  /** Creates a custom profile by overriding fields of a base profile. */
  static custom(base: ProfileName, overrides: Partial<MotionProfileData>, name = "custom"): MotionDNA {
    const b = MotionDNA.profile(base).data;
    const data: MotionProfileData = {
      ...b,
      ...overrides,
      duration: { ...b.duration, ...(overrides.duration ?? {}) },
      spring: { ...b.spring, ...(overrides.spring ?? {}) },
      easing: { ...b.easing, ...(overrides.easing ?? {}) },
    };
    const dna = new MotionDNA(name, data);
    dna.validate();
    return dna;
  }

  static fromJSON(json: string | { name?: string; data: MotionProfileData }): MotionDNA {
    const o = typeof json === "string" ? JSON.parse(json) : json;
    if (!o || typeof o !== "object" || !o.data) throw new MotionError("E_DNA", "invalid Motion DNA document");
    const dna = new MotionDNA(o.name ?? "imported", o.data);
    dna.validate();
    return dna;
  }

  toJSON(): { name: string; data: MotionProfileData } {
    return { name: this.name, data: this.data };
  }

  validate(): void {
    const d = this.data.duration;
    if (!(d.instant <= d.fast && d.fast < d.normal && d.normal < d.slow && d.slow <= d.page)) {
      throw new MotionError("E_DNA", "durations must increase instant ≤ fast < normal < slow ≤ page");
    }
    for (const t of Object.values(this.data.spring)) fromResponse(t.response, t.dampingRatio);
    for (const e of Object.values(this.data.easing)) cubicBezier(e[0], e[1], e[2], e[3]);
    for (const k of ["intensity", "parallax", "elasticity", "distanceScale"] as const) {
      const v = this.data[k];
      if (!(v >= 0 && v <= 1)) throw new MotionError("E_DNA", `${k} must be within [0, 1]`);
    }
  }

  spring(name: SpringTokenName = "standard"): SpringParams {
    const t = this.data.spring[name];
    if (!t) throw new MotionError("E_TOKEN", `unknown spring token \`${name}\``);
    return springParams(fromResponse(t.response, t.dampingRatio));
  }

  /** Milliseconds. */
  duration(name: DurationTokenName = "normal"): number {
    return this.data.duration[name];
  }

  easing(name: EasingTokenName = "standard"): Easing {
    const e = this.data.easing[name];
    return cubicBezier(e[0], e[1], e[2], e[3]);
  }

  /** Context-aware duration growing logarithmically with travelled distance (px). */
  durationForDistance(baseMs: number, distance: number): number {
    return baseMs * (1 + this.data.distanceScale * Math.log(1 + Math.abs(distance) / 200));
  }

  /** CSS custom properties so plain CSS transitions can share the same identity. */
  cssVariables(prefix = "--umx"): Record<string, string> {
    const d = this.data;
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.duration)) vars[`${prefix}-duration-${k}`] = `${v}ms`;
    for (const [k, v] of Object.entries(d.easing)) vars[`${prefix}-easing-${k}`] = `cubic-bezier(${v.join(", ")})`;
    vars[`${prefix}-press-scale`] = String(d.pressScale);
    vars[`${prefix}-hover-lift`] = `${d.hoverLift}px`;
    vars[`${prefix}-depth`] = `${d.depth}px`;
    vars[`${prefix}-stagger`] = `${d.stagger}ms`;
    return vars;
  }

  /** Applies the CSS variables to an element (default: document root). Does not touch colours or fonts. */
  applyCssVariables(target?: HTMLElement): void {
    const el = target ?? (typeof document !== "undefined" ? document.documentElement : null);
    if (!el) return;
    for (const [k, v] of Object.entries(this.cssVariables())) el.style.setProperty(k, v);
  }
}

export const REDUCED_MOTION_POLICY = PROFILES_DATA.reducedMotion;
