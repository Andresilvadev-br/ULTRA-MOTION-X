import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";

let server;
let base;
before(async () => {
  server = spawn(process.execPath, ["studio/serve.mjs"], {
    env: { ...process.env, UMX_STUDIO_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [data] = await once(server.stdout, "data");
  base = String(data).match(/http:\/\/127\.0\.0\.1:\d+/)[0];
});
after(() => server?.kill());
test("preview server exposes only preview assets and compiled SDK modules", async () => {
  for (const path of [
    "/.git/config",
    "/package.json",
    "/AGENTS.md",
    "/studio/serve.mjs",
    "/sdk/typescript/dist/../../../package.json",
    "/%2e%2e/package.json",
  ]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base, { method: "POST" })).status, 405);
  const head = await fetch(base, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
