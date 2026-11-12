# Integration playbook (for AI agents and humans)

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
