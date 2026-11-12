/**
 * Ultra Motion X MCP server (JSON-RPC 2.0 over newline-delimited stdio, per the MCP stdio
 * transport). Tools are thin, typed wrappers over @ultra-motion-x/integration and the WASM
 * compiler. Mutating tools default to dry-run and require `confirm: true` to write files.
 */

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  analyzeProject,
  applyPlan,
  checkCompatibility,
  checkUpdate,
  createPlan,
  doctor,
  findSource,
  heal,
  markdownReport,
  previewPlan,
  rollback,
} from "@ultra-motion-x/integration";
import { MotionDNA, PROFILE_NAMES } from "@ultra-motion-x/web";
import { loadCore } from "@ultra-motion-x/web/wasm";

export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

const dirArg = { project: { type: "string", description: "Absolute path of the project directory" } };
const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v) throw new Error(`\`${name}\` must be a non-empty string`);
  return v;
};

export const TOOLS: Tool[] = [
  {
    name: "umx_environment",
    description:
      "Locate the Ultra Motion X checkout used by this server (plugin root), its version and the CLI command to run.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const src = findSource(process.env.ULTRA_MOTION_X_HOME);
      return {
        root: src.root,
        version: src.version,
        cli: `node "${src.root}/ai/claude-plugin/bin/umx.mjs"`,
        studio: `npm run studio (in ${src.root})`,
        node: process.versions.node,
      };
    },
  },
  {
    name: "umx_analyze",
    description:
      "Analyze a project: platform, frameworks, build system, entry points, existing animation libraries and discovered UI components.",
    inputSchema: { type: "object", properties: dirArg, required: ["project"] },
    handler: (a) => {
      const r = analyzeProject(resolve(str(a.project, "project")));
      return { ...r, components: r.components.slice(0, 200), componentCount: r.components.length };
    },
  },
  {
    name: "umx_check",
    description: "Check compatibility of a project with Ultra Motion X and list issues with suggested fixes.",
    inputSchema: { type: "object", properties: dirArg, required: ["project"] },
    handler: (a) => checkCompatibility(analyzeProject(resolve(str(a.project, "project")))),
  },
  {
    name: "umx_install",
    description:
      "Plan (default) or apply the integration. Without confirm=true it returns the unified diff only. Applying records a reversible transaction.",
    inputSchema: {
      type: "object",
      properties: {
        ...dirArg,
        profile: { type: "string", enum: PROFILE_NAMES },
        mode: { type: "string", enum: ["vendor", "npm"] },
        annotate: { type: "boolean" },
        adapter: { type: "string" },
        entry: { type: "string" },
        confirm: { type: "boolean", description: "Set true to write files" },
      },
      required: ["project"],
    },
    handler: (a) => {
      const dir = resolve(str(a.project, "project"));
      const r = analyzeProject(dir);
      const c = checkCompatibility(r);
      if (!c.compatible) return { ok: false, compatibility: c };
      const plan = createPlan(r, findSource(), {
        profile: a.profile as string,
        mode: a.mode as "vendor" | "npm",
        annotate: !!a.annotate,
        adapter: a.adapter as string,
        entry: a.entry as string,
      });
      if (a.confirm !== true)
        return { ok: true, dryRun: true, diff: previewPlan(plan), manualSteps: plan.manualSteps, notes: plan.notes };
      const tx = applyPlan(plan);
      const findings = doctor(dir);
      return {
        ok: true,
        transaction: tx.id,
        changed: tx.changes.map((x) => x.path).filter((p) => !p.startsWith("vendor/")),
        vendoredFiles: tx.changes.filter((x) => x.path.startsWith("vendor/")).length,
        manualSteps: plan.manualSteps,
        findings,
        report: markdownReport({ report: r, compatibility: c, plan, transaction: tx, findings }),
      };
    },
  },
  {
    name: "umx_doctor",
    description:
      "Diagnose an existing integration (drift, missing wiring, vendor integrity, config validity). fix=true applies safe reversible repairs.",
    inputSchema: { type: "object", properties: { ...dirArg, fix: { type: "boolean" } }, required: ["project"] },
    handler: (a) => {
      const dir = resolve(str(a.project, "project"));
      if (a.fix === true) {
        const { transaction, remaining } = heal(dir);
        return { transaction: transaction?.id ?? null, remaining };
      }
      return doctor(dir);
    },
  },
  {
    name: "umx_rollback",
    description:
      "Revert the last (or all) Ultra Motion X transactions. Later user edits are preserved; overlapping edits are reported as conflicts. Dry-run unless confirm=true.",
    inputSchema: {
      type: "object",
      properties: {
        ...dirArg,
        all: { type: "boolean" },
        files: { type: "array", items: { type: "string" } },
        confirm: { type: "boolean" },
      },
      required: ["project"],
    },
    handler: (a) =>
      rollback(resolve(str(a.project, "project")), {
        all: !!a.all,
        files: a.files as string[] | undefined,
        dryRun: a.confirm !== true,
      }),
  },
  {
    name: "umx_update_check",
    description:
      "Compare the installed Ultra Motion X version with the available source and list migrations/breaking changes.",
    inputSchema: { type: "object", properties: dirArg, required: ["project"] },
    handler: (a) => checkUpdate(resolve(str(a.project, "project"))),
  },
  {
    name: "umx_validate_mdl",
    description:
      "Validate a Motion Design Language (MDL) document given as a JSON string. Returns diagnostics with paths.",
    inputSchema: { type: "object", properties: { document: { type: "string" } }, required: ["document"] },
    handler: async (a) => {
      const core = await loadCore();
      const r = core.compile(str(a.document, "document"));
      return { ok: r.ok, diagnostics: r.diagnostics, migratedFrom: r.migratedFrom };
    },
  },
  {
    name: "umx_compile_mdl",
    description: "Compile an MDL document to an execution plan (or a summary / Graphviz DOT with format).",
    inputSchema: {
      type: "object",
      properties: { document: { type: "string" }, format: { type: "string", enum: ["plan", "summary", "dot"] } },
      required: ["document"],
    },
    handler: async (a) => {
      const core = await loadCore();
      const doc = str(a.document, "document");
      if (a.format === "summary" || a.format === "dot") return { text: core.inspect(doc, a.format) };
      return core.compile(doc);
    },
  },
  {
    name: "umx_profiles",
    description: "List Motion DNA profiles, or return the tokens of one profile.",
    inputSchema: { type: "object", properties: { name: { type: "string", enum: PROFILE_NAMES } } },
    handler: (a) =>
      typeof a.name === "string"
        ? MotionDNA.profile(a.name).toJSON()
        : PROFILE_NAMES.map((n) => ({ name: n, description: MotionDNA.profile(n).data.description })),
  },
];

interface Rpc {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export async function handle(msg: Rpc): Promise<Record<string, unknown> | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
    return msg.id === undefined ? null : fail(-32600, "invalid request");
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? PROTOCOL_VERSION);
      return reply({
        protocolVersion: SUPPORTED.includes(requested) ? requested : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ultra-motion-x", version: "1.0.0" },
        instructions:
          "Ultra Motion X tools. Typical flow: umx_analyze → umx_check → umx_install (dry run, review diff) → umx_install confirm=true → umx_doctor. Undo with umx_rollback confirm=true.",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = msg.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(-32602, `unknown tool ${String(name)}`);
      try {
        const result = await tool.handler((msg.params?.arguments as Record<string, unknown>) ?? {});
        return reply({
          content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (err) {
        // Tool failures are reported in-band so the agent can react (per MCP spec).
        return reply({ content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true });
      }
    }
    default:
      return isNotification ? null : fail(-32601, `method not found: ${msg.method}`);
  }
}

export function serveStdio(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg: Rpc;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`,
      );
      return;
    }
    const res = await handle(msg);
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  });
}

if (
  process.argv.includes("--stdio") ||
  (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
)
  serveStdio();
