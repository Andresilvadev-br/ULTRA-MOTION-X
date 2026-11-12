// Behaviour of the Web SDK in a real browser (Chromium): DOM writes, idle loop, continuity,
// compositor hand-off, reduced motion, drag, FLIP, resource cleanup and shader compilation.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { launch, startServer, watchErrors } from "./helpers.mjs";

let server;
let browser;
before(async () => {
  server = await startServer("examples/serve.mjs", { UMX_EXAMPLES_PORT: "0" });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  server?.proc.kill();
});

async function sdkPage(opts = {}) {
  const ctx = await browser.newContext({
    reducedMotion: opts.reducedMotion ?? "no-preference",
    viewport: { width: 1000, height: 700 },
  });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(`${server.base}/examples/update-rollback/`);
  await page.evaluate(async () => {
    window.umx = await import("/sdk/typescript/dist/index.js");
    document.body.innerHTML = '<div id="box" style="width:50px;height:50px;background:red"></div>';
  });
  return { page, errors, close: () => ctx.close() };
}

test("animate writes transforms, settles exactly and stops the frame loop when idle", async () => {
  const { page, errors, close } = await sdkPage();
  const r = await page.evaluate(async () => {
    const { animate, getEngine } = window.umx;
    const box = document.getElementById("box");
    await animate(box, { x: 200, opacity: 0.5 }, { spring: "snappy", compositor: false });
    const e = getEngine();
    const frames = e.frameCount;
    await new Promise((r) => setTimeout(r, 300));
    return {
      transform: box.style.transform,
      opacity: box.style.opacity,
      idleFrames: e.frameCount - frames,
      idle: e.isIdle,
    };
  });
  assert.equal(r.transform, "translate3d(200px, 0px, 0px)");
  assert.equal(r.opacity, "0.5");
  assert.equal(r.idleFrames, 0, "no frames requested while idle");
  assert.equal(r.idle, true);
  assert.deepEqual(errors, []);
  await close();
});

test("rapid retargeting stays continuous in real frames", async () => {
  const { page, close } = await sdkPage();
  const maxJump = await page.evaluate(async () => {
    const { animate, motionValueOf } = window.umx;
    const box = document.getElementById("box");
    const xs = [];
    const mv = motionValueOf(box, "x");
    mv.on("change", (v) => xs.push(v));
    for (let i = 0; i < 12; i++) {
      animate(box, { x: i % 2 ? 0 : 300 }, { spring: "standard" });
      await new Promise((r) => setTimeout(r, 40));
    }
    await new Promise((r) => setTimeout(r, 300));
    return Math.max(...xs.slice(1).map((v, i) => Math.abs(v - xs[i])));
  });
  assert.ok(maxJump < 60, `largest per-frame step ${maxJump}px`);
  await close();
});

test("compositor path runs on WAAPI and hands back exactly on interruption", async () => {
  const { page, close } = await sdkPage();
  const r = await page.evaluate(async () => {
    const { animate } = window.umx;
    const box = document.getElementById("box");
    animate(box, { opacity: [1, 0] }, { type: "tween", duration: 600, compositor: true });
    await new Promise((r) => setTimeout(r, 200));
    const running = box.getAnimations().length;
    const c = animate(box, { opacity: 1 }, { spring: "snappy", compositor: false });
    const afterInterrupt = box.getAnimations().length;
    const handedOff = Number(box.style.opacity);
    await c;
    return { running, afterInterrupt, handedOff, final: box.style.opacity };
  });
  assert.equal(r.running, 1, "a WAAPI animation drives opacity");
  assert.equal(r.afterInterrupt, 0, "WAAPI cancelled on interruption");
  assert.ok(r.handedOff > 0.1 && r.handedOff < 0.95, `continuity at hand-off (${r.handedOff})`);
  assert.equal(r.final, "1");
  await close();
});

