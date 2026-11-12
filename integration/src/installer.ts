/**
 * Applies plans transactionally and records everything needed to undo them:
 * a manifest with per-file hashes, snapshots of modified files and the exact hunks that
 * Ultra Motion X introduced. Rollback removes only Ultra Motion X's own edits and never
 * silently destroys changes the developer made afterwards.
 */
import { readFileSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Hunk, hunks, revertHunks, unifiedDiff } from "./diff.ts";
import type { IntegrationPlan, PlannedChange } from "./plan.ts";
import { exists, readJson, sha256, writeAtomic } from "./util.ts";

export const MANIFEST_DIR = ".ultra-motion";
export const MANIFEST = `${MANIFEST_DIR}/manifest.json`;

export interface ChangeRecord {
  path: string;
  kind: "create" | "modify" | "json";
  afterHash: string;
  beforeHash: string | null;
  /** Snapshot of the previous content (modify/json, or an overwritten identical create). */
  snapshot: string | null;
  hunks?: Hunk[];
  json?: { pointer: string[]; value: unknown; previous: unknown };
  description: string;
}

export interface Transaction {
  id: string;
  kind: "install" | "update" | "heal";
  createdAt: string;
  version: string;
  adapter: string;
  changes: ChangeRecord[];
  rolledBack?: string;
}

export interface Manifest {
  format: "umx-manifest/1";
  installedVersion: string;
  adapter: string;
  mode: "vendor" | "npm";
  transactions: Transaction[];
}

