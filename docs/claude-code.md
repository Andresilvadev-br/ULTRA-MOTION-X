# Claude Code integration

The repository root is a Claude Code plugin (`.claude-plugin/plugin.json`) and a marketplace
(`.claude-plugin/marketplace.json`, plugin source `./`). Validated with `claude plugin validate .`.

```
/plugin marketplace add andresilvadev-br/ultra-motion-x
/plugin install ultra-motion-x@ultra-motion-x
```

| Component | Location |
|---|---|
| Commands (`/ultra-motion-x:<name>`) | `ai/claude-plugin/commands`: `ultra-motion-x` (full integration), `analyze`, `plan`, `doctor`, `tune`, `update`, `rollback`, `studio`, `bench`, `validate` |
| Skill `ultra-motion-x` | `ai/skills/ultra-motion-x/SKILL.md` + `references/{api,mdl}.md` |
| Agent `motion-integrator` | `ai/claude-plugin/agents/motion-integrator.md` |
| MCP server `ultra-motion-x` | `ai/claude-plugin/mcp.json` → `ai/claude-plugin/bin/umx-mcp.mjs` → `ai/mcp` |
| Agent guides | `ai/agent-guides/{integration-playbook,platform-adapters,safety-rules}.md`, `AGENTS.md`, `CLAUDE.md` |

MCP tools: `umx_environment`, `umx_analyze`, `umx_check`, `umx_install` (dry run unless
`confirm: true`), `umx_doctor` (`fix`), `umx_rollback` (dry run unless `confirm: true`),
`umx_update_check`, `umx_validate_mdl`, `umx_compile_mdl`, `umx_profiles`. Transport: stdio
JSON-RPC (protocol versions 2025-06-18, 2025-03-26, 2024-11-05).

Installed plugins are copied to Claude Code's plugin cache; the launcher
(`ai/claude-plugin/bin/ensure-setup.mjs`) runs `npm ci && npm run build` inside that copy the
first time (requires network access to the npm registry), logging to stderr.

Without the plugin, any agent can follow `AGENTS.md` and use the CLI directly.
