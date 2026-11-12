# Ultra Motion X for Godot 4 (.NET)

Copy `addons/ultra_motion_x` into your project (or `umx install --adapter godot`), enable the plugin
(Project → Project Settings → Plugins). It registers the `UltraMotion` autoload (`UmxEngineNode`).
Place the native library where Godot can load it (project root or alongside the exported binary).

- Animates `Control` nodes (position, scale, modulate alpha) with springs/tweens; idles when nothing moves.
- Works while the tree is paused (process mode Always) — appropriate for pause menus/HUD.
- Example: `example/PauseMenu.cs`.

Requires the .NET build of Godot (C#). GDScript-only projects would need a GDExtension wrapper, which is not provided.

**Validation status:** not compiled here (Godot not available). Bindings shared with `platforms/windows/dotnet`.
