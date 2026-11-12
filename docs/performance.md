# Performance

All numbers below were **measured** on one machine (Intel Xeon @ 2.10 GHz, 4 threads, Linux,
container) and are stored with their environment in `benchmarks/results/`. They describe that
machine only. Headless Chromium has no real display and limited GPU compositing, so its frame
intervals do not represent a user's device. No frame-rate or latency guarantee is made.

## Native core (`npm run bench:native`, release build)

| Scenario | p50 | p95 |
|---|---|---|
| 10 000 analytic spring samples | 126 µs | 148 µs |
| Engine frame, 100 values (25 % retargeted per frame) | 4.9 µs | 5.0 µs |
| Engine frame, 1 000 values | 51 µs | 67 µs |
| Engine frame, 10 000 values | 693 µs | 791 µs |
| 500 motion-graph instances toggled + ticked | 313 µs | 630 µs |
| Particle field fixed step (≈ 20 000 particles, gravity + turbulence) | 738 µs | 857 µs |
| Composition of 2 000 layers, 10 % dirty | 111 µs | 133 µs |
| Compile the example MDL document | 139 µs | 166 µs |

## Web SDK in Chromium (`npm run bench:web`)

Engine work per frame (update + write phases, `performance.now()` inside the page) while
elements are continuously retargeted every 250 ms:

| Scenario | engine p50 | engine p95 | frame interval p95 |
|---|---|---|---|
| 100 elements, transform, frame loop | 0.3 ms | 0.6 ms | 16.7 ms |
| 1 000 elements, transform, frame loop | 2.3 ms | 4.0 ms | 16.7 ms |
| 1 000 elements, `compositor: true` (falls back to frame loop above 32 elements) | 2.4 ms | 4.6 ms | 16.7 ms |
| 1 000 elements, opacity | 1.2 ms | 2.0 ms | 16.8 ms |
| 3 000 elements, transform | 9.9 ms | 15.4 ms | 66.7 ms |

Finding that shaped the design: baking Web Animations keyframes for the compositor path cost
≈ 0.2 ms per element per retarget (≈ 220–280 ms for 1 000 elements in one call, versus ≈ 9–14 ms
on the frame loop). Hence the `compositorMaxElements` limit.

Other measured facts: a single `animate()` on 1 000 new elements costs ≈ 60 ms the first time
(computed-style reads when targets are created); subsequent retargets ≈ 9–14 ms.

## Sizes

| Artifact | Size |
|---|---|
| `@ultra-motion-x/web`, everything, minified (esbuild) | 125 KB (41.7 KB gzip) |
| Only `animate` imported | 60 KB (19.8 KB gzip) — the engine pulls DNA tokens, accessibility, telemetry and power awareness |
| WebAssembly core (optional, lazy) | 708 KB |

## Design measures (what reduces stutter, not a guarantee)

On-demand loop (no frames while idle, verified by tests) · batched reads before writes ·
partial style updates (unchanged values skipped, counted in telemetry) · object reuse and
pooled slots in the native runtime · keyed task de-duplication · decorative work deferred when
the frame budget is exhausted · adaptive fidelity with hysteresis and back-off · compositor
offload for small batches · fixed-step simulation with stall caps.

## Measuring your app

```ts
import { configureEngine } from "@ultra-motion-x/web";
const engine = configureEngine({ telemetry: "detailed" });
// … interact …
console.table(engine.report());          // p50/p95/p99 with provenance (measured / estimated / unavailable)
```

Compare runs: `node benchmarks/compare.mjs <baseline.json> <current.json> [--tolerance 0.15]`.
