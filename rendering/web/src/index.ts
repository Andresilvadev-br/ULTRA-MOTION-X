/**
 * @ultra-motion-x/effects — Shader Effects Engine for the web.
 *
 * Principles:
 * * GPU only where it adds something CSS cannot do. Blur of what is behind an element is
 *   done with CSS `backdrop-filter` (the compositor is better at it); shaders add sheen,
 *   ripples, mesh gradients, lighting, grain and refraction.
 * * Render on demand: a surface draws only when its inputs change or while time-based
 *   materials are visible; nothing runs when idle or offscreen.
 * * Bounded resources: a global WebGL context budget; beyond it, CSS fallbacks are used.
 * * Fidelity-aware: resolution and availability follow the engine's Adaptive Fidelity level.
 * * Accessible: animated materials freeze under reduced motion; effects never carry content.
 */
import { type Engine, getEngine, parseColor, type Tickable } from "@ultra-motion-x/web";
import { SHADER_SOURCES } from "./shaders.generated.ts";

export type Material = "glass" | "ripple" | "gradient" | "lighting" | "noise" | "refraction";
export const MATERIALS: readonly Material[] = ["glass", "ripple", "gradient", "lighting", "noise", "refraction"];

/** Materials whose image changes with time (need continuous frames while visible). */
const ANIMATED: ReadonlySet<Material> = new Set(["gradient", "noise", "ripple"]);

export interface SurfaceOptions {
  engine?: Engine;
  material: Material;
  /** 0..1 */
  intensity?: number;
  /** Up to four CSS colours. */
  colors?: string[];
  /** Backdrop blur in px applied with CSS (glass). */
  blur?: number;
  /** Preferred backend. */
  backend?: "webgl2" | "webgpu" | "css";
  /** Place the surface above (`overlay`) or below (`underlay`) the element's content. */
  layer?: "overlay" | "underlay";
}

export type SurfaceBackend = "webgl2" | "webgpu" | "css" | "none";

/** Maximum simultaneous WebGL contexts created by this package (browsers cap at ~16). */
export let MAX_CONTEXTS = 8;
let liveContexts = 0;
export const setMaxContexts = (n: number): void => {
  MAX_CONTEXTS = Math.max(0, n);
};
export const contextsInUse = (): number => liveContexts;

