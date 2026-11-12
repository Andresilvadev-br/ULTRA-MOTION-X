# Safety rules for automated integration

1. Analyze before changing; show the plan before applying.
2. Never overwrite files Ultra Motion X did not create (the installer enforces this).
3. Every write goes through a recorded transaction (`.ultra-motion/manifest.json`) so it can be
   rolled back; snapshots of modified files live in `.ultra-motion/snapshots/`.
4. Rollback never destroys later user edits: it reverts only Ultra Motion X hunks, and writes
   `*.umx-rollback.rej` when that is not possible.
5. Updates are explicit (`umx update --yes`), semver-classified, run the project's tests and roll
   back automatically on failure. Remote checks only read git tags; no downloaded code is run.
6. Accessibility: keep `reducedMotion: "user"`; do not add flashing or large-amplitude motion.
7. Performance claims require measurements; label estimates as estimates.
8. No network access is needed at runtime; telemetry and autotuning are local only.
