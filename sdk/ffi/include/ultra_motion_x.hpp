// Ultra Motion X — header-only C++17 RAII wrapper over the C ABI.
// Used by the Qt and Unreal adapters; usable from any C++17 host.
#pragma once

#include <cmath>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

#include "ultra_motion_x.h"

namespace umx {

class Error : public std::runtime_error {
public:
    Error(int code, const std::string& msg) : std::runtime_error(msg), code_(code) {}
    int code() const noexcept { return code_; }

private:
    int code_;
};

inline Error last_error() {
    const char* m = umx_last_error_message();
    return Error(umx_last_error_code(), m ? m : "unknown error");
}

inline std::string take(UmxString* s) {
    if (!s) throw last_error();
    std::string out(umx_string_ptr(s), umx_string_len(s));
    umx_string_free(s);
    return out;
}

enum class Priority : int32_t { Decorative = 0, Ambient = 1, Normal = 2, Interaction = 3, Gesture = 4 };
enum class Policy : int32_t { Replace = 0, Queue = 1, Reject = 2, Additive = 3 };

struct Spring {
    double stiffness = 170.0;
    double damping = 26.0;
    double mass = 1.0;
};

class Engine {
public:
    explicit Engine(double fixed_step = 0.0) : e_(umx_engine_new(fixed_step), &umx_engine_free) {
        if (!e_) throw last_error();
    }

    UmxEngine* raw() const noexcept { return e_.get(); }

    uint64_t create(double initial) {
        uint64_t h = umx_value_create(raw(), initial);
        if (!h) throw last_error();
        return h;
    }
    void destroy(uint64_t v) { check(umx_value_destroy(raw(), v)); }
    double get(uint64_t v) const { return umx_value_get(raw(), v); }
    double velocity(uint64_t v) const { return umx_value_velocity(raw(), v); }
    void set(uint64_t v, double x, double vel = 0.0) { check(umx_value_set(raw(), v, x, vel)); }

    uint64_t spring(uint64_t v, double to, Spring s = {}, Priority p = Priority::Normal, Policy pol = Policy::Replace) {
        uint64_t id = umx_animate_spring(raw(), v, to, s.stiffness, s.damping, s.mass, static_cast<int32_t>(p),
                                         static_cast<int32_t>(pol));
        if (!id) throw last_error();
        return id;
    }
    uint64_t tween(uint64_t v, double to, double seconds, double x1 = 0.2, double y1 = 0.0, double x2 = 0.0,
                   double y2 = 1.0, Priority p = Priority::Normal) {
        uint64_t id = umx_animate_tween(raw(), v, to, seconds, x1, y1, x2, y2, static_cast<int32_t>(p), 0);
        if (!id) throw last_error();
        return id;
    }

    /// Returns true if another frame is needed.
    bool frame(double timestamp_ms) { return check(umx_engine_frame(raw(), timestamp_ms)) == 1; }
    bool needs_frame() const { return umx_engine_needs_frame(raw()) == 1; }
    void set_reduced_motion(bool on) { check(umx_engine_set_reduced_motion(raw(), on ? 1 : 0)); }

    std::optional<UmxEvent> poll() {
        UmxEvent ev{};
        return umx_engine_poll_event(raw(), &ev) == 1 ? std::optional<UmxEvent>(ev) : std::nullopt;
    }

    void load_mdl(std::string_view src) { check(umx_engine_load_mdl(raw(), src.data(), src.size())); }
    uint64_t instance(std::string_view component) {
        uint64_t h = umx_instance_create(raw(), component.data(), component.size());
        if (!h) throw last_error();
        return h;
    }
    bool send(uint64_t inst, std::string_view event) {
        return check(umx_instance_send(raw(), inst, event.data(), event.size())) == 1;
    }
    double get(uint64_t inst, std::string_view prop) const {
        return umx_instance_get(raw(), inst, prop.data(), prop.size());
    }
    std::string state(uint64_t inst) const { return take(umx_instance_state(raw(), inst)); }
    std::string telemetry_json() const { return take(umx_engine_telemetry_json(raw())); }

private:
    static int32_t check(int32_t r) {
        if (r < 0) throw last_error();
        return r;
    }
    std::unique_ptr<UmxEngine, void (*)(UmxEngine*)> e_;
};

inline std::string compile(std::string_view mdl) { return take(umx_compile(mdl.data(), mdl.size())); }
inline std::string version() { return umx_version(); }

}  // namespace umx
