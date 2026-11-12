#!/usr/bin/env node
/**
 * Browser benchmarks (Chromium via Playwright). Measures the engine's own telemetry while N
 * elements are animated with continuous retargeting: frame interval distribution and engine
 * work per frame (update + write phases). Results include the environment; headless
 * Chromium usually renders without GPU acceleration and without a real display, so frame
 * intervals here are NOT representative of a user's machine — compare runs only against
 * runs from the same environment (benchmarks/compare.mjs).
 *
 *   node benchmarks/web/browser.mjs [--quick] [--out benchmarks/results/web-<name>.json]
 */
import { writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { launch, startServer } from "../../tests/browser/helpers.mjs";

const quick = process.argv.includes("--quick");
const outIdx = process.argv.indexOf("--out");
const out = outIdx > 0 ? process.argv[outIdx + 1] : null;
const duration = quick ? 1500 : 4000;
const scenarios = [
  { name: "transform-100-raf", count: 100, compositor: false, prop: "transform" },
  { name: "transform-1000-raf", count: 1000, compositor: false, prop: "transform" },
  { name: "transform-1000-compositor", count: 1000, compositor: true, prop: "transform" },
  { name: "opacity-1000-raf", count: 1000, compositor: false, prop: "opacity" },
  { name: "transform-3000-raf", count: 3000, compositor: false, prop: "transform" },
];

const server = await startServer("examples/serve.mjs", { UMX_EXAMPLES_PORT: "0" });
const browser = await launch();
const results = {};
try {
  for (const s of scenarios) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${server.base}/examples/bench/`);
    await page.waitForFunction(() => window.ready === true);
    const r = await page.evaluate((cfg) => window.runScenario(cfg), {
      ...s,
      durationMs: duration,
      retargetEveryMs: 250,
    });
    results[s.name] = {
      frames: r.frames,
      frameIntervalMs: { p50: r.frameInterval.p50, p95: r.frameInterval.p95, p99: r.frameInterval.p99 },
      engineWorkMs: { p50: r.engineWork.p50, p95: r.engineWork.p95, p99: r.engineWork.p99 },
      updateMs: r.phaseUpdate && { p50: r.phaseUpdate.p50, p95: r.phaseUpdate.p95 },
      writeMs: r.phaseWrite && { p50: r.phaseWrite.p50, p95: r.phaseWrite.p95 },
      droppedFrames: r.droppedFrames,
      refreshHz: r.refreshHz,
      writes: r.counters.writes,
      redundantWritesSkipped: r.counters.redundantWritesSkipped,
    };
    console.error(
      `${s.name.padEnd(28)} engine p50 ${r.engineWork.p50.toFixed(2)} ms  p95 ${r.engineWork.p95.toFixed(2)} ms  interval p95 ${r.frameInterval.p95.toFixed(1)} ms`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.proc.kill();
}
const report = {
  kind: "umx-web-bench",
  version: "1.0.0",
  environment: {
    browser: `chromium ${browser.version()}`,
    headless: true,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    threads: cpus().length,
    node: process.versions.node,
    quick,
    durationMs: duration,
  },
  caveats: [
    "Headless Chromium; GPU compositing and display refresh are not representative.",
    "engineWorkMs is measured with performance.now() inside the page; frame intervals come from requestAnimationFrame timestamps.",
  ],
  results,
};
const json = JSON.stringify(report, null, 2);
if (out) writeFileSync(out, `${json}\n`);
console.log(json);
