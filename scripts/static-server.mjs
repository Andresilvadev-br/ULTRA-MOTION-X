/**
 * Safe loopback static server shared by Studio and the examples.
 * Only an explicit allowlist is served: Studio/example assets and compiled package output
 * (never sources, configs, dotfiles, scripts or tests). GET/HEAD only.
 */
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
};
const ASSET_EXT = [".html", ".css", ".js", ".json", ".svg"];

/** Pure allowlist check (exported for tests). */
export function isAllowed(path) {
  if (path.split("/").some((p) => p.startsWith(".") || p === "test" || p === "node_modules")) return false;
  const ext = extname(path);
  if (/^\/(studio|examples)\//.test(path)) return ASSET_EXT.includes(ext) && !path.endsWith("/serve.mjs");
  if (/^\/(sdk\/typescript|rendering\/web|devtools)\/dist\//.test(path)) return ext === ".js";
  if (path === "/sdk/typescript/wasm/ultra_motion_x.wasm") return true;
  return false;
}

export function startServer({ index, port = 0, host = "127.0.0.1", label = "Ultra Motion X" }) {
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url || "/", "http://localhost");
      let path = url.pathname === "/" ? index : decodeURIComponent(url.pathname);
      if (path.endsWith("/")) path += "index.html";
      if (!isAllowed(path)) throw new Error("not allowed");
      const target = resolve(ROOT, `.${path}`);
      if (!target.startsWith(ROOT + sep)) throw new Error("outside root");
      const info = await stat(target);
      if (!info.isFile()) throw new Error("not a file");
      const data = await readFile(target);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(target)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Opener-Policy": "same-origin",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });
  server.listen(port, host, () =>
    console.log(`${label}: http://${host}:${server.address().port}\nRun npm ci && npm run build before opening.`),
  );
  return server;
}
