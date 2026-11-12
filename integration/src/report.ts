/** Human-readable integration report (Markdown). */
import type { ProjectReport } from "./analyzer.ts";
import type { CompatibilityResult } from "./compatibility.ts";
import type { Finding } from "./doctor.ts";
import type { Transaction } from "./installer.ts";
import type { IntegrationPlan } from "./plan.ts";

export function markdownReport(input: {
  report: ProjectReport;
  compatibility?: CompatibilityResult;
  plan?: IntegrationPlan;
  transaction?: Transaction | null;
  findings?: Finding[];
}): string {
  const { report: r } = input;
  const roles = new Map<string, number>();
  for (const c of r.components) roles.set(c.role, (roles.get(c.role) ?? 0) + 1);
  const lines = [
    "# Ultra Motion X — integration report",
    "",
    `- **Platform:** ${r.platform}  **Adapter:** ${r.adapter}`,
    `- **Frameworks:** ${r.frameworks.map((f) => `${f.name}${f.version ? `@${f.version}` : ""}`).join(", ") || "none"}`,
    `- **Build system:** ${r.buildSystem?.name ?? "unknown"}  **Package manager:** ${r.packageManager ?? "none"}  **TypeScript:** ${r.typescript ? "yes" : "no"}`,
    `- **Entry points:** ${r.entryPoints.join(", ") || "none detected"}`,
    `- **Existing animation:** ${r.animationLibraries.map((a) => a.name).join(", ") || "none"}; CSS: ${r.css.transitions} transitions, ${r.css.keyframes} @keyframes`,
    "",
    "## Discovered components",
    "",
    ...(roles.size ? [...roles].map(([k, v]) => `- ${k}: ${v}`) : ["- none"]),
  ];
  if (input.compatibility) {
    lines.push("", "## Compatibility", "", `Compatible: **${input.compatibility.compatible ? "yes" : "no"}**`, "");
    for (const i of input.compatibility.issues)
      lines.push(`- [${i.severity}] ${i.code}: ${i.message}${i.fix ? ` — ${i.fix}` : ""}`);
  }
  if (input.plan) {
    lines.push("", "## Changes", "");
    const vendored = input.plan.changes.filter((c) => c.path.startsWith("vendor/")).length;
    for (const c of input.plan.changes.filter((x) => !x.path.startsWith("vendor/")))
      lines.push(`- \`${c.kind}\` ${c.path} — ${c.description}`);
    if (vendored) lines.push(`- ${vendored} vendored SDK file(s) under vendor/ultra-motion-x`);
    if (input.plan.manualSteps.length)
      lines.push("", "## Manual steps", "", ...input.plan.manualSteps.map((s) => `- ${s}`));
    if (input.plan.notes.length) lines.push("", "## Notes", "", ...input.plan.notes.map((s) => `- ${s}`));
  }
  if (input.transaction)
    lines.push(
      "",
      `Transaction \`${input.transaction.id}\` recorded in .ultra-motion/manifest.json — undo with \`umx rollback\`.`,
    );
  if (input.findings) {
    lines.push("", "## Health", "");
    for (const f of input.findings)
      lines.push(`- [${f.severity}] ${f.message}${f.fixable ? " (fixable: `umx doctor --fix`)" : ""}`);
  }
  return `${lines.join("\n")}\n`;
}
