# Changelog

All notable changes are documented here. The project follows Semantic Versioning; MDL documents
carry their own schema version (`umx/N`) with automatic migrations.

## 1.0.0 — 2026-11-12

Initial release.

- Rust core: analytic springs, decay, inertia, gestures, coupled springs, deterministic worlds and
  particle fields; easing, colour, keyframes, generators, timelines, playback, property
  arbitration, Motion DNA; motion graph; MDL compiler with migrations (umx/0 → umx/1); frame
  scheduler, refresh estimation, adaptive fidelity, power policy; telemetry; composition IR;
  runtime; C ABI (ABI 1), C++ wrapper, WebAssembly.
- Web SDK, effects, DevTools, React/Vue/Svelte/Angular adapters, Electron and React Native
  helpers, .NET/Unity/Godot/Qt/Unreal/Flutter adapters (see docs/status.md for validation).
- Integration engine, CLI, MCP server, Claude Code plugin, Studio with authoring labs,
  13 examples, browser and native benchmarks, browser/visual regression tests.
- Fixed: queued animations are no longer promoted after stop/destroy; no redundant frame is
  requested when the last animation completes; compositor offload bounded for large batches.
