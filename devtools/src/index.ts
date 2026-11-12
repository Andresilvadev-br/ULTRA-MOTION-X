/**
 * @ultra-motion-x/devtools — diagnostic overlay. Import it only in development builds;
 * nothing runs until `attachDevTools()` is called, and `detach()` removes every listener.
 * Toggle with Alt+Shift+M.
 */
import { type Engine, getEngine } from "@ultra-motion-x/web";
import { Inspector, type Snapshot } from "./inspector.ts";

export { Inspector, type Snapshot };

export interface DevToolsOptions {
  engine?: Engine;
  /** Start visible. */
  open?: boolean;
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  hotkey?: boolean;
}

export interface DevToolsHandle {
  readonly inspector: Inspector;
  readonly element: HTMLElement;
  show(): void;
  hide(): void;
  toggle(): void;
  detach(): void;
}

const CSS = `
:host{all:initial}
.panel{position:fixed;z-index:2147483646;width:340px;max-height:70vh;overflow:auto;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e6e9f2;background:rgba(14,16,24,.94);border:1px solid #2a2f45;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);padding:10px 12px;backdrop-filter:blur(10px)}
.panel[hidden]{display:none}
h1{font-size:12px;margin:0 0 6px;color:#9fb4ff;display:flex;justify-content:space-between;align-items:center}
h2{font-size:10px;margin:10px 0 4px;color:#7b84a6;text-transform:uppercase;letter-spacing:.08em}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 10px}
.k{color:#7b84a6}.v{color:#e6e9f2;text-align:right}
.ok{color:#5ee0a0}.warn{color:#ffcc66}.bad{color:#ff7a90}
canvas{width:100%;height:46px;display:block;background:#0b0d14;border-radius:6px}
table{width:100%;border-collapse:collapse}td{padding:1px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px}
button,select{font:inherit;color:#e6e9f2;background:#1d2236;border:1px solid #2f3654;border-radius:6px;padding:2px 6px;cursor:pointer}
.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px}
ul{margin:0;padding-left:14px}li{margin:0}
`;

