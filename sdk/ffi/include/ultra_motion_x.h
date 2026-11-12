/*
 * Ultra Motion X — C ABI (ABI revision 1)
 *
 * Link against `libultra_motion_x` (cdylib) or `libultra_motion_x.a` (staticlib) built from
 * `sdk/ffi`. All functions are thread-compatible: an engine must only be used from one
 * thread at a time. See docs/api/ffi.md for the full contract.
 *
 * Return conventions:
 *   int32_t   >= 0 success, < 0 error code (UMX_ERR_*)
 *   uint64_t  handle / animation id, 0 on error
 *   double    NaN on error
 * After an error, umx_last_error_code()/umx_last_error_message() describe it.
 */
#ifndef ULTRA_MOTION_X_H
#define ULTRA_MOTION_X_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define UMX_ABI_VERSION 1

#define UMX_ERR_INVALID_HANDLE   (-1)
#define UMX_ERR_INVALID_ARGUMENT (-2)
#define UMX_ERR_CORE             (-3)
#define UMX_ERR_GRAPH            (-4)
#define UMX_ERR_COMPILE          (-5)
#define UMX_ERR_NOT_FOUND        (-6)
#define UMX_ERR_CAPACITY         (-7)
#define UMX_ERR_NULL             (-8)
#define UMX_ERR_UTF8             (-9)
#define UMX_ERR_PANIC            (-10)

/* Priorities */
#define UMX_PRIORITY_DECORATIVE  0
#define UMX_PRIORITY_AMBIENT     1
#define UMX_PRIORITY_NORMAL      2
#define UMX_PRIORITY_INTERACTION 3
#define UMX_PRIORITY_GESTURE     4

/* Interruption policies */
#define UMX_POLICY_REPLACE  0
#define UMX_POLICY_QUEUE    1
#define UMX_POLICY_REJECT   2
#define UMX_POLICY_ADDITIVE 3

/* Event kinds */
#define UMX_EVENT_STARTED     0
#define UMX_EVENT_COMPLETED   1
#define UMX_EVENT_INTERRUPTED 2
#define UMX_EVENT_CANCELLED   3
#define UMX_EVENT_REJECTED    4
#define UMX_EVENT_QUEUED      5

/* Gesture phases for umx_instance_gesture */
#define UMX_GESTURE_BEGIN  0
#define UMX_GESTURE_UPDATE 1
#define UMX_GESTURE_END    2

typedef struct UmxEngine UmxEngine;
typedef struct UmxString UmxString;
typedef struct UmxParticles UmxParticles;

typedef struct UmxEvent {
    uint64_t value;
    uint64_t animation;
    int32_t kind;
} UmxEvent;

/* ---- library ---------------------------------------------------------------------- */
const char* umx_version(void);
uint32_t umx_abi_version(void);
int32_t umx_last_error_code(void);
const char* umx_last_error_message(void);

const char* umx_string_ptr(const UmxString* s);
size_t umx_string_len(const UmxString* s);
void umx_string_free(UmxString* s);

uint8_t* umx_alloc(size_t len);
void umx_free(uint8_t* ptr, size_t len);

/* ---- engine ----------------------------------------------------------------------- */
/* fixed_step > 0 enables deterministic fixed-step mode (seconds). */
UmxEngine* umx_engine_new(double fixed_step);
void umx_engine_free(UmxEngine* e);
int32_t umx_engine_set_reduced_motion(UmxEngine* e, int32_t on);
/* Call once per presented frame. Returns 1 if another frame is needed, 0 when idle. */
int32_t umx_engine_frame(UmxEngine* e, double timestamp_ms);
int32_t umx_engine_advance(UmxEngine* e, double dt_seconds);
int32_t umx_engine_needs_frame(UmxEngine* e);
int32_t umx_engine_poll_event(UmxEngine* e, UmxEvent* out);
UmxString* umx_engine_telemetry_json(UmxEngine* e);

