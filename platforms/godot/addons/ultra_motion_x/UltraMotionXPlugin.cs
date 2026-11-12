#if TOOLS
using Godot;

namespace UltraMotionX.Godot
{
    [Tool]
    public partial class UltraMotionXPlugin : EditorPlugin
    {
        private const string Autoload = "UltraMotion";
        public override void _EnterTree() => AddAutoloadSingleton(Autoload, "res://addons/ultra_motion_x/UmxEngineNode.cs");
        public override void _ExitTree() => RemoveAutoloadSingleton(Autoload);
    }
}
#endif
