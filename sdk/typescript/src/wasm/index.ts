/**
 * WebAssembly bridge to the shared Rust core (`sdk/ffi` compiled for wasm32). Provides the
 * MDL compiler, inspection, migrations, the native runtime and the particle field. Loading
 * is lazy and optional: nothing in the main SDK requires it.
 */

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
}

export interface CompileOutput<Plan = unknown> {
  ok: boolean;
  plan: Plan | null;
  diagnostics: Diagnostic[];
  migratedFrom: string | null;
}

interface Exports {
  memory: WebAssembly.Memory;
  umx_alloc(len: number): number;
  umx_free(ptr: number, len: number): void;
  umx_string_ptr(s: number): number;
  umx_string_len(s: number): number;
  umx_string_free(s: number): void;
  umx_version(): number;
  umx_abi_version(): number;
  umx_last_error_code(): number;
  umx_last_error_message(): number;
  umx_compile(ptr: number, len: number): number;
  umx_inspect(ptr: number, len: number, mode: number): number;
  umx_migrate(ptr: number, len: number): number;
  umx_engine_new(fixedStep: number): number;
  umx_engine_free(e: number): void;
  umx_engine_frame(e: number, ts: number): number;
  umx_engine_advance(e: number, dt: number): number;
  umx_engine_set_reduced_motion(e: number, on: number): number;
  umx_engine_telemetry_json(e: number): number;
  umx_engine_load_mdl(e: number, ptr: number, len: number): number;
  umx_value_create(e: number, v: number): bigint;
  umx_value_get(e: number, h: bigint): number;
  umx_value_velocity(e: number, h: bigint): number;
  umx_value_set(e: number, h: bigint, v: number, vel: number): number;
  umx_value_destroy(e: number, h: bigint): number;
  umx_animate_spring(e: number, h: bigint, to: number, k: number, c: number, m: number, p: number, pol: number): bigint;
  umx_animate_tween(
    e: number,
    h: bigint,
    to: number,
    d: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    p: number,
    pol: number,
  ): bigint;
  umx_instance_create(e: number, ptr: number, len: number): bigint;
  umx_instance_send(e: number, h: bigint, ptr: number, len: number): number;
  umx_instance_get(e: number, h: bigint, ptr: number, len: number): number;
  umx_spring_position(k: number, c: number, m: number, from: number, to: number, v0: number, t: number): number;
  umx_spring_velocity(k: number, c: number, m: number, from: number, to: number, v0: number, t: number): number;
  umx_spring_finish_time(k: number, c: number, m: number, from: number, to: number, v0: number): number;
  umx_particles_new(capacity: number, seed: bigint): number;
  umx_particles_free(p: number): void;
  umx_particles_add_emitter(
    p: number,
    x: number,
    y: number,
    rate: number,
    dir: number,
    spread: number,
    smin: number,
    smax: number,
    lmin: number,
    lmax: number,
    zmin: number,
    zmax: number,
  ): number;
  umx_particles_set_emitter(p: number, i: number, x: number, y: number, rate: number, active: number): number;
  umx_particles_add_force(p: number, kind: number, a: number, b: number, c: number, d: number): number;
  umx_particles_clear_forces(p: number): void;
  umx_particles_burst(p: number, i: number, n: number): number;
  umx_particles_set_fidelity(p: number, f: number): void;
  umx_particles_step(p: number, dt: number): number;
  umx_particles_buffer(p: number): number;
  umx_particles_is_idle(p: number): number;
}

