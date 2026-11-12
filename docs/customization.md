# Customization and Motion DNA

Motion DNA is the shared motion identity: tokens and named profiles defined once in
`presets/profiles.json` and consumed by the Rust core (embedded at compile time) and the Web SDK
(generated module). Profiles never change colours, fonts or layout.

| Token | Meaning |
|---|---|
| `duration.{instant,fast,normal,slow,page}` | milliseconds, strictly increasing |
| `spring.{snappy,standard,gentle,bouncy}` | `{ response, dampingRatio }` |
| `easing.{standard,enter,exit}` | cubic Bézier |
| `pressScale`, `hoverLift`, `depth`, `stagger`, `parallax` | interaction and spatial amplitudes |
| `intensity`, `elasticity`, `flingTimeConstant`, `distanceScale` | global strength, rubber band, inertia, distance-aware durations |

Profiles: **minimal** (critically damped, no depth), **professional** (default), **cinematic**,
**dynamic**, **fluid**, **sport**, **elegant**, **ultraResponsive** (shortest), **singularity**
(maximal spatial expression). Invariants are tested in Rust and TS (e.g. minimal never
overshoots; ultraResponsive is the fastest).

```ts
import { configureEngine, getEngine, MotionDNA } from "@ultra-motion-x/web";
configureEngine({ profile: "elegant" });
const brand = MotionDNA.custom("professional", { pressScale: 0.96, spring: { standard: { response: 0.3, dampingRatio: 0.85 } } }, "brand");
getEngine().setProfile(brand);
brand.applyCssVariables();          // --umx-duration-fast, --umx-easing-standard, … for plain CSS
const json = JSON.stringify(brand.toJSON());   // share across projects; MotionDNA.fromJSON(json)
```

Per-call overrides always win: `animate(el, { x: 0 }, { stiffness: 500, damping: 30 })`.
Presets (`presets.button`, `presets.modal.open`, `presets.loading`, …) are built from the same
tokens; heavy presets (e.g. loading pulses) are never enabled by default and pause off-screen.

Semantic defaults can be overridden per element with `data-umx="<role>"` or disabled with
`data-umx="off"`.
