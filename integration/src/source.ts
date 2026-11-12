/** Locates the Ultra Motion X distribution used as installation source. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exists, readJson } from "./util.ts";

export interface UmxSource {
  root: string;
  version: string;
  webPackage: string;
  webDist: string;
  wasm: string;
}

/** Walks up from this module (or `hint`) to the repository root. */
export function findSource(hint?: string): UmxSource {
  const candidates = hint ? [resolve(hint)] : [];
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    candidates.push(dir);
    dir = dirname(dir);
  }
  for (const c of candidates) {
    const pkg = readJson<{ version: string }>(join(c, "sdk/typescript/package.json"));
    if (pkg && exists(join(c, "presets/profiles.json"))) {
      return {
        root: c,
        version: pkg.version,
        webPackage: join(c, "sdk/typescript"),
        webDist: join(c, "sdk/typescript/dist"),
        wasm: join(c, "sdk/typescript/wasm/ultra_motion_x.wasm"),
      };
    }
  }
  throw new Error("Ultra Motion X source not found. Pass --source <path-to-ultra-motion-x>.");
}
