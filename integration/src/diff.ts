/**
 * Line-based diffing (LCS) producing unified diffs and reversible hunks. Hunks are used by
 * rollback to undo *only* Ultra Motion X's own edits while keeping later user changes.
 */

export interface Hunk {
  /** Lines removed by the change (as they were before). */
  before: string[];
  /** Lines added by the change (as they are after). */
  after: string[];
  /** Up to 3 unchanged context lines preceding the hunk (after-version). */
  contextBefore: string[];
  contextAfter: string[];
}

function lcsTable(a: string[], b: string[]): Uint32Array {
  const n = a.length;
  const m = b.length;
  const t = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * (m + 1) + j] =
        a[i] === b[j]
          ? t[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(t[(i + 1) * (m + 1) + j]!, t[i * (m + 1) + j + 1]!);
    }
  }
  return t;
}

type Op = { kind: "eq" | "del" | "add"; line: string };

export function diffLines(oldText: string, newText: string): Op[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length * b.length > 25_000_000) {
    // Degenerate fallback for huge files: replace everything.
    return [...a.map((line) => ({ kind: "del" as const, line })), ...b.map((line) => ({ kind: "add" as const, line }))];
  }
  const t = lcsTable(a, b);
  const m = b.length;
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "eq", line: a[i]! });
      i++;
      j++;
    } else if (t[(i + 1) * (m + 1) + j]! >= t[i * (m + 1) + j + 1]!) ops.push({ kind: "del", line: a[i++]! });
    else ops.push({ kind: "add", line: b[j++]! });
  }
  while (i < a.length) ops.push({ kind: "del", line: a[i++]! });
  while (j < b.length) ops.push({ kind: "add", line: b[j++]! });
  return ops;
}

export function hunks(oldText: string, newText: string): Hunk[] {
  const ops = diffLines(oldText, newText);
  const out: Hunk[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k]!.kind === "eq") {
      k++;
      continue;
    }
    const start = k;
    const before: string[] = [];
    const after: string[] = [];
    while (k < ops.length && ops[k]!.kind !== "eq") {
      if (ops[k]!.kind === "del") before.push(ops[k]!.line);
      else after.push(ops[k]!.line);
      k++;
    }
    const contextBefore = ops
      .slice(Math.max(0, start - 3), start)
      .filter((o) => o.kind === "eq")
      .map((o) => o.line);
    const contextAfter = ops
      .slice(k, k + 3)
      .filter((o) => o.kind === "eq")
      .map((o) => o.line);
    out.push({ before, after, contextBefore, contextAfter });
  }
  return out;
}

export function unifiedDiff(path: string, oldText: string, newText: string): string {
  const ops = diffLines(oldText, newText);
  if (!ops.some((o) => o.kind !== "eq")) return "";
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  let oldLine = 1;
  let newLine = 1;
  let k = 0;
  while (k < ops.length) {
    if (ops[k]!.kind === "eq") {
      oldLine++;
      newLine++;
      k++;
      continue;
    }
    const ctxStart = Math.max(0, k - 3);
    let end = k;
    while (end < ops.length) {
      if (ops[end]!.kind !== "eq") {
        end++;
        continue;
      }
      let run = 0;
      while (end + run < ops.length && ops[end + run]!.kind === "eq") run++;
      if (run > 6 || end + run >= ops.length) {
        end += Math.min(run, 3);
        break;
      }
      end += run;
    }
    const pre = k - ctxStart;
    const chunk = ops.slice(ctxStart, end);
    const oldCount = chunk.filter((o) => o.kind !== "add").length;
    const newCount = chunk.filter((o) => o.kind !== "del").length;
    lines.push(`@@ -${oldLine - pre},${oldCount} +${newLine - pre},${newCount} @@`);
    for (const o of chunk) lines.push(`${o.kind === "eq" ? " " : o.kind === "del" ? "-" : "+"}${o.line}`);
    for (const o of ops.slice(k, end)) {
      if (o.kind !== "add") oldLine++;
      if (o.kind !== "del") newLine++;
    }
    k = end;
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Reverts `hunks` (from base→ours) on `current` text, which may contain later user edits.
 * Each hunk is located by its `after` lines plus context. Returns null if any hunk cannot be
 * located unambiguously (conflict).
 */
export function revertHunks(current: string, hs: Hunk[]): string | null {
  let lines = current.split("\n");
  for (const h of [...hs].reverse()) {
    const needle = [...h.contextBefore, ...h.after, ...h.contextAfter];
    const matches: number[] = [];
    for (let i = 0; i + needle.length <= lines.length; i++) {
      if (needle.every((l, k) => lines[i + k] === l)) matches.push(i);
    }
    if (matches.length !== 1) {
      // Retry without context (the user may have edited around our lines).
      if (h.after.length === 0) return null;
      const bare: number[] = [];
      for (let i = 0; i + h.after.length <= lines.length; i++)
        if (h.after.every((l, k) => lines[i + k] === l)) bare.push(i);
      if (bare.length !== 1) return null;
      const at = bare[0]!;
      lines = [...lines.slice(0, at), ...h.before, ...lines.slice(at + h.after.length)];
      continue;
    }
    const at = matches[0]! + h.contextBefore.length;
    lines = [...lines.slice(0, at), ...h.before, ...lines.slice(at + h.after.length)];
  }
  return lines.join("\n");
}
