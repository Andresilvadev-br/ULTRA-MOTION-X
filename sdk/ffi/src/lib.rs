//! # Ultra Motion X C ABI
//!
//! Stable `extern "C"` surface over [`umx_runtime`]. The same exports are used by native
//! hosts (see `include/ultra_motion_x.h`) and by WebAssembly hosts (the JS loader in
//! `@ultra-motion-x/web/wasm`).
//!
//! Conventions:
//! * functions returning `int32_t` use `>= 0` for success and negative error codes;
//! * functions returning handles return `0` on failure;
//! * functions returning `double` return `NaN` on failure;
//! * after any failure, `umx_last_error_code` / `umx_last_error_message` describe it
//!   (thread-local, valid until the next failing call on the same thread);
//! * strings are passed as `(pointer, length)` UTF-8 without terminator; strings returned
//!   by the library are `UmxString*` and must be released with `umx_string_free`;
//! * no function unwinds across the boundary: panics are caught and reported as errors
//!   (on `wasm32-unknown-unknown`, which aborts on panic, a panic traps instead).

#![allow(clippy::missing_safety_doc)]

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::ffi::{c_char, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use umx_core::{AnimationSpec, Easing, InterruptPolicy, Priority};
use umx_physics::field::{Emitter, Force, ParticleField};
use umx_physics::{DecayParams, Spring, SpringParams};
use umx_runtime::{AnimationEventKind, Engine, EngineConfig, Handle, RuntimeError};

pub const ERR_INVALID_HANDLE: i32 = -1;
pub const ERR_INVALID_ARGUMENT: i32 = -2;
pub const ERR_CORE: i32 = -3;
pub const ERR_GRAPH: i32 = -4;
pub const ERR_COMPILE: i32 = -5;
pub const ERR_NOT_FOUND: i32 = -6;
pub const ERR_CAPACITY: i32 = -7;
pub const ERR_NULL: i32 = -8;
pub const ERR_UTF8: i32 = -9;
pub const ERR_PANIC: i32 = -10;

thread_local! {
    static LAST_ERROR: RefCell<(i32, CString)> = RefCell::new((0, CString::default()));
}

fn set_error(code: i32, msg: impl Into<String>) {
    let msg = msg.into().replace('\0', " ");
    LAST_ERROR.with(|e| *e.borrow_mut() = (code, CString::new(msg).unwrap_or_default()));
}

fn runtime_error(e: &RuntimeError) -> i32 {
    let code = -e.code();
    set_error(code, e.to_string());
    code
}

fn guard<T>(fallback: T, f: impl FnOnce() -> T) -> T {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(v) => v,
        Err(_) => {
            set_error(ERR_PANIC, "internal panic caught at the FFI boundary");
            fallback
        }
    }
}

unsafe fn str_arg<'a>(ptr: *const c_char, len: usize) -> Result<&'a str, i32> {
    if ptr.is_null() {
        set_error(ERR_NULL, "null string pointer");
        return Err(ERR_NULL);
    }
    // SAFETY: caller guarantees `ptr` points to `len` readable bytes.
    let bytes = unsafe { std::slice::from_raw_parts(ptr.cast::<u8>(), len) };
    std::str::from_utf8(bytes).map_err(|_| {
        set_error(ERR_UTF8, "string is not valid UTF-8");
        ERR_UTF8
    })
}

unsafe fn engine<'a>(e: *mut Engine) -> Result<&'a mut Engine, i32> {
    if e.is_null() {
        set_error(ERR_NULL, "null engine pointer");
        return Err(ERR_NULL);
    }
    // SAFETY: non-null engine pointers come from `umx_engine_new` and are owned by the host.
    Ok(unsafe { &mut *e })
}

fn priority(p: i32) -> Priority {
    match p {
        0 => Priority::Decorative,
        1 => Priority::Ambient,
        3 => Priority::Interaction,
        4 => Priority::Gesture,
        _ => Priority::Normal,
    }
}

fn policy(p: i32) -> InterruptPolicy {
    match p {
        1 => InterruptPolicy::Queue,
        2 => InterruptPolicy::Reject,
        3 => InterruptPolicy::Additive,
        _ => InterruptPolicy::Replace,
    }
}

// ------------------------------------------------------------------ strings & memory

/// Owned UTF-8 string returned to the host.
pub struct UmxString {
    data: CString,
}

