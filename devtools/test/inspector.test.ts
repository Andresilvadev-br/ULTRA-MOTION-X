import assert from "node:assert/strict";
import { test } from "node:test";
import { createEngine, ManualDriver, MotionValue, springParams } from "@ultra-motion-x/web";
import { Inspector } from "../src/inspector.ts";

test("inspector tracks live animations and goes empty when idle", () => {
  const driver = new ManualDriver();
  const engine = createEngine({ driver, powerAware: false });
  const inspector = new Inspector(engine);
  const v = new MotionValue(0, engine, { name: "box.x" });
  v.animate(10, { type: "spring", spring: springParams() });
  const s = inspector.snapshot();
  assert.equal(s.active.length, 1);
  assert.equal(s.active[0]!.value, "box.x");
  driver.run(16);
  assert.equal(inspector.snapshot().active.length, 0);
  engine.warn("test warning");
  assert.equal(inspector.snapshot().warnings.at(-1)!.message, "test warning");
  inspector.destroy();
});
