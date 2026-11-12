# Ultra Motion X for Unreal Engine 5

Plugin module `UltraMotionX` exposing `UUltraMotionXSubsystem` (Blueprint-callable):
`SpringWidget(Widget, TranslationX|TranslationY|Scale|Opacity, To, Spring)` animates UMG render
transforms/opacity for menus, HUDs and transitions. It ticks only while animating and keeps
running while the game is paused. Unreal's renderer and gameplay physics are untouched.

Setup: copy `UltraMotionX/` into `Plugins/`, put `sdk/ffi/include/ultra_motion_x.h` into
`Plugins/UltraMotionX/ThirdParty/ultra_motion_x/include/` and the static library built with
`cargo build -p umx-ffi --release --target <triple>` into `ThirdParty/ultra_motion_x/lib/<Platform>/`
(`umx install --adapter unreal` copies the headers and any built library).

**Validation status:** not compiled here (Unreal Engine not available). The C ABI it uses is verified by `sdk/ffi/tests`.
