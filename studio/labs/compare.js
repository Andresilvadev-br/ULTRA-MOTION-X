// Compare lab: two spring configurations side by side (live preview + response curves), and a
// determinism check replaying the same scripted interruption at 60 Hz and 240 Hz.
import { COLORS, canvas2d, h, panel, range } from "./ui.js";

export function mount(host, { sdk, engine, project }) {
  const {
    Spring,
    springParams,
    animate,
    set,
    dampingRatio,
    replayScenario,
    compareRecordings,
    MotionValue,
    detectAnomalies,
  } = sdk;
  const cfg = JSON.parse(JSON.stringify(project.state.compare));
  const cv = h("canvas", { class: "compare-canvas", "aria-label": "Spring A and B response curves" });
  const boxA = h("div", { class: "lab-box a" }, "A");
  const boxB = h("div", { class: "lab-box b" }, "B");
  const lanes = h(
    "div",
    { class: "compare-lanes" },
    h("div", { class: "lab-track" }, boxA),
    h("div", { class: "lab-track" }, boxB),
  );
  const stats = h("pre", { class: "values" });
  const determinism = h(
    "pre",
    { class: "values", id: "determinism" },
    "Run the check to replay a scripted interruption at two refresh rates.",
  );
  const sliders = (key, label) =>
    h(
      "div",
      { class: "compare-col" },
      h("b", {}, label),
      ...["stiffness", "damping", "mass"].map(
        (p) =>
          range(p, {
            min: p === "mass" ? 0.2 : 1,
            max: p === "stiffness" ? 900 : p === "damping" ? 110 : 5,
            step: p === "mass" ? 0.1 : 1,
            value: cfg[key][p],
            onInput: (v) => {
              cfg[key][p] = v;
              draw();
            },
          }).el,
      ),
    );
  function draw() {
    const { ctx, w, h: H } = canvas2d(cv);
    ctx.clearRect(0, 0, w, H);
    const springs = ["a", "b"].map((k) => new Spring(springParams(cfg[k]), 0, 1));
    const dur = Math.min(4, Math.max(...springs.map((s) => s.finishTime), 0.3));
    const y = (v) => H - 14 - ((v + 0.2) / 1.6) * (H - 28);
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(0, y(1));
    ctx.lineTo(w, y(1));
    ctx.stroke();
    springs.forEach((s, i) => {
      ctx.strokeStyle = i ? COLORS.blue : COLORS.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k <= 200; k++) {
        const v = s.sample((dur * k) / 200).value;
        k ? ctx.lineTo((w * k) / 200, y(v)) : ctx.moveTo(0, y(v));
      }
      ctx.stroke();
    });
    stats.textContent = springs
      .map(
        (s, i) =>
          `${"AB"[i]}: ζ=${dampingRatio(s.params).toFixed(3)}  settle=${Math.round(s.finishTime * 1000)} ms  overshoot=${((Math.max(...Array.from({ length: 200 }, (_, k) => s.sample((s.finishTime * k) / 200).value)) - 1) * 100).toFixed(1)}%`,
      )
      .join("\n");
  }
  let flip = false;
  function play() {
    flip = !flip;
    for (const [box, key] of [
      [boxA, "a"],
      [boxB, "b"],
    ]) {
      const dist = Math.max(0, box.parentElement.clientWidth - 72);
      animate(box, { x: flip ? dist : 0 }, { engine, spring: springParams(cfg[key]) });
    }
  }
  function check() {
    const run = (hz) => {
      let v;
      const spec = { type: "spring", spring: springParams(cfg.a) };
      return replayScenario(
        (e) => [(v = new MotionValue(0, e, { name: "x" }))],
        [
          { at: 0, run: () => v.animate(300, spec) },
          { at: 150, run: () => v.animate(-100, spec) },
          { at: 320, run: () => v.animate(200, spec) },
        ],
        { hz, durationMs: 2000 },
      );
    };
    const a = run(60);
    const b = run(240);
    const diff = compareRecordings(a, b).x;
    const anomalies = [...detectAnomalies(a), ...detectAnomalies(b)];
    determinism.textContent = `60 Hz frames: ${a.frames.length}   240 Hz frames: ${b.frames.length}\nfinal value 60 Hz:  ${a.frames.at(-1).values.x[0]}\nfinal value 240 Hz: ${b.frames.at(-1).values.x[0]}\nmax |Δ| at matching times: ${diff.maxDiff.toFixed(4)} (differences come from sampling instants, not the physics)\nanomalies (jumps / NaN / conflicts): ${anomalies.length}`;
  }
  host.append(
    h(
      "div",
      { class: "lab-grid" },
      panel(
        "Compare springs",
        "Same travel, two configurations.",
        lanes,
        h(
          "div",
          { class: "demo-row" },
          h("button", { class: "button primary", onclick: play }, "▶ Play both"),
          h(
            "button",
            {
              class: "button secondary",
              onclick: () => project.update("save comparison", (p) => (p.compare = JSON.parse(JSON.stringify(cfg)))),
            },
            "Save to project",
          ),
        ),
        cv,
        stats,
      ),
      panel(
        "Parameters",
        "Orange = A, blue = B",
        h("div", { class: "compare-cols" }, sliders("a", "Spring A"), sliders("b", "Spring B")),
        h("div", { class: "separator" }),
        h("b", {}, "Refresh-rate determinism"),
        h("button", { class: "button secondary", id: "determinism-run", onclick: check }, "Replay at 60 Hz and 240 Hz"),
        determinism,
      ),
    ),
  );
  for (const b of [boxA, boxB]) set(b, { x: 0 }, engine);
  const ro = new ResizeObserver(draw);
  ro.observe(cv);
  draw();
  return () => ro.disconnect();
}
