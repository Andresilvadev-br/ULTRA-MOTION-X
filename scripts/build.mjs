#!/usr/bin/env node
/**
 * Build all TypeScript workspace packages using checked-in generated assets.
 * Regenerate shader/token sources first, then build project references.
 * WASM is rebuilt explicitly with npm run build:wasm (Rust toolchain required).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
function run(label, command, args) {
  process.stdout.write(`[UMX build] ${label}\n`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("Generating motion tokens", process.execPath, ["scripts/gen-tokens.mjs"]);
run("Generating shader sources", process.execPath, ["scripts/gen-shaders.mjs"]);
const tsc = resolve(root, "node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) {
  console.error("[UMX build] TypeScript missing. Run npm ci first.");
  process.exit(1);
}
run("Compiling workspace project references", process.execPath, [tsc, "-b", "tsconfig.json"]);
console.log("[UMX build] Complete");
