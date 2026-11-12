# Ultra Motion X

Framework-independent motion engine with a Rust core and TypeScript Web SDK.
The repository includes physics, motion graphs, scheduling, DOM animation, gestures,
Motion DNA profiles, telemetry, integration tools and platform adapters.

## Run the interactive Studio

Requires Node.js **22.18 or newer** (24 recommended). Rust is not required for
Studio: the Web SDK includes TypeScript physics and a checked-in WASM binary.

```sh
npm ci
npm run build
npm run studio
```

Open **http://127.0.0.1:4173**. `npm run examples` opens the same playground.
Set `UMX_STUDIO_PORT` to change the port. The preview binds only to loopback.

Studio uses the real compiled SDK, without React. It includes:

- Spring preview with stiffness, damping, mass and travel controls.
- Nine Motion DNA profiles and an analytical response graph.
- Button press feedback, animated card and notification.
- Rapid retargeting, reset and parameter export (clipboard or JSON download).
- Responsive layout and the SDK's existing accessibility policy.

The graph is an analytical spring trajectory, not a measurement of rendered frames.
The displayed settling time describes the spring; system accessibility settings may
change the rendered motion. This playground is not yet a full visual graph editor.

## Validation

```sh
npm run build
npm run lint
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

For an existing Chromium installation set `UMX_CHROMIUM_PATH` to its executable.
Build before running integration tests; they install the built SDK in temporary projects.
`npm run test:all` runs unit/integration/server checks followed by browser tests.

Native validation uses the toolchain pinned in `rust-toolchain.toml`:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
npm run build:wasm
```

GitHub Actions runs Web validation and a native Windows/Linux/macOS matrix.
Native adapter validation inside Unity, Unreal, Godot, Qt, WPF and WinUI still
requires the respective host applications; a passing Rust job does not certify them.

## Repository map

| Directory | Purpose |
| --- | --- |
| `engine/` | Rust physics, runtime, graph, compiler, scheduler and telemetry |
| `sdk/typescript/` | Framework-independent Web SDK and WASM bridge |
| `sdk/framework-adapters/` | React, Vue, Svelte and Angular integration sources |
| `rendering/` | Composition, shaders and Web rendering |
| `platforms/` | Native platform adapter sources |
| `integration/`, `cli/`, `ai/` | Project integration, CLI, MCP and agent tooling |
| `studio/` | Interactive real-SDK preview |
| `tests/`, `benchmarks/` | Conformance, browser fixtures and benchmarks |

See [continuation status](docs/continuation-status.md) for verified scope and remaining work.
