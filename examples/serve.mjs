#!/usr/bin/env node
/** Ultra Motion X examples — local loopback server (see scripts/static-server.mjs). */
import { startServer } from "../scripts/static-server.mjs";

startServer({
  index: "/examples/index.html",
  port: Number(process.env.UMX_EXAMPLES_PORT || 4174),
  label: "Ultra Motion X examples",
});
