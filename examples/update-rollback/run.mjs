#!/usr/bin/env node
// Example 12 — controlled update and safe rollback on a temporary copy of a fixture project.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeProject,
  applyPlan,
  applyUpdate,
  checkUpdate,
  createPlan,
  findSource,
  readManifest,
  rollback,
} from "../../integration/dist/index.js";

const root = new URL("../../", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "umx-update-"));
cpSync(join(root, "tests/fixtures/vite-react"), dir, { recursive: true });
const step = (t) => console.log(`\n=== ${t} ===`);
try {
  step("install");
  console.log(applyPlan(createPlan(analyzeProject(dir), findSource())).id);
  step("developer keeps working (edits main.tsx)");
  const mainPath = join(dir, "src/main.tsx");
  writeFileSync(mainPath, `${readFileSync(mainPath, "utf8")}\n// developer change\n`);
  step("pretend 0.9.0 was installed, check for updates");
  const mPath = join(dir, ".ultra-motion/manifest.json");
  const m = JSON.parse(readFileSync(mPath, "utf8"));
  m.installedVersion = "0.9.0";
  writeFileSync(mPath, JSON.stringify(m));
  console.log(checkUpdate(dir));
  step("update while the project's tests fail → automatic rollback");
  const main = readFileSync(mainPath, "utf8");
  rmSync(mainPath);
  const failed = applyUpdate(dir, { allowMajor: true });
  console.log({
    testsPassed: failed.tests.passed,
    rolledBack: failed.rolledBack,
    installed: readManifest(dir).installedVersion,
  });
  step("fix the project, update again");
  writeFileSync(mainPath, main);
  const ok = applyUpdate(dir, { allowMajor: true });
  console.log({
    testsPassed: ok.tests.passed,
    rolledBack: ok.rolledBack,
    installed: readManifest(dir).installedVersion,
  });
  step("roll back everything (developer edit must survive)");
  const r = rollback(dir, { all: true });
  console.log({
    conflicts: r.conflicts.length,
    devChangeKept: readFileSync(mainPath, "utf8").includes("// developer change"),
    importRemoved: !readFileSync(mainPath, "utf8").includes("ultra-motion"),
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
