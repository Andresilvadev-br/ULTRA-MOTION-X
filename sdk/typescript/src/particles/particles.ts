/**
 * Particle & Field engine (optional, decorative). Capacity-bounded structure-of-arrays
 * simulation with fixed-step integration, emitters and force fields, fidelity scaling and a
 * Canvas 2D renderer. Completely inactive (no frames requested) when nothing is alive and
 * no emitter is active. Disabled under reduced motion.
 *
 * Backends: "cpu" (this file, zero download) or "wasm" (the Rust `ParticleField` through
 * `@ultra-motion-x/web/wasm`) — both implement `ParticleBackend`.
 */
import { type Engine, getEngine, type Tickable } from "../core/engine.ts";
import type { TaskPriority } from "../core/scheduler.ts";

export const MAX_PARTICLES = 100_000;

export interface EmitterConfig {
  x: number;
  y: number;
  /** particles / second */
  rate: number;
  direction?: number;
  spread?: number;
  speed?: [number, number];
  life?: [number, number];
  size?: [number, number];
  active?: boolean;
}

export type ForceConfig =
  | { kind: "gravity"; x: number; y: number }
  | { kind: "drag"; coefficient: number }
  | { kind: "point"; x: number; y: number; strength: number; radius: number }
  | { kind: "vortex"; x: number; y: number; strength: number; radius: number }
  | { kind: "turbulence"; strength: number; scale: number };

export interface ParticleBackend {
  readonly capacity: number;
  addEmitter(e: Required<EmitterConfig>): number;
  setEmitter(i: number, patch: Partial<EmitterConfig>): void;
  setForces(forces: ForceConfig[]): void;
  burst(i: number, n: number): number;
  setFidelity(f: number): void;
  /** Steps and returns `[x, y, size, alpha] × alive`. */
  step(dt: number): Float32Array;
  readonly idle: boolean;
  dispose(): void;
}

class Pcg32 {
  private state = 0n;
  private readonly inc = (0xda3e39cb94b95bdbn << 1n) | 1n;
  constructor(seed: number) {
    this.next();
    this.state = (this.state + BigInt(seed)) & 0xffffffffffffffffn;
    this.next();
  }
  next(): number {
    const old = this.state;
    this.state = (old * 6364136223846793005n + this.inc) & 0xffffffffffffffffn;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }
  float(): number {
    return this.next() / 4294967296;
  }
}

function noise(x: number, y: number, seed: number): number {
  const h = (ix: number, iy: number) => {
    let n = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    n ^= n >>> 13;
    return ((n >>> 0) / 4294967296) * 2 - 1;
  };
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const tx = x - fx;
  const ty = y - fy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = h(fx, fy) + (h(fx + 1, fy) - h(fx, fy)) * sx;
  const b = h(fx, fy + 1) + (h(fx + 1, fy + 1) - h(fx, fy + 1)) * sx;
  return a + (b - a) * sy;
}

/** Pure TypeScript backend. */
export class CpuParticles implements ParticleBackend {
  readonly capacity: number;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private out: Float32Array;
  private alive = 0;
  private emitters: Array<Required<EmitterConfig> & { acc: number }> = [];
  private forces: ForceConfig[] = [];
  private fidelity = 1;
  private rng: Pcg32;
  private accumulator = 0;
  readonly stepSize = 1 / 120;

  constructor(capacity: number, seed = 1) {
    if (!(capacity >= 0 && capacity <= MAX_PARTICLES))
      throw new RangeError(`capacity must be within [0, ${MAX_PARTICLES}]`);
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.out = new Float32Array(capacity * 4);
    this.rng = new Pcg32(seed);
  }

