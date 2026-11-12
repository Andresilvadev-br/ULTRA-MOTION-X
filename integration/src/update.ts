/**
 * Auto-Evolution: controlled updates. Detects the installed version, compares it with a
 * newer source (local checkout or published tags), classifies the change with semver,
 * lists breaking changes and migrations, applies the update as a reversible transaction,
 * runs the project's tests and rolls back automatically if they fail. Never updates
 * without being asked and never executes code downloaded from the network.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { analyzeProject } from "./analyzer.ts";
import { applyPlan, IntegrationError, readManifest, revertTransaction, type Transaction } from "./installer.ts";
import { createPlan } from "./plan.ts";
import { findSource, type UmxSource } from "./source.ts";
import { compareSemver, readJson, semverChange, writeAtomic } from "./util.ts";

export interface MigrationEntry {
  version: string;
  breaking: boolean;
  summary: string;
  steps: string[];
}

export interface UpdateCheck {
  installed: string;
  available: string;
  change: ReturnType<typeof semverChange>;
  breaking: boolean;
  migrations: MigrationEntry[];
  source: string;
}

export function loadMigrations(source: UmxSource): MigrationEntry[] {
  return (
    readJson<{ migrations: MigrationEntry[] }>(join(source.root, "integration/migrations/index.json"))?.migrations ?? []
  );
}

export function checkUpdate(root: string, sourceHint?: string): UpdateCheck {
  const m = readManifest(root);
  if (!m) throw new IntegrationError("NOT_INSTALLED", "no Ultra Motion X integration found");
  const src = findSource(sourceHint);
  const change = semverChange(m.installedVersion, src.version);
  const migrations = loadMigrations(src).filter(
    (x) => compareSemver(x.version, m.installedVersion) > 0 && compareSemver(x.version, src.version) <= 0,
  );
  return {
    installed: m.installedVersion,
    available: src.version,
    change,
    breaking: change === "major" || migrations.some((x) => x.breaking),
    migrations,
    source: src.root,
  };
}

/** Lists released versions from a git remote (tags only — no code is fetched or run). */
export function remoteVersions(url: string): string[] {
  if (!/^(https:\/\/|git@)[\w.@:/-]+$/.test(url))
    throw new IntegrationError("BAD_URL", "only https:// or git@ remotes are accepted");
  const out = execFileSync("git", ["ls-remote", "--tags", "--refs", url], { encoding: "utf8", timeout: 20_000 });
  return out
    .split("\n")
    .map((l) => l.split("refs/tags/")[1])
    .filter((t): t is string => !!t && /^v?\d+\.\d+\.\d+/.test(t))
    .map((t) => t.replace(/^v/, ""))
    .sort(compareSemver);
}

export interface UpdateResult {
  check: UpdateCheck;
  transaction: Transaction | null;
  tests: { ran: boolean; passed: boolean; output: string };
  rolledBack: boolean;
}

/** Runs `npm test` (or the configured script) if the project defines one. */
export function runProjectTests(
  root: string,
  script = "test",
  timeoutMs = 300_000,
): { ran: boolean; passed: boolean; output: string } {
  const pkg = readJson<{ scripts?: Record<string, string> }>(join(root, "package.json"));
  const cmd = pkg?.scripts?.[script];
  if (!cmd || /no test specified/.test(cmd)) return { ran: false, passed: true, output: "no test script" };
  const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script, "--silent"], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return { ran: true, passed: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-4000) };
}

export function applyUpdate(
  root: string,
  opts: { source?: string; allowMajor?: boolean; runTests?: boolean } = {},
): UpdateResult {
  const check = checkUpdate(root, opts.source);
  if (check.change === "none")
    return { check, transaction: null, tests: { ran: false, passed: true, output: "" }, rolledBack: false };
  if (check.change === "downgrade")
    throw new IntegrationError("DOWNGRADE", `source ${check.available} is older than installed ${check.installed}`);
  if (check.breaking && !opts.allowMajor)
    throw new IntegrationError(
      "BREAKING",
      `update ${check.installed} → ${check.available} contains breaking changes; review migrations and pass --allow-major`,
      check.migrations.map((x) => `${x.version}: ${x.summary}`),
    );
  const m = readManifest(root)!;
  const src = findSource(opts.source);
  const report = analyzeProject(root);
  const plan = createPlan(report, src, { mode: m.mode, adapter: m.adapter });
  // Updates only touch vendored files and the dependency entry; config and entry wiring stay.
  plan.changes = plan.changes.filter((c) => c.path.startsWith("vendor/") || c.kind === "json");
  const tx = applyPlan(plan, { kind: "update", force: true });
  const tests = opts.runTests === false ? { ran: false, passed: true, output: "skipped" } : runProjectTests(root);
  if (!tests.passed) {
    revertTransaction(root, tx, { force: true });
    const mm = readManifest(root)!;
    const t = mm.transactions.find((x) => x.id === tx.id);
    if (t) t.rolledBack = new Date().toISOString();
    mm.installedVersion = check.installed;
    writeAtomic(join(root, ".ultra-motion/manifest.json"), `${JSON.stringify(mm, null, 2)}\n`);
    return { check, transaction: tx, tests, rolledBack: true };
  }
  return { check, transaction: tx, tests, rolledBack: false };
}
