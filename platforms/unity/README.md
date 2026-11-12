# Ultra Motion X for Unity (UPM package)

Install: copy this folder into `Packages/com.ultramotionx.unity` (or `umx install --adapter unity`).
Put the native library in `Plugins/` for each target (`ultra_motion_x.dll`, `libultra_motion_x.so`,
`libultra_motion_x.dylib`; static `libultra_motion_x.a` on iOS — the bindings switch to `__Internal`).
Build them with `cargo build -p umx-ffi --release --target <triple>`.

- `UmxDriver` — singleton MonoBehaviour; ticks only while animating; unscaled time by default.
- `UmxRectAnimator` — springs RectTransform position/scale and CanvasGroup alpha.
- Sample `HUD Menu`.

Scope: menus, HUD, UI transitions and interactive UI. Unity's renderer and gameplay physics are not replaced.

**Validation status:** not compiled here (Unity Editor unavailable in CI). Bindings are shared with the .NET adapter and mirror the C header verified by `sdk/ffi/tests`.
