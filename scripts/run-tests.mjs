#!/usr/bin/env node
/** Run the repository's Node tests with source export conditions.
 * Node >=22.18 is required for type stripping; older Node supports builds,
 * but must upgrade or use a compatible TS test runner for source tests.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mode = process.argv[2] ?? "unit";
const unitRoots = ["sdk/typescript/test", "rendering/web/test", "devtools/test", "integration/test", "cli/test", "ai/mcp/test"];
function collect(dir) {
  const path = join(root, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path).filter(x => /\.test\.[cm]?[jt]s$/.test(x)).map(x => join(path, x)).sort();
}
function run(args, label) {
  console.log(`[UMX tests] ${label}`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "" } });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
function nodeTests(files, label) {
  if (!files.length) {
    console.error(`[UMX tests] No ${label} test files found; refusing false success.`);
    return 1;
  }
  return run(["--experimental-strip-types", "--conditions=umx-source", "--test", ...files], label);
}
let result = 0;
if (mode === "unit" || mode === "integration") {
  const dirs = mode === "integration" ? ["integration/test", "cli/test", "ai/mcp/test"] : unitRoots;
  result = nodeTests(dirs.flatMap(collect), mode);
} else if (mode === "browser") {
  const browserFiles = collect("tests/browser");
  if (browserFiles.length) result = nodeTests(browserFiles, "browser");
  else {
    console.error("[UMX tests] Browser tests not implemented. Configure Playwright and create tests/browser/*.test.mjs.");
    result = 1;
  }
} else if (mode === "all") {
  result = nodeTests(unitRoots.flatMap(collect), "unit + integration");
  if (result === 0) {
    const browserFiles = collect("tests/browser");
    if (!browserFiles.length) {
      console.error("[UMX tests] Missing browser tests; cannot certify full test suite.");
      result = 1;
    } else result = nodeTests(browserFiles, "browser");
  }
} else {
  console.error(`Usage: node scripts/run-tests.mjs unit|integration|browser|all (received ${mode})`);
  result = 2;
}
process.exit(result);
