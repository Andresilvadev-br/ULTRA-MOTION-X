#!/usr/bin/env node
/** Ultra Motion X Studio — local loopback server (see scripts/static-server.mjs). */
import { startServer } from "../scripts/static-server.mjs";

startServer({
  index: "/studio/index.html",
  port: Number(process.env.UMX_STUDIO_PORT || 4173),
  label: "Ultra Motion Studio",
});
