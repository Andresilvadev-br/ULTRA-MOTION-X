// Visual regression. (1) Geometry checks at three viewports: no horizontal overflow, key
// elements visible and inside the viewport, no overlapping controls. (2) Pixel comparison
// against baselines recorded for the *same browser version*; when no baseline exists for the
// running browser the pixel step is reported as skipped (never as passed).
// Record baselines: UMX_UPDATE_SNAPSHOTS=1 npm run test:browser
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { launch, startServer } from "./helpers.mjs";
import { decodePng, diffRatio } from "./png.mjs";

let server;
let browser;
let snapDir;
before(async () => {
  server = await startServer("examples/serve.mjs", { UMX_EXAMPLES_PORT: "0" });
  browser = await launch();
  snapDir = join(
    new URL(".", import.meta.url).pathname,
    "__screenshots__",
    `chromium-${browser.version().split(".")[0]}-${process.platform}`,
  );
});
after(async () => {
  await browser?.close();
  server?.proc.kill();
});

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};
const PAGES = [
  { name: "examples-index", path: "/examples/", key: ["#list a"] },
  { name: "studio", path: "/studio/index.html", key: [".top h1", "#replay", "#preview"] },
  { name: "morphing", path: "/examples/morphing/", key: ["#card", "#s1"] },
  { name: "dashboard", path: "/examples/dashboard/", key: [".kpi", "#accounts"] },
];

async function open(viewport, path) {
  // Reduced motion makes every entrance land on its final frame → deterministic screenshots.
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(server.base + path);
  await page.waitForTimeout(600);
  return { page, ctx };
}

for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  for (const p of PAGES) {
    test(`${p.name} @ ${vpName}: layout geometry`, async () => {
      const { page, ctx } = await open(vp, p.path);
      const g = await page.evaluate((keys) => {
        const doc = document.documentElement;
        const vis = keys.map((sel) => {
          const el = document.querySelector(sel);
          if (!el) return { sel, ok: false, why: "missing" };
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const ok =
            r.width > 0 &&
            r.height > 0 &&
            cs.visibility !== "hidden" &&
            Number(cs.opacity) > 0.05 &&
            r.left >= -1 &&
            r.right <= innerWidth + 1;
          return { sel, ok, why: ok ? "" : JSON.stringify({ l: r.left, r: r.right, w: r.width, o: cs.opacity }) };
        });
        // Overlaps between visible buttons (a common symptom of broken responsive layouts).
        const btns = [...document.querySelectorAll("button")].filter(
          (b) => b.offsetParent && b.getBoundingClientRect().width > 0,
        );
        const overlaps = [];
        for (let i = 0; i < btns.length; i++)
          for (let j = i + 1; j < btns.length; j++) {
            const a = btns[i].getBoundingClientRect();
            const b = btns[j].getBoundingClientRect();
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ix > 2 && iy > 2 && !btns[i].contains(btns[j]) && !btns[j].contains(btns[i]))
              overlaps.push(`${btns[i].textContent.trim()} × ${btns[j].textContent.trim()}`);
          }
        return { overflow: doc.scrollWidth - innerWidth, vis, overlaps };
      }, p.key);
      assert.ok(g.overflow <= 1, `horizontal overflow ${g.overflow}px`);
      for (const v of g.vis) assert.ok(v.ok, `${v.sel} not visible: ${v.why}`);
      assert.deepEqual(g.overlaps, []);
      await ctx.close();
    });
  }
}

for (const p of PAGES.filter((x) => x.name !== "dashboard")) {
  test(`${p.name}: pixels match the baseline for this browser`, async (t) => {
    const { page, ctx } = await open(VIEWPORTS.desktop, p.path);
    const shot = await page.screenshot({ animations: "disabled", caret: "hide" });
    await ctx.close();
    const file = join(snapDir, `${p.name}.png`);
    if (process.env.UMX_UPDATE_SNAPSHOTS === "1") {
      mkdirSync(snapDir, { recursive: true });
      writeFileSync(file, shot);
      t.diagnostic(`baseline written: ${file}`);
      return;
    }
    if (!existsSync(file)) {
      t.skip(`no baseline for ${snapDir.split("/").pop()} — record with UMX_UPDATE_SNAPSHOTS=1`);
      return;
    }
    const ratio = diffRatio(decodePng(readFileSync(file)), decodePng(shot));
    assert.ok(ratio < 0.01, `${(ratio * 100).toFixed(2)}% of pixels differ`);
  });
}
