#!/usr/bin/env node
// CLI entry point used by plugin commands: node "<plugin root>/ai/claude-plugin/bin/umx.mjs" <command> …
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureSetup, ROOT } from "./ensure-setup.mjs";

if (process.argv[2] === "setup") {
  ensureSetup();
  console.log(`Ultra Motion X ready at ${ROOT}`);
} else {
  ensureSetup();
  const { run } = await import(pathToFileURL(join(ROOT, "cli/dist/main.js")).href);
  process.exitCode = await run(process.argv.slice(2));
}
