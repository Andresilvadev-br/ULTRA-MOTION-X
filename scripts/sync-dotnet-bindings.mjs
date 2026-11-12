#!/usr/bin/env node
// Copies the canonical C# bindings into the Unity and Godot adapters. `--check` fails on drift.
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["UltraMotionX.Native.cs", "UltraMotionX.cs"];
const targets = ["platforms/unity/Runtime/Bindings", "platforms/godot/addons/ultra_motion_x/Bindings"];
let drift = false;
for (const t of targets) {
  for (const f of files) {
    const src = join(root, "platforms/windows/dotnet/src", f);
    const dst = join(root, t, f);
    if (process.argv.includes("--check")) {
      let same = false;
      try {
        same = readFileSync(src, "utf8") === readFileSync(dst, "utf8");
      } catch {}
      if (!same) {
        console.error(`out of date: ${t}/${f}`);
        drift = true;
      }
    } else copyFileSync(src, dst);
  }
}
if (drift) process.exit(1);
console.log(process.argv.includes("--check") ? "C# bindings in sync" : "C# bindings synced");