/** Capability detection — real feature tests, no user-agent sniffing. */
export function detectCapabilities(): { webgl2: boolean; webgpu: boolean; backdropFilter: boolean } {
  const doc = typeof document !== "undefined" ? document : null;
  let webgl2 = false;
  if (doc) {
    try {
      const c = doc.createElement("canvas");
      const gl = c.getContext("webgl2");
      webgl2 = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  const webgpu =
    typeof navigator !== "undefined" && "gpu" in navigator && !!(navigator as Navigator & { gpu?: unknown }).gpu;
  const backdropFilter =
    typeof CSS !== "undefined" &&
    (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)"));
  return { webgl2, webgpu, backdropFilter };
}

const VERT = SHADER_SOURCES["fullscreen.vert.glsl"]!;
const COMMON = SHADER_SOURCES["common.glsl"]!;

export function fragmentSource(material: Material): string {
  const body = SHADER_SOURCES[`${material}.frag.glsl`];
  if (!body) throw new Error(`unknown material \`${material}\``);
  return `#version 300 es\n${COMMON}\n${body}`;
}

export function vertexSource(): string {
  return `#version 300 es\n${VERT}`;
}

function rgba(c: string | undefined, fallback: [number, number, number, number]): [number, number, number, number] {
  const p = c ? parseColor(c) : null;
  return p ? [p.r, p.g, p.b, p.a] : fallback;
}

const DEFAULT_COLORS = ["#ffffff", "#7dd3fc", "#a78bfa", "#f472b6"];

/** A shader surface attached to an element. */
export class Surface implements Tickable {
  readonly tickPriority = "decorative" as const;
  readonly host: HTMLElement;
  readonly engine: Engine;
  readonly options: Required<Omit<SurfaceOptions, "engine">>;
  backend: SurfaceBackend = "none";
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private pointer: [number, number, number] = [0.5, 0.5, 0];
  private pointerTarget: [number, number, number] = [0.5, 0.5, 0];
  private ripples: Array<[number, number, number, number]> = [];
  private startTime = typeof performance !== "undefined" ? performance.now() : 0;
  private visible = true;
  private dirty = true;
  private disposers: Array<() => void> = [];
  private prevPosition = "";
  private cssLayer: HTMLElement | null = null;
  /** Frames actually rendered (for tests/telemetry). */
  renders = 0;

  constructor(host: HTMLElement, opts: SurfaceOptions) {
    this.host = host;
    this.engine = opts.engine ?? getEngine();
    if (!MATERIALS.includes(opts.material)) throw new Error(`unknown material \`${opts.material}\``);
    this.options = {
      material: opts.material,
      intensity: Math.min(1, Math.max(0, opts.intensity ?? 0.7)),
      colors: opts.colors ?? DEFAULT_COLORS,
      blur: opts.blur ?? (opts.material === "glass" ? 16 : 0),
      backend: opts.backend ?? "webgl2",
      layer: opts.layer ?? (opts.material === "gradient" ? "underlay" : "overlay"),
    };
    this.init();
  }

  private init(): void {
    const cs = getComputedStyle(this.host);
    if (cs.position === "static") {
      this.prevPosition = this.host.style.position;
      this.host.style.position = "relative";
    }
    if (this.options.blur > 0) {
      const b = `blur(${this.options.blur * this.engine.fidelitySettings.blur}px)`;
      this.host.style.setProperty("backdrop-filter", b);
      this.host.style.setProperty("-webkit-backdrop-filter", b);
    }
    const settings = this.engine.fidelitySettings;
    const wantGpu = this.options.backend !== "css" && settings.shaders && liveContexts < MAX_CONTEXTS;
    if (wantGpu && this.initWebGL()) this.backend = "webgl2";
    else this.initCss();
    this.listen();
    this.schedule();
  }

  private initWebGL(): boolean {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.dataset.umxSurface = this.options.material;
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      borderRadius: "inherit",
      zIndex: this.options.layer === "underlay" ? "-1" : "0",
    });
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) return false;
    const program = compile(gl, vertexSource(), fragmentSource(this.options.material));
    if (!program) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return false;
    }
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    liveContexts++;
    for (const name of [
      "u_resolution",
      "u_time",
      "u_pointer",
      "u_intensity",
      "u_radius",
      "u_color0",
      "u_color1",
      "u_color2",
      "u_color3",
      "u_ripples",
    ]) {
      this.uniforms.set(name, gl.getUniformLocation(program, name));
    }
    canvas.addEventListener("webglcontextlost", this.onLost);
    this.host.prepend(canvas);
    return true;
  }

  private readonly onLost = (e: Event) => {
    e.preventDefault();
    this.releaseGl();
    this.initCss();
    this.engine.warn("WebGL context lost; switched effect to CSS fallback", this.host);
  };

  /** CSS fallback: approximates each material with gradients (no GPU context). */
  private initCss(): void {
    this.backend = "css";
    const layer = document.createElement("span");
    layer.setAttribute("aria-hidden", "true");
    layer.dataset.umxSurface = `${this.options.material}-css`;
    Object.assign(layer.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      borderRadius: "inherit",
      zIndex: this.options.layer === "underlay" ? "-1" : "0",
    });
    this.cssLayer = layer;
    this.host.prepend(layer);
    this.dirty = true;
  }

  private listen(): void {
    const move = (e: PointerEvent) => {
      const r = this.host.getBoundingClientRect();
      this.pointerTarget = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, 1];
      this.schedule();
    };
    const leave = () => {
      this.pointerTarget = [this.pointerTarget[0], this.pointerTarget[1], 0];
      this.schedule();
    };
    const down = (e: PointerEvent) => {
      if (this.options.material !== "ripple") return;
      const r = this.host.getBoundingClientRect();
      this.ripples.push([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, this.time(), 1]);
      if (this.ripples.length > 4) this.ripples.shift();
      this.schedule();
    };
    this.host.addEventListener("pointermove", move, { passive: true });
    this.host.addEventListener("pointerleave", leave);
    this.host.addEventListener("pointerdown", down, { passive: true });
    this.disposers.push(() => {
      this.host.removeEventListener("pointermove", move);
      this.host.removeEventListener("pointerleave", leave);
      this.host.removeEventListener("pointerdown", down);
    });
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        if (this.visible) this.schedule();
      });
      io.observe(this.host);
      this.disposers.push(() => io.disconnect());
    }
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => this.schedule());
      ro.observe(this.host);
      this.disposers.push(() => ro.disconnect());
    }
    this.disposers.push(this.engine.on("fidelity", () => this.schedule()));
    this.disposers.push(this.engine.on("reducedmotion", () => this.schedule()));
  }

  private time(): number {
    return ((typeof performance !== "undefined" ? performance.now() : 0) - this.startTime) / 1000;
  }

  /** Requests a render on the next frame (on demand). */
  schedule(): void {
    this.dirty = true;
    if (!this.engine.has(this)) this.engine.add(this);
  }

  setIntensity(v: number): void {
    this.options.intensity = Math.min(1, Math.max(0, v));
    this.schedule();
  }

  tick(): boolean {
    if (!this.visible) return false;
    // Smooth pointer following (critically damped approach, frame-rate independent enough
    // for a decorative signal).
    const k = 0.25;
    for (let i = 0; i < 3; i++) this.pointer[i] = this.pointer[i]! + (this.pointerTarget[i]! - this.pointer[i]!) * k;
    const pointerMoving = this.pointer.some((v, i) => Math.abs(v - this.pointerTarget[i]!) > 1e-3);
    const ripplesActive = this.ripples.some((r) => this.time() - r[2] < 1.6);
    const animated =
      ANIMATED.has(this.options.material) &&
      !this.engine.reducedMotion &&
      (this.options.material !== "ripple" || ripplesActive);
    if (this.dirty || pointerMoving || animated) {
      this.engine.write(() => this.render(), {
        key: `umx:surface:${this.options.material}:${surfaceId(this)}`,
        priority: "decorative",
      });
      this.dirty = false;
    }
    return pointerMoving || animated;
  }

  private render(): void {
    const settings = this.engine.fidelitySettings;
    if (this.backend === "webgl2" && !settings.shaders) {
      // Fidelity dropped below shader level: degrade to CSS without losing the effect.
      this.releaseGl();
      this.initCss();
    }
    if (this.backend === "css") return this.renderCss();
    const gl = this.gl;
    const c = this.canvas;
    if (!gl || !c || !this.program) return;
    const dpr =
      Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1) *
      Math.max(0.25, settings.effectResolution);
    const w = Math.max(1, Math.round(this.host.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.host.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = (n: string) => this.uniforms.get(n) ?? null;
    const radius = Number.parseFloat(getComputedStyle(this.host).borderTopLeftRadius) || 0;
    gl.uniform2f(u("u_resolution"), w, h);
    gl.uniform1f(u("u_time"), this.engine.reducedMotion ? 0 : this.time());
    gl.uniform3f(u("u_pointer"), this.pointer[0], this.pointer[1], this.pointer[2]);
    gl.uniform1f(u("u_intensity"), this.options.intensity * this.engine.a11y.options.maxIntensity);
    gl.uniform1f(u("u_radius"), radius * dpr);
    this.options.colors.slice(0, 4).forEach((col, i) => gl.uniform4f(u(`u_color${i}`), ...rgba(col, [1, 1, 1, 1])));
    const rip = new Float32Array(16);
    this.ripples.forEach((r, i) => rip.set(r, i * 4));
    gl.uniform4fv(u("u_ripples"), rip);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.renders++;
  }

  private renderCss(): void {
    const l = this.cssLayer;
    if (!l) return;
    const [a, b, c, d] = this.options.colors;
    const i = this.options.intensity;
    const px = `${(this.pointer[0] * 100).toFixed(1)}%`;
    const py = `${(this.pointer[1] * 100).toFixed(1)}%`;
    const alpha = (col: string | undefined, k: number) => {
      const p = rgba(col, [1, 1, 1, 1]);
      return `rgba(${Math.round(p[0] * 255)}, ${Math.round(p[1] * 255)}, ${Math.round(p[2] * 255)}, ${(p[3] * k).toFixed(3)})`;
    };
    switch (this.options.material) {
      case "glass":
        l.style.background = `radial-gradient(circle at ${px} ${py}, ${alpha(a, 0.35 * i * (0.4 + this.pointer[2]))}, transparent 60%), ${alpha(a, 0.08 * i)}`;
        break;
      case "lighting":
        l.style.background = `radial-gradient(circle at ${px} ${py}, ${alpha(a, 0.45 * i * this.pointer[2])}, transparent 55%)`;
        break;
      case "gradient":
      case "refraction":
        l.style.background = `linear-gradient(135deg, ${alpha(a, i)}, ${alpha(b, i)} 40%, ${alpha(c, i)} 70%, ${alpha(d, i)})`;
        break;
      case "ripple":
      case "noise":
        l.style.background = "transparent";
        break;
    }
    this.renders++;
  }

  private releaseGl(): void {
    if (this.gl) {
      this.canvas?.removeEventListener("webglcontextlost", this.onLost);
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
      liveContexts = Math.max(0, liveContexts - 1);
    }
    this.canvas?.remove();
    this.canvas = null;
    this.gl = null;
    this.program = null;
  }

  destroy(): void {
    this.engine.remove(this);
    for (const d of this.disposers) d();
    this.disposers = [];
    this.releaseGl();
    this.cssLayer?.remove();
    this.cssLayer = null;
    this.host.style.removeProperty("backdrop-filter");
    this.host.style.removeProperty("-webkit-backdrop-filter");
    if (this.prevPosition !== "" || this.host.style.position === "relative")
      this.host.style.position = this.prevPosition;
    this.backend = "none";
  }
}

