import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { launch, startServer, watchErrors } from "./helpers.mjs";

let server;
let browser;
let page;
let errors;
before(async () => {
  server = await startServer("studio/serve.mjs", { UMX_STUDIO_PORT: "0" });
  browser = await launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  errors = watchErrors(page);
  await page.goto(server.base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#engine-state:has-text('Engine connected')");
});
after(async () => {
  await browser?.close();
  server?.proc.kill();
});

const openLab = async (name) => {
  await page.click(`[data-lab="${name}"]`);
  await page.waitForFunction(
    (n) => !document.getElementById("lab-host").hidden && document.getElementById("lab-host").children.length > 0,
    name,
  );
};
const transformOf = (sel) => page.$eval(sel, (el) => el.style.transform);

test("timeline: scrubbing is exact, frame stepping and keyframe editing with undo/redo", async () => {
  await openLab("timeline");
  await page.fill(".tl-scrub", "600");
  await page.dispatchEvent(".tl-scrub", "input");
  await page.waitForTimeout(50);
  // At 600 ms the x track reaches its 120 px keyframe exactly.
  assert.match(await transformOf(".tl-box"), /translate3d\(120px/);
  const keysBefore = await page.$$eval(".tl-lane[data-track='x'] .tl-key", (k) => k.length);
  const lane = await page.$(".tl-lane[data-track='x']");
  const box = await lane.boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  assert.equal(await page.$$eval(".tl-lane[data-track='x'] .tl-key", (k) => k.length), keysBefore + 1);
  await page.click("#undo");
  assert.equal(await page.$$eval(".tl-lane[data-track='x'] .tl-key", (k) => k.length), keysBefore);
  await page.click("#redo");
  assert.equal(await page.$$eval(".tl-lane[data-track='x'] .tl-key", (k) => k.length), keysBefore + 1);
  await page.click("[aria-label='Next frame']");
  assert.match(await page.textContent(".tl-time"), /\d+ ms/);
});

test("curve editor: presets update the CSS easing and persist in the project", async () => {
  await openLab("curve");
  await page.selectOption(".lab-panel select", "easeOut");
  assert.equal(await page.textContent(".css-out"), "cubic-bezier(0, 0, 0.58, 1)");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("umx:studio:project:v1")).curve);
  assert.deepEqual(stored, [0, 0, 0.58, 1]);
});

test("motion graph: MDL compiles in WebAssembly, events drive the state machine, errors are reported", async () => {
  await openLab("graph");
  await page.waitForSelector("text=compiler 1.0.0 (WASM)");
  await page.selectOption(".lab-panel:nth-child(2) select", "drawer");
  await page.waitForSelector("[data-event='toggle']");
  await page.click("[data-event='toggle']");
  await page.waitForFunction(() => document.getElementById("graph-state").textContent === "open");
  await page.fill(
    ".mdl-editor",
    '{"version":"umx/1","components":{"c":{"properties":{"x":0},"states":{"a":{},"b":{}}}}}',
  );
  await page.click("#compile");
  await page.waitForSelector(".diag.error:has-text('E_INITIAL_REQUIRED')");
});

test("gestures, compare (refresh-rate determinism), effects and diagnostics labs work", async () => {
  await openLab("gestures");
  const card = await page.$(".drag-card");
  const b = await card.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 20 + i * 25, b.y + 20 + i * 8);
  await page.mouse.up();
  await page.waitForTimeout(900);
  assert.match(await page.textContent(".values"), /intent\s+(drag|swipe)/);

  await openLab("compare");
  await page.click("#determinism-run");
  const det = await page.textContent("#determinism");
  const [v60, v240] = [...det.matchAll(/final value \d+ Hz:\s+(-?[\d.]+)/g)].map((m) => Number(m[1]));
  assert.equal(v60, v240, "both refresh rates settle on the same value");
  assert.match(det, /anomalies \(jumps \/ NaN \/ conflicts\): 0/);

  await openLab("effects");
  await page.waitForFunction(() => /backend\s+(webgl2|css)/.test(document.querySelector(".values")?.textContent ?? ""));
  await page.selectOption("#fx-material", "ripple");

  await openLab("diagnostics");
  await page.click("#tm-record");
  await page.click("#tm-animate");
  await page.waitForTimeout(600);
  await page.click("#tm-record");
  assert.match(await page.textContent(".lab-panel:nth-child(2) .values"), /\d+ frames, \d+ events, anomalies: 0/);
  assert.match(await page.textContent("#diag-stats"), /refresh/);
  assert.deepEqual(errors, []);
});
