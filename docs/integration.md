# Integration guide

This is the authoritative procedure for integrating Ultra Motion X into an existing project.
The goal: better motion **without changing functionality, styles or architecture**.

## 0. Preconditions
- Node ≥ 20.11 for the CLI/MCP tools. The Ultra Motion X checkout must be built once
  (`npm ci && npm run build` at its root; the plugin launcher does this automatically).
- Work on a clean git tree or a branch so the user can review the diff independently of the
  installer's own rollback.

## 1. Understand the project
- `umx analyze <dir> --json` / `umx_analyze`. Read: platform, adapter, entry points, components
  by role, animation libraries, CSS transitions on transform/opacity.
- Open the main layout/entry files yourself to confirm the analysis (static detection is
  heuristic; confidence values are given per component).

## 2. Check compatibility
- `umx check` / `umx_check`. Errors stop the process (unsupported framework version, unknown
  platform, missing entry). Warnings are informational (coexisting animation libraries, CSS
  transitions, SSR).

## 3. Plan and review
- `umx plan <dir> [--profile p] [--annotate]` / `umx_install` without confirm.
- Acceptable changes: config file, bootstrap file, one import (or script tag / client component),
  vendored SDK files, dependency entry, optional `data-umx` attributes. Reject anything else.

## 4. Apply
- `umx install <dir> --yes` / `umx_install confirm=true`. The installer refuses to overwrite files
  it did not create and aborts if files changed since planning.
- Run the package manager (`npm install` etc.) so `file:vendor/...` is linked.

## 5. Targeted enhancement (optional, recommended)
Auto-enhance covers common roles generically. For key interactions, use explicit APIs:

| Component | API |
|---|---|
| Primary buttons | `press(el)` (auto) — keep native `:active` styles if they exist |
| Cards → detail view | `sharedTransition(card, detail)` or `viewTransition(update)` |
| Lists that reorder/insert | `layoutTransition(list, mutate)` or `data-umx="list"` |
| Native `<dialog>` | `openDialog(d)` / `closeDialog(d)` |
| Drawers/sheets | `drag(sheet, { axis, bounds, snapX/snapY })` + MotionGraph from MDL |
| Tabs | `tabIndicator(indicator, tab)` |
| Progress | `progressTo(fill, value)` |
| Page transitions | `viewTransition(() => router.navigate(...))` |

Do **not**: animate form inputs decoratively, change colours/fonts/layout rules, remove the
user's CSS, or animate elements owned by another animation library.

## 6. Verify
- Type-check, lint, unit tests, build of the host project.
- `umx doctor <dir>` → must be healthy (or only info findings).
- If a browser is available, open the app: interactions must stay responsive during
  animations; with OS "reduce motion" enabled, motion must become minimal.

## 7. Report
- Transaction id, files changed, profile, enhancements, measured results (with provenance),
  manual steps, how to roll back (`umx rollback <dir> --yes`).

## Failure handling
- Build/test failure caused by the integration and not trivially fixable → `umx rollback --yes`.
- Rollback conflicts (user edited our lines) → read the `.umx-rollback.rej`, resolve manually.

## What the engine records

`.ultra-motion/manifest.json` lists every transaction (install, heal, update) with per-file
hashes, the exact hunks Ultra Motion X introduced and snapshots of modified files
(`.ultra-motion/snapshots/`). Rollback:

- files created by Ultra Motion X are removed only if unchanged since installation;
- modified files are restored from the snapshot when untouched, otherwise only our hunks are
  reverted (your later edits stay); when our lines were edited too, a `*.umx-rollback.rej`
  file is written and the conflict is reported;
- JSON changes (dependency entries) are reverted at key level, keeping other dependencies.

## Self-healing (`umx doctor [--fix]`)

Detects: missing manifest, invalid config, vendored files missing/modified, version mismatch,
bootstrap import removed from the entry point, dependency entry removed, coexisting animation
libraries. Safe repairs are applied as a new reversible `heal` transaction; anything else is
reported for a human.

## Updates (`umx update`)

`--check` compares the installed version (manifest) with the source checkout using semver and
lists entries from `integration/migrations/index.json`. Applying requires `--yes` (and
`--allow-major` for breaking changes), runs the project's `test` script and rolls back
automatically if it fails. `--remote <git-url>` lists released tags without downloading or
executing code.

## Platforms

`--adapter` selects non-web installers (`unity`, `godot`, `unreal`, `qt`, `dotnet-wpf`, `winui`,
`flutter`, `react-native`). They copy the adapter sources, the C headers and any native library
found in `target/release` as a reversible transaction.
