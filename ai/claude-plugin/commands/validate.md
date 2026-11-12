---
description: Validate, compile or migrate a Motion Design Language (*.umx.json) document.
argument-hint: "<file> [--compile|--migrate|--dot]"
---

Read the file given in `$ARGUMENTS`. Use `umx_validate_mdl` (diagnostics with JSON paths), `umx_compile_mdl` (`format: "summary"` or `"dot"` for inspection) or the CLI `umx migrate <file> --write` for old `umx/0` documents. Fix reported errors in the document with minimal edits and re-validate until it is valid.
