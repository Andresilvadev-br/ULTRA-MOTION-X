---
description: Diagnose (and optionally repair) an existing Ultra Motion X integration after the project changed.
argument-hint: "[--fix]"
---

Run `umx_doctor` for the current directory. Explain each finding. If `$ARGUMENTS` contains `--fix`, call `umx_doctor` with `fix: true` (repairs are recorded as a reversible transaction) and then re-run the project's tests and build. For findings that are not auto-fixable (e.g. entry file moved, invalid config), make the minimal manual fix yourself, explain it, and re-run `umx_doctor` until it reports healthy or only informational items remain.
