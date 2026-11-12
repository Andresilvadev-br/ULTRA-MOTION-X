/** Compatibility checks: version ranges, conflicts and environment requirements. */
import type { ProjectReport } from "./analyzer.ts";
import { minVersion, parseSemver } from "./util.ts";

export interface Issue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  fix?: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  issues: Issue[];
}

const MIN_FRAMEWORK: Record<string, [number, number]> = {
  react: [16, 8],
  vue: [3, 0],
  svelte: [3, 0],
  angular: [15, 0],
  next: [13, 0],
  nuxt: [3, 0],
  electron: [20, 0],
  "react-native": [0, 70],
};

export function checkCompatibility(report: ProjectReport, env: { node?: string } = {}): CompatibilityResult {
  const issues: Issue[] = [];
  const node = parseSemver(env.node ?? process.versions.node);
  if (node && node.major < 20)
    issues.push({
      severity: "error",
      code: "NODE_VERSION",
      message: `Node ${process.versions.node} detected; the CLI requires Node ≥ 20.11.`,
      fix: "Upgrade Node.js",
    });
  for (const f of report.frameworks) {
    const req = MIN_FRAMEWORK[f.name];
    const v = minVersion(f.version);
    if (req && v && (v.major < req[0] || (v.major === req[0] && v.minor < req[1]))) {
      issues.push({
        severity: "error",
        code: "FRAMEWORK_VERSION",
        message: `${f.name}@${f.version} is older than the supported minimum ${req.join(".")}.`,
        fix: `Upgrade ${f.name} or use the framework-agnostic web adapter manually.`,
      });
    }
  }
  const names = report.frameworks.map((f) => f.name);
  if (
    names.includes("next") ||
    names.includes("nuxt") ||
    names.includes("sveltekit") ||
    names.includes("remix") ||
    names.includes("astro")
  ) {
    issues.push({
      severity: "info",
      code: "SSR",
      message: "Server-side rendering detected: the bootstrap only runs in the browser (guarded by `typeof window`).",
      fix: "No action needed.",
    });
  }
  for (const a of report.animationLibraries) {
    issues.push({
      severity: "warning",
      code: "ANIMATION_LIBRARY",
      message: `${a.name} is already used (${a.evidence}). Both can coexist; avoid animating the same element with both.`,
      fix: 'Mark elements owned by the other library with data-umx="off".',
    });
  }
  if (report.css.transformTransitions > 0) {
    issues.push({
      severity: "warning",
      code: "CSS_TRANSITIONS",
      message: `${report.css.transformTransitions} CSS transitions target transform/opacity/all.`,
      fix: "Auto-enhance skips such elements; remove the CSS transition to let Ultra Motion X animate them.",
    });
  }
  const supported = [
    "web",
    "electron",
    "tauri",
    "react-native",
    "flutter",
    "godot",
    "unity",
    "unreal",
    "dotnet-wpf",
    "winui",
    "qt",
  ];
  if (!supported.includes(report.platform))
    issues.push({
      severity: "error",
      code: "PLATFORM",
      message: `Unsupported or unrecognised platform \`${report.platform}\`.`,
      fix: "Pass --adapter explicitly.",
    });
  if (report.platform === "web" && !report.entryPoints.length)
    issues.push({
      severity: "error",
      code: "NO_ENTRY",
      message: "No application entry point found.",
      fix: "Pass --entry <file>.",
    });
  if (report.existingIntegration)
    issues.push({
      severity: "info",
      code: "ALREADY_INSTALLED",
      message: "Ultra Motion X is already integrated (.ultra-motion/manifest.json).",
      fix: "Use `umx update` or `umx doctor`.",
    });
  return { compatible: !issues.some((i) => i.severity === "error"), issues };
}
