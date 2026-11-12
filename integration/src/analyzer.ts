/**
 * Project analyzer: detects languages, frameworks, build system, package manager, entry
 * points, existing animation mechanisms and UI components (Automatic Motion Discovery).
 * Read-only; never executes project code.
 */
import { join } from "node:path";
import { exists, readJson, readText, walk } from "./util.ts";

export type Platform =
  | "web"
  | "electron"
  | "tauri"
  | "react-native"
  | "flutter"
  | "godot"
  | "unity"
  | "unreal"
  | "dotnet-wpf"
  | "winui"
  | "qt"
  | "unknown";

export interface Detection {
  name: string;
  version?: string;
  confidence: number;
  evidence: string;
}

export interface DiscoveredComponent {
  file: string;
  line: number;
  role: string;
  confidence: number;
  snippet: string;
}

export interface ProjectReport {
  root: string;
  platform: Platform;
  languages: string[];
  frameworks: Detection[];
  buildSystem: Detection | null;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | null;
  typescript: boolean;
  entryPoints: string[];
  animationLibraries: Detection[];
  css: { files: number; transitions: number; keyframes: number; transformTransitions: number };
  components: DiscoveredComponent[];
  existingIntegration: boolean;
  adapter: string;
  warnings: string[];
}

const ANIMATION_LIBS: Record<string, string> = {
  "framer-motion": "Framer Motion",
  motion: "Motion",
  gsap: "GSAP",
  animejs: "anime.js",
  "@react-spring/web": "React Spring",
  "react-spring": "React Spring",
  "react-transition-group": "React Transition Group",
  "@formkit/auto-animate": "AutoAnimate",
  "lottie-web": "Lottie",
  "lottie-react": "Lottie",
  popmotion: "Popmotion",
  "velocity-animate": "Velocity",
  "@angular/animations": "Angular Animations",
  "react-native-reanimated": "Reanimated",
};