  get count(): number {
    return this.alive;
  }
  get idle(): boolean {
    return this.alive === 0 && !this.emitters.some((e) => e.active && e.rate > 0);
  }
  addEmitter(e: Required<EmitterConfig>): number {
    this.emitters.push({ ...e, acc: 0 });
    return this.emitters.length - 1;
  }
  setEmitter(i: number, patch: Partial<EmitterConfig>): void {
    const e = this.emitters[i];
    if (e) Object.assign(e, patch);
  }
  setForces(forces: ForceConfig[]): void {
    this.forces = forces.slice();
  }
  setFidelity(f: number): void {
    this.fidelity = Math.min(1, Math.max(0, f));
  }
  private spawn(e: Required<EmitterConfig>): boolean {
    if (this.alive >= this.capacity) return false;
    const i = this.alive++;
    const angle = e.direction + (this.rng.float() - 0.5) * e.spread;
    const speed = e.speed[0] + (e.speed[1] - e.speed[0]) * this.rng.float();
    this.x[i] = e.x;
    this.y[i] = e.y;
    this.vx[i] = Math.cos(angle) * speed;
    this.vy[i] = Math.sin(angle) * speed;
    this.age[i] = 0;
    this.life[i] = Math.max(1e-3, e.life[0] + (e.life[1] - e.life[0]) * this.rng.float());
    this.size[i] = e.size[0] + (e.size[1] - e.size[0]) * this.rng.float();
    return true;
  }
  burst(i: number, n: number): number {
    const e = this.emitters[i];
    if (!e) return 0;
    let k = 0;
    while (k < n && this.spawn(e)) k++;
    return k;
  }
  private kill(i: number): void {
    const l = --this.alive;
    for (const a of [this.x, this.y, this.vx, this.vy, this.age, this.life, this.size]) a[i] = a[l]!;
  }
  private fixed(h: number): void {
    for (const e of this.emitters) {
      if (!e.active) continue;
      e.acc += e.rate * this.fidelity * h;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (!this.spawn(e)) {
          e.acc = 0;
          break;
        }
      }
    }
    let i = 0;
    while (i < this.alive) {
      this.age[i]! += h;
      if (this.age[i]! >= this.life[i]!) {
        this.kill(i);
        continue;
      }
      const px = this.x[i]!;
      const py = this.y[i]!;
      let ax = 0;
      let ay = 0;
      for (const f of this.forces) {
        switch (f.kind) {
          case "gravity":
            ax += f.x;
            ay += f.y;
            break;
          case "drag":
            ax -= f.coefficient * this.vx[i]!;
            ay -= f.coefficient * this.vy[i]!;
            break;
          case "point":
          case "vortex": {
            const dx = f.kind === "point" ? f.x - px : px - f.x;
            const dy = f.kind === "point" ? f.y - py : py - f.y;
            const d = Math.hypot(dx, dy);
            if (d > 1e-6 && d < f.radius) {
              const s = f.strength * (1 - d / f.radius);
              if (f.kind === "point") {
                ax += (s * dx) / d;
                ay += (s * dy) / d;
              } else {
                ax += (-s * dy) / d;
                ay += (s * dx) / d;
              }
            }
            break;
          }
          case "turbulence":
            ax += f.strength * noise(px / f.scale, py / f.scale, 0);
            ay += f.strength * noise(px / f.scale, py / f.scale, 17);
            break;
        }
      }
      this.vx[i]! += ax * h;
      this.vy[i]! += ay * h;
      this.x[i]! += this.vx[i]! * h;
      this.y[i]! += this.vy[i]! * h;
      i++;
    }
  }
  step(dt: number): Float32Array {
    this.accumulator += Math.min(dt, 0.25);
    let n = 0;
    while (this.accumulator >= this.stepSize && n < 32) {
      this.fixed(this.stepSize);
      this.accumulator -= this.stepSize;
      n++;
    }
    if (n === 32) this.accumulator = 0;
    for (let i = 0; i < this.alive; i++) {
      this.out[i * 4] = this.x[i]!;
      this.out[i * 4 + 1] = this.y[i]!;
      this.out[i * 4 + 2] = this.size[i]!;
      this.out[i * 4 + 3] = Math.max(0, 1 - this.age[i]! / this.life[i]!);
    }
    return this.out.subarray(0, this.alive * 4);
  }
  dispose(): void {
    this.alive = 0;
    this.emitters = [];
  }
}

export interface ParticleSystemOptions {
  engine?: Engine;
  capacity?: number;
  seed?: number;
  backend?: ParticleBackend;
  forces?: ForceConfig[];
  color?: string;
  /** Composite mode for the canvas (e.g. "lighter" for glows). */
  blend?: GlobalCompositeOperation;
}

/** Simulation + Canvas 2D renderer bound to the engine's decorative tick class. */
export class ParticleSystem implements Tickable {
  readonly tickPriority: TaskPriority = "decorative";
  readonly engine: Engine;
  readonly backend: ParticleBackend;
  readonly canvas: HTMLCanvasElement | null;
  private ctx: CanvasRenderingContext2D | null;
  private last: number | null = null;
  private color: string;
  private blend: GlobalCompositeOperation;
  private buffer: Float32Array = new Float32Array(0);
  frames = 0;

