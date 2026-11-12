// Makes sure the Ultra Motion X checkout this plugin runs from is installed and built.
// Output goes to stderr (stdout is reserved for the MCP protocol). Idempotent.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = process.env.ULTRA_MOTION_X_HOME || fileURLToPath(new URL("../../../", import.meta.url));

export function ensureSetup() {
  const needInstall = !existsSync(join(ROOT, "node_modules/typescript"));
  const needBuild =
    !existsSync(join(ROOT, "sdk/typescript/dist/index.js")) ||
    !existsSync(join(ROOT, "integration/dist/index.js")) ||
    !existsSync(join(ROOT, "cli/dist/main.js")) ||
    !existsSync(join(ROOT, "ai/mcp/dist/server.js"));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const run = (args) => {
    process.stderr.write(`[ultra-motion-x] ${npm} ${args.join(" ")} (in ${ROOT})\n`);
    const r = spawnSync(npm, args, { cwd: ROOT, stdio: ["ignore", 2, 2] });
    if (r.status !== 0) throw new Error(`setup step failed: ${npm} ${args.join(" ")}`);
  };
  if (needInstall)
    run(
      existsSync(join(ROOT, "package-lock.json"))
        ? ["ci", "--no-audit", "--no-fund"]
        : ["install", "--no-audit", "--no-fund"],
    );
  if (needInstall || needBuild) run(["run", "build"]);
}
