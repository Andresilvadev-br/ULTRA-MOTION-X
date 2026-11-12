# Ultra Motion X — guide for AI coding agents

Two situations:

**A. You are working inside this repository** (developing the engine):
- Rust workspace (`engine/*`, `rendering/composition`, `sdk/ffi`, `benchmarks/native`):
  `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.
- TypeScript workspaces: `npm ci`, `npm run build` (tsc -b), `npm run lint`, `npm test`
  (Node test runner, `--conditions=umx-source` runs sources directly), `npm run test:browser`
  (Playwright/Chromium).
- After changing `presets/profiles.json` run `npm run gen:tokens`; after changing
  `rendering/shaders/*` run `node scripts/gen-shaders.mjs`; after changing Rust code used by the
  web, run `npm run build:wasm` and `cargo run -p umx-bench --bin conformance > tests/conformance/vectors.json`.
- Keep Rust and TypeScript physics in agreement (conformance tests enforce 1e-9).

**B. You are integrating Ultra Motion X into another project**:
- Load the skill `ai/skills/ultra-motion-x/SKILL.md` and follow
  `ai/agent-guides/integration-playbook.md`. Safety rules: `ai/agent-guides/safety-rules.md`.
- Tools: MCP server `ai/mcp` (`umx_*` tools) or CLI `node ai/claude-plugin/bin/umx.mjs <cmd>`.
