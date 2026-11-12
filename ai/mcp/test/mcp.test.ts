import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { handle, TOOLS } from "../src/server.ts";

const root = new URL("../../../", import.meta.url).pathname;

test("initialize, list and call tools in-process", async () => {
  const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal((init!.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
  const list = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal((list!.result as { tools: unknown[] }).tools.length, TOOLS.length);
  const call = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "umx_analyze", arguments: { project: `${root}tests/fixtures/vite-react` } },
  });
  const text = (call!.result as { content: Array<{ text: string }> }).content[0]!.text;
  assert.equal(JSON.parse(text).adapter, "react");
  const dry = await handle({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "umx_install", arguments: { project: `${root}tests/fixtures/vite-react` } },
  });
  assert.match((dry!.result as { content: Array<{ text: string }> }).content[0]!.text, /dryRun/);
  const bad = await handle({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "umx_analyze", arguments: {} },
  });
  assert.equal((bad!.result as { isError: boolean }).isError, true);
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(((await handle({ jsonrpc: "2.0", id: 6, method: "nope" }))!.error as { code: number }).code, -32601);
});

test("stdio transport round-trip", async () => {
  const child = spawn(process.execPath, [
    "--conditions=umx-source",
    "--no-warnings",
    new URL("../src/server.ts", import.meta.url).pathname,
    "--stdio",
  ]);
  const lines: string[] = [];
  child.stdout.setEncoding("utf8");
  const got = new Promise<void>((res) => {
    let buf = "";
    child.stdout.on("data", (d: string) => {
      buf += d;
      const parts = buf.split("\n");
      buf = parts.pop()!;
      lines.push(...parts.filter(Boolean));
      if (lines.length >= 2) res();
    });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "umx_profiles", arguments: {} } })}\n`,
  );
  await got;
  child.kill();
  assert.equal(JSON.parse(lines[0]!).result.serverInfo.name, "ultra-motion-x");
  assert.match(JSON.parse(lines[1]!).result.content[0].text, /singularity/);
});
