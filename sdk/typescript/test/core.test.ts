import assert from "node:assert/strict";
import { test } from "node:test";
import { ManualDriver } from "../src/core/driver.ts";
import { createEngine } from "../src/core/engine.ts";
import { MotionValue } from "../src/core/motion-value.ts";
import { animate } from "../src/dom/animate.ts";
import { namedEasing } from "../src/math/easing.ts";
import { springParams } from "../src/math/spring.ts";

const spring = { type: "spring" as const, spring: springParams({ stiffness: 300, damping: 30 }) };

function setup() {
  const driver = new ManualDriver();
  const engine = createEngine({ driver, powerAware: false });
  return { driver, engine };
}

test("engine is idle until something animates and stops when done", () => {
  const { driver, engine } = setup();
  const v = new MotionValue(0, engine);
  assert.equal(driver.hasPendingFrame, false);
  const a = v.animate(100, spring);
  assert.equal(driver.hasPendingFrame, true);
  const frames = driver.run(1000 / 120);
  assert.ok(frames > 10 && frames < 1000, `frames=${frames}`);
  assert.equal(v.get(), 100);
  assert.equal(a.state, "completed");
  assert.equal(driver.hasPendingFrame, false, "loop must stop when idle");
});

test("interruptions preserve velocity and position", () => {
  const { driver, engine } = setup();
  const v = new MotionValue(0, engine);
  v.animate(100, spring);
  for (let i = 0; i < 6; i++) driver.step(1000 / 60);
  const pos = v.get();
  const vel = v.velocity;
  assert.ok(vel > 0);
  const first = v.currentAnimation!;
  v.animate(-100, spring);
  assert.equal(first.state, "interrupted");
  driver.step(0.001);
  assert.ok(Math.abs(v.get() - pos) < 1, "no jump on retarget");
  assert.ok(v.velocity > 0, "momentum carried into the new spring");
});

test("frame-rate independence for springs", () => {
  const run = (hz: number) => {
    const { driver, engine } = setup();
    const v = new MotionValue(0, engine);
    v.animate(1, spring);
    // The first frame after an idle loop establishes the time origin (dt = 0).
    for (let i = 0; i <= hz / 4; i++) driver.step(1000 / hz);
    return v.get();
  };
  const a = run(60);
  const b = run(240);
  assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
});

test("priorities: gesture owner rejects decorative requests", () => {
  const { engine } = setup();
  const v = new MotionValue(0, engine);
  v.animate(10, spring, { priority: "gesture" });
  const r = v.animate(-10, spring, { priority: "decorative" });
  assert.equal(r.state, "rejected");
});

test("queue policy runs after the owner completes", async () => {
  const { driver, engine } = setup();
  const v = new MotionValue(0, engine);
  v.animate(10, { type: "tween", duration: 0.1, easing: namedEasing("linear")! });
  const q = v.animate(20, { type: "tween", duration: 0.1, easing: namedEasing("linear")! }, { policy: "queue" });
  driver.run(10);
  assert.equal(await q.finished, "completed");
  assert.equal(v.get(), 20);
});

test("pause, rate, reverse for tweens", () => {
  const { driver, engine } = setup();
  const v = new MotionValue(0, engine);
  const a = v.animate(100, { type: "tween", duration: 1, easing: namedEasing("linear")! });
  for (let i = 0; i <= 10; i++) driver.step(50);
  assert.ok(Math.abs(v.get() - 50) < 1e-6);
  a.pause();
  driver.step(500);
  assert.ok(Math.abs(v.get() - 50) < 1e-6);
  a.play();
  a.reverse();
  driver.step(1);
  driver.step(250);
  assert.ok(v.get() < 50);
  driver.run(16);
  assert.equal(v.get(), 0);
  assert.equal(a.state, "completed");
});

test("reduced motion jumps to the destination", () => {
  const driver = new ManualDriver();
  const engine = createEngine({ driver, powerAware: false, reducedMotion: "always" });
  const v = new MotionValue(0, engine);
  v.animate(42, spring);
  assert.equal(v.get(), 42);
});

test("destroy releases the value", () => {
  const { engine } = setup();
  const before = engine.valueCount;
  for (let i = 0; i < 100; i++) {
    const v = new MotionValue(0, engine);
    v.animate(1, spring);
    v.destroy();
  }
  assert.equal(engine.valueCount, before);
  assert.equal(engine.activeCount, 0);
});

test("stop cancels queued animations without promoting a new owner", async () => {
  const { driver, engine } = setup();
  const value = new MotionValue(0, engine);
  const first = value.animate(100, spring);
  const queued = value.animate(200, spring, { policy: "queue" });
  const last = value.animate(300, spring, { policy: "queue" });
  driver.step(16);
  const stoppedAt = value.get();
  value.stop();
  driver.run(16);
  assert.equal(value.get(), stoppedAt);
  assert.equal(value.currentAnimation, null);
  assert.deepEqual(await Promise.all([first.finished, queued.finished, last.finished]), [
    "cancelled",
    "cancelled",
    "cancelled",
  ]);
});

test("destroy settles queued animation promises", async () => {
  const { engine } = setup();
  const value = new MotionValue(0, engine);
  const first = value.animate(100, spring);
  const queued = value.animate(200, spring, { policy: "queue" });
  value.destroy();
  assert.equal(queued.state, "cancelled");
  assert.deepEqual(await Promise.all([first.finished, queued.finished]), ["cancelled", "cancelled"]);
  assert.equal(engine.activeCount, 0);
});

test("public controls cancel a queued request before it starts", async () => {
  const { driver, engine } = setup();
  const value = new MotionValue(0, engine);
  const owner = animate(value, 100, { engine, spring: spring.spring });
  const queued = animate(value, 200, { engine, spring: spring.spring, policy: "queue" });
  queued.cancel();
  assert.equal(queued.animations[0]!.state, "cancelled");
  driver.run(16);
  assert.equal(value.get(), 100);
  assert.deepEqual(await queued.finished, ["cancelled"]);
  assert.deepEqual(await owner.finished, ["completed"]);
});

test("no extra frame is requested after the last animation completes", () => {
  const { driver, engine } = setup();
  const v = new MotionValue(0, engine);
  v.on("change", () => engine.write(() => undefined)); // like a DOM renderer flushing styles
  const a = v.animate(10, spring);
  let guard = 0;
  while (a.state !== "completed" && guard++ < 2000) driver.step(1000 / 120);
  assert.equal(a.state, "completed");
  assert.equal(driver.hasPendingFrame, false, "the completing frame must leave the loop idle");
});
