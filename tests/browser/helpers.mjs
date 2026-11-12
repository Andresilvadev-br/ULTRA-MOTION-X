// Shared Playwright helpers: start a loopback server and a Chromium instance.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

export async function startServer(script, env = {}) {
  const proc = spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = await Promise.race([
    once(proc.stdout, "data").then(([d]) => String(d)),
    once(proc, "exit").then(([code]) => {
      throw new Error(`${script} exited: ${code}`);
    }),
  ]);
  return { proc, base: output.match(/http:\/\/127\.0\.0\.1:\d+/)[0] };
}

export function launch() {
  return chromium.launch({
    executablePath: process.env.UMX_CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
}

/** Collects page errors and console errors so tests can assert a clean run. */
export function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
