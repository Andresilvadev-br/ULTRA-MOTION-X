#!/usr/bin/env node
// Builds the Rust core for wasm32-unknown-unknown and copies it into the Web SDK package.
// Requires the Rust toolchain (see rust-toolchain.toml). The resulting binary is committed
// so that JavaScript users do not need Rust installed.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("cargo", ["build", "-p", "umx-ffi", "--target", "wasm32-unknown-unknown", "--profile", "wasm"], {
  cwd: root,
  stdio: "inherit",
});
const src = join(root, "target/wasm32-unknown-unknown/wasm/ultra_motion_x.wasm");
const outDir = join(root, "sdk/typescript/wasm");
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, "ultra_motion_x.wasm"));
console.log(`wasm: ${(statSync(src).size / 1024).toFixed(0)} KiB → sdk/typescript/wasm/ultra_motion_x.wasm`);
