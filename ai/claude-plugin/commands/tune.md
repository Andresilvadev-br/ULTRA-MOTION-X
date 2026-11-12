---
description: Tune Ultra Motion X for this project — profile, fidelity bounds, compositor usage — based on measurements, not guesses.
argument-hint: "[target profile]"
---

1. Read `ultra-motion.config.json`. List current profile, fidelity bounds and compositor mode. Show the alternatives with `umx_profiles`.
2. If the app can be run (dev server), measure: add `attachDevTools()` temporarily or use `engine.report()` / `MotionAutotuner` (`@ultra-motion-x/web`) in a scratch script to capture telemetry while exercising the UI. Use the recommendations from `diagnose()` — they are based on measured p95 frame intervals and engine work.
3. Propose changes with their evidence (numbers and provenance: measured vs estimated). Apply only the ones the user accepts by editing `ultra-motion.config.json`, then regenerate the bootstrap (`umx install` keeps existing config; edit the `config` object in the generated `ultra-motion.(ts|js)` to match).
4. If nothing could be measured in this environment, say so explicitly and only suggest profile changes based on the product's tone ($ARGUMENTS).
