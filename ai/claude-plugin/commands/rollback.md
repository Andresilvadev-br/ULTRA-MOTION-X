---
description: Undo Ultra Motion X changes in this project (last transaction or everything), preserving later edits by the developer.
argument-hint: "[--all] [--files a,b]"
---

1. Call `umx_rollback` *without* `confirm` (dry run) with options from `$ARGUMENTS`; show what would be restored, reverted, removed and any conflicts.
2. After the user agrees, call it again with `confirm: true`.
3. For each conflict, open the `.umx-rollback.rej` file, explain the remaining Ultra Motion X lines, and remove them by hand only with the user's agreement. Then remove the dependency from the lockfile by running the package manager install.
4. Run the project's tests/build to confirm the app still works.
