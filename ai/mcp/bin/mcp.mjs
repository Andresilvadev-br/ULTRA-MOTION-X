#!/usr/bin/env node
// Launches the Ultra Motion X MCP server over stdio (compiled build or sources).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/server.js", import.meta.url));
if (existsSync(dist)) {
  const { serveStdio } = await import(dist);
  serveStdio();
} else {
  const src = fileURLToPath(new URL("../src/server.ts", import.meta.url));
  const r = spawnSync(process.execPath, ["--conditions=umx-source", "--no-warnings", src, "--stdio"], {
    stdio: "inherit",
  });
  process.exitCode = r.status ?? 1;
}