const ids = new WeakMap<Surface, number>();
let seq = 0;
function surfaceId(s: Surface): number {
  let id = ids.get(s);
  if (!id) ids.set(s, (id = ++seq));
  return id;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("[ultra-motion-x/effects] shader compile error:", gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const v = shader(gl.VERTEX_SHADER, vs);
  const f = shader(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error("[ultra-motion-x/effects] program link error:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

/** Convenience: attaches a surface and returns a disposer. */
export function surface(host: HTMLElement, opts: SurfaceOptions): Surface {
  return new Surface(host, opts);
}

/**
 * Experimental WebGPU renderer for the gradient material (WGSL source in
 * `rendering/shaders/gradient.wgsl`). Returns null when WebGPU is unavailable.
 */
export async function webgpuGradient(
  canvas: HTMLCanvasElement,
  colors: string[] = DEFAULT_COLORS,
): Promise<{ render(time: number, intensity?: number): void; destroy(): void } | null> {
  type GPU = {
    requestAdapter(): Promise<{ requestDevice(): Promise<GPUDeviceLike> } | null>;
    getPreferredCanvasFormat(): string;
  };
  type GPUDeviceLike = {
    createShaderModule(d: { code: string }): unknown;
    createBuffer(d: { size: number; usage: number }): { destroy(): void };
    createRenderPipeline(d: unknown): { getBindGroupLayout(i: number): unknown };
    createBindGroup(d: unknown): unknown;
    createCommandEncoder(): {
      beginRenderPass(d: unknown): {
        setPipeline(p: unknown): void;
        setBindGroup(i: number, g: unknown): void;
        draw(n: number): void;
        end(): void;
      };
      finish(): unknown;
    };
    queue: { writeBuffer(b: unknown, o: number, d: Float32Array): void; submit(c: unknown[]): void };
    destroy(): void;
  };
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu" as "2d") as unknown as {
    configure(d: unknown): void;
    getCurrentTexture(): { createView(): unknown };
  } | null;
  if (!ctx) return null;
  const format = gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "premultiplied" });
  const module = device.createShaderModule({ code: SHADER_SOURCES["gradient.wgsl"]! });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  // UNIFORM | COPY_DST
  const ubo = device.createBuffer({ size: 112, usage: 0x40 | 0x8 });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ubo } }],
  });
  const cols = colors.slice(0, 4).map((c) => rgba(c, [1, 1, 1, 1]));
  return {
    render(time: number, intensity = 0.8) {
      const data = new Float32Array(28);
      data.set([canvas.width, canvas.height, time, intensity, 0, 0, 0, 0, 0, 0, 0, 0]);
      cols.forEach((c, i) => data.set(c, 12 + i * 4));
      device.queue.writeBuffer(ubo, 0, data);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: ctx.getCurrentTexture().createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    destroy() {
      ubo.destroy();
      device.destroy();
    },
  };
}

export { SHADER_SOURCES };
