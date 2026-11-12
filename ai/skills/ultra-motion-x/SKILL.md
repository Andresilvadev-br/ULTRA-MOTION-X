---
name: ultra-motion-x
description: How to integrate, use, tune, diagnose, update and roll back the Ultra Motion X motion/physics/rendering engine in a project. Use when the user asks to add premium/fluid animation, springs, gestures, layout or shared-element transitions, motion profiles, or to install/remove Ultra Motion X.
when_to_use: Adding or changing UI motion in any web/desktop/mobile/game-UI project; installing, diagnosing, updating or removing Ultra Motion X; writing Motion Design Language (*.umx.json) files.
---

# Ultra Motion X

Ultra Motion X (UMX) is a motion engine with a shared Rust core (physics, motion graph, compiler,
scheduler, telemetry; C ABI + WebAssembly) and a framework-agnostic Web SDK (`@ultra-motion-x/web`).
It adapts to the host application: it never replaces the app's architecture, styles or fonts.

## Integration workflow (always this order)

1. `umx_analyze` → `umx_check` (MCP) — or `umx analyze . --json`, `umx check . --json`.
2. `umx_install` without `confirm` → review the diff (only bootstrap import/script, config file,
   vendored SDK, dependency entry, optional `data-umx` annotations).
3. `umx_install confirm=true` → creates a reversible transaction in `.ultra-motion/manifest.json`.
4. Run the package manager install, the project's tests/type-check/build, then `umx_doctor`.
5. Undo at any time with `umx_rollback confirm=true` (later user edits are preserved; overlapping
   edits become `.umx-rollback.rej` conflicts — never silently overwritten).

Full playbook: `ai/agent-guides/integration-playbook.md` (read it for non-trivial projects).

## What the installer adds (web)

- `ultra-motion.config.json` — profile, reduced-motion policy, fidelity bounds, compositor mode,
  auto-enhanced roles.
- `src/ultra-motion.(ts|js)` bootstrap — `configureEngine()` + `autoEnhance()`; browser-only (SSR-safe).
- One `import "./ultra-motion";` in the entry (or `<script type="module">` for plain HTML; a
  `"use client"` component for Next.js app router).
- `vendor/ultra-motion-x/web` + `"@ultra-motion-x/web": "file:vendor/ultra-motion-x/web"` (default
  `--mode vendor`), or `^version` with `--mode npm`.

`autoEnhance()` discovers buttons, cards, menus, dialogs, drawers, toasts, tooltips, nav links,
lists (FLIP on reorder) and `<details>`; it skips forms, elements with `data-umx="off"` and elements
whose CSS already transitions transform/opacity (conflict avoidance).

## Explicit API (prefer it for important components)

See `references/api.md` for signatures. Most used:

```ts
import { animate, press, drag, layoutTransition, sharedTransition, openDialog, closeDialog,
  timeline, MotionGraph, MotionDNA, configureEngine } from "@ultra-motion-x/web";

animate(el, { x: 120, opacity: 1 });                       // DNA "standard" spring
animate(el, { scale: [1, 1.05, 1] }, { duration: 400 });   // keyframes
animate(".item", { y: [12, 0], opacity: [0, 1] }, { stagger: 40, spring: "snappy" });
press(button);                                             // immediate pointer-down feedback
drag(card, { axis: "x", bounds: "parent", snapX: [0, 320] });
await layoutTransition(list, () => list.prepend(newItem)); // FLIP with velocity continuity
await sharedTransition(thumb, hero);                       // element keeps identity
```

Framework adapters: `@ultra-motion-x/react` (`useAnimate`, `useMotionValue`, `useSpring`, `usePress`,
`useDrag`, `useLayoutTransition`), `@ultra-motion-x/vue` (`v-umx-press`, composables),
`@ultra-motion-x/svelte` (actions `use:press`, `use:drag`, …), `@ultra-motion-x/angular` (directives).

## Motion DNA profiles

`minimal`, `professional` (default), `cinematic`, `dynamic`, `fluid`, `sport`, `elegant`,
`ultraResponsive`, `singularity`. Tokens: durations, springs (snappy/standard/gentle/bouncy), easings,
press scale, hover lift, depth, stagger, parallax, intensity, elasticity. Change with the config file
or `engine.setProfile()`. Profiles never change colours or typography.

## Rules

- Keep `reducedMotion: "user"`; never force motion on users who asked to reduce it.
- Never animate decoratively form inputs; never block interaction on animations (all animations are
  interruptible and retarget with velocity preserved).
- Don't stack UMX and another animation library on the same element.
- Don't claim performance numbers you did not measure. Telemetry marks values as
  measured / estimated / unavailable — keep that distinction in reports.
- Motion Design Language documents: validate with `umx_validate_mdl`; reference in `references/mdl.md`.
