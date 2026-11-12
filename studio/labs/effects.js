// Effects lab: shader materials (WebGL2) with CSS fallbacks, intensity and fidelity control.
import { h, panel, range, select } from "./ui.js";

export async function mount(host, { engine }) {
  let fx;
  try {
    fx = await import("/rendering/web/dist/index.js");
  } catch (e) {
    host.append(panel("Effects unavailable", `Build @ultra-motion-x/effects first (${e.message}).`));
    return () => undefined;
  }
  const caps = fx.detectCapabilities();
  const card = h(
    "div",
    { class: "fx-card", tabindex: 0 },
    h("b", {}, "Ultra Motion X"),
    h("small", {}, "Move the pointer · click for ripples"),
  );
  const stage = h("div", { class: "fx-stage" }, card);
  const info = h("pre", { class: "values" });
  let surface = null;
  let material = "glass";
  let intensity = 0.8;
  let backend = "webgl2";
  const colors = ["#ffffff", "#7dd3fc", "#a78bfa", "#ff8748"];
  function rebuild() {
    surface?.destroy();
    surface = fx.surface(card, { engine, material, intensity, colors, backend });
    report();
  }
  function report() {
    info.textContent = `backend        ${surface?.backend}\nWebGL2         ${caps.webgl2}\nWebGPU exposed ${caps.webgpu}\nbackdrop-filter ${caps.backdropFilter}\nfidelity level ${engine.fidelity.level}\ncontexts used  ${fx.contextsInUse()} / ${fx.MAX_CONTEXTS}\nframes drawn   ${surface?.renders ?? 0}`;
  }
  const mat = select(
    "Material",
    [...fx.MATERIALS],
    material,
    (m) => {
      material = m;
      rebuild();
    },
    "fx-material",
  );
  const be = select("Backend", ["webgl2", "css"], backend, (b) => {
    backend = b;
    rebuild();
  });
  const fid = select("Fidelity override", ["auto", "0", "1", "2", "3", "4"], "auto", (v) => {
    engine.setFidelity(v === "auto" ? null : Number(v));
    rebuild();
  });
  const inten = range("Intensity", {
    min: 0,
    max: 1,
    step: 0.05,
    value: intensity,
    onInput: (v) => {
      intensity = v;
      surface?.setIntensity(v);
    },
  });
  host.append(
    h(
      "div",
      { class: "lab-grid" },
      panel(
        "Shader materials",
        "GPU only where CSS cannot do it: backdrop blur stays a CSS compositor effect. Surfaces draw on demand and stop when idle.",
        stage,
      ),
      panel("Material", "", mat.el, be.el, fid.el, inten.el, info),
    ),
  );
  rebuild();
  const t = setInterval(report, 500);
  return () => {
    clearInterval(t);
    surface?.destroy();
    engine.setFidelity(null);
  };
}
