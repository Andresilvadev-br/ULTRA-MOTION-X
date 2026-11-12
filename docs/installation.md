# Installation

## Web projects

| Mode | How | When |
|---|---|---|
| CLI / Claude Code (recommended) | `umx install <dir> --yes` | Existing apps: adds config, bootstrap import, vendored SDK, dependency entry — reversible |
| Vendored | copy `sdk/typescript/{dist,wasm,package.json}` to `vendor/ultra-motion-x/web` and depend on `file:vendor/ultra-motion-x/web` | Offline / reproducible builds (what the installer does by default) |
| npm | `npm i @ultra-motion-x/web` | When the packages are published to your registry (the repository is prepared for publishing; publishing is not automated) |
| No bundler | `<script type="module">` + import map pointing to `dist/index.js` | Plain HTML (see `examples/*/index.html`) |

Optional packages: `@ultra-motion-x/effects` (shaders), `@ultra-motion-x/devtools`,
framework adapters `@ultra-motion-x/{react,vue,svelte,angular}`, `@ultra-motion-x/electron`,
`@ultra-motion-x/react-native`.

## Native hosts

1. Build the core for the target: `cargo build -p umx-ffi --release [--target <triple>]`
   → `libultra_motion_x.{a,so,dylib}` / `ultra_motion_x.{dll,lib}`.
2. Use `sdk/ffi/include/ultra_motion_x.h` (C), `ultra_motion_x.hpp` (C++17), or the adapter for
   your platform (`docs/adapters.md`). `umx install --adapter unity|godot|unreal|qt|dotnet-wpf|winui|flutter`
   copies the adapter, headers and any built library into the project as a reversible transaction.

## Building this repository

```sh
npm ci
npm run build          # tokens + shaders generation, TypeScript project references
npm run build:wasm     # optional: rebuild WebAssembly (needs Rust + wasm32 target)
```

Toolchains: Node ≥ 22.18; Rust 1.97 (pinned in `rust-toolchain.toml`) with `wasm32-unknown-unknown`.
