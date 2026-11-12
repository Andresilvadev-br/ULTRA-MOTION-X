# Compatibility

| Area | Supported | Notes |
|---|---|---|
| Browsers | Evergreen Chromium, Firefox, Safari with ES2022 + Pointer Events | Tested automatically on Chromium only. WAAPI path needs `Element.animate`; `linear()` easing is not required (keyframes are baked). View Transitions used only when available. |
| WebGL2 / WebGPU | WebGL2 materials; WebGPU experimental | Missing APIs → CSS fallbacks. |
| Node (tools) | ≥ 22.18 (24 in CI) | Tests run TypeScript sources with type stripping. |
| Frameworks | React ≥ 16.8, Vue ≥ 3, Svelte ≥ 3, Angular ≥ 15, Next ≥ 13, Nuxt ≥ 3, plain HTML | Older versions are rejected by `umx check`. |
| SSR | Next, Nuxt, SvelteKit, Remix, Astro | Bootstrap runs only in the browser. |
| Native | Any host that can call a C ABI | Rust 1.97 toolchain; Windows/macOS/Linux built in CI (`cargo test`). Mobile targets need the respective Rust targets. |
| Refresh rates | 24–480 Hz detected; VRR flagged | Motion is time-based; detection only informs telemetry and fidelity. |

Known limitations:
- Transform components are owned by Ultra Motion X once an element is animated; pre-existing CSS
  transforms are composed after them (not decomposed).
- Units are not converted automatically except from 0 (`"0px" → "50%"`); other mixed-unit
  animations jump to 0 of the target unit and emit a warning.
- Path morphing between incompatible SVG paths resamples to polygons (curves become segments).
