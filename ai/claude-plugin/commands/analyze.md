---
description: Analyze the current project for Ultra Motion X (platform, frameworks, components, existing animation, compatibility) without changing anything.
---

Analyze the project in the current directory with the `umx_analyze` and `umx_check` tools of the `ultra-motion-x` MCP server (CLI fallback: `umx analyze . --json` and `umx check . --json`).

Report: platform and recommended adapter; frameworks with versions; build system and package manager; entry points; discovered components grouped by role with file:line examples (top 5 per role); existing animation libraries and CSS transitions that could conflict; compatibility issues with fixes. Do not modify files.
