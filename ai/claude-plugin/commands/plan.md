---
description: Show the exact diff an Ultra Motion X installation would apply, without writing anything.
argument-hint: "[profile] [--annotate]"
---

Call `umx_install` (no `confirm`) for the current directory with the profile/flags from `$ARGUMENTS`. Present the unified diff, the manual steps and notes. Point out anything that would touch code beyond the bootstrap import, config, vendored SDK, dependency entry and optional `data-umx` annotations. Do not apply.
