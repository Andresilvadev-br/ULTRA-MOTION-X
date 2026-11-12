import 'dart:ffi';

import 'package:flutter/scheduler.dart';

import 'bindings.dart';

/// The native Ultra Motion X runtime driven by Flutter's [Ticker] (vsync-aligned), active only
/// while animations run. Values are read with [get] (e.g. in an AnimatedBuilder).
class UmxEngine {
  UmxEngine(TickerProvider vsync) : _n = UmxNative.instance {
    _ptr = _n.engineNew(0);
    _ticker = vsync.createTicker(_onTick);
  }

  final UmxNative _n;
  late final Pointer<Void> _ptr;
  late final Ticker _ticker;
  final _listeners = <void Function()>[];

  int createValue(double initial) => _n.valueCreate(_ptr, initial);
  double get(int value) => _n.valueGet(_ptr, value);
  void destroyValue(int value) => _n.valueDestroy(_ptr, value);

  /// Springs [value] to [to]; retargeting keeps the current velocity.
  void spring(int value, double to, {double stiffness = 322, double damping = 33, double mass = 1}) {
    _n.animateSpring(_ptr, value, to, stiffness, damping, mass, 3, 0);
    if (!_ticker.isActive) _ticker.start();
  }

  void addListener(void Function() l) => _listeners.add(l);
  void removeListener(void Function() l) => _listeners.remove(l);

  void _onTick(Duration elapsed) {
    final more = _n.engineFrame(_ptr, elapsed.inMicroseconds / 1000.0) == 1;
    for (final l in List.of(_listeners)) {
      l();
    }
    if (!more) _ticker.stop();
  }

  void dispose() {
    _ticker.dispose();
    _n.engineFree(_ptr);
  }
}
