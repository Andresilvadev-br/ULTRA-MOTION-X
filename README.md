# Ultra Motion X

Universal motion, physics, rendering and interaction engine. A shared **Rust core**
(analytic springs, inertia, motion graphs, the Motion Design Language compiler, frame
scheduling, adaptive fidelity, telemetry; exposed through a C ABI and WebAssembly) and a
framework-independent **TypeScript Web SDK**, plus integration tooling that lets you — or
Claude Code — add the engine to an existing project, verify it, update it and roll it back.

It adapts to the host application: no React requirement, no change of architecture, and it
never touches your colours, fonts or layout rules.

```ts
import { animate, press, drag, layoutTransition } from "@ultra-motion-x/web";

animate(".card", { y: [12, 0], opacity: [0, 1] }, { stagger: 40, spring: "snappy" });
press(document.querySelector("#save"));                 // feedback on pointer-down
drag(sheet, { axis: "y", snapY: [0, 320, 640] });        // momentum, rubber band, snap
await layoutTransition(list, () => list.prepend(item));  // FLIP, velocity preserved
```

## Install the Claude Code plugin

This repository is a Claude Code plugin marketplace. In Claude Code:

```
/plugin marketplace add andresilvadev-br/ultra-motion-x
/plugin install ultra-motion-x@ultra-motion-x
```

Then open any compatible project and run `/ultra-motion-x:ultra-motion-x` (full integration)
or `/ultra-motion-x:analyze`, `:plan`, `:doctor`, `:tune`, `:update`, `:rollback`, `:studio`,
`:bench`, `:validate`. The plugin ships a skill, an integration agent and an MCP server
(`umx_*` tools). On first use it installs and builds this checkout (`npm ci && npm run build`).
Details: [docs/claude-code.md](docs/claude-code.md).

## Quick start (manual)

Requires Node.js **22.18+** (24 recommended). Rust is only needed to rebuild the native core;
the WebAssembly binary is checked in.

```sh
npm ci
npm run build
npm run studio      # http://127.0.0.1:4173 — Studio
npm run examples    # http://127.0.0.1:4174 — 13 examples
```

Integrate into a project with the CLI:

```sh
node cli/bin/umx.mjs analyze ../my-app
node cli/bin/umx.mjs plan ../my-app            # exact diff, writes nothing
node cli/bin/umx.mjs install ../my-app --yes   # reversible transaction
node cli/bin/umx.mjs rollback ../my-app --yes  # keeps your later edits
```

## What is in the repository

| Area | Path | Status |
|---|---|---|
| Physics, core, motion graph, compiler (MDL), scheduler, telemetry, runtime | `engine/*` (Rust) | 150 tests |
| Composition / render IR (layer tree, damage, fidelity-scaled effects) | `rendering/composition` (Rust) | tested |
| C ABI + C++ wrapper + WebAssembly | `sdk/ffi` | C and C++ conformance programs |
| Web SDK (DOM, gestures, layout, morphing, timelines, graphs, DNA, a11y, particles, time machine) | `sdk/typescript` | unit + browser tests; TS⇄Rust conformance at 1e-9 |
| Shader effects (WebGL2, WebGPU experimental, CSS fallbacks) | `rendering/web`, `rendering/shaders` | compiled in Chromium tests |
| DevTools overlay & inspector | `devtools` | tested |
| Integration engine, CLI, MCP server, Claude Code plugin | `integration`, `cli`, `ai/*`, `.claude-plugin` | fixture-project tests |
| Studio (timeline, curves, MDL graphs, gestures, compare, effects, diagnostics) | `studio` | browser tests |
| Examples (13) and benchmarks | `examples`, `benchmarks` | browser tests / recorded baselines |
| Adapters: React, Vue, Svelte, Angular, Electron, React Native, Flutter, .NET (WPF/WinUI), Unity, Godot, Qt, Unreal | `sdk/framework-adapters`, `platforms` | see [validation matrix](docs/status.md) |

Some native adapters (Flutter, .NET, Unity, Godot, Qt classes, Unreal, Angular) are source
implementations that could not be compiled in this repository's environment; they are listed
as **pending validation** in [docs/status.md](docs/status.md).

## Documentation

- [Architecture](docs/architecture.md) · [Installation](docs/installation.md) · [Quick start](docs/quickstart.md)
- API: [Web SDK](docs/api/web.md) · [C ABI](docs/api/ffi.md) · [Motion Design Language](docs/mdl.md)
- Guides: [Integration](docs/integration.md) · [Physics](docs/physics.md) · [Rendering & shaders](docs/rendering.md) · [Adapters](docs/adapters.md) · [Customization / Motion DNA](docs/customization.md) · [Accessibility](docs/accessibility.md)
- Tools: [Studio](docs/studio.md) · [DevTools](docs/devtools.md) · [CLI](docs/cli.md) · [Claude Code](docs/claude-code.md)
- [Performance](docs/performance.md) · [Compatibility](docs/compatibility.md) · [Troubleshooting](docs/troubleshooting.md) · [Status & validation](docs/status.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · License: MIT OR Apache-2.0

## Validation

```sh
npm run build && npm run lint && npm test          # Node unit + integration tests
npx playwright install --with-deps chromium        # or set UMX_CHROMIUM_PATH
npm run test:browser                               # Studio, examples, SDK behaviour, visual regression
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
bash sdk/ffi/tests/run.sh                          # C / C++ ABI conformance
```

Measurements in this repository describe the machines they were recorded on; no frame-rate
or latency guarantees are made. See [docs/performance.md](docs/performance.md).
