# Status and validation matrix

This page states what was verified, how, and what is pending. "Tested" means automated tests
ran and passed in this repository's environment (Linux container, Node 22, Rust 1.97, Chromium
via Playwright). GitHub Actions additionally runs the Rust suite on Windows, macOS and Linux.

| Component | Verification |
|---|---|
| Rust crates (physics, core, graph, compiler, scheduler, telemetry, render, runtime, FFI) | 150 unit tests; `cargo fmt`, `clippy -D warnings` |
| C ABI / C++ wrapper | `sdk/ffi/tests/run.sh` compiles and runs C11 and C++17 programs against the headers |
| WebAssembly build | built in CI; exercised by Node tests (compiler, engine, particles) and in Chromium (Studio MDL lab, example 5) |
| TS ⇄ Rust conformance | springs, easings, decay, inertia agree within 1e-9 |
| Web SDK | 46 Node tests (engine, values, arbitration, graph, timeline, DNA, adaptive, time machine, particles, WASM) + browser behaviour tests (DOM writes, idle loop, continuity, WAAPI hand-off, reduced motion, drag, FLIP, leaks, shaders) |
| Studio | browser tests for every lab, undo/redo, persistence, mobile layout, reduced motion |
| Examples (13) | each page loads without errors in Chromium; targeted interaction tests; scripts 11 and 12 run in Node |
| Visual regression | geometry at 3 viewports; pixel baselines for Chromium 153 on Linux (other browsers/platforms: reported as skipped until baselines are recorded) |
| Integration engine / CLI / MCP | fixture projects (Vite+React, plain HTML, Vue, Next.js, Unity, legacy React): analyze, check, plan, install, doctor/heal, update with auto-rollback, rollback preserving user edits; stdio MCP round-trip |
| Claude Code plugin | `claude plugin validate .` passes |
| React / Vue / Svelte adapters | compiled (tsc); no dedicated runtime tests yet |
| Electron / React Native adapters | unit tests with structural fakes; not executed inside Electron / React Native |
| Angular directives | source only (Angular toolchain not in the workspace) — **pending** |
| .NET (WPF, WinUI), Unity, Godot | C# sources; .NET/Unity/Godot not available — **pending compilation and runtime validation** |
| Qt adapter | C++ wrapper tested; Qt classes not compiled (Qt absent) — **pending** |
| Unreal plugin | sources; Unreal Engine absent — **pending** |
| Flutter | Dart sources; Dart/Flutter SDK absent — **pending** |
| Benchmarks | native and browser baselines recorded on one machine (see performance.md) |

Known gaps relative to the original specification:
- Studio does not offer a multi-file project browser, collaborative storage or a desktop
  installer; graphs are edited as MDL text (the visual graph is read-only).
- No machine-learning modules ship; the intelligence layer is statistical (tempo,
  cancellation rate) behind a module interface.
- Packages are prepared for publishing (versions, exports, files) but are not published to npm,
  crates.io, NuGet, pub.dev or asset stores.
- A wgpu-based native renderer is not included: native adapters present with each platform's
  own compositor via the `umx-render` IR, which avoids duplicating mature compositors.

History of earlier continuation work: `history-continuation-2026-11-12.md`.