fn new_string(s: String) -> *mut UmxString {
    Box::into_raw(Box::new(UmxString {
        data: CString::new(s.replace('\0', " ")).unwrap_or_default(),
    }))
}

#[no_mangle]
pub unsafe extern "C" fn umx_string_ptr(s: *const UmxString) -> *const c_char {
    if s.is_null() {
        return std::ptr::null();
    }
    // SAFETY: produced by `new_string`.
    unsafe { (*s).data.as_ptr() }
}

#[no_mangle]
pub unsafe extern "C" fn umx_string_len(s: *const UmxString) -> usize {
    if s.is_null() {
        return 0;
    }
    // SAFETY: produced by `new_string`.
    unsafe { (*s).data.as_bytes().len() }
}

#[no_mangle]
pub unsafe extern "C" fn umx_string_free(s: *mut UmxString) {
    if !s.is_null() {
        // SAFETY: produced by `Box::into_raw` in `new_string`, freed once by contract.
        drop(unsafe { Box::from_raw(s) });
    }
}

/// Allocates `len` bytes (WebAssembly hosts use this to pass strings in).
#[no_mangle]
pub extern "C" fn umx_alloc(len: usize) -> *mut u8 {
    let mut v = vec![0u8; len.max(1)];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn umx_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        // SAFETY: `ptr`/`len` come from `umx_alloc(len)`.
        drop(unsafe { Vec::from_raw_parts(ptr, len.max(1), len.max(1)) });
    }
}

#[no_mangle]
pub extern "C" fn umx_version() -> *const c_char {
    concat!(env!("CARGO_PKG_VERSION"), "\0").as_ptr().cast()
}

/// ABI revision; bumped on any incompatible change to this header.
#[no_mangle]
pub extern "C" fn umx_abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn umx_last_error_code() -> i32 {
    LAST_ERROR.with(|e| e.borrow().0)
}

#[no_mangle]
pub extern "C" fn umx_last_error_message() -> *const c_char {
    LAST_ERROR.with(|e| e.borrow().1.as_ptr())
}

// ------------------------------------------------------------------ engine

