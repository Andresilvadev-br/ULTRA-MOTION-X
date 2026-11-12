import assert from "node:assert/strict";
import { test } from "node:test";
import { createEngine, ManualDriver } from "@ultra-motion-x/web";
import { SpringValue } from "../src/index.ts";

test("SpringValue pushes physics into an Animated.Value-like sink and flings with snapping", async () => {
  const driver = new ManualDriver();
  const engine = createEngine({ driver, powerAware: false });
  const seen: number[] = [];
  const v = new SpringValue(0, { setValue: (x) => seen.push(x) }, { spring: "snappy" }, engine);
  const done = v.to(100);
  driver.run(16);
  await done;
  assert.equal(seen.at(-1), 100);
  assert.ok(seen.length > 5);
  v.track(120, 1500);
  const f = v.fling(1500, { snapTo: [0, 200, 400] });
  driver.run(16);
  await f;
  assert.equal(seen.at(-1), 400, "fling projects to the nearest snap point");
  v.destroy();
});
