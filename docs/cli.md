# CLI (`umx`)

Run from a checkout: `node cli/bin/umx.mjs <command>` (or `npx umx` once the package is installed).

```text
Ultra Motion X CLI 1.0.0

Usage: umx <command> [dir] [options]

Project integration
  analyze [dir]            Detect platform, frameworks, components, existing animation
  check [dir]              Compatibility verification
  plan [dir]               Show the exact changes an install would make (diff, no writes)
  install [dir]            Analyze → check → plan → apply → validate → report
      --yes                 apply without confirmation (required when not a TTY)
      --profile <name>      motion profile (minimal, professional, cinematic, dynamic, fluid, sport, elegant, ultraResponsive, singularity)
      --mode vendor|npm     vendor the SDK (default, offline) or depend on the npm package
      --adapter <name>      override the detected adapter
      --entry <file>        override the detected entry point
      --annotate            add data-umx role attributes to clearly identified elements
      --dry-run             same as plan
      --force               allow replacing files that were already installed
  doctor [dir] [--fix]     Diagnose drift; --fix applies safe, reversible repairs
  rollback [dir]           Undo the last transaction (--all, --files a,b, --dry-run, --force)
  update [dir]             Check/apply engine updates (--check, --source <path>,
                            --remote <git-url>, --allow-major, --no-tests, --yes)
  report [dir]             Write .ultra-motion/report.md
  test [dir]               Run the project's tests and the integration doctor

Motion Design Language
  init [dir]               Create ultra-motion.config.json (--profile)
  validate <file>          Validate an MDL document
  compile <file>           Compile MDL to an execution plan (-o plan.json, --summary, --dot)
  migrate <file>           Migrate an MDL document to the current version (--write)
  presets [name]           List motion profiles or show one profile's tokens

Engine
  bench [--native|--web]   Run benchmarks from the Ultra Motion X repository
  version                  Print versions

Global: --json (machine output), --help
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | failure (incompatible project, invalid MDL, failed tests during update…) |
| 2 | usage error (unknown command, missing argument, destructive command without `--yes` in a non-interactive shell) |
| 3 | completed but needs attention (rollback conflicts, doctor errors, plan conflicts, breaking update without `--allow-major`) |

Every command accepts `--json` for machine-readable output. Destructive commands
(`install`, `rollback`, `update`) never prompt when `--yes` is given and refuse to run
non-interactively without it.

## Typical flows

```sh
umx analyze app && umx plan app --profile fluid     # review
umx install app --yes                               # apply (transaction recorded)
umx doctor app --fix                                # after refactors
umx update app --check && umx update app --yes      # controlled update, auto-rollback on failing tests
umx rollback app --yes [--all] [--files a,b]        # undo
umx validate motion.umx.json && umx compile motion.umx.json --dot > graph.dot
umx bench --native --quick                          # from the Ultra Motion X checkout
```
