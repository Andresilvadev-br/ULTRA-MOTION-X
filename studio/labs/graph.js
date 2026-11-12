// Motion Graph lab: edit MDL, compile it with the Rust compiler (WebAssembly), inspect
// diagnostics, visualise each component's state machine and drive it live.
import { download } from "../project.js";
import { h, panel } from "./ui.js";

export async function mount(host, { sdk, engine, project, wasm }) {
  const editor = h("textarea", { class: "mdl-editor", spellcheck: "false", "aria-label": "MDL document" });
  const diags = h("ul", { class: "diags" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "graph-svg");
  svg.setAttribute("role", "img");
  const compSelect = h("select", { "aria-label": "Component" });
  const events = h("div", { class: "demo-row" });
  const stateChip = h("span", { class: "chip", id: "graph-state" }, "—");
  const target = h("div", { class: "lab-box graph-target" }, "UMX");
  const stage = h("div", { class: "lab-stage" }, target);
  const values = h("pre", { class: "values" });
  const summary = h("pre", { class: "values" });
  const coreStatus = h("span", { class: "chip" }, "loading compiler…");
  let core = null;
  let plan = null;
  let graph = null;
  let unbind = null;
  let timer = null;

  editor.value = project.state.mdl ?? (await (await fetch("/examples/mdl/app.umx.json")).text());
  host.append(
    h(
      "div",
      { class: "lab-grid wide" },
      panel(
        "Motion Design Language",
        "Edited text is compiled by the same Rust compiler used by the CLI and native runtimes (loaded as WebAssembly).",
        editor,
        h(
          "div",
          { class: "demo-row" },
          h("button", { class: "button primary", id: "compile", onclick: () => compile(true) }, "Compile"),
          h(
            "button",
            { class: "button secondary", onclick: () => download("motion.umx.json", editor.value) },
            "Export .umx.json",
          ),
          coreStatus,
        ),
        diags,
      ),
      panel(
        "Motion graph",
        "States and transitions of the selected component. Send events to drive it; interruptions retarget with velocity preserved.",
        h("div", { class: "demo-row" }, compSelect, stateChip),
        svg,
        events,
        stage,
        values,
        summary,
      ),
    ),
  );

  function renderDiagnostics(list) {
    diags.replaceChildren(
      ...(list.length ? list : [{ severity: "info", code: "OK", path: "$", message: "no diagnostics" }]).map((d) =>
        h("li", { class: `diag ${d.severity}` }, h("b", {}, d.code), ` ${d.path}: ${d.message}`),
      ),
    );
  }

  function draw(component) {
    const c = plan.components[component];
    svg.replaceChildren();
    const states = Object.keys(c.states);
    const W = 520;
    const H = 260;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const pos = Object.fromEntries(
      states.map((s, i) => {
        const a = (i / states.length) * Math.PI * 2 - Math.PI / 2;
        return [
          s,
          [W / 2 + Math.cos(a) * (states.length > 1 ? 170 : 0), H / 2 + Math.sin(a) * (states.length > 1 ? 90 : 0)],
        ];
      }),
    );
    const ns = "http://www.w3.org/2000/svg";
    const el = (tag, attrs, text) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (text) e.textContent = text;
      svg.append(e);
      return e;
    };
    const defs = el("defs", {});
    defs.innerHTML =
      '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6f8cff"/></marker>';
    for (const t of c.transitions) {
      const froms = t.from === "*" ? states.filter((s) => s !== t.to) : [t.from];
      for (const f of froms) {
        const [x1, y1] = pos[f];
        const [x2, y2] = pos[t.to];
        const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15;
        const my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
        el("path", {
          d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`,
          fill: "none",
          stroke: "#6f8cff",
          "stroke-width": 1.5,
          "marker-end": "url(#arrow)",
          opacity: 0.8,
        });
        el("text", { x: mx, y: my, fill: "#9aa3b8", "font-size": 11, "text-anchor": "middle" }, t.event);
      }
    }
    for (const s of states) {
      const [x, y] = pos[s];
      el("rect", {
        x: x - 46,
        y: y - 16,
        width: 92,
        height: 32,
        rx: 10,
        fill: s === graph?.state ? "#ff8748" : "#1d2236",
        stroke: s === c.initial ? "#ff8748" : "#2f3654",
        "data-state": s,
      });
      el("text", { x, y: y + 4, fill: "#f3f3f8", "font-size": 12, "text-anchor": "middle" }, s);
    }
  }

  function select(component) {
    unbind?.();
    graph?.destroy();
    graph = sdk.graphFromPlan(plan, component, { engine });
    const c = plan.components[component];
    // Map common property names to visible styles; others are shown as numbers only.
    const visual = { x: "x", y: "y", scale: "scale", opacity: "opacity", lift: "y", rotate: "rotate" };
    const map = Object.fromEntries(Object.keys(c.properties).map((p) => [p, visual[p] ?? ""]));
    sdk.set(target, { x: 0, y: 0, scale: 1, opacity: 1, rotate: 0 }, engine);
    unbind = graph.bind(target, map);
    graph.on(() => {
      stateChip.textContent = graph.state;
      draw(component);
    });
    stateChip.textContent = graph.state;
    events.replaceChildren(
      ...[...new Set(c.transitions.map((t) => t.event))].map((ev) =>
        h("button", { class: "button secondary", "data-event": ev, onclick: () => graph.send(ev) }, ev),
      ),
    );
    draw(component);
  }

  async function compile(save) {
    if (!core) return;
    const out = core.compile(editor.value);
    renderDiagnostics(out.diagnostics);
    if (!out.ok) return;
    plan = out.plan;
    if (save) project.update("edit MDL", (p) => (p.mdl = editor.value));
    summary.textContent = core.inspect(editor.value, "summary");
    const names = Object.keys(plan.components);
    const keep = names.includes(compSelect.value) ? compSelect.value : names[0];
    compSelect.replaceChildren(...names.map((n) => h("option", { value: n, selected: n === keep }, n)));
    if (keep) select(keep);
  }

  compSelect.addEventListener("change", () => select(compSelect.value));
  timer = setInterval(() => {
    if (graph)
      values.textContent = Object.entries(graph.snapshot())
        .map(([k, v]) => `${k.padEnd(10)} ${v.toFixed(3)}`)
        .join("\n");
  }, 100);
  try {
    core = await wasm();
    coreStatus.textContent = `compiler ${core.version} (WASM)`;
    await compile(false);
  } catch (e) {
    coreStatus.textContent = `compiler unavailable: ${e.message}`;
  }
  return () => {
    clearInterval(timer);
    unbind?.();
    graph?.destroy();
  };
}
