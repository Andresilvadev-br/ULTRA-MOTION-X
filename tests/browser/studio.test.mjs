import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

let server;
let browser;
let base;
before(async () => {
  server = spawn(process.execPath, ["studio/serve.mjs"], {
    env: { ...process.env, UMX_STUDIO_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The server prints its OS-assigned port, avoiding collisions in parallel CI runs.
  const output = await Promise.race([
    once(server.stdout, "data").then(([data]) => String(data)),
    once(server, "exit").then(([code]) => {
      throw new Error(`Studio exited: ${code}`);
    }),
  ]);
  base = output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  browser = await chromium.launch({
    executablePath: process.env.UMX_CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
  server?.kill();
});

test("Studio loads the SDK, moves, settles, exports and handles rapid interruptions", async () => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector("#engine-state").textContent === "Engine connected");
  await page.waitForFunction(() => document.querySelector("#motion-status").textContent === "Settled");
  const before = await page.locator("#orb").evaluate((el) => getComputedStyle(el).transform);
  await page.locator("#replay").click();
  await page.waitForFunction(() => document.querySelector("#motion-status").textContent === "Settled");
  const after = await page.locator("#orb").evaluate((el) => getComputedStyle(el).transform);
  assert.notEqual(before, after);
  await page.locator("#profile").selectOption("cinematic");
  assert.equal(await page.locator("#profile-indicator").textContent(), "cinematic");
  await page.locator("#replay").evaluate((el) => {
    for (let i = 0; i < 20; i++) el.click();
  });
  await page.waitForFunction(() => document.querySelector("#motion-status").textContent === "Settled");
  await page.locator("#export").click();
  const exported = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(exported.profile, "cinematic");
  assert.ok(exported.spring.stiffness > 0);
  await page.locator('[data-lab="components"]').click();
  assert.equal(await page.locator(".graph").isVisible(), false);
  await page.locator("#demo-toast").click();
  assert.equal(await page.locator("#toast").isVisible(), true);
  await page.locator("#demo-card").click();
  await page.locator("#reset").click();
  assert.equal(await page.locator("#toast").isVisible(), false);
  assert.equal(await page.locator("#motion-status").textContent(), "Ready");
  await page.locator('[data-lab="profiles"]').click();
  assert.equal(await page.locator(".graph").isVisible(), true);
  assert.equal(await page.locator(".components").isVisible(), false);
  await page.waitForFunction(() => globalThis.__ULTRA_MOTION_X__.isIdle);
  assert.deepEqual(errors, []);
  await context.close();
});

test("mobile viewport stays within the screen and honors reduced-motion preference", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector("#engine-state").textContent === "Engine connected");
  assert.equal(await page.locator("#mode").textContent(), "Reduced motion");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await context.close();
});
