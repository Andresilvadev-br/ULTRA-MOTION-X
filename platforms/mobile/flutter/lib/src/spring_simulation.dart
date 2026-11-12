import 'package:flutter/physics.dart';

import 'bindings.dart';

/// A Flutter [Simulation] that evaluates the Ultra Motion X closed-form spring.
/// Position/velocity are exact for any elapsed time, so frame timing never changes the path.
class UmxSpringSimulation extends Simulation {
  UmxSpringSimulation({required this.from, required this.to, this.velocity = 0, this.stiffness = 322, this.damping = 33, this.mass = 1})
      : _finish = UmxNative.instance.springFinishTime(stiffness, damping, mass, from, to, velocity);

  /// Perceptual parameters: response (s) and damping ratio.
  factory UmxSpringSimulation.response({required double from, required double to, double velocity = 0, double response = 0.35, double dampingRatio = 0.92}) {
    final w = 2 * 3.141592653589793 / response;
    final k = w * w;
    return UmxSpringSimulation(from: from, to: to, velocity: velocity, stiffness: k, damping: 2 * dampingRatio * _sqrt(k));
  }

  final double from, to, velocity, stiffness, damping, mass;
  final double _finish;

  static double _sqrt(double x) {
    var r = x;
    for (var i = 0; i < 30; i++) {
      r = 0.5 * (r + x / r);
    }
    return r;
  }

  @override
  double x(double time) => time >= _finish ? to : UmxNative.instance.springPosition(stiffness, damping, mass, from, to, velocity, time);

  @override
  double dx(double time) => time >= _finish ? 0 : UmxNative.instance.springVelocity(stiffness, damping, mass, from, to, velocity, time);

  @override
  bool isDone(double time) => time >= _finish;
}
