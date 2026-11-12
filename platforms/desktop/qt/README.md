# Ultra Motion X for Qt (Widgets / Qt Quick)

`umx_qt.hpp` (header-only) builds on the C++ wrapper `sdk/ffi/include/ultra_motion_x.hpp`:
`umx::QtAnimator::spring(object, "property", to)` animates any numeric Q_PROPERTY with Ultra
Motion X springs; a `Qt::PreciseTimer` at the primary screen's refresh rate runs only while
something animates; destroyed targets are released automatically.

Build the example: `cmake -S platforms/desktop/qt -B build && cmake --build build` (Qt 6 required).

**Validation status:** the underlying C++ wrapper is compiled and tested in CI
(`sdk/ffi/tests/cpp_wrapper_test.cpp`); the Qt classes themselves are not compiled here (Qt not installed).
