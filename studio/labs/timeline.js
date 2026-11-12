// Timeline editor: keyframe tracks, scrubbing, frame stepping, speed, loop, MDL export.
import { download } from "../project.js";
import { h, panel } from "./ui.js";

const PROPS = ["x", "y", "scale", "opacity", "rotate", "blur"];
const DEFAULTS = { x: 0, y: 0, scale: 1, opacity: 1, rotate: 0, blur: 0 };

export function mount(host, { sdk, engine, project }) {
  const { Timeline, set } = sdk;
  let tl = null;
  let selected = null; // { track, key }
  let rate = 1;
  let loop = false;
  const box = h("div", { class: "lab-box tl-box" }, "UMX");
  const stage = h("div", { class: "lab-stage" }, box);
  const tracksEl = h("div", { class: "tl-tracks" });
  const playhead = h("div", { class: "tl-playhead" });
  const ruler = h("div", { class: "tl-ruler" });
  const scrub = h("input", {
    type: "range",
    min: 0,
    max: 1200,
    step: 1,
    value: 0,
    class: "tl-scrub",
    "aria-label": "Scrub timeline",
  });
  const time = h("output", { class: "tl-time" }, "0 ms");
  const inspector = h("div", { class: "tl-inspector" });
  const addSelect = h("select", { "aria-label": "Track property" }, ...PROPS.map((p) => h("option", { value: p }, p)));
  const status = h("span", { class: "chip" }, "paused");

  const doc = () => project.state.timeline;
  function build() {
    tl?.pause();
    const segments = [];
    for (const track of doc().tracks) {
      const keys = [...track.keys].sort((a, b) => a.t - b.t);
      for (let i = 0; i + 1 < keys.length; i++) {
        const a = keys[i];
        const b = keys[i + 1];
        if (b.t <= a.t) continue;
        segments.push([
          box,
          { [track.prop]: [a.v, b.v] },
          { type: "tween", duration: b.t - a.t, ease: project.state.curve, at: a.t },
        ]);
      }
    }
    for (const p of PROPS) set(box, { [p]: DEFAULTS[p] }, engine);
    tl = new Timeline(segments, {
      engine,
      autoplay: false,
      onUpdate: (ms) => showTime(ms),
      onComplete: () => {
        status.textContent = "finished";
        if (loop) {
          tl.seek(0);
          tl.play();
          status.textContent = "playing";
        }
      },
    });
    tl.rate = rate;
    scrub.max = String(doc().duration);
    tl.seek(Number(scrub.value));
  }
  function showTime(ms) {
    time.textContent = `${Math.round(ms)} ms`;
    if (document.activeElement !== scrub) scrub.value = String(Math.round(ms));
    playhead.style.left = `${(ms / doc().duration) * 100}%`;
  }
  function renderTracks() {
    tracksEl.replaceChildren();
    ruler.replaceChildren(
      ...Array.from({ length: 7 }, (_, i) =>
        h("span", { style: { left: `${(i / 6) * 100}%` } }, `${Math.round((doc().duration * i) / 6)}`),
      ),
    );
    doc().tracks.forEach((track, ti) => {
      const lane = h("div", { class: "tl-lane", "data-track": track.prop, title: "Click to add a keyframe" });
      for (const [ki, key] of track.keys.entries()) {
        const dot = h("button", {
          class: `tl-key${selected?.track === ti && selected?.key === ki ? " selected" : ""}`,
          style: { left: `${(key.t / doc().duration) * 100}%` },
          "aria-label": `${track.prop} keyframe at ${key.t} ms = ${key.v}`,
        });
        dot.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          selected = { track: ti, key: ki };
          dot.setPointerCapture(e.pointerId);
          const laneRect = lane.getBoundingClientRect();
          const move = (ev) => {
            const t = Math.round(
              Math.min(1, Math.max(0, (ev.clientX - laneRect.left) / laneRect.width)) * doc().duration,
            );
            dot.style.left = `${(t / doc().duration) * 100}%`;
            dot.dataset.t = String(t);
          };
          const up = () => {
            dot.removeEventListener("pointermove", move);
            if (dot.dataset.t)
              project.update("move keyframe", (p) => {
                p.timeline.tracks[ti].keys[ki].t = Number(dot.dataset.t);
              });
            else refresh();
          };
          dot.addEventListener("pointermove", move);
          dot.addEventListener("pointerup", up, { once: true });
        });
        lane.append(dot);
      }
      lane.addEventListener("pointerdown", (e) => {
        const r = lane.getBoundingClientRect();
        const t = Math.round(((e.clientX - r.left) / r.width) * doc().duration);
        tl?.seek(t);
        const current = engine && sdk.motionValueOf(box, track.prop, engine).get();
        project.update(`add ${track.prop} keyframe`, (p) => {
          p.timeline.tracks[ti].keys.push({ t, v: Math.round(current * 100) / 100 });
        });
        selected = { track: ti, key: doc().tracks[ti].keys.length - 1 };
        refresh();
      });
      tracksEl.append(
        h(
          "div",
          { class: "tl-row" },
          h(
            "span",
            { class: "tl-label" },
            track.prop,
            h(
              "button",
              {
                class: "icon",
                "aria-label": `Remove ${track.prop} track`,
                onclick: () => project.update(`remove ${track.prop} track`, (p) => p.timeline.tracks.splice(ti, 1)),
              },
              "×",
            ),
          ),
          lane,
        ),
      );
    });
    tracksEl.append(playhead);
    renderInspector();
  }
  function renderInspector() {
    const s = selected && doc().tracks[selected.track]?.keys[selected.key];
    if (!s) {
      inspector.replaceChildren(h("small", {}, "Select a keyframe to edit it. Click an empty lane to add one."));
      return;
    }
    const prop = doc().tracks[selected.track].prop;
    const tIn = h("input", {
      type: "number",
      value: s.t,
      min: 0,
      step: 1,
      "aria-label": "Keyframe time (ms)",
      class: "num",
    });
    const vIn = h("input", { type: "number", value: s.v, step: "any", "aria-label": "Keyframe value", class: "num" });
    const apply = () =>
      project.update(`edit ${prop} keyframe`, (p) => {
        const k = p.timeline.tracks[selected.track].keys[selected.key];
        k.t = Math.max(0, Number(tIn.value));
        k.v = Number(vIn.value);
      });
    tIn.addEventListener("change", apply);
    vIn.addEventListener("change", apply);
    inspector.replaceChildren(
      h("b", {}, `${prop} keyframe`),
      h("label", { class: "form-field" }, h("span", {}, "Time (ms)"), tIn),
      h("label", { class: "form-field" }, h("span", {}, "Value"), vIn),
      h(
        "button",
        {
          class: "button secondary",
          onclick: () => {
            const sel = selected;
            selected = null;
            project.update(`delete ${prop} keyframe`, (p) => p.timeline.tracks[sel.track].keys.splice(sel.key, 1));
          },
        },
        "Delete keyframe",
      ),
    );
  }
  function refresh() {
    build();
    renderTracks();
  }
  const durationIn = h("input", {
    type: "number",
    min: 100,
    max: 20000,
    step: 50,
    value: doc().duration,
    class: "num",
    "aria-label": "Duration (ms)",
  });
  durationIn.addEventListener("change", () =>
    project.update("timeline duration", (p) => (p.timeline.duration = Math.max(100, Number(durationIn.value)))),
  );
  scrub.addEventListener("input", () => {
    tl.pause();
    status.textContent = "paused";
    tl.seek(Number(scrub.value));
  });
  const controls = h(
    "div",
    { class: "demo-row tl-controls" },
    h(
      "button",
      {
        class: "button primary",
        id: "tl-play",
        onclick: () => {
          if (tl.isPlaying) {
            tl.pause();
            status.textContent = "paused";
          } else {
            if (tl.currentTime >= doc().duration) tl.seek(0);
            tl.play();
            status.textContent = "playing";
          }
        },
      },
      "▶ / ❚❚",
    ),
    h("button", { class: "button secondary", "aria-label": "Previous frame", onclick: () => tl.step(-1) }, "◀ 1f"),
    h("button", { class: "button secondary", "aria-label": "Next frame", onclick: () => tl.step(1) }, "1f ▶"),
    h(
      "label",
      { class: "inline" },
      "Speed ",
      h(
        "select",
        {
          onchange: (e) => {
            rate = Number(e.target.value);
            tl.rate = rate;
          },
        },
        ...["0.25", "0.5", "1", "2"].map((v) => h("option", { value: v, selected: v === "1" }, `${v}×`)),
      ),
    ),
    h(
      "label",
      { class: "inline" },
      h("input", { type: "checkbox", onchange: (e) => (loop = e.target.checked) }),
      " Loop",
    ),
    h("label", { class: "inline" }, "Duration ", durationIn),
    status,
  );
  const exportMdl = () => {
    const tracks = [];
    for (const track of doc().tracks) {
      const keys = [...track.keys].sort((a, b) => a.t - b.t);
      for (let i = 0; i + 1 < keys.length; i++)
        tracks.push({
          target: `box.${track.prop}`,
          from: keys[i].v,
          to: keys[i + 1].v,
          at: keys[i].t,
          transition: { type: "tween", duration: keys[i + 1].t - keys[i].t, easing: project.state.curve },
        });
    }
    const properties = Object.fromEntries(doc().tracks.map((t) => [t.prop, { initial: DEFAULTS[t.prop] ?? 0 }]));
    const mdl = {
      version: "umx/1",
      name: "studio-timeline",
      components: { box: { properties, states: { rest: {} }, initial: "rest" } },
      timelines: { main: { tracks } },
    };
    download("timeline.umx.json", JSON.stringify(mdl, null, 2));
  };
  host.append(
    h(
      "div",
      { class: "lab-grid wide" },
      panel(
        "Timeline",
        "Keyframes per property. Easing between keys uses the curve from the Curve lab. Sampling is exact, so scrubbing and frame stepping are deterministic.",
        stage,
        controls,
        h("div", { class: "tl-scrub-row" }, scrub, time),
        ruler,
        tracksEl,
        h(
          "div",
          { class: "demo-row" },
          addSelect,
          h(
            "button",
            {
              class: "button secondary",
              onclick: () => {
                const prop = addSelect.value;
                if (doc().tracks.some((t) => t.prop === prop)) return;
                project.update(`add ${prop} track`, (p) =>
                  p.timeline.tracks.push({ prop, keys: [{ t: 0, v: DEFAULTS[prop] }] }),
                );
              },
            },
            "+ Track",
          ),
          h("button", { class: "button secondary", onclick: exportMdl }, "Export as MDL timeline"),
        ),
      ),
      panel("Keyframe", "Inspector", inspector),
    ),
  );
  const off = project.on(() => {
    durationIn.value = String(doc().duration);
    refresh();
  });
  refresh();
  return () => {
    off();
    tl?.pause();
  };
}
