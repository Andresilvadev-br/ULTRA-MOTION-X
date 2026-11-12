import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  analyzeProject,
  annotateSource,
  applyPlan,
  applyUpdate,
  checkCompatibility,
  checkUpdate,
  createPlan,
  doctor,
  findSource,
  heal,
  hunks,
  previewPlan,
  readManifest,
  revertHunks,
  rollback,
} from "../src/index.ts";

const fixtures = new URL("../../tests/fixtures/", import.meta.url).pathname;
const temps: string[] = [];
after(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `umx-${name}-`));
  temps.push(dir);
  cpSync(join(fixtures, name), dir, { recursive: true });
  return dir;
}
const source = findSource();

test("analyzer detects frameworks, entry points, components and animation mechanisms", () => {
  const r = analyzeProject(copy("vite-react"));
  assert.equal(r.platform, "web");
  assert.equal(r.adapter, "react");
  assert.equal(r.buildSystem?.name, "vite");
  assert.equal(r.typescript, true);
  assert.deepEqual(r.entryPoints, ["src/main.tsx"]);
  const roles = new Set(r.components.map((c) => c.role));
  for (const role of ["button", "card", "modal", "notification", "navigation", "form"])
    assert.ok(roles.has(role), `missing ${role}`);
  assert.equal(r.css.keyframes, 1);
  assert.equal(r.css.transformTransitions, 1);
  const next = analyzeProject(copy("next-app"));
  assert.ok(next.animationLibraries.some((a) => a.name === "Framer Motion"));
  assert.ok(next.entryPoints[0]!.endsWith("layout.tsx"));
  assert.equal(analyzeProject(copy("unity-game")).platform, "unity");
  assert.ok(analyzeProject(copy("vue-app")).animationLibraries.some((a) => a.name.includes("Vue")));
});

test("compatibility rejects unsupported framework versions", () => {
  const ok = checkCompatibility(analyzeProject(copy("vite-react")));
  assert.equal(ok.compatible, true);
  const legacy = checkCompatibility(analyzeProject(copy("legacy-react")));
  assert.equal(legacy.compatible, false);
  assert.ok(legacy.issues.some((i) => i.code === "FRAMEWORK_VERSION"));
});

test("install → doctor → user edits → rollback preserves user changes", () => {
  const dir = copy("vite-react");
  const plan = createPlan(analyzeProject(dir), source, { profile: "fluid", annotate: true });
  const diff = previewPlan(plan);
  assert.match(diff, /\+import "\.\/ultra-motion";/);
  assert.match(diff, /data-umx="card"/);
  const before = readFileSync(join(dir, "src/main.tsx"), "utf8");
  const tx = applyPlan(plan);
  assert.ok(tx.changes.length > 5);
  assert.ok(existsSync(join(dir, "vendor/ultra-motion-x/web/dist/index.js")));
  assert.ok(existsSync(join(dir, "vendor/ultra-motion-x/web/wasm/ultra_motion_x.wasm")));
  const boot = readFileSync(join(dir, "src/ultra-motion.ts"), "utf8");
  assert.match(boot, /"profile": "fluid"/);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["@ultra-motion-x/web"], "file:vendor/ultra-motion-x/web");
  assert.deepEqual(
    doctor(dir).map((f) => f.id),
    ["healthy"],
  );

  // The developer keeps working: edits main.tsx (outside our lines) and adds a dependency.
  writeFileSync(
    join(dir, "src/main.tsx"),
    `${readFileSync(join(dir, "src/main.tsx"), "utf8")}\nconsole.log("user change");\n`,
  );
  const p2 = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  p2.dependencies.zod = "^3.0.0";
  writeFileSync(join(dir, "package.json"), JSON.stringify(p2, null, 2));
  // And edits the generated bootstrap (must be kept, reported as a conflict).
  writeFileSync(join(dir, "src/ultra-motion.ts"), `${boot}// customised\n`);

  const r = rollback(dir);
  const main = readFileSync(join(dir, "src/main.tsx"), "utf8");
  assert.ok(!main.includes("ultra-motion"), "our import removed");
  assert.ok(main.includes('console.log("user change")'), "user edit preserved");
  assert.equal(main, `${before}\nconsole.log("user change");\n`);
  const p3 = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(p3.dependencies["@ultra-motion-x/web"], undefined);
  assert.equal(p3.dependencies.zod, "^3.0.0");
  assert.ok(!existsSync(join(dir, "vendor/ultra-motion-x")), "vendor removed");
  assert.ok(r.conflicts.some((c) => c.path === "src/ultra-motion.ts"));
  assert.ok(existsSync(join(dir, "src/ultra-motion.ts")), "edited generated file kept");
  assert.ok(readManifest(dir), "manifest kept while conflicts remain");
});

