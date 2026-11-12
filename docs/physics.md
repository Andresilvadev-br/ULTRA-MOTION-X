# Physics guide

## Springs (closed form)

`m·x'' + c·x' + k·(x − target) = 0` is solved exactly for under-, critically (|ζ−1| < 1e-6) and
over-damped regimes. Parametrisations: physical (`stiffness`, `damping`, `mass`), perceptual
(`response` = undamped period in seconds, `dampingRatio` ζ) and designer (`duration` + `bounce`
∈ [-1, 1]).

**Completion** uses the *envelope* of displacement and velocity (`restDelta`, `restSpeed`), so a
spring cannot stop at a zero crossing while still moving fast. `clampOvershoot` finishes at the
first target crossing; `maxOscillations` caps the number of crossings. Undamped springs never
finish unless capped (timelines reject them).

**Retargeting** creates a new spring from the exact position and velocity at the current
instant (momentum preservation) — the basis of interruptible open/close/open sequences.

## Decay and inertia

Decay: `v(t) = v0·e^(−t/τ)`, `x(t) = x0 + v0·τ·(1 − e^(−t/τ))`; `τ` from a time constant or a
per-millisecond deceleration rate (0.998 ≈ scroll views). Inertia combines decay with
boundary springs: the exact crossing time is solved analytically and the spring starts with the
crossing velocity (rubber banding), or the motion springs to the snap point nearest the
projected end position.

## Gestures

Velocity is a weighted least-squares fit over the last 100 ms of (coalesced) pointer samples,
robust to irregular event delivery; it returns 0 after 40 ms without movement. Rubber banding:
`(1 − 1/(x·c/d + 1))·d`. Magnetism uses a smoothstep fall-off. Intent classification uses
distance, duration and release speed (tap / long press / drag / swipe / cancel).

## Deterministic simulation

Systems without closed forms (coupled springs, 2D worlds with collisions, particle fields) use
`FixedStepper`: wall-clock deltas accumulate and an integer number of identical steps run; a
step cap prevents spirals of death after stalls. The trajectory therefore depends only on the
step size, not on the display rate (tests compare 60 Hz and 240 Hz feeding).

**Determinism limits.** Native Rust results are bit-identical for the same build across
operating systems because transcendentals use the pure-Rust `libm`. Different compilers, CPU
targets with different FMA usage, or the TypeScript runtime (which uses the JS engine's `Math`)
may differ in the last bits; the TS ⇄ Rust conformance tests bound the difference at 1e-9
(relative) for springs, easings, decay and inertia. Particle fields use a seeded PCG32 generator.

## Frame-rate independence

Analytic generators are sampled with elapsed time, so a spring at 60 Hz and at 240 Hz passes
through identical states at identical times (`frame_rate_independence` tests in Rust, TS and the
Studio *Compare* lab). Frame deltas longer than `maxDelta` (100 ms by default) are treated as a
pause rather than a jump.
