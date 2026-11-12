// Tiny DOM helpers shared by Studio labs.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat())
    if (c !== null && c !== undefined && c !== false)
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function panel(title, subtitle, ...body) {
  return h(
    "div",
    { class: "panel lab-panel" },
    h("div", { class: "panel-heading" }, h("div", {}, h("b", {}, title), subtitle ? h("small", {}, subtitle) : null)),
    ...body,
  );
}

export function range(label, { min, max, step = 1, value, onInput, id }) {
  const out = h("output", {}, String(value));
  const input = h("input", { type: "range", min, max, step, value, id });
  input.addEventListener("input", () => {
    out.textContent = input.value;
    onInput(Number(input.value));
  });
  return {
    el: h("label", { class: "range-field" }, h("span", {}, label, " ", out), input),
    input,
    out,
    set(v) {
      input.value = String(v);
      out.textContent = String(v);
    },
  };
}

export function select(label, options, value, onChange, id) {
  const s = h("select", { id }, ...options.map((o) => h("option", { value: o, selected: o === value }, o)));
  s.addEventListener("change", () => onChange(s.value));
  return { el: h("label", { class: "form-field" }, h("span", {}, label), s), select: s };
}

/** Sizes a canvas for crisp drawing and returns its 2D context in CSS pixels. */
export function canvas2d(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hgt };
}

export const COLORS = { accent: "#ff8748", blue: "#6f8cff", green: "#5ee0a0", grid: "#2a2f3d", text: "#9aa3b8" };
