---
description: Integrate Ultra Motion X into the open project end-to-end (analyze → check → plan → install → wire → verify → report), preserving existing functionality.
argument-hint: "[profile] [--annotate] [--mode vendor|npm]"
---

# Ultra Motion X — full integration

Integrate the Ultra Motion X engine into the project in the current working directory. Arguments: `$ARGUMENTS` (optional motion profile such as `fluid`, `professional`, `sport`; flags are passed to the installer).

Follow the playbook in the `ultra-motion-x` skill (load it now). Use the `ultra-motion-x` MCP tools (`umx_analyze`, `umx_check`, `umx_install`, `umx_doctor`, `umx_rollback`). If MCP tools are unavailable, call the CLI: `node "<plugin root>/ai/claude-plugin/bin/umx.mjs" <command> <project> --json` (the `umx_environment` tool returns the plugin root).

Steps — do all of them, in order:

1. **Analyze** the project (`umx_analyze`). Summarise platform, frameworks, entry points, discovered components by role and any existing animation library or CSS transitions.
2. **Check compatibility** (`umx_check`). Stop and explain if `compatible` is false; propose the concrete fix.
3. **Plan**: call `umx_install` *without* `confirm` to get the diff. Review every hunk: it must only add the bootstrap import/script, the config file, the vendored SDK and the dependency entry (plus `data-umx` annotations when `--annotate` was requested). If anything touches unrelated code, do not apply.
4. **Apply** with `umx_install` and `confirm: true` (same arguments). Record the transaction id.
5. **Wire framework specifics** only where the report lists manual steps (e.g. run the package manager install, mount `<UltraMotion />` in a Next.js layout). Run `npm install`/`pnpm install`/`yarn` as appropriate.
6. **Enhance deliberately**: for components the analysis found with high confidence, prefer explicit APIs over guessing — e.g. `press()` for primary buttons, `layoutTransition()` for lists that reorder, `openDialog()/closeDialog()` for `<dialog>`, `drag()` for draggable surfaces, `sharedTransition()` for card→detail. Keep business logic, styles, colours and fonts untouched. Never animate form fields decoratively. Respect `prefers-reduced-motion` (the engine does by default — do not override `reducedMotion` to `never`).
7. **Verify**: run the project's type-check, linter, tests and build. Then `umx_doctor`. If anything fails because of the integration and cannot be fixed safely, run `umx_rollback` with `confirm: true` and report.
8. **Report**: list changed files, the transaction id, the motion profile, what was enhanced, how to tune (`ultra-motion.config.json`), how to inspect (`attachDevTools()` from `@ultra-motion-x/devtools` in development) and how to undo (`/ultra-motion-x:rollback`).

Never claim visual smoothness or FPS improvements you did not measure. Never commit or push unless asked.
