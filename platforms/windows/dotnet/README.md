# Ultra Motion X for .NET (WPF / WinUI 3)

- `src/UltraMotionX.Native.cs` — P/Invoke over the C ABI (`sdk/ffi/include/ultra_motion_x.h`).
- `src/UltraMotionX.cs` — managed `MotionEngine`, `SpringConfig`, `MotionBindings`.
- `Wpf/WpfMotionDriver.cs` (`#if WPF`) — drives the engine from `CompositionTarget.Rendering`, subscribing only while animations run; honours *Client area animation* (reduced motion).
- `WinUI/WinUIMotionDriver.cs` (`#if WINUI`) — same for WinUI 3; honours `UISettings.AnimationsEnabled`.

Build the native library for Windows (x64): `cargo build -p umx-ffi --release --target x86_64-pc-windows-msvc`, copy `ultra_motion_x.dll` next to your app (or into `native/`).

```csharp
using UltraMotionX.Wpf;
var motion = new WpfMotionDriver();
motion.SpringTranslate((TranslateTransform)panel.RenderTransform, 0, 0, SpringConfig.FromResponse(0.35, 0.9));
```

**Validation status:** not compiled in this repository's CI (no .NET SDK / Windows runners configured). The P/Invoke signatures mirror the C header, which is verified by the C and C++ conformance programs (`sdk/ffi/tests`).
