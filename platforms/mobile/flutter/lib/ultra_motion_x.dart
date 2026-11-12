/// Ultra Motion X for Flutter.
///
/// * [UmxSpringSimulation] — a Flutter [Simulation] backed by the native analytic spring
///   (identical numbers to every other Ultra Motion X runtime). Use it with
///   `AnimationController.animateWith`, so Flutter keeps scheduling frames (vsync, Ticker).
/// * [UmxEngine] — the native runtime (motion values, MDL motion graphs) for app-wide motion.
library ultra_motion_x;

export 'src/bindings.dart' show UmxNative;
export 'src/engine.dart';
export 'src/spring_simulation.dart';
