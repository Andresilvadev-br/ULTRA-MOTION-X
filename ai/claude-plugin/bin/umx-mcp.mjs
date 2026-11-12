#!/usr/bin/env node
// MCP entry point used by the Claude Code plugin (see ../mcp.json).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureSetup, ROOT } from "./ensure-setup.mjs";

ensureSetup();
const { serveStdio } = await import(pathToFileURL(join(ROOT, "ai/mcp/dist/server.js")).href);
serveStdio();