  constructor(canvas: HTMLCanvasElement | null, opts: ParticleSystemOptions = {}) {
    this.engine = opts.engine ?? getEngine();
    this.backend = opts.backend ?? new CpuParticles(Math.min(opts.capacity ?? 2000, MAX_PARTICLES), opts.seed ?? 1);
    this.canvas = canvas;
    this.ctx = canvas?.getContext("2d") ?? null;
    this.color = opts.color ?? "rgba(160, 200, 255, 1)";
    this.blend = opts.blend ?? "lighter";
    if (opts.forces) this.backend.setForces(opts.forces);
  }

  emitter(cfg: EmitterConfig): number {
    const full: Required<EmitterConfig> = {
      direction: -Math.PI / 2,
      spread: Math.PI / 3,
      speed: [40, 120],
      life: [0.6, 1.4],
      size: [2, 5],
      active: true,
      ...cfg,
    };
    const i = this.backend.addEmitter(full);
    if (full.active && full.rate > 0) this.wake();
    return i;
  }

  setEmitter(i: number, patch: Partial<EmitterConfig>): void {
    this.backend.setEmitter(i, patch);
    this.wake();
  }

  burst(i: number, n: number): number {
    if (!this.engine.a11y.allows("particles")) return 0;
    const k = this.backend.burst(i, Math.round(n * this.engine.fidelitySettings.particles));
    this.wake();
    return k;
  }

  private wake(): void {
    if (!this.engine.has(this)) {
      this.last = null;
      this.engine.add(this);
    }
  }

  tick(time: number): boolean {
    if (!this.engine.a11y.allows("particles")) {
      this.clear();
      return false;
    }
    const dt = this.last === null ? 0 : time - this.last;
    this.last = time;
    this.backend.setFidelity(this.engine.fidelitySettings.particles);
    this.buffer = this.backend.step(dt);
    this.frames++;
    this.engine.write(() => this.draw(), { key: `umx:particles:${this.frames % 2}`, priority: "decorative" });
    const active = !this.backend.idle;
    if (!active) this.engine.write(() => this.clear(), { priority: "decorative" });
    return active;
  }

  get particles(): Float32Array {
    return this.buffer;
  }

  private clear(): void {
    if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(): void {
    const ctx = this.ctx;
    const c = this.canvas;
    if (!ctx || !c) return;
    const dpr = typeof devicePixelRatio === "number" ? Math.min(2, devicePixelRatio) : 1;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = this.blend;
    ctx.fillStyle = this.color;
    const b = this.buffer;
    for (let i = 0; i < b.length; i += 4) {
      ctx.globalAlpha = b[i + 3]!;
      ctx.beginPath();
      ctx.arc(b[i]!, b[i + 1]!, b[i + 2]!, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  destroy(): void {
    this.engine.remove(this);
    this.backend.dispose();
    this.clear();
  }
}

/** Adapts a `WasmParticles` instance (from `@ultra-motion-x/web/wasm`) to `ParticleBackend`. */
export function wasmParticleBackend(w: {
  capacity: number;
  addEmitter(e: {
    x: number;
    y: number;
    rate: number;
    direction: number;
    spread: number;
    speed: [number, number];
    life: [number, number];
    size: [number, number];
  }): number;
  setEmitter(i: number, x: number, y: number, rate: number, active: boolean): void;
  addForce(kind: ForceConfig["kind"], a?: number, b?: number, c?: number, d?: number): void;
  clearForces(): void;
  burst(i: number, n: number): number;
  setFidelity(f: number): void;
  step(dt: number): Float32Array;
  readonly idle: boolean;
  free(): void;
}): ParticleBackend {
  const emitters: Array<Required<EmitterConfig>> = [];
  return {
    capacity: w.capacity,
    addEmitter(e) {
      emitters.push({ ...e });
      return w.addEmitter(e);
    },
    setEmitter(i, patch) {
      const e = emitters[i];
      if (!e) return;
      Object.assign(e, patch);
      w.setEmitter(i, e.x, e.y, e.rate, e.active);
    },
    setForces(forces) {
      w.clearForces();
      for (const f of forces) {
        if (f.kind === "gravity") w.addForce("gravity", f.x, f.y);
        else if (f.kind === "drag") w.addForce("drag", f.coefficient);
        else if (f.kind === "turbulence") w.addForce("turbulence", f.strength, f.scale);
        else w.addForce(f.kind, f.x, f.y, f.strength, f.radius);
      }
    },
    burst: (i, n) => w.burst(i, n),
    setFidelity: (f) => w.setFidelity(f),
    step: (dt) => w.step(dt),
    get idle() {
      return w.idle;
    },
    dispose: () => w.free(),
  };
}
