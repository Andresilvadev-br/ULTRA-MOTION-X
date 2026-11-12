# DevTools

```ts
import { attachDevTools } from "@ultra-motion-x/devtools";
if (import.meta.env.DEV) attachDevTools({ open: true });   // Alt+Shift+M toggles
```

The overlay (shadow DOM, no style leakage) shows refresh rate, estimated FPS, frame interval
p50/p95, engine work p95, dropped frames (estimated), input→frame latency, fidelity level,
profile, reduced-motion state, values/active animations, JS heap (Chromium only, labelled),
a frame-interval histogram, active animations (value, spec, priority, current → target,
velocity), counters (writes, skipped redundant writes, interruptions, rejections) and warnings
(e.g. elements skipped because CSS already transitions them). Controls: fidelity override,
global time scale (0.1×–1× slow motion), reduced-motion toggle.

It polls at 4 Hz only while visible and never keeps the engine loop alive; `detach()` removes
every listener. `Inspector` is the headless part (used by Studio and tests). Do not ship it in
production builds; it is a separate package so bundlers drop it.
