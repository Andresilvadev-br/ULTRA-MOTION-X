# Accessibility

- `reducedMotion: "user"` (default) follows `prefers-reduced-motion` live. Under reduced motion
  animations jump to their destination (decay/inertia still resolve their physical end), spatial
  effects, parallax, particles and decorative loops are disabled, shader time is frozen.
  `"always"` forces it; `"never"` is accepted but the compiler warns — reserve it for essential motion.
- `maxIntensity` (0–1) scales tilt, parallax and depth globally.
- Nothing blocks input: every animation is interruptible; gestures have the highest priority.
- Keyboard: `press` reacts to Enter/Space; `drag` supports arrow keys; Escape cancels drags and
  gestures; `rovingFocus` and `gamepadNavigation` only move focus between focusable elements.
- Modals: `openDialog`/`closeDialog` keep native `<dialog>` focus handling; exiting elements get
  `inert` and `aria-hidden` (`exitAndRemove`). Auto-enhance never decorates form fields.
- Effects are `aria-hidden` and never carry content; the Time Machine never records text or input values.
