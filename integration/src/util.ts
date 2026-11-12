import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "target",
  ".ultra-motion",
  "vendor",
  "coverage",
  ".turbo",
  ".cache",
  "Library",
  "Temp",
  "obj",
  "bin",
  ".godot",
  "Intermediate",
  "Binaries",
  "DerivedDataCache",
  "Saved",
]);
/** Files larger than this are never read by the analyzer. */
export const MAX_SCAN_BYTES = 512 * 1024;
export const MAX_SCAN_FILES = 5000;

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function readJson<T = Record<string, unknown>>(path: string): T | null {
  const t = readText(path);
  if (t === null) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

/** Atomic write: temp file + rename (never leaves half-written files). */
export function writeAtomic(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.umx-tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export interface WalkOptions {
  extensions?: string[];
  maxFiles?: number;
}

/** Recursive file listing (POSIX-style relative paths), skipping heavy/generated dirs. */
export function walk(root: string, opts: WalkOptions = {}): string[] {
  const out: string[] = [];
  const max = opts.maxFiles ?? MAX_SCAN_FILES;
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries.sort()) {
      if (name.startsWith(".") && name !== ".claude") continue;
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!IGNORED_DIRS.has(name)) stack.push(full);
      } else if (!opts.extensions || opts.extensions.some((e) => name.endsWith(e))) {
        if (st.size <= MAX_SCAN_BYTES) out.push(toPosix(relative(root, full)));
        if (out.length >= max) break;
      }
    }
  }
  return out.sort();
}

export const toPosix = (p: string): string => p.split(sep).join("/");
export const exists = (p: string): boolean => existsSync(p);

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string;
}

export function parseSemver(v: string): SemVer | null {
  const m = v
    .trim()
    .replace(/^[v=^~>< ]+/, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return { major: +m[1]!, minor: +(m[2] ?? 0), patch: +(m[3] ?? 0), pre: m[4] ?? "" };
}

export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return 0;
  for (const k of ["major", "minor", "patch"] as const) if (x[k] !== y[k]) return x[k] - y[k];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** `major` | `minor` | `patch` | `none` | `downgrade`. */
export function semverChange(from: string, to: string): "major" | "minor" | "patch" | "none" | "downgrade" {
  const c = compareSemver(to, from);
  if (c === 0) return "none";
  if (c < 0) return "downgrade";
  const a = parseSemver(from)!;
  const b = parseSemver(to)!;
  return a.major !== b.major ? "major" : a.minor !== b.minor ? "minor" : "patch";
}

/** Minimum version declared by a dependency range (`^18.2.0` → 18.2.0). */
export function minVersion(range: string | undefined): SemVer | null {
  if (!range) return null;
  if (/^(workspace:|file:|link:|git|https?:)/.test(range)) return null;
  return parseSemver(range.split("||")[0]!.trim());
}
