# Web SDK API reference (`@ultra-motion-x/web`)

All times in the DOM-level API are **milliseconds**; physics parameters are SI (seconds, units/s).

## Engine
- `configureEngine(opts)` / `getEngine()` / `createEngine(opts)`
  - `profile`, `reducedMotion: "user"|"always"|"never"`, `maxIntensity`, `fidelity: {min,max,initial}`,
    `compositor: "auto"|"always"|"never"`, `budgetFraction`, `maxDelta`, `fixedStep`, `telemetry`,
    `powerAware`, `driver` (`ManualDriver` for tests), `devtoolsHook`.
  - `engine.report()` telemetry (p50/p95/p99, provenance), `engine.setProfile()`, `engine.setFidelity()`,
    `engine.timeScale`, `engine.on("frame"|"idle"|"fidelity"|"power"|"warning"|"animation", cb)`.
- The frame loop runs only while something animates (on-demand).

## Animating
- `animate(target, values, options) → AnimationControls` (awaitable; `.pause() .play() .reverse()
  .seek(ms) .speed .cancel() .complete()`). Targets: element, selector, NodeList/array, MotionValue,
  plain object. Values: number, `"10px"`, `"50%"`, colours (OKLab interpolation), arrays = keyframes,
  `null` first keyframe = current value.
  - Transition options: `type` (`spring`|`tween`|`keyframes`|`decay`|`inertia`|`instant`), `spring`
    (`snappy|standard|gentle|bouncy` or params), `stiffness/damping/mass`, `response/dampingRatio`,
    `duration+bounce`, `duration`, `ease`, `delay`, `times`, `velocity`, `clamp`.
  - `priority` (`decorative|ambient|normal|interaction|gesture`), `policy`
    (`replace|queue|reject|additive`), `stagger`, `repeat`, `repeatType`, `transitions` per property,
    `compositor` (WAAPI offload), `onUpdate`, `onComplete`.
- `set(target, values)`, `stop(target)`, `motionValueOf(el, prop)`, `stagger(each, {from})`.
- `MotionValue` (`get`, `velocity`, `set`, `jump`, `animate(to, spec, opts)`, `on("change")`, `stop`, `destroy`).

## Interaction
- `press(el, {scale})`, `hover(el, {lift})`, `magnetic(el, {radius, strength})`
- `drag(el, {axis, bounds, elastic, momentum, snapX, snapY, threshold, keyboardStep, onStart/onMove/onEnd})`
- `gestures(el, {onTap, onDoubleTap, onLongPress, onPan*, onSwipe, onPinch, onWheel})`
- `predictIntent(elements, {onPredict})` (prepare only), `rovingFocus(container)`, `gamepadNavigation()`

## Living interface
- `layoutTransition(container|elements, mutate, {mode: "position"|"size", preserveRadius, stagger})`
- `exitAndRemove(el, props)`, `sharedTransition(from, to)`, `captureShared()/animateShared()`,
  `viewTransition(update)` (native View Transitions when available)
- `morphContainer(el, apply, {radius, background})`, `morphPath(path, d)`, `tilt(el)`, `parallax(layers)`, `depthStack(container)`

## Semantics & presets
- `autoEnhance({roles, lists})`, `detectRole(el)`, `enter(el, role)`, `exit(el, role)`,
  `openDialog(dialog)`, `closeDialog(dialog)`, `presets.*` (button, card, menu, modal, drawer,
  notification, tooltip, overlay, list, tabs, page, window, draggable, scroll, loading, progress,
  expand, magnetic, spatial, form)

## Orchestration & graphs
- `timeline([[target, values, {at}], {label, at}], {repeat})` — scrubbable (`seek`, `step`)
- `sequence(...)`, `parallel(...)`, `race(...)`, `MotionGroup`, `choreograph(phases)`
- `MotionGraph(def)` (`send`, `bind(el, map)`, `beginGesture/setGestureValue/endGesture`,
  `setStateValue`), `graphFromPlan(plan, component)` with plans from `loadCore().compile(mdl)`.

## Adaptive & tools
- `MotionDNA.profile(name)`, `.custom(base, overrides)`, `.cssVariables()`
- `MotionAutotuner`, `diagnose(report, config)`, `MotionIntelligence` (tempo/cancellation modules)
- `ParticleSystem(canvas, {capacity})` (+ `wasmParticleBackend`)
- `MotionRecorder`, `MotionPlayer`, `detectAnomalies`, `compareRecordings`, `replayScenario`
- `@ultra-motion-x/web/wasm`: `loadCore()` → `compile`, `inspect`, `migrate`, `createEngine`, `createParticles`
- `@ultra-motion-x/effects`: `surface(el, {material: "glass"|"ripple"|"gradient"|"lighting"|"noise"|"refraction"})`
- `@ultra-motion-x/devtools`: `attachDevTools({open})` (Alt+Shift+M)

## Error handling

Invalid input throws `MotionError` with a stable `code` (`E_NOT_FINITE`, `E_RANGE`, `E_EASING`,
`E_KEYFRAMES`, `E_VALUE`, `E_PROFILE`, `E_GRAPH`, …). Errors thrown by user callbacks inside the
frame loop are reported with `reportError` and never stop the loop.

## Lifecycle and resources

- `MotionValue.destroy()`, `ElementTarget.destroy()`, `MotionGraph.destroy()`, `Surface.destroy()`,
  `ParticleSystem.destroy()` release listeners and engine registrations. Framework adapters call
  them on unmount.
- `will-change` is set only while an element animates and is bounded (64 elements).
- `engine.destroy()` stops the loop and detaches visibility/battery/pressure observers.

## Existing CSS transforms

Transforms present in CSS before Ultra Motion X first animates an element are **preserved and
composed after** the animated components. Do not position hidden panels with a CSS
`transform`; set the initial value with `set(el, { x: … })` instead (see troubleshooting.md).
