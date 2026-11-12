// Example: spring a pause menu (Control) in and out with Ultra Motion X in Godot 4 (.NET).
using Godot;
using UltraMotionX.Godot;

public partial class PauseMenu : Control
{
    private bool _open;

    public override void _UnhandledInput(InputEvent e)
    {
        if (!e.IsActionPressed("ui_cancel")) return;
        _open = !_open;
        var umx = GetNode<UmxEngineNode>("/root/UltraMotion");
        umx.Animate(this, position: _open ? Vector2.Zero : new Vector2(-480, 0), alpha: _open ? 1f : 0f);
    }
}
