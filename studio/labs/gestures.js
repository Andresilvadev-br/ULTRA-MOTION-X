// Gesture lab: drag with momentum, rubber-banding and snap points; gesture recognition pad.
import { h, panel, range } from "./ui.js";

export function mount(host, { sdk, engine }) {
  const card = h(
    "div",
    { class: "lab-box drag-card", tabindex: 0, "aria-label": "Draggable card (arrow keys move it)" },
    "Drag me",
  );
  const area = h("div", { class: "drag-area" }, card);
  const readout = h("pre", { class: "values" }, "release the card to see the fling");
  const pad = h("div", { class: "gesture-pad", tabindex: 0 }, "Tap · double tap · long press · swipe · pinch · wheel");
  const log = h("ol", { class: "gesture-log" });
  const opts = { momentum: true, snap: true, elastic: engine.dna.data.elasticity };
  let ctrl = null;
  const snaps = () => {
    const w = area.clientWidth - card.offsetWidth;
    const hh = area.clientHeight - card.offsetHeight;
    return { x: [0, w / 2, w].map(Math.round), y: [0, hh].map(Math.round) };
  };
  function attach() {
    ctrl?.destroy();
    const s = snaps();
    ctrl = sdk.drag(card, {
      engine,
      bounds: "parent",
      momentum: opts.momentum,
      elastic: opts.elastic,
      snapX: opts.snap ? s.x : undefined,
      snapY: opts.snap ? s.y : undefined,
      onEnd: (i) => {
        readout.textContent = `intent      ${i.intent}\nrelease vx  ${i.vx.toFixed(0)} px/s\nrelease vy  ${i.vy.toFixed(0)} px/s\nprojection  x ${sdk.projectRelease(i.x, i.vx, engine.dna.data.flingTimeConstant).toFixed(0)} px`;
      },
    });
  }
  const elastic = range("Edge elasticity", {
    min: 0,
    max: 1,
    step: 0.05,
    value: opts.elastic,
    onInput: (v) => {
      opts.elastic = v;
      attach();
    },
  });
  const toggles = h(
    "div",
    { class: "demo-row" },
    h(
      "label",
      { class: "inline" },
      h("input", {
        type: "checkbox",
        checked: true,
        onchange: (e) => {
          opts.momentum = e.target.checked;
          attach();
        },
      }),
      " Momentum",
    ),
    h(
      "label",
      { class: "inline" },
      h("input", {
        type: "checkbox",
        checked: true,
        onchange: (e) => {
          opts.snap = e.target.checked;
          attach();
        },
      }),
      " Snap points",
    ),
  );
  const add = (text) => {
    log.prepend(h("li", {}, text));
    while (log.children.length > 8) log.lastChild.remove();
    sdk.animate(log.firstChild, { opacity: [0, 1], x: [-8, 0] }, { engine, spring: "snappy" });
  };
  const offGestures = sdk.gestures(pad, {
    engine,
    onTap: () => add("tap"),
    onDoubleTap: () => add("double tap"),
    onLongPress: () => add("long press"),
    onSwipe: (e) => add(`swipe ${e.direction} (${Math.round(e.velocity)} px/s)`),
    onPinch: (e) => add(`pinch ×${e.scale.toFixed(2)} ${e.rotation.toFixed(0)}°`),
    onWheel: (e) => add(`wheel dy ${Math.round(e.dy)}${e.zoom ? " (zoom)" : ""}`),
    onCancel: () => add("cancelled"),
  });
  host.append(
    h(
      "div",
      { class: "lab-grid" },
      panel(
        "Drag, inertia & snap",
        "The release velocity becomes the initial velocity of the settle animation (gesture → animation continuity). Escape cancels a drag.",
        area,
        toggles,
        elastic.el,
        readout,
      ),
      panel("Gesture recognition", "Intent classification from distance, duration and release speed.", pad, log),
    ),
  );
  requestAnimationFrame(attach);
  return () => {
    ctrl?.destroy();
    offGestures();
  };
}
