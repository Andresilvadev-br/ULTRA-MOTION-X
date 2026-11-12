# Security policy

Report vulnerabilities privately through GitHub Security Advisories on this repository
(Security → Report a vulnerability). Please include reproduction steps and affected versions.

Security properties maintained by the project:
- The runtime needs no network access; telemetry and autotuning stay local.
- Integration tools never overwrite files they did not create, show a dry-run first, record
  every change and can roll back without destroying later user edits.
- Updates are explicit, semver-classified, verified by the project's tests and rolled back on
  failure; remote checks only read git tags and never execute downloaded code.
- The Studio/examples server binds to 127.0.0.1, serves an explicit allowlist (no sources,
  configs, dotfiles or tests) and accepts only GET/HEAD.
- The C ABI validates pointers, UTF-8 and parameter ranges, never unwinds across the boundary
  and bounds allocations (values, particles, layers, document size).
- The MCP server performs writes only with `confirm: true`.
