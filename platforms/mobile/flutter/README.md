# Ultra Motion X for Flutter

- `UmxSpringSimulation` — a `Simulation` for `AnimationController.animateWith` that evaluates the native analytic spring.
- `UmxEngine` — the native runtime (motion values with momentum-preserving retargeting) ticked by a Flutter `Ticker`, idle when nothing moves.

```dart
controller.animateWith(UmxSpringSimulation.response(from: 0, to: 1, velocity: dragVelocity));
```

Native library: build `cargo build -p umx-ffi --release --target <triple>` (Android: `aarch64-linux-android` etc., iOS static `aarch64-apple-ios`) and bundle it per platform (jniLibs / Frameworks).

**Validation status:** not compiled here (Flutter/Dart SDK not available). Function signatures mirror `sdk/ffi/include/ultra_motion_x.h`, which is verified by the C/C++ conformance programs.