/// Creates an engine. `fixed_step > 0` enables deterministic fixed-step mode (seconds).
#[no_mangle]
pub extern "C" fn umx_engine_new(fixed_step: f64) -> *mut Engine {
    guard(std::ptr::null_mut(), || {
        let config = EngineConfig {
            fixed_step: (fixed_step > 0.0 && fixed_step.is_finite()).then_some(fixed_step),
            ..EngineConfig::default()
        };
        Box::into_raw(Box::new(Engine::new(config)))
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_engine_free(e: *mut Engine) {
    if !e.is_null() {
        // SAFETY: produced by `umx_engine_new`, freed once by contract.
        drop(unsafe { Box::from_raw(e) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn umx_engine_set_reduced_motion(e: *mut Engine, on: i32) -> i32 {
    guard(ERR_PANIC, || match unsafe { engine(e) } {
        Ok(e) => {
            e.set_reduced_motion(on != 0);
            0
        }
        Err(c) => c,
    })
}

/// Host frame: returns 1 if another frame is needed, 0 if idle, < 0 on error.
#[no_mangle]
pub unsafe extern "C" fn umx_engine_frame(e: *mut Engine, timestamp_ms: f64) -> i32 {
    guard(ERR_PANIC, || match unsafe { engine(e) } {
        Ok(e) => i32::from(e.frame(timestamp_ms, None)),
        Err(c) => c,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_engine_advance(e: *mut Engine, dt_seconds: f64) -> i32 {
    guard(ERR_PANIC, || match unsafe { engine(e) } {
        Ok(e) => {
            e.advance(dt_seconds);
            i32::from(e.needs_frame())
        }
        Err(c) => c,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_engine_needs_frame(e: *mut Engine) -> i32 {
    guard(ERR_PANIC, || match unsafe { engine(e) } {
        Ok(e) => i32::from(e.needs_frame()),
        Err(c) => c,
    })
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct UmxEvent {
    pub value: u64,
    pub animation: u64,
    /// 0 started, 1 completed, 2 interrupted, 3 cancelled, 4 rejected, 5 queued.
    pub kind: i32,
}

#[no_mangle]
pub unsafe extern "C" fn umx_engine_poll_event(e: *mut Engine, out: *mut UmxEvent) -> i32 {
    guard(ERR_PANIC, || {
        let e = match unsafe { engine(e) } {
            Ok(e) => e,
            Err(c) => return c,
        };
        if out.is_null() {
            set_error(ERR_NULL, "null event pointer");
            return ERR_NULL;
        }
        match e.poll_event() {
            Some(ev) => {
                let kind = match ev.kind {
                    AnimationEventKind::Started => 0,
                    AnimationEventKind::Completed => 1,
                    AnimationEventKind::Interrupted => 2,
                    AnimationEventKind::Cancelled => 3,
                    AnimationEventKind::Rejected => 4,
                    AnimationEventKind::Queued => 5,
                };
                // SAFETY: `out` is non-null and points to a writable UmxEvent.
                unsafe {
                    *out = UmxEvent {
                        value: ev.value,
                        animation: ev.animation,
                        kind,
                    }
                };
                1
            }
            None => 0,
        }
    })
}

/// Telemetry + engine stats as JSON.
#[no_mangle]
pub unsafe extern "C" fn umx_engine_telemetry_json(e: *mut Engine) -> *mut UmxString {
    guard(std::ptr::null_mut(), || match unsafe { engine(e) } {
        Ok(e) => {
            let v = serde_json::json!({
                "telemetry": e.telemetry(),
                "stats": e.stats(),
                "refreshHz": e.refresh_hz(),
                "fidelity": e.fidelity(),
                "arbiter": e.arbiter().stats(),
            });
            new_string(v.to_string())
        }
        Err(_) => std::ptr::null_mut(),
    })
}

// ------------------------------------------------------------------ values

#[no_mangle]
pub unsafe extern "C" fn umx_value_create(e: *mut Engine, initial: f64) -> u64 {
    guard(0, || match unsafe { engine(e) } {
        Ok(e) => match e.create_value(initial) {
            Ok(h) => h.0,
            Err(err) => {
                runtime_error(&err);
                0
            }
        },
        Err(_) => 0,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_value_destroy(e: *mut Engine, h: u64) -> i32 {
    guard(ERR_PANIC, || match unsafe { engine(e) } {
        Ok(e) => e
            .destroy_value(Handle(h))
            .map_or_else(|err| runtime_error(&err), |_| 0),
        Err(c) => c,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_value_get(e: *mut Engine, h: u64) -> f64 {
    guard(f64::NAN, || match unsafe { engine(e) } {
        Ok(e) => e.get(Handle(h)).unwrap_or_else(|err| {
            runtime_error(&err);
            f64::NAN
        }),
        Err(_) => f64::NAN,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_value_velocity(e: *mut Engine, h: u64) -> f64 {
    guard(f64::NAN, || match unsafe { engine(e) } {
        Ok(e) => e.velocity(Handle(h)).unwrap_or_else(|err| {
            runtime_error(&err);
            f64::NAN
        }),
        Err(_) => f64::NAN,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_value_set(e: *mut Engine, h: u64, value: f64, velocity: f64) -> i32 {
    guard(ERR_PANIC, || match unsafe { engine(e) } {
        Ok(e) => e
            .set(Handle(h), value, velocity)
            .map_or_else(|err| runtime_error(&err), |_| 0),
        Err(c) => c,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_value_set_bounds(e: *mut Engine, h: u64, min: f64, max: f64) -> i32 {
    guard(ERR_PANIC, || match unsafe { engine(e) } {
        Ok(e) => e
            .set_bounds(Handle(h), min, max)
            .map_or_else(|err| runtime_error(&err), |_| 0),
        Err(c) => c,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_value_stop(e: *mut Engine, h: u64) -> i32 {
    guard(ERR_PANIC, || match unsafe { engine(e) } {
        Ok(e) => e
            .stop(Handle(h))
            .map_or_else(|err| runtime_error(&err), |_| 0),
        Err(c) => c,
    })
}

fn animate(
    e: *mut Engine,
    h: u64,
    to: f64,
    spec: Result<AnimationSpec, String>,
    prio: i32,
    pol: i32,
) -> u64 {
    guard(0, || {
        let e = match unsafe { engine(e) } {
            Ok(e) => e,
            Err(_) => return 0,
        };
        let spec = match spec {
            Ok(s) => s,
            Err(m) => {
                set_error(ERR_INVALID_ARGUMENT, m);
                return 0;
            }
        };
        e.animate(Handle(h), to, &spec, priority(prio), policy(pol))
            .unwrap_or_else(|err| {
                runtime_error(&err);
                0
            })
    })
}

/// Spring animation. `priority`: 0 decorative … 4 gesture. `policy`: 0 replace, 1 queue,
/// 2 reject, 3 additive. Returns the animation id or 0.
#[no_mangle]
pub unsafe extern "C" fn umx_animate_spring(
    e: *mut Engine,
    h: u64,
    to: f64,
    stiffness: f64,
    damping: f64,
    mass: f64,
    prio: i32,
    pol: i32,
) -> u64 {
    let spec = SpringParams::new(stiffness, damping, mass)
        .map(AnimationSpec::spring)
        .map_err(|x| x.to_string());
    animate(e, h, to, spec, prio, pol)
}

/// Cubic-Bézier tween; `duration` in seconds.
#[no_mangle]
pub unsafe extern "C" fn umx_animate_tween(
    e: *mut Engine,
    h: u64,
    to: f64,
    duration: f64,
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    prio: i32,
    pol: i32,
) -> u64 {
    let spec = Easing::cubic(x1, y1, x2, y2)
        .map(|ez| AnimationSpec::tween(duration, ez))
        .map_err(|x| x.to_string());
    animate(e, h, to, spec, prio, pol)
}

/// Momentum decay from the value's current velocity (or `velocity` if finite).
#[no_mangle]
pub unsafe extern "C" fn umx_animate_decay(
    e: *mut Engine,
    h: u64,
    velocity: f64,
    time_constant: f64,
    prio: i32,
) -> u64 {
    guard(0, || {
        let eng = match unsafe { engine(e) } {
            Ok(x) => x,
            Err(_) => return 0,
        };
        if velocity.is_finite() {
            if let Ok(cur) = eng.get(Handle(h)) {
                let _ = eng.set(Handle(h), cur, velocity);
            }
        }
        let spec = DecayParams::new(time_constant, 0.5)
            .map(|decay| AnimationSpec::Decay { decay })
            .map_err(|x| x.to_string());
        animate(e, h, f64::NAN, spec, prio, 0)
    })
}

/// Animation from a JSON `AnimationSpec` (see docs/api/ffi.md).
#[no_mangle]
pub unsafe extern "C" fn umx_animate_json(
    e: *mut Engine,
    h: u64,
    to: f64,
    json: *const c_char,
    len: usize,
    prio: i32,
    pol: i32,
) -> u64 {
    let spec = match unsafe { str_arg(json, len) } {
        Ok(s) => serde_json::from_str::<AnimationSpec>(s).map_err(|x| x.to_string()),
        Err(_) => return 0,
    };
    animate(e, h, to, spec, prio, pol)
}

// ------------------------------------------------------------------ MDL & graphs

/// Compiles MDL; returns the compile output (plan + diagnostics) as JSON.
#[no_mangle]
pub unsafe extern "C" fn umx_compile(src: *const c_char, len: usize) -> *mut UmxString {
    guard(std::ptr::null_mut(), || {
        match unsafe { str_arg(src, len) } {
            Ok(s) => {
                new_string(serde_json::to_string(&umx_compiler::compile_str(s)).unwrap_or_default())
            }
            Err(_) => std::ptr::null_mut(),
        }
    })
}

/// Human-readable summary or Graphviz DOT (`mode` 0 / 1) of a compiled MDL document.
#[no_mangle]
pub unsafe extern "C" fn umx_inspect(src: *const c_char, len: usize, mode: i32) -> *mut UmxString {
    guard(std::ptr::null_mut(), || {
        match unsafe { str_arg(src, len) } {
            Ok(s) => match umx_compiler::compile_str(s).plan {
                Some(p) => new_string(if mode == 1 {
                    umx_compiler::inspect::to_dot(&p)
                } else {
                    umx_compiler::inspect::summary(&p)
                }),
                None => {
                    set_error(ERR_COMPILE, "document does not compile");
                    std::ptr::null_mut()
                }
            },
            Err(_) => std::ptr::null_mut(),
        }
    })
}

/// Migrates an MDL document to the current version; returns JSON `{ok, document, from}`.
#[no_mangle]
pub unsafe extern "C" fn umx_migrate(src: *const c_char, len: usize) -> *mut UmxString {
    guard(std::ptr::null_mut(), || {
        match unsafe { str_arg(src, len) } {
            Ok(s) => {
                let mut d = umx_compiler::diag::Diagnostics::default();
                let out = match serde_json::from_str::<serde_json::Value>(s) {
                    Ok(v) => match umx_compiler::migrate::migrate(v, &mut d) {
                        Some((doc, from)) => {
                            serde_json::json!({"ok": true, "document": doc, "from": from, "diagnostics": d.into_vec()})
                        }
                        None => serde_json::json!({"ok": false, "diagnostics": d.into_vec()}),
                    },
                    Err(err) => {
                        serde_json::json!({"ok": false, "diagnostics": [{"severity":"error","code":"E_PARSE","path":"$","message": err.to_string()}]})
                    }
                };
                new_string(out.to_string())
            }
            Err(_) => std::ptr::null_mut(),
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_engine_load_mdl(
    e: *mut Engine,
    src: *const c_char,
    len: usize,
) -> i32 {
    guard(ERR_PANIC, || {
        let e = match unsafe { engine(e) } {
            Ok(e) => e,
            Err(c) => return c,
        };
        let s = match unsafe { str_arg(src, len) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        match e.load_mdl(s) {
            Ok(_) => 0,
            Err(RuntimeError::Compile(d)) => {
                let msg = d
                    .iter()
                    .map(|x| format!("[{}] {}: {}", x.code, x.path, x.message))
                    .collect::<Vec<_>>()
                    .join("; ");
                set_error(ERR_COMPILE, msg);
                ERR_COMPILE
            }
            Err(err) => runtime_error(&err),
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_instance_create(
    e: *mut Engine,
    component: *const c_char,
    len: usize,
) -> u64 {
    guard(0, || {
        let (Ok(e), Ok(c)) = (unsafe { engine(e) }, unsafe { str_arg(component, len) }) else {
            return 0;
        };
        e.instantiate(c).map(|h| h.0).unwrap_or_else(|err| {
            runtime_error(&err);
            0
        })
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_instance_destroy(e: *mut Engine, h: u64) -> i32 {
    guard(ERR_PANIC, || match unsafe { engine(e) } {
        Ok(e) => e
            .destroy_instance(Handle(h))
            .map_or_else(|err| runtime_error(&err), |_| 0),
        Err(c) => c,
    })
}

/// Returns 1 if a transition started, 0 if the event was ignored/queued, < 0 on error.
#[no_mangle]
pub unsafe extern "C" fn umx_instance_send(
    e: *mut Engine,
    h: u64,
    event: *const c_char,
    len: usize,
) -> i32 {
    guard(ERR_PANIC, || {
        let e = match unsafe { engine(e) } {
            Ok(e) => e,
            Err(c) => return c,
        };
        let ev = match unsafe { str_arg(event, len) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        e.send(Handle(h), ev)
            .map_or_else(|err| runtime_error(&err), i32::from)
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_instance_get(
    e: *mut Engine,
    h: u64,
    prop: *const c_char,
    len: usize,
) -> f64 {
    guard(f64::NAN, || {
        let (Ok(e), Ok(p)) = (unsafe { engine(e) }, unsafe { str_arg(prop, len) }) else {
            return f64::NAN;
        };
        e.instance_value(Handle(h), p).unwrap_or_else(|err| {
            runtime_error(&err);
            f64::NAN
        })
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_instance_state(e: *mut Engine, h: u64) -> *mut UmxString {
    guard(std::ptr::null_mut(), || match unsafe { engine(e) } {
        Ok(e) => e
            .instance_state(Handle(h))
            .map(new_string)
            .unwrap_or_else(|err| {
                runtime_error(&err);
                std::ptr::null_mut()
            }),
        Err(_) => std::ptr::null_mut(),
    })
}

/// Starts a gesture on a graph property (direct manipulation).
#[no_mangle]
pub unsafe extern "C" fn umx_instance_gesture(
    e: *mut Engine,
    h: u64,
    prop: *const c_char,
    len: usize,
    phase: i32,
    value: f64,
    velocity: f64,
) -> i32 {
    guard(ERR_PANIC, || {
        let e = match unsafe { engine(e) } {
            Ok(e) => e,
            Err(c) => return c,
        };
        let p = match unsafe { str_arg(prop, len) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let g = match e.graph_mut(Handle(h)) {
            Ok(g) => g,
            Err(err) => return runtime_error(&err),
        };
        let r = match phase {
            0 => g.begin_gesture(p),
            1 => g.set_gesture_value(p, value, velocity),
            _ => g.end_gesture(p, velocity, None, None),
        };
        r.map_or_else(|err| runtime_error(&RuntimeError::Graph(err)), |_| 0)
    })
}

/// Plays a timeline; `bindings_json` maps `"component.property"` to value handles.
#[no_mangle]
pub unsafe extern "C" fn umx_timeline_play(
    e: *mut Engine,
    name: *const c_char,
    name_len: usize,
    bindings_json: *const c_char,
    bindings_len: usize,
) -> u64 {
    guard(0, || {
        let (Ok(e), Ok(n), Ok(b)) = (
            unsafe { engine(e) },
            unsafe { str_arg(name, name_len) },
            unsafe { str_arg(bindings_json, bindings_len) },
        ) else {
            return 0;
        };
        let map: BTreeMap<String, u64> = match serde_json::from_str(b) {
            Ok(m) => m,
            Err(err) => {
                set_error(ERR_INVALID_ARGUMENT, err.to_string());
                return 0;
            }
        };
        let bindings = map.into_iter().map(|(k, v)| (k, Handle(v))).collect();
        e.play_timeline(n, bindings)
            .map(|h| h.0)
            .unwrap_or_else(|err| {
                runtime_error(&err);
                0
            })
    })
}

// ------------------------------------------------------------------ stateless springs

#[no_mangle]
pub extern "C" fn umx_spring_position(
    k: f64,
    c: f64,
    m: f64,
    from: f64,
    to: f64,
    v0: f64,
    t: f64,
) -> f64 {
    SpringParams::new(k, c, m)
        .and_then(|p| Spring::new(p, from, to, v0))
        .map_or(f64::NAN, |s| s.sample(t).position)
}

#[no_mangle]
pub extern "C" fn umx_spring_velocity(
    k: f64,
    c: f64,
    m: f64,
    from: f64,
    to: f64,
    v0: f64,
    t: f64,
) -> f64 {
    SpringParams::new(k, c, m)
        .and_then(|p| Spring::new(p, from, to, v0))
        .map_or(f64::NAN, |s| s.sample(t).velocity)
}

#[no_mangle]
pub extern "C" fn umx_spring_finish_time(
    k: f64,
    c: f64,
    m: f64,
    from: f64,
    to: f64,
    v0: f64,
) -> f64 {
    SpringParams::new(k, c, m)
        .and_then(|p| Spring::new(p, from, to, v0))
        .map_or(f64::NAN, |s| s.finish_time())
}

// ------------------------------------------------------------------ particles

pub struct UmxParticles {
    field: ParticleField,
    buffer: Vec<f32>,
}

#[no_mangle]
pub extern "C" fn umx_particles_new(capacity: u32, seed: u64) -> *mut UmxParticles {
    guard(std::ptr::null_mut(), || {
        match ParticleField::new(capacity as usize, seed) {
            Ok(field) => Box::into_raw(Box::new(UmxParticles {
                buffer: vec![0.0; capacity as usize * 4],
                field,
            })),
            Err(e) => {
                set_error(ERR_CAPACITY, e.to_string());
                std::ptr::null_mut()
            }
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_particles_free(p: *mut UmxParticles) {
    if !p.is_null() {
        // SAFETY: produced by `umx_particles_new`.
        drop(unsafe { Box::from_raw(p) });
    }
}

unsafe fn particles<'a>(p: *mut UmxParticles) -> Option<&'a mut UmxParticles> {
    if p.is_null() {
        set_error(ERR_NULL, "null particles pointer");
        None
    } else {
        // SAFETY: produced by `umx_particles_new`.
        Some(unsafe { &mut *p })
    }
}

#[no_mangle]
pub unsafe extern "C" fn umx_particles_add_emitter(
    p: *mut UmxParticles,
    x: f64,
    y: f64,
    rate: f64,
    direction: f64,
    spread: f64,
    speed_min: f64,
    speed_max: f64,
    life_min: f64,
    life_max: f64,
    size_min: f64,
    size_max: f64,
) -> i32 {
    guard(ERR_PANIC, || {
        let Some(p) = (unsafe { particles(p) }) else {
            return ERR_NULL;
        };
        let e = Emitter {
            x,
            y,
            rate,
            direction,
            spread,
            speed_min,
            speed_max,
            life_min,
            life_max,
            size_min,
            size_max,
            active: true,
        };
        p.field.add_emitter(e).map_or_else(
            |err| {
                set_error(ERR_INVALID_ARGUMENT, err.to_string());
                ERR_INVALID_ARGUMENT
            },
            |i| i as i32,
        )
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_particles_set_emitter(
    p: *mut UmxParticles,
    index: u32,
    x: f64,
    y: f64,
    rate: f64,
    active: i32,
) -> i32 {
    guard(ERR_PANIC, || {
        let Some(p) = (unsafe { particles(p) }) else {
            return ERR_NULL;
        };
        match p.field.emitters.get_mut(index as usize) {
            Some(e) => {
                e.x = x;
                e.y = y;
                if rate.is_finite() && rate >= 0.0 {
                    e.rate = rate;
                }
                e.active = active != 0;
                0
            }
            None => {
                set_error(ERR_NOT_FOUND, "emitter index out of range");
                ERR_NOT_FOUND
            }
        }
    })
}

/// Force kinds: 0 gravity(a=x, b=y), 1 drag(a), 2 point(a=x,b=y,c=strength,d=radius),
/// 3 vortex(a=x,b=y,c=strength,d=radius), 4 turbulence(a=strength,b=scale).
#[no_mangle]
pub unsafe extern "C" fn umx_particles_add_force(
    p: *mut UmxParticles,
    kind: i32,
    a: f64,
    b: f64,
    c: f64,
    d: f64,
) -> i32 {
    guard(ERR_PANIC, || {
        let Some(p) = (unsafe { particles(p) }) else {
            return ERR_NULL;
        };
        let f = match kind {
            0 => Force::Gravity { x: a, y: b },
            1 => Force::Drag { coefficient: a },
            2 => Force::Point {
                x: a,
                y: b,
                strength: c,
                radius: d,
            },
            3 => Force::Vortex {
                x: a,
                y: b,
                strength: c,
                radius: d,
            },
            4 => Force::Turbulence {
                strength: a,
                scale: b,
            },
            _ => {
                set_error(ERR_INVALID_ARGUMENT, "unknown force kind");
                return ERR_INVALID_ARGUMENT;
            }
        };
        p.field.forces.push(f);
        (p.field.forces.len() - 1) as i32
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_particles_clear_forces(p: *mut UmxParticles) {
    if let Some(p) = unsafe { particles(p) } {
        p.field.forces.clear();
    }
}

#[no_mangle]
pub unsafe extern "C" fn umx_particles_burst(
    p: *mut UmxParticles,
    emitter: u32,
    count: u32,
) -> i32 {
    guard(ERR_PANIC, || match unsafe { particles(p) } {
        Some(p) => p.field.burst(emitter as usize, count as usize) as i32,
        None => ERR_NULL,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_particles_set_fidelity(p: *mut UmxParticles, factor: f64) {
    if let Some(p) = unsafe { particles(p) } {
        p.field.fidelity = factor.clamp(0.0, 1.0);
    }
}

/// Advances by `dt` seconds; returns the number of live particles. The render buffer
/// (`[x, y, size, alpha]` × alive, f32) is available via `umx_particles_buffer`.
#[no_mangle]
pub unsafe extern "C" fn umx_particles_step(p: *mut UmxParticles, dt: f64) -> u32 {
    guard(0, || match unsafe { particles(p) } {
        Some(p) => {
            p.field.advance(dt);
            p.field.write_render_buffer(&mut p.buffer) as u32
        }
        None => 0,
    })
}

#[no_mangle]
pub unsafe extern "C" fn umx_particles_buffer(p: *mut UmxParticles) -> *const f32 {
    match unsafe { particles(p) } {
        Some(p) => p.buffer.as_ptr(),
        None => std::ptr::null(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn umx_particles_is_idle(p: *mut UmxParticles) -> i32 {
    match unsafe { particles(p) } {
        Some(p) => i32::from(p.field.is_idle()),
        None => ERR_NULL,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn engine_lifecycle_through_abi() {
        unsafe {
            let e = umx_engine_new(0.0);
            assert!(!e.is_null());
            let v = umx_value_create(e, 0.0);
            assert_ne!(v, 0);
            assert_ne!(umx_animate_spring(e, v, 10.0, 200.0, 20.0, 1.0, 2, 0), 0);
            let mut t = 0.0;
            while umx_engine_frame(e, t) == 1 {
                t += 16.0;
            }
            assert_eq!(umx_value_get(e, v), 10.0);
            let mut ev = UmxEvent::default();
            assert_eq!(umx_engine_poll_event(e, &mut ev), 1);
            assert_eq!(ev.kind, 0);
            assert_eq!(umx_value_destroy(e, v), 0);
            assert!(umx_value_get(e, v).is_nan());
            assert_eq!(umx_last_error_code(), ERR_INVALID_HANDLE);
            umx_engine_free(e);
        }
    }

    #[test]
    fn errors_are_reported_not_panicked() {
        unsafe {
            assert_eq!(umx_engine_frame(std::ptr::null_mut(), 0.0), ERR_NULL);
            let e = umx_engine_new(0.0);
            let v = umx_value_create(e, 0.0);
            assert_eq!(umx_animate_spring(e, v, 1.0, -5.0, 1.0, 1.0, 2, 0), 0);
            assert_eq!(umx_last_error_code(), ERR_INVALID_ARGUMENT);
            let msg = CStr::from_ptr(umx_last_error_message()).to_str().unwrap();
            assert!(msg.contains("stiffness"));
            umx_engine_free(e);
        }
    }

    #[test]
    fn compile_and_instances() {
        let src = include_str!("../../../examples/mdl/app.umx.json");
        unsafe {
            let out = umx_compile(src.as_ptr().cast(), src.len());
            let json = CStr::from_ptr(umx_string_ptr(out))
                .to_str()
                .unwrap()
                .to_string();
            umx_string_free(out);
            assert!(json.contains("\"ok\":true"));
            let e = umx_engine_new(1.0 / 120.0);
            assert_eq!(umx_engine_load_mdl(e, src.as_ptr().cast(), src.len()), 0);
            let name = "toast";
            let inst = umx_instance_create(e, name.as_ptr().cast(), name.len());
            assert_ne!(inst, 0);
            let ev = "show";
            assert_eq!(umx_instance_send(e, inst, ev.as_ptr().cast(), ev.len()), 1);
            for i in 0..240 {
                umx_engine_frame(e, f64::from(i) * 8.0);
            }
            let p = "opacity";
            assert!((umx_instance_get(e, inst, p.as_ptr().cast(), p.len()) - 1.0).abs() < 1e-6);
            let bad = "{";
            assert_eq!(
                umx_engine_load_mdl(e, bad.as_ptr().cast(), bad.len()),
                ERR_COMPILE
            );
            umx_engine_free(e);
        }
    }

    #[test]
    fn particles_through_abi() {
        unsafe {
            let p = umx_particles_new(256, 1);
            assert!(
                umx_particles_add_emitter(
                    p, 0.0, 0.0, 0.0, 0.0, std::f64::consts::TAU, 10.0, 20.0, 0.2, 0.3, 1.0, 2.0
                ) >= 0
            );
            assert_eq!(umx_particles_burst(p, 0, 50), 50);
            assert_eq!(umx_particles_step(p, 0.01), 50);
            let buf = umx_particles_buffer(p);
            assert!(!buf.is_null());
            for _ in 0..60 {
                umx_particles_step(p, 1.0 / 60.0);
            }
            assert_eq!(umx_particles_is_idle(p), 1);
            umx_particles_free(p);
            assert!(umx_particles_new(10_000_000, 0).is_null());
        }
    }

    #[test]
    fn stateless_springs() {
        let x = umx_spring_position(170.0, 26.0, 1.0, 0.0, 1.0, 0.0, 0.0);
        assert_eq!(x, 0.0);
        assert!(umx_spring_finish_time(170.0, 26.0, 1.0, 0.0, 1.0, 0.0) > 0.0);
        assert!(umx_spring_position(-1.0, 26.0, 1.0, 0.0, 1.0, 0.0, 0.1).is_nan());
    }
}
