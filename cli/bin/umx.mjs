#!/usr/bin/env node
// Ultra Motion X CLI launcher. Uses the compiled build when present, otherwise runs the
// TypeScript sources directly (Node ≥ 22.6 type stripping) — handy inside the repository.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/main.js", import.meta.url));
if (existsSync(dist)) {
  const { run } = await import(dist);
  process.exitCode = await run(process.argv.slice(2));
} else {
  const src = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const r = spawnSync(process.execPath, ["--conditions=umx-source", "--no-warnings", src, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exitCode = r.status ?? 1;
}