export class IntegrationError extends Error {
  readonly code: string;
  readonly details: string[];
  constructor(code: string, message: string, details: string[] = []) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const buf = (c: string | Buffer) => (typeof c === "string" ? Buffer.from(c) : c);
const isText = (c: string | Buffer | null) => typeof c === "string";

export function readManifest(root: string): Manifest | null {
  return readJson<Manifest>(join(root, MANIFEST));
}

function writeManifest(root: string, m: Manifest): void {
  writeAtomic(join(root, MANIFEST), `${JSON.stringify(m, null, 2)}\n`);
}

/** Unified diff preview of a plan (binary/vendor files are summarised). */
export function previewPlan(plan: IntegrationPlan): string {
  const out: string[] = [];
  let vendored = 0;
  for (const c of plan.changes) {
    if (!isText(c.after) || c.path.startsWith("vendor/")) {
      vendored++;
      continue;
    }
    out.push(unifiedDiff(c.path, (c.before as string | null) ?? "", c.after as string));
  }
  if (vendored) out.push(`# + ${vendored} vendored/binary file(s) (not shown)\n`);
  return out.join("\n");
}

/** Detects conflicts: files changed since planning or unknown files in the way. */
export function verifyPlan(plan: IntegrationPlan, force = false): string[] {
  const problems: string[] = [];
  for (const c of plan.changes) {
    const full = join(plan.root, c.path);
    const current = exists(full) ? readFileSync(full) : null;
    const planned = c.before === null ? null : buf(c.before);
    if (c.kind === "create" && current && !current.equals(buf(c.after)) && !force) {
      problems.push(`${c.path}: an existing file would be overwritten (use --force only if it is safe)`);
    } else if (c.kind !== "create" && (current === null) !== (planned === null)) {
      problems.push(`${c.path}: file appeared or disappeared since planning`);
    } else if (c.kind !== "create" && current && planned && !current.equals(planned)) {
      problems.push(`${c.path}: file changed since planning; re-run the plan`);
    }
  }
  return problems;
}

/** Applies a plan atomically per file and records a transaction. */
export function applyPlan(
  plan: IntegrationPlan,
  opts: { kind?: Transaction["kind"]; force?: boolean } = {},
): Transaction {
  const problems = verifyPlan(plan, opts.force);
  if (problems.length) throw new IntegrationError("CONFLICT", "plan cannot be applied safely", problems);
  const tx: Transaction = {
    id: `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: opts.kind ?? "install",
    createdAt: new Date().toISOString(),
    version: plan.version,
    adapter: plan.adapter,
    changes: [],
  };
  const written: string[] = [];
  try {
    for (const c of plan.changes) {
      const full = join(plan.root, c.path);
      const before = exists(full) ? readFileSync(full) : null;
      if (before?.equals(buf(c.after))) continue; // already in the desired state
      let snapshot: string | null = null;
      if (before) {
        const h = sha256(before);
        snapshot = `${MANIFEST_DIR}/snapshots/${h}`;
        if (!exists(join(plan.root, snapshot))) writeAtomic(join(plan.root, snapshot), before);
      }
      writeAtomic(full, c.after);
      written.push(c.path);
      tx.changes.push(record(c, before, snapshot));
    }
  } catch (err) {
    // Undo partial work of this transaction before reporting the failure.
    revertTransaction(plan.root, tx, { force: true });
    throw err;
  }
  const m = readManifest(plan.root) ?? {
    format: "umx-manifest/1" as const,
    installedVersion: plan.version,
    adapter: plan.adapter,
    mode: plan.mode,
    transactions: [],
  };
  m.installedVersion = plan.version;
  m.adapter = plan.adapter;
  m.mode = plan.mode;
  m.transactions.push(tx);
  writeManifest(plan.root, m);
  return tx;
}

function record(c: PlannedChange, before: Buffer | null, snapshot: string | null): ChangeRecord {
  const r: ChangeRecord = {
    path: c.path,
    kind: c.kind,
    afterHash: sha256(buf(c.after)),
    beforeHash: before ? sha256(before) : null,
    snapshot,
    description: c.description,
  };
  if (c.kind === "modify" && before && isText(c.after)) r.hunks = hunks(before.toString("utf8"), c.after as string);
  if (c.kind === "json") r.json = c.json;
  return r;
}

export interface RollbackReport {
  restored: string[];
  removed: string[];
  reverted: string[];
  conflicts: Array<{ path: string; reason: string; rejectFile?: string }>;
  skipped: string[];
}

function deepGet(o: Record<string, unknown>, p: string[]): unknown {
  return p.reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
}

function deepSet(o: Record<string, unknown>, p: string[], v: unknown): void {
  let cur = o;
  for (const k of p.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
  const last = p[p.length - 1]!;
  if (v === undefined) delete cur[last];
  else cur[last] = v;
}

/** Reverts one transaction's changes (newest first). */
export function revertTransaction(
  root: string,
  tx: Transaction,
  opts: { force?: boolean; files?: string[]; dryRun?: boolean } = {},
): RollbackReport {
  const rep: RollbackReport = { restored: [], removed: [], reverted: [], conflicts: [], skipped: [] };
  for (const c of [...tx.changes].reverse()) {
    if (opts.files && !opts.files.includes(c.path)) {
      rep.skipped.push(c.path);
      continue;
    }
    const full = join(root, c.path);
    const current = exists(full) ? readFileSync(full) : null;
    const unchanged = current !== null && sha256(current) === c.afterHash;
    if (c.kind === "create") {
      if (!current) continue;
      if (unchanged || opts.force) {
        if (!opts.dryRun) {
          if (c.snapshot) writeAtomic(full, readFileSync(join(root, c.snapshot)));
          else rmSync(full);
        }
        (c.snapshot ? rep.restored : rep.removed).push(c.path);
      } else rep.conflicts.push({ path: c.path, reason: "file was edited after installation; kept as is" });
      continue;
    }
    if (c.kind === "json") {
      if (!current) {
        rep.conflicts.push({ path: c.path, reason: "file no longer exists" });
        continue;
      }
      try {
        const obj = JSON.parse(current.toString("utf8")) as Record<string, unknown>;
        if (c.json && JSON.stringify(deepGet(obj, c.json.pointer)) === JSON.stringify(c.json.value)) {
          deepSet(obj, c.json.pointer, c.json.previous);
          // Keep the user's formatting choices as far as JSON allows (2-space indent).
          if (!opts.dryRun) writeAtomic(full, `${JSON.stringify(obj, null, 2)}\n`);
          rep.reverted.push(c.path);
        } else
          rep.conflicts.push({
            path: c.path,
            reason: `value at ${c.json?.pointer.join(".")} was changed after installation; kept`,
          });
      } catch {
        rep.conflicts.push({ path: c.path, reason: "invalid JSON; not modified" });
      }
      continue;
    }
    // modify
    if (!current) {
      rep.conflicts.push({ path: c.path, reason: "file no longer exists" });
      continue;
    }
    if (unchanged && c.snapshot) {
      if (!opts.dryRun) writeAtomic(full, readFileSync(join(root, c.snapshot)));
      rep.restored.push(c.path);
      continue;
    }
    const reverted = c.hunks ? revertHunks(current.toString("utf8"), c.hunks) : null;
    if (reverted !== null) {
      if (!opts.dryRun) writeAtomic(full, reverted);
      rep.reverted.push(c.path);
    } else {
      const rej = `${c.path}.umx-rollback.rej`;
      if (!opts.dryRun)
        writeAtomic(
          join(root, rej),
          `${(c.hunks ?? []).map((h) => `@@ ultra-motion-x change @@\n${h.after.map((l) => `-${l}`).join("\n")}\n${h.before.map((l) => `+${l}`).join("\n")}`).join("\n")}\n`,
        );
      rep.conflicts.push({
        path: c.path,
        reason: "our edit overlaps later user edits; see reject file and apply manually",
        rejectFile: rej,
      });
    }
  }
  return rep;
}

/**
 * Rolls back the most recent transaction (`all` = every transaction, newest first).
 * Successfully reverted transactions are marked in the manifest; when nothing remains the
 * manifest directory is removed (snapshots included).
 */
export function rollback(
  root: string,
  opts: { all?: boolean; files?: string[]; force?: boolean; dryRun?: boolean } = {},
): RollbackReport {
  const m = readManifest(root);
  if (!m)
    throw new IntegrationError(
      "NOT_INSTALLED",
      "no Ultra Motion X integration found (.ultra-motion/manifest.json missing)",
    );
  const active = m.transactions.filter((t) => !t.rolledBack);
  if (!active.length) throw new IntegrationError("NOTHING_TO_ROLLBACK", "all transactions are already rolled back");
  const targets = opts.all ? [...active].reverse() : [active[active.length - 1]!];
  const total: RollbackReport = { restored: [], removed: [], reverted: [], conflicts: [], skipped: [] };
  for (const tx of targets) {
    const r = revertTransaction(root, tx, opts);
    for (const k of ["restored", "removed", "reverted", "skipped"] as const) total[k].push(...r[k]);
    total.conflicts.push(...r.conflicts);
    if (!opts.dryRun && !opts.files && !r.conflicts.length) tx.rolledBack = new Date().toISOString();
  }
  if (!opts.dryRun) {
    const remaining = m.transactions.filter((t) => !t.rolledBack);
    cleanupEmptyDirs(root, [...total.removed]);
    if (!remaining.length) {
      rmSync(join(root, MANIFEST_DIR), { recursive: true, force: true });
    } else {
      const last = remaining[remaining.length - 1]!;
      m.installedVersion = last.version;
      writeManifest(root, m);
    }
  }
  return total;
}

function cleanupEmptyDirs(root: string, removed: string[]): void {
  const dirs = new Set<string>();
  for (const f of removed) {
    let d = dirname(f);
    while (d && d !== ".") {
      dirs.add(d);
      d = dirname(d);
    }
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      rmdirSync(join(root, d));
    } catch {
      /* not empty or already gone */
    }
  }
}
