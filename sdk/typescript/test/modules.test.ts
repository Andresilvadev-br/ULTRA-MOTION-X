import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  adaptProfile,
  CpuParticles,
  compareRecordings,
  createEngine,
  detectAnomalies,
  diagnose,
  FidelityController,
  type GraphDef,
  graphFromPlan,
  ManualDriver,
  MotionDNA,
  MotionGraph,
  MotionValue,
  PROFILE_NAMES,
  powerPolicy,
  RefreshEstimator,
  replayScenario,
  snapRate,
  springParams,
  TempoModule,
  validateGraph,
} from "../src/index.ts";
import { loadCore } from "../src/wasm/index.ts";

const setup = () => {
  const driver = new ManualDriver();
  return { driver, engine: createEngine({ driver, powerAware: false }) };
};

const panel = (): GraphDef => ({
  properties: { x: { initial: -300, min: -320, max: 0 }, scrim: { initial: 0 } },
  states: { closed: { x: -300 }, open: { x: 0 } },
  initial: "closed",
  transitions: [
    { from: "closed", to: "open", event: "toggle" },
    { from: "open", to: "closed", event: "toggle" },
  ],
  defaultSpec: { type: "spring", spring: springParams({ stiffness: 300, damping: 30 }) },
  relations: [{ source: "x", target: "scrim", input: [-300, 0], output: [0, 0.5] }],
});

test("motion graph: transitions, relations, continuity, completion", async () => {
  const { driver, engine } = setup();
  const g = new MotionGraph(panel(), { engine });
  const events: string[] = [];
  g.on((e) => events.push(e.type));
  g.send("toggle");
  let last = g.get("x");
  let maxJump = 0;
  for (let i = 0; i < 240; i++) {
    if (i === 8 || i === 12) g.send("toggle");
    driver.step(1000 / 120);
    maxJump = Math.max(maxJump, Math.abs(g.get("x") - last));
    last = g.get("x");
  }
  driver.run(1000 / 120);
  await new Promise((r) => setTimeout(r, 0)); // completion is promise-based (microtasks)
  assert.ok(maxJump < 40, `jump ${maxJump}`);
  assert.equal(g.state, "open");
  assert.ok(Math.abs(g.get("scrim") - 0.5) < 1e-3);
  assert.ok(events.includes("interrupt") && events.includes("transitionend"));
});

test("motion graph: incremental retarget and validation", () => {
  const { driver, engine } = setup();
  const g = new MotionGraph(panel(), { engine });
  g.send("toggle");
  const r = g.rebuilds;
  driver.step(16);
  g.setStateValue("open", "x", -20);
  assert.equal(g.rebuilds, r + 1);
  const bad = panel();
  bad.relations!.push({ source: "scrim", target: "x", input: [0, 1], output: [0, 1] });
  const codes = validateGraph(bad).map((d) => d.code);
  assert.ok(codes.includes("E_CYCLE") && codes.includes("E_OWNERSHIP"));
  assert.throws(() => new MotionGraph(bad, { engine }));
});

test("motion graph: gesture hand-off keeps velocity", () => {
  const { engine } = setup();
  const g = new MotionGraph(panel(), { engine });
  g.beginGesture("x");
  g.setGestureValue("x", -150, 900);
  assert.equal(g.get("scrim"), 0.25);
  g.endGesture("x", 900, "toggle");
  assert.equal(g.values.x!.velocity, 900);
  assert.equal(g.state, "open");
});

test("WASM core: compile MDL, drive a compiled graph in TS and in Rust", async () => {
  const core = await loadCore();
  assert.match(core.version, /^\d+\.\d+\.\d+$/);
  const src = readFileSync(new URL("../../../examples/mdl/app.umx.json", import.meta.url), "utf8");
  const out = core.compile(src);
  assert.equal(out.ok, true, JSON.stringify(out.diagnostics));
  const { driver, engine } = setup();
  // biome-ignore lint/suspicious/noExplicitAny: plan JSON
  const g = graphFromPlan(out.plan as any, "drawer", { engine });
  g.send("toggle");
  driver.run(1000 / 60);
  assert.ok(Math.abs(g.get("x")) < 0.01);
  const bad = core.compile({ version: "umx/1", components: { c: { properties: { x: 0 }, states: { a: {}, b: {} } } } });
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.some((d) => d.code === "E_INITIAL_REQUIRED"));
  assert.match(core.inspect(src, "dot"), /^digraph/);
  const rust = core.createEngine(1000 / 120);
  rust.loadMDL(src);
  const inst = rust.instance("drawer");
  assert.equal(rust.send(inst, "toggle"), true);
  for (let i = 0; i < 240; i++) rust.frame(i * 8);
  assert.ok(Math.abs(rust.instanceValue(inst, "x")) < 0.01);
  // TS and Rust agree on the spring math through the ABI too.
  const k = 300;
  const c = 20;
  assert.ok(
    Math.abs(
      core.springPosition(k, c, 1, 0, 1, 0, 0.1) -
        new (await import("../src/math/spring.ts")).Spring(springParams({ stiffness: k, damping: c }), 0, 1, 0).sample(
          0.1,
        ).value,
    ) < 1e-12,
  );
  rust.free();
  const p = core.createParticles(100, 3);
  p.addEmitter({ x: 0, y: 0, rate: 0, direction: 0, spread: 6, speed: [10, 20], life: [0.1, 0.2], size: [1, 2] });
  assert.equal(p.burst(0, 30), 30);
  assert.equal(p.step(0.01).length, 120);
  p.free();
});

