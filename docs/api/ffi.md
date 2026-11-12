# C ABI reference (`sdk/ffi/include/ultra_motion_x.h`, ABI 1)

Thread-compatible: use one engine from one thread at a time. Conventions:

| Return type | Success | Failure |
|---|---|---|
| `int32_t` | `>= 0` | `UMX_ERR_*` (< 0) |
| `uint64_t` handle / animation id | non-zero | `0` |
| `double` | value | `NaN` |

After any failure `umx_last_error_code()` / `umx_last_error_message()` (thread-local) describe
it. Strings are passed as `(ptr, len)` UTF-8; returned strings are `UmxString*`, released with
`umx_string_free`. No function unwinds across the boundary (panics are caught and reported as
`UMX_ERR_PANIC`; on `wasm32-unknown-unknown` a panic traps).

| Group | Functions |
|---|---|
| Library | `umx_version`, `umx_abi_version`, `umx_last_error_code`, `umx_last_error_message`, `umx_string_*`, `umx_alloc`, `umx_free` |
| Engine | `umx_engine_new(fixed_step)`, `umx_engine_free`, `umx_engine_frame(ts_ms)` → 1 while animating, `umx_engine_advance(dt)`, `umx_engine_needs_frame`, `umx_engine_poll_event`, `umx_engine_set_reduced_motion`, `umx_engine_telemetry_json` |
| Values | `umx_value_create/destroy/get/velocity/set/set_bounds/stop` |
| Animations | `umx_animate_spring(k, c, m, priority, policy)`, `umx_animate_tween(duration, bezier)`, `umx_animate_decay`, `umx_animate_json(spec)` |
| MDL & graphs | `umx_compile`, `umx_inspect`, `umx_migrate`, `umx_engine_load_mdl`, `umx_instance_create/destroy/send/get/state/gesture`, `umx_timeline_play` |
| Stateless math | `umx_spring_position/velocity/finish_time` |
| Particles | `umx_particles_new/free/add_emitter/set_emitter/add_force/clear_forces/burst/set_fidelity/step/buffer/is_idle` |

`umx_animate_json` accepts the serialised `AnimationSpec`:
`{"type":"spring","spring":{"stiffness":300,"damping":20}}`,
`{"type":"tween","duration":0.3,"easing":{"type":"cubicBezier","x1":0.2,"y1":0,"x2":0,"y2":1}}`,
`{"type":"keyframes","keyframes":{"values":[0,1.1,1]},"duration":0.4}`, `{"type":"decay"}`, `{"type":"instant"}`.

Priorities: `UMX_PRIORITY_DECORATIVE`…`UMX_PRIORITY_GESTURE`. Policies: `UMX_POLICY_REPLACE|QUEUE|REJECT|ADDITIVE`.

The C++17 wrapper `ultra_motion_x.hpp` provides RAII (`umx::Engine`) and exceptions (`umx::Error`).
Conformance programs: `sdk/ffi/tests/abi_test.c`, `cpp_wrapper_test.cpp` (`bash sdk/ffi/tests/run.sh`).
