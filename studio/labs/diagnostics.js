// Diagnostics lab: live engine telemetry (with provenance), active animations, and the Motion
// Time Machine (record → scrub frame by frame → anomaly detection → export).
import { download } from "../project.js";
import { h, panel } from "./ui.js";

export async function mount(host, { sdk, engine }) {
  const { Inspector } = await import("/devtools/dist/index.js").catch(() => ({ Inspector: null }));
  const inspector = Inspector ? new Inspector(engine) : null;
  const stats = h("pre", { class: "values", id: "diag-stats" });
  const active = h("pre", { class: "values" });
  const target = h("div", { class: "lab-box" }, "REC");
  const stage = h("div", { class: "lab-stage" }, target);
  const scrub = h("input", {
    type: "range",
    min: 0,
    max: 0,
    value: 0,
    disabled: true,
    class: "tl-scrub",
    "aria-label": "Recorded frame",
  });
  const frameInfo = h("pre", { class: "values" }, "Record a session, then scrub through it frame by frame.");
  let recorder = null;
  let recording = null;
  let player = null;
  const xs = [-140, 140, -40, 100, 0];
  let step = 0;
  const poke = () =>
    sdk.animate(target, { x: xs[step++ % xs.length], rotate: (step % 3) * 30 }, { engine, spring: "bouncy" });
  function fmt(m) {
    return m.provenance === "unavailable" ? "unavailable" : `${m.value.toFixed(1)} (${m.provenance})`;
  }
  function update() {
    const r = engine.report();
    stats.textContent = [
      `refresh       ${fmt(r.refreshHz)} Hz`,
      `fps           ${fmt(r.estimatedFps)}`,
      `interval p50  ${r.frameInterval.p50.toFixed(2)} ms   p95 ${r.frameInterval.p95.toFixed(2)}   p99 ${r.frameInterval.p99.toFixed(2)}`,
      `engine p50    ${r.engineWork.p50.toFixed(3)} ms   p95 ${r.engineWork.p95.toFixed(3)}`,
      `dropped       ${fmt(r.droppedFrames)}`,
      `input→frame   ${r.inputToFrame ? `${r.inputToFrame.p50.toFixed(1)} ms p50` : "no input measured yet"}`,
      `regularity    ${fmt(r.regularity)}`,
      `fidelity      ${r.fidelityLevel}`,
      `values/active ${r.activeValues} / ${r.activeAnimations}`,
      `writes        ${r.counters.writes} (skipped redundant ${r.counters.redundantWritesSkipped})`,
      `interrupted   ${r.counters.animationsInterrupted}   completed ${r.counters.animationsCompleted}`,
      `JS heap       ${r.memory.provenance === "measured" ? `${(r.memory.value / 1048576).toFixed(1)} MB (whole page)` : "unavailable"}`,
    ].join("\n");
    if (inspector) {
      const s = inspector.snapshot();
      active.textContent = s.active.length
        ? s.active
            .map((a) => `${a.value.padEnd(24)} ${a.spec.padEnd(8)} ${a.current.toFixed(1)} → ${a.to.toFixed(1)}`)
            .join("\n")
        : "idle — the engine requests no frames";
    }
  }
  const recBtn = h("button", { class: "button primary", id: "tm-record" }, "● Record");
  recBtn.addEventListener("click", () => {
    if (!recorder) {
      recorder = new sdk.MotionRecorder(engine, { inputs: true, filter: (n) => n.includes("div") });
      recorder.start();
      recBtn.textContent = "■ Stop";
      scrub.disabled = true;
      return;
    }
    recording = recorder.stop({ source: "studio" });
    recorder = null;
    recBtn.textContent = "● Record";
    player = new sdk.MotionPlayer(recording);
    scrub.max = String(Math.max(0, recording.frames.length - 1));
    scrub.disabled = recording.frames.length === 0;
    const anomalies = sdk.detectAnomalies(recording);
    frameInfo.textContent = `${recording.frames.length} frames, ${recording.events.length} events, anomalies: ${anomalies.length}${
      anomalies.length
        ? `\n${anomalies
            .slice(0, 5)
            .map((a) => `${a.kind} ${a.value} @${a.t.toFixed(3)}s ${a.detail}`)
            .join("\n")}`
        : ""
    }`;
  });
  scrub.addEventListener("input", () => {
    const f = player?.seek(Number(scrub.value));
    if (f)
      frameInfo.textContent = `frame ${scrub.value}  t=${f.t.toFixed(4)}s  dt=${(f.dt * 1000).toFixed(2)}ms\n${Object.entries(
        f.values,
      )
        .map(([k, [v, vel]]) => `${k.padEnd(14)} ${v.toFixed(3)}  v=${vel.toFixed(1)}`)
        .join("\n")}`;
  });
  host.append(
    h(
      "div",
      { class: "lab-grid" },
      panel(
        "Frame telemetry",
        "Every number shows whether it is measured or estimated. Idle periods are excluded (the loop stops).",
        stats,
        h("b", {}, "Active animations"),
        active,
      ),
      panel(
        "Motion Time Machine",
        "Records values, velocities and animation events (no page content).",
        stage,
        h(
          "div",
          { class: "demo-row" },
          recBtn,
          h("button", { class: "button secondary", id: "tm-animate", onclick: poke }, "Animate"),
          h(
            "button",
            {
              class: "button secondary",
              onclick: () => recording && download("recording.json", JSON.stringify(recording, null, 2)),
            },
            "Export recording",
          ),
        ),
        scrub,
        frameInfo,
      ),
    ),
  );
  const t = setInterval(update, 250);
  update();
  return () => {
    clearInterval(t);
    recorder?.stop();
    inspector?.destroy();
  };
}
