// Cross-implementation conformance: the TypeScript math must match the Rust reference.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Decay } from "../src/math/decay.ts";
import { applyEasing, easingDerivative, namedEasing } from "../src/math/easing.ts";
import { defaultInertia, Inertia } from "../src/math/inertia.ts";
import { Spring, springParams } from "../src/math/spring.ts";

const vectors = JSON.parse(readFileSync(new URL("../../../tests/conformance/vectors.json", import.meta.url), "utf8"));
const close = (a: number, b: number, tol: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

test("springs match the Rust reference", () => {
  for (const v of vectors.springs) {
    const s = new Spring(
      springParams({ stiffness: v.stiffness, damping: v.damping, mass: v.mass }),
      v.from,
      v.to,
      v.v0,
    );
    close(s.finishTime, v.finishTime, 1e-9, "finishTime");
    for (const [t, x, vel, done] of v.samples) {
      const r = s.sample(t);
      close(r.value, x, 1e-9, `x(${t}) k=${v.stiffness}`);
      close(r.velocity, vel, 1e-8, `v(${t}) k=${v.stiffness}`);
      assert.equal(r.done, done);
    }
  }
});

test("easings match the Rust reference", () => {
  for (const e of vectors.easings) {
    const ez = namedEasing(e.name)!;
    for (const [p, y, dy] of e.samples) {
      close(applyEasing(ez, p), y, 1e-8, `${e.name}(${p})`);
      close(easingDerivative(ez, p), dy, 1e-6, `${e.name}'(${p})`);
    }
  }
});

test("decay and inertia match the Rust reference", () => {
  const d = new Decay(
    { timeConstant: vectors.decay.timeConstant, restSpeed: vectors.decay.restSpeed },
    vectors.decay.from,
    vectors.decay.velocity,
  );
  for (const [t, x, v, done] of vectors.decay.samples) {
    const r = d.sample(t);
    close(r.value, x, 1e-9, `decay x(${t})`);
    close(r.velocity, v, 1e-9, `decay v(${t})`);
    assert.equal(r.done, done);
  }
  const p = { ...defaultInertia(), max: vectors.inertia.max, bounceSpring: springParams(vectors.inertia.bounce) };
  const i = new Inertia(p, vectors.inertia.from, vectors.inertia.velocity);
  assert.equal(i.target, vectors.inertia.target);
  for (const [t, x, v, done] of vectors.inertia.samples) {
    const r = i.sample(t);
    close(r.value, x, 1e-7, `inertia x(${t})`);
    close(r.velocity, v, 1e-6, `inertia v(${t})`);
    assert.equal(r.done, done);
  }
});
