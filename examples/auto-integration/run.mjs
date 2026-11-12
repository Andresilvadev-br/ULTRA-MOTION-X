#!/usr/bin/env node
// Example 11 — automatic integration of a real project (copy of tests/fixtures/vite-react):
// analyze → compatibility → plan (diff) → install → doctor → report → rollback.
// Uses the public API of @ultra-motion-x/integration (the same code behind `umx` and MCP).
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeProject,
  applyPlan,
  checkCompatibility,
  createPlan,
  doctor,
  findSource,
  previewPlan,
  rollback,
} from "../../integration/dist/index.js";

const root = new URL("../../", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "umx-example-"));
cpSync(join(root, "tests/fixtures/vite-react"), dir, { recursive: true });
const step = (t) => console.log(`\n=== ${t} ===`);
try {
  step("1. analyze");
  const report = analyzeProject(dir);
  console.log({
    platform: report.platform,
    adapter: report.adapter,
    frameworks: report.frameworks.map((f) => `${f.name}@${f.version}`),
    entry: report.entryPoints,
    components: report.components.length,
  });
  step("2. compatibility");
  const compat = checkCompatibility(report);
  for (const i of compat.issues) console.log(`[${i.severity}] ${i.code}: ${i.message}`);
  step("3. plan (dry run)");
  const plan = createPlan(report, findSource(), { profile: "fluid", annotate: true });
  console.log(previewPlan(plan));
  step("4. install");
  const tx = applyPlan(plan);
  console.log(`transaction ${tx.id}: ${tx.changes.length} files`);
  console.log(readFileSync(join(dir, "src/main.tsx"), "utf8").split("\n").slice(0, 6).join("\n"));
  step("5. doctor");
  for (const f of doctor(dir)) console.log(`[${f.severity}] ${f.message}`);
  step("6. rollback");
  const r = rollback(dir);
  console.log({
    restored: r.restored.length,
    reverted: r.reverted.length,
    removed: r.removed.length,
    conflicts: r.conflicts.length,
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