test("Motion DNA: all profiles valid, CSS variables, custom profiles", () => {
  assert.equal(PROFILE_NAMES.length, 9);
  for (const n of PROFILE_NAMES) MotionDNA.profile(n).validate();
  const dna = MotionDNA.profile("professional");
  assert.equal(dna.cssVariables()["--umx-duration-fast"], "120ms");
  assert.throws(() => MotionDNA.profile("nope"));
  assert.throws(() => MotionDNA.custom("minimal", { intensity: 2 }));
  const roundtrip = MotionDNA.fromJSON(JSON.stringify(dna.toJSON()));
  assert.deepEqual(roundtrip.data, dna.data);
  const fast = adaptProfile(dna, 0.7);
  assert.ok(fast.duration("normal") < dna.duration("normal"));
});

test("timeline sampling is exact and scrubbable", async () => {
  const { Timeline } = await import("../src/orchestration/timeline.ts");
  const { driver, engine } = setup();
  const a = new MotionValue(0, engine);
  const b = new MotionValue(0, engine);
  const tl = new Timeline(
    [
      [a, 100, { type: "tween", duration: 1000, ease: "linear" }],
      { label: "mid", at: 500 },
      [b, 10, { type: "tween", duration: 500, ease: "linear", at: "mid" }],
    ],
    { engine, autoplay: false },
  );
  assert.equal(tl.duration, 1);
  tl.seek(750);
  assert.equal(a.get(), 75);
  assert.equal(b.get(), 5);
  tl.seek(250);
  assert.equal(b.get(), 0);
  tl.play();
  driver.run(16);
  assert.equal(a.get(), 100);
  assert.equal(await tl.finished, "completed");
});

test("fidelity, refresh and power policies", () => {
  const f = new FidelityController();
  for (let i = 0; i < 200; i++) f.observe(true);
  assert.ok(f.level < 3);
  const r = new RefreshEstimator();
  let t = 0;
  for (let i = 0; i < 60; i++) r.sample((t += 1000 / 144));
  assert.equal(r.hz, 144);
  assert.equal(snapRate(59.9), 60);
  assert.equal(powerPolicy({}).maxFidelity, 4);
  assert.equal(powerPolicy({ visible: false }).suspend, true);
  assert.equal(powerPolicy({ pressure: "critical" }).maxFidelity, 0);
});

test("time machine: deterministic replay across refresh rates, no anomalies", () => {
  const scenario = (hz: number) =>
    replayScenario(
      (engine) => [new MotionValue(0, engine, { name: "x" })],
      [
        { at: 0, run: (e) => e.emit("noop", null) },
        { at: 0, run: () => undefined },
      ].map((s) => s),
      { hz, durationMs: 50 },
    );
  assert.equal(scenario(60).format, "umx-recording/1");
  const run = (hz: number) => {
    let v!: MotionValue;
    return replayScenario(
      (engine) => [(v = new MotionValue(0, engine, { name: "x" }))],
      [
        { at: 0, run: () => v.animate(100, { type: "spring", spring: springParams({ stiffness: 200, damping: 20 }) }) },
        { at: 120, run: () => v.animate(0, { type: "spring", spring: springParams({ stiffness: 200, damping: 20 }) }) },
      ],
      { hz, durationMs: 1500 },
    );
  };
  const a = run(60);
  const b = run(240);
  assert.deepEqual(detectAnomalies(a), []);
  const diff = compareRecordings(a, b).x!;
  assert.ok(diff.maxDiff < 15, `max diff ${diff.maxDiff}`);
  assert.ok(a.events.some((e) => e.kind === "animation:interrupt"));
});

test("particles: capacity, idle, fidelity", () => {
  const p = new CpuParticles(100, 1);
  p.addEmitter({
    x: 0,
    y: 0,
    rate: 1e5,
    direction: 0,
    spread: 1,
    speed: [1, 2],
    life: [5, 5],
    size: [1, 1],
    active: true,
  });
  for (let i = 0; i < 10; i++) p.step(1 / 60);
  assert.equal(p.count, 100);
  p.setEmitter(0, { active: false });
  for (let i = 0; i < 400; i++) p.step(1 / 60);
  assert.equal(p.idle, true);
  assert.throws(() => new CpuParticles(1e7));
});

test("autotune diagnoses measurable problems only", () => {
  const { engine } = setup();
  const r = engine.report();
  assert.equal(
    diagnose(r, { initialFidelity: 3, compositor: "auto", budgetFraction: 0.5 })[0]!.id,
    "insufficient-data",
  );
  const tempo = new TempoModule();
  for (let i = 0; i < 10; i++) tempo.observe({ kind: "press", time: i * 200 });
  assert.ok(tempo.suggest()!.speed < 0.7);
});
