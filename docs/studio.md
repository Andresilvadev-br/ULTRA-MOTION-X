# Ultra Motion X Studio

`npm run studio` → http://127.0.0.1:4173 (loopback only; serves Studio assets and compiled
packages, nothing else). Studio uses the real compiled SDK — no substitute physics.

| Lab | What it does |
|---|---|
| Spring Physics | stiffness / damping / mass / travel, analytic response graph, natural frequency, ζ, settle time |
| Component Motion | press, card and notification demos with rapid interruption |
| Motion DNA | the nine profiles and their spring response |
| Timeline | keyframe tracks (x, y, scale, opacity, rotate, blur), click to add, drag to retime, inspector, exact scrubbing, frame stepping (±1 frame at 60 Hz), speed, loop, export as MDL timeline |
| Curve Editor | draggable cubic-Bézier handles, numeric entry, presets, CSS output, live preview |
| Motion Graph · MDL | edit MDL, compile with the Rust compiler (WASM), diagnostics with paths, state-machine view, event buttons, live values, plan summary, export |
| Gestures & Inertia | drag with momentum, rubber banding and snap points; gesture recognition pad (tap, double tap, long press, swipe, pinch, wheel) |
| Shader Effects | every material, WebGL2/CSS backend switch, intensity, fidelity override, context usage |
| Compare | two springs side by side (preview + curves + overshoot) and a 60 Hz vs 240 Hz determinism replay |
| Diagnostics · Time Machine | live telemetry with provenance, active animations, record → scrub frame by frame → anomaly detection → export recording |

Project: one JSON document shared by all labs, saved in this browser's `localStorage`, with
undo/redo (buttons or Ctrl/Cmd+Z, Shift for redo), **Import** (Studio project or an MDL
`*.umx.json`) and **Export**.

Limitations: no multi-file project browser, no collaborative storage, no desktop installer; the
graph view is read-only (edit the MDL text to change graphs).