export function attachDevTools(opts: DevToolsOptions = {}): DevToolsHandle {
  const engine = opts.engine ?? getEngine();
  const inspector = new Inspector(engine);
  const host = document.createElement("umx-devtools");
  host.setAttribute("aria-label", "Ultra Motion X DevTools");
  const root = host.attachShadow({ mode: "open" });
  const pos = opts.position ?? "bottom-right";
  root.innerHTML = `<style>${CSS}</style><section class="panel" role="complementary" style="${pos.includes("bottom") ? "bottom" : "top"}:12px;${pos.includes("right") ? "right" : "left"}:12px">
<h1><span>Ultra Motion X</span><button data-a="close" aria-label="Close DevTools">×</button></h1>
<canvas width="320" height="46" aria-label="Frame interval history"></canvas>
<div class="grid" data-s="stats"></div>
<div class="row">
<label>Fidelity <select data-a="fidelity"><option value="auto">auto</option><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
<label>Speed <select data-a="speed"><option value="1">1×</option><option value="0.5">0.5×</option><option value="0.25">0.25×</option><option value="0.1">0.1×</option></select></label>
<button data-a="reduce">Reduced motion</button>
</div>
<h2>Active animations</h2><table data-s="anims"></table>
<h2>Counters</h2><div class="grid" data-s="counters"></div>
<h2>Warnings</h2><ul data-s="warnings"></ul>
</section>`;
  document.body.appendChild(host);
  const panel = root.querySelector<HTMLElement>(".panel")!;
  const canvas = root.querySelector("canvas")!;
  const q = (s: string) => root.querySelector<HTMLElement>(`[data-s="${s}"]`)!;
  if (!opts.open) panel.hidden = true;

  root.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).dataset.a;
    if (a === "close") panel.hidden = true;
    if (a === "reduce") engine.a11y.set({ reducedMotion: engine.reducedMotion ? "never" : "always" });
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.a === "fidelity")
      engine.setFidelity(t.value === "auto" ? null : (Number(t.value) as 0 | 1 | 2 | 3 | 4));
    if (t.dataset.a === "speed") engine.timeScale = Number(t.value);
  });

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  let timer: ReturnType<typeof setInterval> | null = null;
  const render = () => {
    if (panel.hidden) return;
    const s = inspector.snapshot();
    const r = s.report;
    const fps = r.estimatedFps.provenance === "unavailable" ? "–" : r.estimatedFps.value.toFixed(0);
    const cls =
      r.frameInterval.p95 > r.expectedIntervalMs * 1.5
        ? "bad"
        : r.frameInterval.p95 > r.expectedIntervalMs * 1.1
          ? "warn"
          : "ok";
    q("stats").innerHTML = [
      ["refresh", `${s.refreshHz} Hz`],
      ["fps (est.)", fps],
      [
        "p50 / p95",
        `<span class="${cls}">${r.frameInterval.p50.toFixed(1)} / ${r.frameInterval.p95.toFixed(1)} ms</span>`,
      ],
      ["engine p95", `${r.engineWork.p95.toFixed(2)} ms`],
      ["dropped (est.)", String(r.droppedFrames.provenance === "unavailable" ? "–" : r.droppedFrames.value)],
      ["input→frame p50", r.inputToFrame ? `${r.inputToFrame.p50.toFixed(1)} ms` : "–"],
      ["fidelity", String(s.fidelity)],
      ["profile", esc(s.profile)],
      ["reduced motion", s.reducedMotion ? "on" : "off"],
      ["values / active", `${r.activeValues} / ${r.activeAnimations}`],
      ["JS heap", r.memory.provenance === "measured" ? `${(r.memory.value / 1048576).toFixed(1)} MB` : "unavailable"],
    ]
      .map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`)
      .join("");
    q("anims").innerHTML = s.active.length
      ? s.active
          .slice(0, 24)
          .map(
            (a) =>
              `<tr><td>${esc(a.value)}</td><td>${a.spec}</td><td>${a.priority}</td><td>${a.current.toFixed(1)}→${a.to.toFixed(1)}</td><td>v ${a.velocity.toFixed(0)}</td></tr>`,
          )
          .join("")
      : `<tr><td class="k">idle — no frames requested</td></tr>`;
    const c = r.counters;
    q("counters").innerHTML = Object.entries({
      ...c,
      interruptions: s.arbitration.interruptions,
      rejections: s.arbitration.rejections,
    })
      .map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`)
      .join("");
    q("warnings").innerHTML = s.warnings.length
      ? s.warnings.map((w) => `<li class="warn">${esc(w.message)}</li>`).join("")
      : `<li class="k">none</li>`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const iv = engine.telemetry.intervals.values().slice(-160);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const exp = r.expectedIntervalMs;
      const max = Math.max(exp * 3, ...iv);
      ctx.strokeStyle = "#2a2f45";
      ctx.beginPath();
      const ey = canvas.height - (exp / max) * canvas.height;
      ctx.moveTo(0, ey);
      ctx.lineTo(canvas.width, ey);
      ctx.stroke();
      iv.forEach((v, i) => {
        ctx.fillStyle = v > exp * 1.5 ? "#ff7a90" : "#6f8cff";
        const h = (v / max) * canvas.height;
        ctx.fillRect(i * 2, canvas.height - h, 1.5, h);
      });
    }
  };
  // The overlay polls at 4 Hz only while visible; it never keeps the engine loop alive.
  const show = () => {
    panel.hidden = false;
    render();
    timer ??= setInterval(render, 250);
  };
  const hide = () => {
    panel.hidden = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey && e.shiftKey && e.code === "KeyM") {
      e.preventDefault();
      panel.hidden ? show() : hide();
    }
  };
  if (opts.hotkey !== false) addEventListener("keydown", onKey);
  if (opts.open) show();
  const handle: DevToolsHandle = {
    inspector,
    element: host,
    show,
    hide,
    toggle: () => (panel.hidden ? show() : hide()),
    detach() {
      hide();
      removeEventListener("keydown", onKey);
      inspector.destroy();
      host.remove();
      if ((globalThis as Record<string, unknown>).__ULTRA_MOTION_X_DEVTOOLS__ === handle)
        delete (globalThis as Record<string, unknown>).__ULTRA_MOTION_X_DEVTOOLS__;
    },
  };
  (globalThis as Record<string, unknown>).__ULTRA_MOTION_X_DEVTOOLS__ = handle;
  return handle;
}