test("prefers-reduced-motion: motion jumps to its destination", async () => {
  const { page, close } = await sdkPage({ reducedMotion: "reduce" });
  const r = await page.evaluate(() => {
    const { animate, getEngine } = window.umx;
    const box = document.getElementById("box");
    animate(box, { x: 150 }, { spring: "gentle" });
    return { reduced: getEngine().reducedMotion, x: window.umx.motionValueOf(box, "x").get() };
  });
  assert.deepEqual(r, { reduced: true, x: 150 });
  await close();
});

test("drag: pointer moves the element, release flings into bounds with snapping", async () => {
  const { page, close } = await sdkPage();
  await page.evaluate(() => {
    document.body.innerHTML =
      '<div id="area" style="position:relative;width:600px;height:100px"><div id="box" style="width:50px;height:50px;background:red;touch-action:none"></div></div>';
    window.ctrl = window.umx.drag(document.getElementById("box"), {
      axis: "x",
      bounds: { left: 0, right: 500 },
      snapX: [0, 250, 500],
    });
  });
  await page.mouse.move(25, 25);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(25 + i * 18, 25);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const x = await page.evaluate(() => window.ctrl.x.get());
  assert.ok([250, 500].includes(Math.round(x)), `settled on a snap point (${x})`);
  await close();
});

test("layoutTransition ends exactly on the new layout", async () => {
  const { page, close } = await sdkPage();
  const r = await page.evaluate(async () => {
    document.body.innerHTML =
      '<ul id="l" style="list-style:none;padding:0">' +
      [1, 2, 3, 4].map((i) => `<li style="height:30px">${i}</li>`).join("") +
      "</ul>";
    const l = document.getElementById("l");
    await window.umx.layoutTransition(l, () => l.prepend(l.lastElementChild), { mode: "position" });
    return [...l.children].map((c) => [
      c.textContent,
      Math.round(c.getBoundingClientRect().top - l.getBoundingClientRect().top),
    ]);
  });
  assert.deepEqual(r, [
    ["4", 0],
    ["1", 30],
    ["2", 60],
    ["3", 90],
  ]);
  await close();
});

test("mount/unmount cycles do not leak values or animations", async () => {
  const { page, close } = await sdkPage();
  const r = await page.evaluate(async () => {
    const { animate, getEngine, ElementTarget } = window.umx;
    const e = getEngine();
    const base = e.valueCount;
    for (let round = 0; round < 5; round++) {
      const els = Array.from({ length: 100 }, () => document.body.appendChild(document.createElement("div")));
      els.forEach((el, i) => animate(el, { x: i, opacity: 0.5 }, { spring: "snappy" }));
      await new Promise((r) => setTimeout(r, 30));
      for (const el of els) {
        ElementTarget.peek(el)?.destroy();
        el.remove();
      }
    }
    await new Promise((r) => setTimeout(r, 100));
    return { leaked: e.valueCount - base, active: e.activeCount };
  });
  assert.deepEqual(r, { leaked: 0, active: 0 });
  await close();
});

test("every shader material compiles in WebGL2 or falls back to CSS", async () => {
  const { page, errors, close } = await sdkPage();
  const backends = await page.evaluate(async () => {
    const fx = await import("/rendering/web/dist/index.js");
    document.body.innerHTML = fx.MATERIALS.map((m) => `<div id="fx-${m}" style="width:200px;height:120px"></div>`).join(
      "",
    );
    const out = {};
    for (const m of fx.MATERIALS) {
      const s = fx.surface(document.getElementById(`fx-${m}`), { material: m });
      await new Promise((r) => setTimeout(r, 50));
      out[m] = s.backend;
      s.destroy();
    }
    return { out, webgl2: fx.detectCapabilities().webgl2, contexts: fx.contextsInUse() };
  });
  for (const b of Object.values(backends.out)) assert.equal(b, backends.webgl2 ? "webgl2" : "css");
  assert.equal(backends.contexts, 0, "contexts released after destroy");
  assert.deepEqual(
    errors.filter((e) => /shader|program/i.test(e)),
    [],
    "no shader compile errors",
  );
  await close();
});
