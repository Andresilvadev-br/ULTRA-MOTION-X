---
description: Check for and apply a newer Ultra Motion X version safely (semver analysis, migrations, tests, automatic rollback on failure).
argument-hint: "[--allow-major]"
---

1. `umx_update_check` for the current directory. Report installed vs available version, change type and migrations; highlight breaking entries.
2. Ask the user before applying (never update silently). For major versions require explicit approval and `--allow-major`.
3. Apply with the CLI: `umx update . --yes [--allow-major]`. The updater runs the project's `test` script and rolls back automatically if it fails — report the outcome and test output.
4. Run `umx_doctor` afterwards and summarise.
