# Contributing

1. Install Node ≥ 22.18 and the Rust toolchain from `rust-toolchain.toml` (with `wasm32-unknown-unknown`).
2. `npm ci && npm run build`.
3. Before opening a pull request run:
   ```sh
   npm run lint && npm test && npm run test:browser
   cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
   bash sdk/ffi/tests/run.sh
   node scripts/gen-tokens.mjs --check && node scripts/gen-shaders.mjs --check && node scripts/sync-dotnet-bindings.mjs --check
   ```
4. Changing physics/easing: update both implementations, regenerate
   `cargo run -p umx-bench --bin conformance > tests/conformance/vectors.json`, rebuild WASM
   (`npm run build:wasm`).
5. Changing the C ABI: bump `UMX_ABI_VERSION`, update `include/*.h`, the .NET/Dart/Unreal bindings
   and `docs/api/ffi.md`; run `node scripts/sync-dotnet-bindings.mjs`.
6. Changing MDL: add a migration step and an entry in `integration/migrations/index.json`;
   update `docs/schema/mdl-1.schema.json`.
7. Performance claims need a benchmark result with its environment (`benchmarks/`).

Code style: Biome (TS/JS/CSS), rustfmt/clippy (Rust). Keep modules independent; no new runtime
dependencies without discussion. Accessibility and reduced motion are requirements, not options.
