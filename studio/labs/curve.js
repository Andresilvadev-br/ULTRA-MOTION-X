// Curve editor: draggable cubic-Bézier handles, presets, numeric inputs, live SDK preview.
import { COLORS, canvas2d, h, panel, select } from "./ui.js";

const PRESETS = [
  "standard",
  "emphasized",
  "decelerate",
  "accelerate",
  "ease",
  "easeIn",
  "easeOut",
  "easeInOut",
  "backOut",
  "expoOut",
];

export function mount(host, { sdk, engine, project }) {
  const { animate, namedEasing, cubicBezier, applyEasing, easingToCss, set } = sdk;
  let curve = [...project.state.curve];
  const cv = h("canvas", { class: "curve-canvas", width: 320, height: 320, "aria-label": "Cubic Bézier editor" });
  const inputs = curve.map((v, i) =>
    h("input", { type: "number", step: "0.01", value: v, "aria-label": ["x1", "y1", "x2", "y2"][i], class: "num" }),
  );
  const css = h("code", { class: "css-out" });
  const box = h("div", { class: "lab-box" }, "UMX");
  const track = h("div", { class: "lab-track" }, box);
  const preset = select("Preset", ["custom", ...PRESETS], "custom", (name) => {
    if (name === "custom") return;
    const e = namedEasing(name);
    commit([e.x1, e.y1, e.x2, e.y2], `curve preset ${name}`);
  });
  const play = h("button", { class: "button primary", onclick: () => preview() }, "▶ Preview");
  const copy = h(
    "button",
    { class: "button secondary", onclick: () => navigator.clipboard?.writeText(css.textContent) },
    "Copy CSS",
  );
  host.append(
    h(
      "div",
      { class: "lab-grid" },
      panel(
        "Curve editor",
        "Drag the handles or type values. The preview uses the SDK tween with this curve.",
        h("div", { class: "curve-wrap" }, cv),
        h("div", { class: "num-row" }, inputs),
        css,
      ),
      panel("Preview", "200 px travel · 600 ms", track, h("div", { class: "demo-row" }, play, copy), preset.el),
    ),
  );
  const pad = 40;
  const geo = () => {
    const { w, h: H } = { w: cv.clientWidth, h: cv.clientHeight };
    const size = Math.min(w, H) - pad * 2;
    return { size, ox: (w - size) / 2, oy: (H + size) / 2 };
  };
  const toPx = (x, y) => {
    const g = geo();
    return [g.ox + x * g.size, g.oy - y * g.size];
  };
  const fromPx = (px, py) => {
    const g = geo();
    return [(px - g.ox) / g.size, (g.oy - py) / g.size];
  };
  function draw() {
    const { ctx, w, h: H } = canvas2d(cv);
    ctx.clearRect(0, 0, w, H);
    const [x0, y0] = toPx(0, 0);
    const [x1b, y1b] = toPx(1, 1);
    ctx.strokeStyle = COLORS.grid;
    ctx.strokeRect(x0, y1b, x1b - x0, y0 - y1b);
    const e = cubicBezier(...curve);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const [px, py] = toPx(i / 100, applyEasing(e, i / 100));
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    for (const [hx, hy, ax, ay] of [
      [curve[0], curve[1], 0, 0],
      [curve[2], curve[3], 1, 1],
    ]) {
      const [px, py] = toPx(hx, hy);
      const [qx, qy] = toPx(ax, ay);
      ctx.strokeStyle = COLORS.text;
      ctx.beginPath();
      ctx.moveTo(qx, qy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = COLORS.blue;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    css.textContent = easingToCss(e);
    inputs.forEach((inp, i) => {
      if (document.activeElement !== inp) inp.value = String(Math.round(curve[i] * 1000) / 1000);
    });
  }
  function commit(next, label = "edit curve") {
    const clamped = [Math.min(1, Math.max(0, next[0])), next[1], Math.min(1, Math.max(0, next[2])), next[3]];
    curve = clamped;
    project.update(label, (p) => {
      p.curve = clamped;
    });
    draw();
  }
  let dragging = -1;
  cv.addEventListener("pointerdown", (e) => {
    const r = cv.getBoundingClientRect();
    const handles = [toPx(curve[0], curve[1]), toPx(curve[2], curve[3])];
    dragging = handles.findIndex(([x, y]) => Math.hypot(x - (e.clientX - r.left), y - (e.clientY - r.top)) < 16);
    if (dragging >= 0) cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    if (dragging < 0) return;
    const r = cv.getBoundingClientRect();
    const [x, y] = fromPx(e.clientX - r.left, e.clientY - r.top);
    curve[dragging * 2] = Math.min(1, Math.max(0, x));
    curve[dragging * 2 + 1] = Math.max(-1, Math.min(2, y));
    draw();
  });
  cv.addEventListener("pointerup", () => {
    if (dragging >= 0) commit(curve);
    dragging = -1;
  });
  inputs.forEach((inp, i) =>
    inp.addEventListener("change", () => {
      const next = [...curve];
      next[i] = Number(inp.value);
      if (next.every(Number.isFinite)) commit(next);
    }),
  );
  function preview() {
    set(box, { x: 0 }, engine);
    animate(
      box,
      { x: [0, Math.max(0, track.clientWidth - 72)] },
      { engine, type: "tween", duration: 600, ease: curve },
    );
  }
  const off = project.on(() => {
    curve = [...project.state.curve];
    draw();
  });
  const ro = new ResizeObserver(draw);
  ro.observe(cv);
  draw();
  return () => {
    off();
    ro.disconnect();
  };
}