/* ---- motion values ---------------------------------------------------------------- */
uint64_t umx_value_create(UmxEngine* e, double initial);
int32_t umx_value_destroy(UmxEngine* e, uint64_t value);
double umx_value_get(UmxEngine* e, uint64_t value);
double umx_value_velocity(UmxEngine* e, uint64_t value);
int32_t umx_value_set(UmxEngine* e, uint64_t value, double v, double velocity);
int32_t umx_value_set_bounds(UmxEngine* e, uint64_t value, double min, double max);
int32_t umx_value_stop(UmxEngine* e, uint64_t value);

uint64_t umx_animate_spring(UmxEngine* e, uint64_t value, double to, double stiffness, double damping,
                            double mass, int32_t priority, int32_t policy);
uint64_t umx_animate_tween(UmxEngine* e, uint64_t value, double to, double duration_s, double x1,
                           double y1, double x2, double y2, int32_t priority, int32_t policy);
uint64_t umx_animate_decay(UmxEngine* e, uint64_t value, double velocity, double time_constant_s,
                           int32_t priority);
uint64_t umx_animate_json(UmxEngine* e, uint64_t value, double to, const char* spec_json, size_t len,
                          int32_t priority, int32_t policy);

/* ---- Motion Design Language & motion graphs --------------------------------------- */
UmxString* umx_compile(const char* src, size_t len);
UmxString* umx_inspect(const char* src, size_t len, int32_t mode /* 0 summary, 1 dot */);
UmxString* umx_migrate(const char* src, size_t len);
int32_t umx_engine_load_mdl(UmxEngine* e, const char* src, size_t len);
uint64_t umx_instance_create(UmxEngine* e, const char* component, size_t len);
int32_t umx_instance_destroy(UmxEngine* e, uint64_t instance);
int32_t umx_instance_send(UmxEngine* e, uint64_t instance, const char* event, size_t len);
double umx_instance_get(UmxEngine* e, uint64_t instance, const char* prop, size_t len);
UmxString* umx_instance_state(UmxEngine* e, uint64_t instance);
int32_t umx_instance_gesture(UmxEngine* e, uint64_t instance, const char* prop, size_t len, int32_t phase,
                             double value, double velocity);
uint64_t umx_timeline_play(UmxEngine* e, const char* name, size_t name_len, const char* bindings_json,
                           size_t bindings_len);

/* ---- stateless spring math -------------------------------------------------------- */
double umx_spring_position(double k, double c, double m, double from, double to, double v0, double t);
double umx_spring_velocity(double k, double c, double m, double from, double to, double v0, double t);
double umx_spring_finish_time(double k, double c, double m, double from, double to, double v0);

/* ---- particles -------------------------------------------------------------------- */
UmxParticles* umx_particles_new(uint32_t capacity, uint64_t seed);
void umx_particles_free(UmxParticles* p);
int32_t umx_particles_add_emitter(UmxParticles* p, double x, double y, double rate, double direction,
                                  double spread, double speed_min, double speed_max, double life_min,
                                  double life_max, double size_min, double size_max);
int32_t umx_particles_set_emitter(UmxParticles* p, uint32_t index, double x, double y, double rate,
                                  int32_t active);
/* kind: 0 gravity(a=x,b=y) 1 drag(a) 2 point(a=x,b=y,c=strength,d=radius)
 *       3 vortex(a=x,b=y,c=strength,d=radius) 4 turbulence(a=strength,b=scale) */
int32_t umx_particles_add_force(UmxParticles* p, int32_t kind, double a, double b, double c, double d);
void umx_particles_clear_forces(UmxParticles* p);
int32_t umx_particles_burst(UmxParticles* p, uint32_t emitter, uint32_t count);
void umx_particles_set_fidelity(UmxParticles* p, double factor);
uint32_t umx_particles_step(UmxParticles* p, double dt_seconds);
/* [x, y, size, alpha] per live particle; valid until the next step/free. */
const float* umx_particles_buffer(UmxParticles* p);
int32_t umx_particles_is_idle(UmxParticles* p);

#ifdef __cplusplus
}
#endif

#endif /* ULTRA_MOTION_X_H */
