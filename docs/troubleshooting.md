# Troubleshooting

**An element ends up offset or a drawer never appears.** It probably has a CSS `transform`
(e.g. `translateX(-300px)`) — Ultra Motion X preserves existing transforms and composes them
after the animated values, so offsets add up. Remove the CSS transform and set the initial
state with `set(el, { x: -300 })`.

**Nothing animates.** Check `getEngine().reducedMotion` (the OS may request reduced motion),
elements with `data-umx="off"`, or a `MotionError` in the console (invalid values/units).

**Animations stop when the tab is hidden.** Intentional: the loop is suspended while the page
is not visible and resumes where it left off.

**Large lists stutter with `compositor: true`.** Baking Web Animations costs main-thread time
per element; calls with more than `compositorMaxElements` elements use the frame loop.

**`umx install` refuses to run.** It never overwrites files it did not create and aborts if
files changed between planning and applying. Use `umx plan` to see why, then move the file or
pass `--force` only if the existing file is disposable.

**Rollback reports conflicts.** Your edits overlap the lines Ultra Motion X added. Read the
`*.umx-rollback.rej` file next to the conflicting file and remove the remaining lines manually.

**Browser tests cannot launch Chromium.** Run `npx playwright install --with-deps chromium` or
set `UMX_CHROMIUM_PATH` to an existing Chromium/Chrome executable.

**`node: --conditions … type stripping` errors.** Use Node ≥ 22.18.

**Native library not found (Unity/Godot/.NET/Flutter).** Build `cargo build -p umx-ffi --release`
for the target and place the library where the host loads native plugins (see the adapter README).
