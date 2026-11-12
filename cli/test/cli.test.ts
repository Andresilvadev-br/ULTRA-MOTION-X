import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { parseArgs } from "../src/main.ts";

const bin = new URL("../bin/umx.mjs", import.meta.url).pathname;
const root = new URL("../../", import.meta.url).pathname;
const temps: string[] = [];
after(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
const umx = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

test("argument parsing", () => {
  const a = parseArgs(["install", "app", "--profile", "fluid", "--yes", "--files=a,b", "-j"]);
  assert.deepEqual(a._, ["install", "app"]);
  assert.equal(a.flags.profile, "fluid");
  assert.equal(a.flags.yes, true);
  assert.equal(a.flags.files, "a,b");
  assert.equal(a.flags.json, true);
});

test("usage errors exit with 2; help exits 0", () => {
  assert.equal(umx().status, 2);
  assert.equal(umx("--help").status, 0);
  assert.equal(umx("nope").status, 2);
});

test("validate / compile / migrate MDL through the WASM core", () => {
  const ok = umx("validate", join(root, "examples/mdl/app.umx.json"), "--json");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  const dot = umx("compile", join(root, "examples/mdl/app.umx.json"), "--dot");
  assert.match(dot.stdout, /^digraph/);
  const legacy = umx("migrate", join(root, "examples/mdl/legacy-v0.umx.json"), "--json");
  assert.equal(JSON.parse(legacy.stdout).from, "umx/0");
});

test("non-interactive install requires --yes, then installs and rolls back", () => {
  const dir = mkdtempSync(join(tmpdir(), "umx-cli-"));
  temps.push(dir);
  cpSync(join(root, "tests/fixtures/vite-react"), dir, { recursive: true });
  assert.equal(umx("install", dir).status, 2);
  const plan = umx("plan", dir, "--json");
  assert.equal(JSON.parse(plan.stdout).dryRun, true);
  const inst = umx("install", dir, "--yes", "--json", "--profile", "sport");
  assert.equal(inst.status, 0, inst.stderr);
  assert.equal(JSON.parse(inst.stdout).ok, true);
  assert.equal(umx("doctor", dir).status, 0);
  const rb = umx("rollback", dir, "--yes", "--json");
  assert.equal(rb.status, 0, rb.stdout);
  assert.equal(umx("doctor", dir).status, 3, "no integration after rollback");
});

test("check fails for incompatible projects", () => {
  assert.equal(umx("check", join(root, "tests/fixtures/legacy-react")).status, 1);
  assert.equal(umx("presets", "--json").status, 0);
});
