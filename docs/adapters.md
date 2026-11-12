# Platform adapters

| Platform | Package / folder | Mechanism | Validation status |
|---|---|---|---|
| Web (any framework) | `@ultra-motion-x/web` | TS runtime, rAF + WAAPI compositor path | Tested (Node + Chromium) |
| React | `@ultra-motion-x/react` | hooks over the web SDK | Type-checked (built in CI); no dedicated hook tests yet |
| Vue 3 | `@ultra-motion-x/vue` | directives + composables | Type-checked |
| Svelte | `@ultra-motion-x/svelte` | actions | Type-checked |
| Angular | `@ultra-motion-x/angular` | standalone directives | Source provided; not compiled here (Angular toolchain absent) |
| Electron | `@ultra-motion-x/electron` + web SDK | display bridge (real refresh rate, monitor changes), throttling policy | Unit-tested with structural fakes; not run inside Electron here |
| Tauri | web SDK in the webview; `umx-runtime` crate in Rust backend | — | Documented |
| React Native | `@ultra-motion-x/react-native` | core physics → `Animated.Value.setValue` / setter, RN rAF driver | `SpringValue` tested in Node; not run inside RN here |
| Flutter | `platforms/mobile/flutter` | Dart FFI over the C ABI + `Simulation` | Not compiled (Dart SDK absent) |
| WPF / WinUI 3 | `platforms/windows/dotnet` | P/Invoke + `CompositionTarget.Rendering` | Not compiled (.NET SDK absent) |
| Qt | `platforms/desktop/qt` | header-only C++ (`ultra_motion_x.hpp`) + QObject driver | C++ wrapper compiled & tested; Qt classes not compiled (Qt absent) |
| Unity | `platforms/unity` | C# P/Invoke + MonoBehaviour driver | Not compiled (Unity absent) |
| Godot 4 (.NET) | `platforms/godot/addons/ultra_motion_x` | C# node driver | Not compiled (Godot absent) |
| Unreal Engine 5 | `platforms/unreal/UltraMotionX` | C++ plugin module over the C ABI | Not compiled (UE absent) |

All native adapters share the same Rust core through `sdk/ffi/include/ultra_motion_x.h` (ABI 1),
whose C and C++ conformance programs run in CI. Build the native library with
`cargo build -p umx-ffi --release` for the target OS/architecture.

Game engines: use Ultra Motion X for menus, HUD, UI transitions and interactive UI elements.
Do not replace the engine's own renderer or gameplay physics.

## Usage snippets

```tsx
// React
const ref = useRef<HTMLButtonElement>(null);
usePress(ref);
const x = useSpring(open ? 0 : -320);           // MotionValue
```

```vue
<!-- Vue: app.use(UltraMotion) -->
<button v-umx-press>Save</button>
<ul v-umx-layout><li v-for="i in items" :key="i.id">{{ i.name }}</li></ul>
```

```svelte
<button use:press>Save</button>
<div use:drag={{ axis: "x", bounds: "parent" }} />
```

```csharp
// WPF
var motion = new UltraMotionX.Wpf.WpfMotionDriver();
motion.SpringTranslate((TranslateTransform)panel.RenderTransform, 0, 0, SpringConfig.FromResponse(0.35, 0.9));
```

```cpp
// Qt
umx::QtAnimator animator;
animator.spring(item, "x", 0.0);
```

```dart
// Flutter
controller.animateWith(UmxSpringSimulation.response(from: 0, to: 1, velocity: v));
```
