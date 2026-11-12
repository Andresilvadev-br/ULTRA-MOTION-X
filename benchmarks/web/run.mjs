#!/usr/bin/env node
/**
 * Lightweight, explicit benchmark harness for the TypeScript spring math.
 * Measures compute throughput, NOT rendering FPS or user-perceived latency.
 */
import { performance } from "node:perf_hooks";
import { Spring, springParams } from "../../sdk/typescript/dist/math/spring.js";

const iterations = Number.parseInt(process.env.UMX_BENCH_ITERATIONS ?? "100000", 10);
if (!Number.isSafeInteger(iterations) || iterations <= 0 || iterations > 10000000) {
  console.error("UMX_BENCH_ITERATIONS must be between 1 and 10,000,000.");
  process.exit(2);
}
const spring = new Spring(springParams({ stiffness: 320, damping: 28, mass: 1 }), 0, 100, 0);
let checksum = 0;
const started = performance.now();
for (let i = 0; i < iterations; i++) checksum += spring.sample((i % 120) / 120).value;
const ms = performance.now() - started;
console.log(
  JSON.stringify(
    {
      benchmark: "spring.sample",
      iterations,
      ms: Number(ms.toFixed(3)),
      samplesPerSecond: Math.round(iterations / (ms / 1000)),
      checksum,
      note: "Compute-only; does not measure GPU/render FPS",
    },
    null,
    2,
  ),
);