test("installer refuses to overwrite unknown files", () => {
  const dir = copy("vite-react");
  writeFileSync(join(dir, "src/ultra-motion.ts"), "// someone else's file\n");
  const plan = createPlan(analyzeProject(dir), source);
  assert.throws(() => applyPlan(plan), /cannot be applied safely/);
  assert.equal(readFileSync(join(dir, "src/ultra-motion.ts"), "utf8"), "// someone else's file\n");
});

test("plain HTML and Next.js installs wire the bootstrap correctly", () => {
  const html = copy("vanilla-html");
  applyPlan(createPlan(analyzeProject(html), source));
  assert.match(
    readFileSync(join(html, "index.html"), "utf8"),
    /<script type="module" src="\.\/ultra-motion\.js"><\/script>\n<\/body>/,
  );
  assert.match(readFileSync(join(html, "ultra-motion.js"), "utf8"), /\.\/vendor\/ultra-motion-x\/web\/dist\/index\.js/);
  rollback(html);
  assert.ok(!readFileSync(join(html, "index.html"), "utf8").includes("ultra-motion"));
  assert.ok(!existsSync(join(html, ".ultra-motion")), "clean rollback removes the manifest");
  const next = copy("next-app");
  applyPlan(createPlan(analyzeProject(next), source));
  const layout = readFileSync(join(next, "app/layout.tsx"), "utf8");
  assert.match(layout, /import UltraMotion from "\.\/ultra-motion-client";/);
  assert.match(layout, /<UltraMotion \/>/);
  assert.match(readFileSync(join(next, "app/ultra-motion-client.tsx"), "utf8"), /^"use client";/);
});

test("doctor detects drift and heal repairs it reversibly", () => {
  const dir = copy("vite-react");
  applyPlan(createPlan(analyzeProject(dir), source));
  writeFileSync(
    join(dir, "src/main.tsx"),
    readFileSync(join(dir, "src/main.tsx"), "utf8").replace('import "./ultra-motion";\n', ""),
  );
  rmSync(join(dir, "vendor/ultra-motion-x/web/dist/index.js"));
  const ids = doctor(dir).map((f) => f.id);
  assert.ok(ids.includes("entry-unwired") && ids.includes("vendor-missing"));
  const { transaction, remaining } = heal(dir);
  assert.ok(transaction && transaction.kind === "heal");
  assert.deepEqual(
    remaining.map((f) => f.id),
    ["healthy"],
  );
});

test("update: no-op when current, refuses downgrades, rolls back when tests fail", () => {
  const dir = copy("vite-react");
  applyPlan(createPlan(analyzeProject(dir), source));
  assert.equal(checkUpdate(dir).change, "none");
  // Simulate an older install so the current source is an update.
  const mPath = join(dir, ".ultra-motion/manifest.json");
  const m = JSON.parse(readFileSync(mPath, "utf8"));
  m.installedVersion = "0.9.0";
  writeFileSync(mPath, JSON.stringify(m));
  const c = checkUpdate(dir);
  assert.equal(c.change, "major");
  assert.throws(() => applyUpdate(dir), /breaking/);
  // Break the project's tests: the update must roll itself back.
  const mainPath = join(dir, "src/main.tsx");
  const main = readFileSync(mainPath, "utf8");
  rmSync(mainPath);
  const res = applyUpdate(dir, { allowMajor: true });
  assert.equal(res.tests.ran, true);
  assert.equal(res.tests.passed, false);
  assert.equal(res.rolledBack, true);
  assert.equal(readManifest(dir)!.installedVersion, "0.9.0");
  writeFileSync(mainPath, main);
  const ok = applyUpdate(dir, { allowMajor: true });
  assert.equal(ok.rolledBack, false);
  assert.equal(readManifest(dir)!.installedVersion, source.version);
});

test("diff hunks revert around unrelated edits", () => {
  const base = "a\nb\nc\nd\ne\nf\ng";
  const ours = "a\nb\nX\nc\nd\ne\nf\ng";
  const user = "a\nb\nX\nc\nd\ne\nUSER\nf\ng";
  assert.equal(revertHunks(user, hunks(base, ours)), "a\nb\nc\nd\ne\nUSER\nf\ng");
  assert.equal(revertHunks("totally different", hunks(base, ours)), null);
  assert.equal(annotateSource('<div className="card x">').text, '<div className="card x" data-umx="card">');
});
