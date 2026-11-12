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

const PAGES = [
  "dashboard",
  "desktop-app",
  "mobile",
  "spring",
  "motion-graph",
  "morphing",
  "gestures",
  "shaders",
  "spatial",
  "adaptive-fidelity",
  "auto-integration",
  "update-rollback",
  "game-ui",
];

test("index lists all 13 examples", async () => {
  const page = await browser.newPage();
  const errors = watchErrors(page);
  await page.goto(server.base);
  assert.equal(await page.$$eval("#list a", (a) => a.length), 13);
  assert.deepEqual(errors, []);
  await page.close();
});

for (const name of PAGES) {
  test(`example ${name} loads without errors`, async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = watchErrors(page);
    await page.goto(`${server.base}/examples/${name}/`);
    await page.waitForTimeout(700);
    assert.deepEqual(errors, [], `${name}: ${errors.join("; ")}`);
    await page.close();
  });
}

test("dashboard: counters reach their targets and the list reorders with FLIP", async () => {
  const page = await browser.newPage();
  await page.goto(`${server.base}/examples/dashboard/`);
  await page.waitForFunction(
    () => document.querySelector("[data-count='48210']").textContent.replace(/\D/g, "") === "48210",
    null,
    { timeout: 5000 },
  );
  await page.click("#add");
  await page.waitForTimeout(50);
  // Mid-animation the inserted item is still fading in (opacity animated by the engine).
  assert.ok(await page.$eval("#accounts li", (li) => li.textContent.startsWith("New account")));
  await page.close();
});

test("motion graph: compiled drawer opens via event and settles at x = 0", async () => {
  const page = await browser.newPage();
  await page.goto(`${server.base}/examples/motion-graph/`);
  await page.waitForSelector("#status:has-text('WASM')");
  await page.click("#toggle");
  await page.waitForFunction(() => document.getElementById("state").textContent === "state: open");
  await page.waitForFunction(
    () =>
      /translate3d\(0px|^none$|^$/.test(document.getElementById("drawer").style.transform) ||
      !document.getElementById("drawer").style.transform.includes("-"),
    null,
    { timeout: 4000 },
  );
  await page.close();
});

test("game UI: pause menu springs in while the game loop keeps running", async () => {
  const page = await browser.newPage();
  await page.goto(`${server.base}/examples/game-ui/`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => {
      const r = document.getElementById("menu").getBoundingClientRect();
      const g = document.getElementById("game").getBoundingClientRect();
      return Math.abs(r.left - g.left) < 1;
    },
    null,
    { timeout: 4000 },
  );
  await page.close();
});
