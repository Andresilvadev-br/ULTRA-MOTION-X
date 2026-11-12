# Rendering, composition and shaders

## Web rendering path

1. MotionValues are updated in the engine's *update* phase.
2. Each element's `ElementTarget` composes transforms (`perspective · translate3d · rotateX ·
   rotateY · rotate · skew · scale`) and filters, then writes **only properties whose
   serialised value changed** in the batched *write* phase (reads happen before writes).
3. `will-change` is applied only while animating (bounded to 64 elements) and removed afterwards.
4. Compositor path: opacity (default `compositor: "auto"`) or full transforms (`"always"` /
   `compositor: true`) are baked into Web Animations so the browser compositor keeps them smooth
   while the main thread is busy. Interrupting hands control back to the frame loop with the
   analytic position and velocity. Batches above `compositorMaxElements` (32) stay on the frame
   loop because baking costs main-thread time (measured, see performance.md).

## Native composition IR (`umx-render`)

A layer tree with generational ids, 2.5D transforms (perspective, rotateX/Y/Z, skew, scale,
origin), clip rects, corner radii and effects. `Composer::compose` recomputes only dirty
subtrees, accumulates damage rectangles (old ∪ new bounds, including effect outsets), culls
invisible/off-screen layers and scales effects by the fidelity settings, producing a
`DrawList` that a platform presents with its own compositor. `ResourceCache` is an LRU with a
byte budget for GPU resources.

## Shader effects (`@ultra-motion-x/effects`)

Materials: `glass`, `ripple`, `gradient`, `lighting`, `noise`, `refraction` (GLSL ES 3.00 in
`rendering/shaders`, embedded by `scripts/gen-shaders.mjs`; a WGSL gradient for the experimental
WebGPU path).

- **GPU only where it adds value.** Backdrop blur is CSS `backdrop-filter` (compositor);
  shaders add sheen, ripples, gradients, light, grain and lens effects.
- **On demand.** Surfaces render when inputs change; time-based materials render while visible
  (IntersectionObserver) and stop when idle; reduced motion freezes time.
- **Bounded.** At most `MAX_CONTEXTS` (8) WebGL contexts; beyond that, and when WebGL2 is
  missing, shader compilation fails, the context is lost, or the fidelity level disables
  shaders, a CSS fallback renders an approximation.
- **Fidelity.** Effect resolution follows `effectResolution`, blur follows `blur`, decorative
  layers are capped per level.

```ts
import { surface } from "@ultra-motion-x/effects";
const s = surface(card, { material: "glass", intensity: 0.7, colors: ["#fff", "#7dd3fc"] });
s.backend; // "webgl2" | "css"
s.destroy();
```

## Particles

`ParticleSystem` (Canvas 2D renderer, decorative priority) with a CPU backend or the Rust
`ParticleField` through WASM (`wasmParticleBackend`). Hard capacity caps, fidelity-scaled
emission, completely inactive when nothing is alive, disabled under reduced motion.
