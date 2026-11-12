#!/usr/bin/env node
/**
 * Compares two benchmark result files (native umx-bench JSON or web JSON) and reports
 * regressions above a tolerance. Exit code 1 when a regression is found.
 *   node benchmarks/compare.mjs <baseline.json> <current.json> [--tolerance 0.15]
 */
import { readFileSync } from "node:fs";

const [, , a, b] = process.argv;
const ti = process.argv.indexOf("--tolerance");
const tol = ti > 0 ? Number(process.argv[ti + 1]) : 0.15;
if (!a || !b) {
  console.error("usage: node benchmarks/compare.mjs <baseline.json> <current.json> [--tolerance 0.15]");
  process.exit(2);
}
const base = JSON.parse(readFileSync(a, "utf8"));
const cur = JSON.parse(readFileSync(b, "utf8"));
if (base.kind !== cur.kind) {
  console.error(`different benchmark kinds: ${base.kind} vs ${cur.kind}`);
  process.exit(2);
}
const metric = (r) =>
  base.kind === "umx-native-bench"
    ? { p50: r.dist.p50, p95: r.dist.p95 }
    : { p50: r.engineWorkMs.p50, p95: r.engineWorkMs.p95 };
let regressions = 0;
for (const [name, r] of Object.entries(cur.results)) {
  const old = base.results[name];
  if (!old) continue;
  const m0 = metric(old);
  const m1 = metric(r);
  for (const k of ["p50", "p95"]) {
    const change = m0[k] > 0 ? (m1[k] - m0[k]) / m0[k] : 0;
    const flag = change > tol ? "REGRESSION" : change < -tol ? "improved" : "ok";
    if (flag === "REGRESSION") regressions++;
    console.log(
      `${name.padEnd(36)} ${k} ${m0[k].toFixed(3)} → ${m1[k].toFixed(3)} (${(change * 100).toFixed(1)}%) ${flag}`,
    );
  }
}
if (JSON.stringify(base.environment) !== JSON.stringify(cur.environment))
  console.log("note: environments differ — differences may not be regressions");
process.exit(regressions ? 1 : 0);