const FRAMEWORKS: Array<[string, string]> = [
  ["next", "next"],
  ["nuxt", "nuxt"],
  ["@sveltejs/kit", "sveltekit"],
  ["@remix-run/react", "remix"],
  ["astro", "astro"],
  ["react-native", "react-native"],
  ["react", "react"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["@angular/core", "angular"],
  ["solid-js", "solid"],
  ["preact", "preact"],
  ["lit", "lit"],
  ["electron", "electron"],
  ["@tauri-apps/api", "tauri"],
];

const BUILD: Array<[string, string]> = [
  ["vite", "vite"],
  ["webpack", "webpack"],
  ["@angular/cli", "angular-cli"],
  ["parcel", "parcel"],
  ["esbuild", "esbuild"],
  ["rollup", "rollup"],
  ["@rspack/core", "rspack"],
  ["turbopack", "turbopack"],
];

interface RolePattern {
  role: string;
  re: RegExp;
  confidence: number;
}

/** Static discovery patterns (runtime discovery in the SDK uses the same vocabulary). */
const ROLE_PATTERNS: RolePattern[] = [
  { role: "button", re: /<button\b/i, confidence: 0.95 },
  { role: "button", re: /<(?:a|div|span)\b[^>]*role=["']button["']/i, confidence: 0.9 },
  {
    role: "modal",
    re: /<dialog\b|role=["'](?:alert)?dialog["']|\b(?:class|className)=["'][^"']*\bmodal\b/i,
    confidence: 0.9,
  },
  { role: "drawer", re: /\b(?:class|className)=["'][^"']*\b(?:drawer|sidebar|offcanvas)\b/i, confidence: 0.7 },
  {
    role: "menu",
    re: /role=["'](?:menu|menubar|listbox)["']|\b(?:class|className)=["'][^"']*\b(?:dropdown|menu|popover)\b/i,
    confidence: 0.75,
  },
  { role: "tabs", re: /role=["']tablist["']|\b(?:class|className)=["'][^"']*\btabs?\b/i, confidence: 0.75 },
  { role: "card", re: /\b(?:class|className)=["'][^"']*\b(?:card|tile)\b/i, confidence: 0.7 },
  {
    role: "notification",
    re: /role=["'](?:status|alert)["']|\b(?:class|className)=["'][^"']*\b(?:toast|snackbar|notification)\b/i,
    confidence: 0.8,
  },
  { role: "tooltip", re: /role=["']tooltip["']|\b(?:class|className)=["'][^"']*\btooltip\b/i, confidence: 0.8 },
  { role: "navigation", re: /<nav\b/i, confidence: 0.9 },
  { role: "list", re: /<(?:ul|ol)\b|\.map\(\s*\(?\w+/i, confidence: 0.5 },
  { role: "disclosure", re: /<details\b/i, confidence: 0.9 },
  { role: "form", re: /<form\b/i, confidence: 0.95 },
  { role: "progress", re: /<progress\b|role=["']progressbar["']/i, confidence: 0.9 },
  { role: "overlay", re: /\b(?:class|className)=["'][^"']*\b(?:overlay|backdrop|scrim)\b/i, confidence: 0.6 },
];

const SOURCE_EXT = [".tsx", ".jsx", ".ts", ".js", ".mjs", ".vue", ".svelte", ".html", ".astro"];
const CSS_EXT = [".css", ".scss", ".sass", ".less"];

export function analyzeProject(root: string): ProjectReport {
  const warnings: string[] = [];
  const pkg = readJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    main?: string;
    scripts?: Record<string, string>;
  }>(join(root, "package.json"));
  const deps: Record<string, string> = { ...(pkg?.devDependencies ?? {}), ...(pkg?.dependencies ?? {}) };
  const frameworks: Detection[] = [];
  for (const [dep, name] of FRAMEWORKS) {
    if (deps[dep])
      frameworks.push({
        name,
        version: deps[dep],
        confidence: 1,
        evidence: `package.json dependency ${dep}@${deps[dep]}`,
      });
  }
  const files = walk(root);
  const has = (p: string) => exists(join(root, p));
  const anyFile = (re: RegExp) => files.find((f) => re.test(f));

  let platform: Platform = "unknown";
  if (has("pubspec.yaml")) platform = "flutter";
  else if (has("project.godot")) platform = "godot";
  else if (has("ProjectSettings/ProjectVersion.txt")) platform = "unity";
  else if (anyFile(/\.uproject$/)) platform = "unreal";
  else if (deps["react-native"]) platform = "react-native";
  else if (deps.electron) platform = "electron";
  else if (deps["@tauri-apps/api"] || has("src-tauri/tauri.conf.json")) platform = "tauri";
  else if (anyFile(/\.csproj$/)) {
    const csproj = readText(join(root, anyFile(/\.csproj$/)!)) ?? "";
    if (/Microsoft\.WindowsAppSDK|UseWinUI/i.test(csproj)) platform = "winui";
    else if (/UseWPF/i.test(csproj)) platform = "dotnet-wpf";
  } else if ((readText(join(root, "CMakeLists.txt")) ?? "").match(/find_package\(\s*Qt[56]/) || anyFile(/\.pro$/))
    platform = "qt";
  else if (pkg || anyFile(/\.html$/)) platform = "web";

  if (platform === "flutter") frameworks.push({ name: "flutter", confidence: 1, evidence: "pubspec.yaml" });
  if (platform === "godot") frameworks.push({ name: "godot", confidence: 1, evidence: "project.godot" });
  if (platform === "unity")
    frameworks.push({
      name: "unity",
      version: (readText(join(root, "ProjectSettings/ProjectVersion.txt")) ?? "").match(
        /m_EditorVersion:\s*(\S+)/,
      )?.[1],
      confidence: 1,
      evidence: "ProjectSettings/ProjectVersion.txt",
    });
  if (platform === "unreal") frameworks.push({ name: "unreal", confidence: 1, evidence: anyFile(/\.uproject$/)! });
  if (platform === "dotnet-wpf" || platform === "winui")
    frameworks.push({ name: platform, confidence: 0.9, evidence: anyFile(/\.csproj$/)! });
  if (platform === "qt") frameworks.push({ name: "qt", confidence: 0.9, evidence: "CMakeLists.txt / .pro" });

  let buildSystem: Detection | null = null;
  for (const [dep, name] of BUILD) {
    if (deps[dep]) {
      buildSystem = { name, version: deps[dep], confidence: 1, evidence: `dependency ${dep}` };
      break;
    }
  }
  if (!buildSystem && frameworks.some((f) => f.name === "next"))
    buildSystem = { name: "next", confidence: 1, evidence: "next dependency" };
  if (!buildSystem && has("Cargo.toml")) buildSystem = { name: "cargo", confidence: 1, evidence: "Cargo.toml" };
  if (!buildSystem && has("CMakeLists.txt")) buildSystem = { name: "cmake", confidence: 1, evidence: "CMakeLists.txt" };

  const packageManager = has("pnpm-lock.yaml")
    ? "pnpm"
    : has("yarn.lock")
      ? "yarn"
      : has("bun.lockb") || has("bun.lock")
        ? "bun"
        : has("package-lock.json") || pkg
          ? "npm"
          : null;
  const typescript = has("tsconfig.json") || !!deps.typescript;

  const languages = new Set<string>();
  for (const f of files) {
    if (/\.(tsx?|mts)$/.test(f)) languages.add("typescript");
    else if (/\.(jsx?|mjs|cjs)$/.test(f)) languages.add("javascript");
    else if (/\.cs$/.test(f)) languages.add("csharp");
    else if (/\.(cpp|cc|h|hpp)$/.test(f)) languages.add("cpp");
    else if (/\.dart$/.test(f)) languages.add("dart");
    else if (/\.gd$/.test(f)) languages.add("gdscript");
    else if (/\.rs$/.test(f)) languages.add("rust");
    else if (/\.vue$/.test(f)) languages.add("vue");
    else if (/\.svelte$/.test(f)) languages.add("svelte");
    else if (/\.html?$/.test(f)) languages.add("html");
  }

  const entryPoints = detectEntries(
    root,
    files,
    frameworks.map((f) => f.name),
  );

  const animationLibraries: Detection[] = [];
  for (const [dep, name] of Object.entries(ANIMATION_LIBS)) {
    if (deps[dep]) animationLibraries.push({ name, version: deps[dep], confidence: 1, evidence: `dependency ${dep}` });
  }
  const css = { files: 0, transitions: 0, keyframes: 0, transformTransitions: 0 };
  for (const f of files.filter((x) => CSS_EXT.some((e) => x.endsWith(e)))) {
    const t = readText(join(root, f)) ?? "";
    css.files++;
    css.transitions += (t.match(/\btransition\s*:/g) ?? []).length;
    css.keyframes += (t.match(/@keyframes\b/g) ?? []).length;
    css.transformTransitions += (t.match(/transition\s*:[^;]*(transform|all|opacity)/g) ?? []).length;
  }
  if (css.transformTransitions)
    warnings.push(
      `${css.transformTransitions} CSS transitions on transform/opacity/all found; auto-enhance skips those elements to avoid double animation.`,
    );

  const components: DiscoveredComponent[] = [];
  for (const f of files.filter((x) => SOURCE_EXT.some((e) => x.endsWith(e)))) {
    if (f.includes("ultra-motion")) continue;
    const text = readText(join(root, f));
    if (!text) continue;
    if (/\b(vue|svelte|motion|gsap)\b.*Transition|<Transition\b|transition:/i.test(text) && /\.(vue|svelte)$/.test(f)) {
      animationLibraries.push({
        name: f.endsWith(".vue") ? "Vue <Transition>" : "Svelte transitions",
        confidence: 0.8,
        evidence: f,
      });
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const p of ROLE_PATTERNS) {
        if (p.re.test(line)) {
          components.push({
            file: f,
            line: i + 1,
            role: p.role,
            confidence: p.confidence,
            snippet: line.trim().slice(0, 140),
          });
          break;
        }
      }
    });
  }

  const existingIntegration = has(".ultra-motion/manifest.json");
  const names = frameworks.map((f) => f.name);
  const adapter =
    platform === "web" || platform === "electron" || platform === "tauri"
      ? names.includes("react") || names.includes("next")
        ? "react"
        : names.includes("vue") || names.includes("nuxt")
          ? "vue"
          : names.includes("svelte") || names.includes("sveltekit")
            ? "svelte"
            : names.includes("angular")
              ? "angular"
              : "web"
      : platform;
  if (animationLibraries.some((a) => /Framer|Motion|GSAP|Spring/.test(a.name))) {
    warnings.push(
      "Another animation library is present; Ultra Motion X will not touch elements it animates unless annotated with data-umx.",
    );
  }
  if (platform === "unknown")
    warnings.push("Platform not recognised; use an explicit adapter (umx install --adapter <name>).");
  return {
    root,
    platform,
    languages: [...languages].sort(),
    frameworks,
    buildSystem,
    packageManager,
    typescript,
    entryPoints,
    animationLibraries: dedupe(animationLibraries),
    css,
    components,
    existingIntegration,
    adapter,
    warnings,
  };
}

function dedupe(d: Detection[]): Detection[] {
  const seen = new Set<string>();
  return d.filter((x) => {
    if (seen.has(x.name)) return false;
    seen.add(x.name);
    return true;
  });
}

function detectEntries(root: string, files: string[], frameworks: string[]): string[] {
  const out: string[] = [];
  const index = readText(join(root, "index.html"));
  if (index) {
    const m = index.match(/<script[^>]+type=["']module["'][^>]+src=["']\/?([^"']+)["']/i);
    if (m && files.includes(m[1]!)) out.push(m[1]!);
  }
  if (frameworks.includes("next")) {
    for (const f of [
      "app/layout.tsx",
      "app/layout.jsx",
      "src/app/layout.tsx",
      "src/app/layout.jsx",
      "pages/_app.tsx",
      "pages/_app.jsx",
      "src/pages/_app.tsx",
    ])
      if (files.includes(f)) out.push(f);
  }
  for (const f of [
    "src/main.tsx",
    "src/main.ts",
    "src/main.jsx",
    "src/main.js",
    "src/index.tsx",
    "src/index.ts",
    "src/index.jsx",
    "src/index.js",
    "main.js",
    "index.js",
    "src/app.tsx",
  ]) {
    if (files.includes(f) && !out.includes(f)) out.push(f);
  }
  if (!out.length && index) out.push("index.html");
  return out;
}
