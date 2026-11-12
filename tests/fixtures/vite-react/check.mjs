// Fixture "test suite": fails if the app entry no longer exists (used by update tests).
import { existsSync } from "node:fs";

process.exit(existsSync(new URL("./src/main.tsx", import.meta.url)) ? 0 : 1);