export class WasmError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "WasmError";
    this.code = code;
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class WasmCore {
  readonly x: Exports;

  constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as unknown as Exports;
  }

  private cstr(ptr: number): string {
    const mem = new Uint8Array(this.x.memory.buffer);
    let end = ptr;
    while (mem[end] !== 0) end++;
    return dec.decode(mem.subarray(ptr, end));
  }

  get version(): string {
    return this.cstr(this.x.umx_version());
  }

  lastError(): WasmError {
    return new WasmError(this.x.umx_last_error_code(), this.cstr(this.x.umx_last_error_message()));
  }

  /** Calls `fn` with a string copied into wasm memory. */
  withString<T>(s: string, fn: (ptr: number, len: number) => T): T {
    const bytes = enc.encode(s);
    const ptr = this.x.umx_alloc(bytes.length);
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes);
    try {
      return fn(ptr, bytes.length);
    } finally {
      this.x.umx_free(ptr, bytes.length);
    }
  }

  takeString(s: number): string {
    if (!s) throw this.lastError();
    const ptr = this.x.umx_string_ptr(s);
    const len = this.x.umx_string_len(s);
    const out = dec.decode(new Uint8Array(this.x.memory.buffer, ptr, len));
    this.x.umx_string_free(s);
    return out;
  }

  compile<Plan = unknown>(doc: string | object): CompileOutput<Plan> {
    const src = typeof doc === "string" ? doc : JSON.stringify(doc);
    return JSON.parse(this.withString(src, (p, l) => this.takeString(this.x.umx_compile(p, l))));
  }

  inspect(doc: string | object, mode: "summary" | "dot" = "summary"): string {
    const src = typeof doc === "string" ? doc : JSON.stringify(doc);
    return this.withString(src, (p, l) => this.takeString(this.x.umx_inspect(p, l, mode === "dot" ? 1 : 0)));
  }

  migrate(doc: string | object): { ok: boolean; document?: unknown; from?: string | null; diagnostics: Diagnostic[] } {
    const src = typeof doc === "string" ? doc : JSON.stringify(doc);
    return JSON.parse(this.withString(src, (p, l) => this.takeString(this.x.umx_migrate(p, l))));
  }

  springPosition(k: number, c: number, m: number, from: number, to: number, v0: number, t: number): number {
    return this.x.umx_spring_position(k, c, m, from, to, v0, t);
  }

  createEngine(fixedStepMs = 0): WasmEngine {
    return new WasmEngine(this, this.x.umx_engine_new(fixedStepMs / 1000));
  }

  createParticles(capacity: number, seed = 1): WasmParticles {
    const p = this.x.umx_particles_new(capacity, BigInt(seed));
    if (!p) throw this.lastError();
    return new WasmParticles(this, p, capacity);
  }
}

/** The Rust runtime driven from JS (deterministic simulations, server-side previews…). */
export class WasmEngine {
  private core: WasmCore;
  private ptr: number;
  constructor(core: WasmCore, ptr: number) {
    this.core = core;
    this.ptr = ptr;
  }
  private check<T extends number | bigint>(r: T): T {
    if ((typeof r === "bigint" && r === 0n) || (typeof r === "number" && r < 0)) throw this.core.lastError();
    return r;
  }
  createValue(initial: number): bigint {
    return this.check(this.core.x.umx_value_create(this.ptr, initial));
  }
  get(h: bigint): number {
    return this.core.x.umx_value_get(this.ptr, h);
  }
  velocity(h: bigint): number {
    return this.core.x.umx_value_velocity(this.ptr, h);
  }
  spring(h: bigint, to: number, k = 170, c = 26, m = 1, priority = 2): bigint {
    return this.check(this.core.x.umx_animate_spring(this.ptr, h, to, k, c, m, priority, 0));
  }
  tween(h: bigint, to: number, seconds: number, bezier: [number, number, number, number] = [0.2, 0, 0, 1]): bigint {
    return this.check(this.core.x.umx_animate_tween(this.ptr, h, to, seconds, ...bezier, 2, 0));
  }
  /** Returns true while more frames are needed. */
  frame(timestampMs: number): boolean {
    return this.check(this.core.x.umx_engine_frame(this.ptr, timestampMs)) === 1;
  }
  advance(dtSeconds: number): boolean {
    return this.check(this.core.x.umx_engine_advance(this.ptr, dtSeconds)) === 1;
  }
  loadMDL(doc: string | object): void {
    const src = typeof doc === "string" ? doc : JSON.stringify(doc);
    this.check(this.core.withString(src, (p, l) => this.core.x.umx_engine_load_mdl(this.ptr, p, l)));
  }
  instance(component: string): bigint {
    return this.check(this.core.withString(component, (p, l) => this.core.x.umx_instance_create(this.ptr, p, l)));
  }
  send(inst: bigint, event: string): boolean {
    return this.check(this.core.withString(event, (p, l) => this.core.x.umx_instance_send(this.ptr, inst, p, l))) === 1;
  }
  instanceValue(inst: bigint, prop: string): number {
    return this.core.withString(prop, (p, l) => this.core.x.umx_instance_get(this.ptr, inst, p, l));
  }
  telemetry(): unknown {
    return JSON.parse(this.core.takeString(this.core.x.umx_engine_telemetry_json(this.ptr)));
  }
  free(): void {
    if (this.ptr) this.core.x.umx_engine_free(this.ptr);
    this.ptr = 0;
  }
}

