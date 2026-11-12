// dart:ffi bindings for sdk/ffi/include/ultra_motion_x.h (ABI 1).
import 'dart:ffi';
import 'dart:io' show Platform;

typedef _SpringFnC = Double Function(Double, Double, Double, Double, Double, Double, Double);
typedef _SpringFn = double Function(double, double, double, double, double, double, double);
typedef _FinishFnC = Double Function(Double, Double, Double, Double, Double, Double);
typedef _FinishFn = double Function(double, double, double, double, double, double);

class UmxNative {
  UmxNative._(this.lib)
      : springPosition = lib.lookupFunction<_SpringFnC, _SpringFn>('umx_spring_position'),
        springVelocity = lib.lookupFunction<_SpringFnC, _SpringFn>('umx_spring_velocity'),
        springFinishTime = lib.lookupFunction<_FinishFnC, _FinishFn>('umx_spring_finish_time'),
        abiVersion = lib.lookupFunction<Uint32 Function(), int Function()>('umx_abi_version'),
        engineNew = lib.lookupFunction<Pointer<Void> Function(Double), Pointer<Void> Function(double)>('umx_engine_new'),
        engineFree = lib.lookupFunction<Void Function(Pointer<Void>), void Function(Pointer<Void>)>('umx_engine_free'),
        engineFrame = lib.lookupFunction<Int32 Function(Pointer<Void>, Double), int Function(Pointer<Void>, double)>('umx_engine_frame'),
        valueCreate = lib.lookupFunction<Uint64 Function(Pointer<Void>, Double), int Function(Pointer<Void>, double)>('umx_value_create'),
        valueGet = lib.lookupFunction<Double Function(Pointer<Void>, Uint64), double Function(Pointer<Void>, int)>('umx_value_get'),
        valueDestroy = lib.lookupFunction<Int32 Function(Pointer<Void>, Uint64), int Function(Pointer<Void>, int)>('umx_value_destroy'),
        animateSpring = lib.lookupFunction<Uint64 Function(Pointer<Void>, Uint64, Double, Double, Double, Double, Int32, Int32),
            int Function(Pointer<Void>, int, double, double, double, double, int, int)>('umx_animate_spring');

  final DynamicLibrary lib;
  final _SpringFn springPosition;
  final _SpringFn springVelocity;
  final _FinishFn springFinishTime;
  final int Function() abiVersion;
  final Pointer<Void> Function(double) engineNew;
  final void Function(Pointer<Void>) engineFree;
  final int Function(Pointer<Void>, double) engineFrame;
  final int Function(Pointer<Void>, double) valueCreate;
  final double Function(Pointer<Void>, int) valueGet;
  final int Function(Pointer<Void>, int) valueDestroy;
  final int Function(Pointer<Void>, int, double, double, double, double, int, int) animateSpring;

  static UmxNative? _instance;

  /// Loads the native library (bundled per platform; static on iOS).
  static UmxNative get instance => _instance ??= _load();

  static UmxNative _load() {
    final lib = Platform.isIOS
        ? DynamicLibrary.process()
        : Platform.isAndroid || Platform.isLinux
            ? DynamicLibrary.open('libultra_motion_x.so')
            : Platform.isMacOS
                ? DynamicLibrary.open('libultra_motion_x.dylib')
                : DynamicLibrary.open('ultra_motion_x.dll');
    final n = UmxNative._(lib);
    if (n.abiVersion() != 1) throw StateError('ultra_motion_x ABI ${n.abiVersion()} is not supported');
    return n;
  }
}
