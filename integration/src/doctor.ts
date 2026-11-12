/**
 * Self-healing integration checks. Detects drift after the project evolves (removed
 * imports, corrupted vendor files, invalid configuration, version mismatches) and applies
 * only fixes that are provably safe; everything else is reported for a human.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeProject } from "./analyzer.ts";
import { applyPlan, MANIFEST, readManifest, type Transaction } from "./installer.ts";
import { CONFIG_FILE, type IntegrationConfig, type IntegrationPlan, VENDOR_DIR } from "./plan.ts";
import { findSource } from "./source.ts";
import { exists, readJson, readText, sha256 } from "./util.ts";

export interface Finding {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  fixable: boolean;
  path?: string;
}

const PROFILES = [
  "minimal",
  "professional",
  "cinematic",
  "dynamic",
  "fluid",
  "sport",
  "elegant",
  "ultraResponsive",
  "singularity",
];

export function validateConfig(cfg: unknown): string[] {
  const e: string[] = [];
  const c = cfg as Partial<IntegrationConfig> | null;
  if (!c || typeof c !== "object") return ["config must be an object"];
  if (!c.profile || !PROFILES.includes(c.profile)) e.push(`profile must be one of ${PROFILES.join(", ")}`);
  if (c.reducedMotion && !["user", "always", "never"].includes(c.reducedMotion))
    e.push("reducedMotion must be user | always | never");
  const f = c.fidelity;
  if (f && !(f.min >= 0 && f.min <= f.initial && f.initial <= f.max && f.max <= 4))
    e.push("fidelity must satisfy 0 ≤ min ≤ initial ≤ max ≤ 4");
  if (c.compositor && !["auto", "always", "never"].includes(c.compositor))
    e.push("compositor must be auto | always | never");
  if (c.enhance && !Array.isArray(c.enhance.roles)) e.push("enhance.roles must be an array");
  return e;
}

export function doctor(root: string): Finding[] {
  const out: Finding[] = [];
  const m = readManifest(root);
  if (!m)
    return [
      {
        id: "not-installed",
        severity: "error",
        message: `No integration found (${MANIFEST} missing). Run \`umx install\`.`,
        fixable: false,
      },
    ];
  const active = m.transactions.filter((t) => !t.rolledBack);
  const install = active.find((t) => t.kind === "install");
  if (exists(join(root, CONFIG_FILE))) {
    const cfg = readJson(join(root, CONFIG_FILE));
    const errs = validateConfig(cfg);
    for (const e of errs)
      out.push({
        id: "config-invalid",
        severity: "error",
        message: `${CONFIG_FILE}: ${e}`,
        fixable: false,
        path: CONFIG_FILE,
      });
  } else if (m.adapter !== "unity" && m.adapter !== "godot") {
    out.push({
      id: "config-missing",
      severity: "warning",
      message: `${CONFIG_FILE} is missing; defaults are used by the bootstrap.`,
      fixable: false,
    });
  }
  // Vendored files must match what was installed (integrity).
  for (const tx of active) {
    for (const c of tx.changes) {
      if (!c.path.startsWith(VENDOR_DIR)) continue;
      const full = join(root, c.path);
      if (!exists(full))
        out.push({
          id: "vendor-missing",
          severity: "error",
          message: `${c.path} is missing`,
          fixable: true,
          path: c.path,
        });
      else if (sha256(readFileSync(full)) !== c.afterHash)
        out.push({
          id: "vendor-modified",
          severity: "warning",
          message: `${c.path} differs from the installed version (local edits are overwritten by \`umx doctor --fix\`)`,
          fixable: true,
          path: c.path,
        });
    }
  }
  // Bootstrap import still wired into the entry point?
  const entryChange = install?.changes.find(
    (c) => c.kind === "modify" && c.description.toLowerCase().includes("bootstrap"),
  );
  if (entryChange) {
    const text = readText(join(root, entryChange.path));
    if (text === null)
      out.push({
        id: "entry-missing",
        severity: "error",
        message: `entry point ${entryChange.path} no longer exists; import the bootstrap from your new entry`,
        fixable: false,
        path: entryChange.path,
      });
    else if (!/ultra-motion/.test(text))
      out.push({
        id: "entry-unwired",
        severity: "error",
        message: `${entryChange.path} no longer imports the Ultra Motion bootstrap`,
        fixable: true,
        path: entryChange.path,
      });
  }
  const pkg = readJson<{ dependencies?: Record<string, string> }>(join(root, "package.json"));
  if (
    pkg &&
    m.adapter !== "react-native" &&
    ["web", "react", "vue", "svelte", "angular", "electron", "tauri"].includes(m.adapter) &&
    !pkg.dependencies?.["@ultra-motion-x/web"]
  ) {
    out.push({
      id: "dependency-missing",
      severity: "error",
      message: "package.json no longer depends on @ultra-motion-x/web",
      fixable: true,
      path: "package.json",
    });
  }
  const vendorPkg = readJson<{ version: string }>(join(root, VENDOR_DIR, "web/package.json"));
  if (vendorPkg && vendorPkg.version !== m.installedVersion)
    out.push({
      id: "version-mismatch",
      severity: "warning",
      message: `vendored SDK ${vendorPkg.version} ≠ manifest ${m.installedVersion}`,
      fixable: true,
    });
  const report = analyzeProject(root);
  if (report.animationLibraries.length)
    out.push({
      id: "other-animation-libraries",
      severity: "info",
      message: `Also present: ${report.animationLibraries.map((a) => a.name).join(", ")}`,
      fixable: false,
    });
  if (!out.length) out.push({ id: "healthy", severity: "info", message: "Integration is healthy.", fixable: false });
  return out;
}

/** Applies safe fixes as a new "heal" transaction (itself reversible). */
export function heal(root: string, sourceHint?: string): { transaction: Transaction | null; remaining: Finding[] } {
  const findings = doctor(root);
  const m = readManifest(root);
  if (!m) return { transaction: null, remaining: findings };
  const fixable = findings.filter((f) => f.fixable);
  const plan: IntegrationPlan = {
    root,
    adapter: m.adapter,
    mode: m.mode,
    version: m.installedVersion,
    changes: [],
    notes: [],
    manualSteps: [],
  };
  const active = m.transactions.filter((t) => !t.rolledBack);
  for (const f of fixable) {
    if ((f.id === "vendor-missing" || f.id === "vendor-modified" || f.id === "version-mismatch") && f.path) {
      // Restore the exact installed bytes from the current source if they match the record.
      const src = findSource(sourceHint);
      const rel = f.path.slice(`${VENDOR_DIR}/web/`.length);
      const candidate = rel.startsWith("dist/")
        ? join(src.webDist, rel.slice(5))
        : rel.startsWith("wasm/")
          ? join(src.webPackage, rel)
          : null;
      const rec = active.flatMap((t) => t.changes).find((c) => c.path === f.path);
      if (candidate && exists(candidate) && rec && sha256(readFileSync(candidate)) === rec.afterHash) {
        plan.changes.push({
          kind: "create",
          path: f.path,
          description: "Restore vendored file",
          after: readFileSync(candidate),
          before: exists(join(root, f.path)) ? readFileSync(join(root, f.path)) : null,
        });
      }
    }
    if (f.id === "entry-unwired" && f.path) {
      const text = readText(join(root, f.path))!;
      const isHtml = f.path.endsWith(".html");
      const after = isHtml
        ? text.replace(/<\/body>/i, '  <script type="module" src="./ultra-motion.js"></script>\n</body>')
        : `import "./ultra-motion";\n${text}`;
      plan.changes.push({
        kind: "modify",
        path: f.path,
        description: "Re-wire the bootstrap import",
        after,
        before: text,
      });
    }
    if (f.id === "dependency-missing") {
      const before = readText(join(root, "package.json"))!;
      const pkg = JSON.parse(before);
      const value = m.mode === "vendor" ? `file:${VENDOR_DIR}/web` : `^${m.installedVersion}`;
      pkg.dependencies = { ...(pkg.dependencies ?? {}), "@ultra-motion-x/web": value };
      plan.changes.push({
        kind: "json",
        path: "package.json",
        description: "Restore dependency",
        after: `${JSON.stringify(pkg, null, 2)}\n`,
        before,
        json: { pointer: ["dependencies", "@ultra-motion-x/web"], value, previous: undefined },
      });
    }
  }
  // `create` over existing modified vendor files is intentional here.
  const tx = plan.changes.length ? applyPlan(plan, { kind: "heal", force: true }) : null;
  return { transaction: tx, remaining: doctor(root) };
}
