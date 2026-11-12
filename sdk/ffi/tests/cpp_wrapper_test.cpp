// Verifies the header-only C++ wrapper used by the Qt and Unreal adapters.
#include <cassert>
#include <cmath>
#include <cstdio>
#include "ultra_motion_x.hpp"

int main() {
    umx::Engine engine;
    auto v = engine.create(0.0);
    engine.spring(v, 1.0, {400.0, 30.0, 1.0}, umx::Priority::Interaction);
    double t = 0.0;
    while (engine.frame(t)) t += 1000.0 / 240.0;
    assert(std::fabs(engine.get(v) - 1.0) < 1e-9);
    bool threw = false;
    try {
        engine.spring(v, 1.0, {-1.0, 1.0, 1.0});
    } catch (const umx::Error& e) {
        threw = e.code() == UMX_ERR_INVALID_ARGUMENT;
    }
    assert(threw);
    std::string compiled = umx::compile("{\"version\":\"umx/1\"}");
    assert(compiled.find("\"ok\":true") != std::string::npos);
    std::printf("cpp_wrapper_test: ok (umx %s)\n", umx::version().c_str());
    return 0;
}