export class WasmParticles {
  private core: WasmCore;
  private ptr: number;
  readonly capacity: number;
  constructor(core: WasmCore, ptr: number, capacity: number) {
    this.core = core;
    this.ptr = ptr;
    this.capacity = capacity;
  }
  addEmitter(e: {
    x: number;
    y: number;
    rate: number;
    direction: number;
    spread: number;
    speed: [number, number];
    life: [number, number];
    size: [number, number];
  }): number {
    return this.core.x.umx_particles_add_emitter(
      this.ptr,
      e.x,
      e.y,
      e.rate,
      e.direction,
      e.spread,
      e.speed[0],
      e.speed[1],
      e.life[0],
      e.life[1],
      e.size[0],
      e.size[1],
    );
  }
  setEmitter(i: number, x: number, y: number, rate: number, active: boolean): void {
    this.core.x.umx_particles_set_emitter(this.ptr, i, x, y, rate, active ? 1 : 0);
  }
  addForce(kind: "gravity" | "drag" | "point" | "vortex" | "turbulence", a = 0, b = 0, c = 0, d = 0): void {
    const k = { gravity: 0, drag: 1, point: 2, vortex: 3, turbulence: 4 }[kind];
    this.core.x.umx_particles_add_force(this.ptr, k, a, b, c, d);
  }
  clearForces(): void {
    this.core.x.umx_particles_clear_forces(this.ptr);
  }
  burst(i: number, n: number): number {
    return this.core.x.umx_particles_burst(this.ptr, i, n);
  }
  setFidelity(f: number): void {
    this.core.x.umx_particles_set_fidelity(this.ptr, f);
  }
  /** Steps and returns a view `[x, y, size, alpha] × alive` (valid until the next call). */
  step(dtSeconds: number): Float32Array {
    const n = this.core.x.umx_particles_step(this.ptr, dtSeconds);
    return new Float32Array(this.core.x.memory.buffer, this.core.x.umx_particles_buffer(this.ptr), n * 4);
  }
  get idle(): boolean {
    return this.core.x.umx_particles_is_idle(this.ptr) === 1;
  }
  free(): void {
    if (this.ptr) this.core.x.umx_particles_free(this.ptr);
    this.ptr = 0;
  }
}

let cached: Promise<WasmCore> | null = null;

/**
 * Loads the core. `source` may be a URL, a path (Node), bytes or a Response. Defaults to the
 * `ultra_motion_x.wasm` shipped with this package.
 */
export function loadCore(source?: string | URL | ArrayBuffer | Uint8Array | Response): Promise<WasmCore> {
  if (!source && cached) return cached;
  const p = (async () => {
    let bytes: ArrayBuffer | Uint8Array;
    const src = source ?? new URL("../../wasm/ultra_motion_x.wasm", import.meta.url);
    if (src instanceof ArrayBuffer || src instanceof Uint8Array) bytes = src;
    else if (typeof Response !== "undefined" && src instanceof Response) bytes = await src.arrayBuffer();
    else {
      const url =
        src instanceof URL
          ? src
          : new URL(String(src), typeof location !== "undefined" ? location.href : `file://${process.cwd()}/`);
      if (url.protocol === "file:") {
        const fs = await import(/* @vite-ignore */ "node:fs/promises" as string);
        bytes = await (fs as typeof import("node:fs/promises")).readFile(url);
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
        bytes = await res.arrayBuffer();
      }
    }
    const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
    const core = new WasmCore(instance);
    if (core.x.umx_abi_version() !== 1) throw new Error(`unsupported ABI version ${core.x.umx_abi_version()}`);
    return core;
  })();
  if (!source) cached = p;
  return p;
}
