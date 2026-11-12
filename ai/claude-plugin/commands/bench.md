---
description: Run Ultra Motion X benchmarks (native core and/or browser) and report the measured results with environment details.
argument-hint: "[--native|--web] [--quick]"
---

Run `umx bench $ARGUMENTS` from the Ultra Motion X checkout (path via `umx_environment`). Report p50/p95 per scenario together with the environment block (CPU, OS, profile, browser). Compare against `benchmarks/results/baseline-*.json` with `node benchmarks/compare.mjs <baseline> <new>` when a baseline exists. Never extrapolate numbers to other hardware.
