// Autoload node that owns the Ultra Motion X engine and advances it in _Process only while
// animations are active. Process mode Always keeps UI motion running while the tree is paused.
using Godot;

namespace UltraMotionX.Godot
{
    public partial class UmxEngineNode : Node
    {
        public MotionEngine Engine { get; private set; } = null!;
        public MotionBindings Bindings { get; private set; } = null!;
        private bool _active;

        public override void _Ready()
        {
            ProcessMode = ProcessModeEnum.Always;
            Engine = new MotionEngine();
            Bindings = new MotionBindings(Engine);
            SetProcess(false);
        }

        public void Wake()
        {
            _active = true;
            SetProcess(true);
        }

        public override void _Process(double delta)
        {
            if (!_active) return;
            _active = Bindings.Tick(Time.GetTicksUsec() / 1000.0);
            if (!_active) SetProcess(false);
        }

        public override void _ExitTree()
        {
            Bindings.Dispose();
            Engine.Dispose();
        }

        /// <summary>Springs a Control's position and scale; fades its modulate alpha.</summary>
        public void Animate(Control c, Vector2? position = null, float? scale = null, float? alpha = null, SpringConfig? spring = null)
        {
            if (position is { } p)
            {
                var x = Bindings.Bind(c.Position.X, v => c.Position = new Vector2((float)v, c.Position.Y));
                var y = Bindings.Bind(c.Position.Y, v => c.Position = new Vector2(c.Position.X, (float)v));
                Engine.Spring(x, p.X, spring, Priority.Interaction);
                Engine.Spring(y, p.Y, spring, Priority.Interaction);
            }
            if (scale is { } s)
            {
                var v = Bindings.Bind(c.Scale.X, k => c.Scale = new Vector2((float)k, (float)k));
                Engine.Spring(v, s, spring);
            }
            if (alpha is { } a)
            {
                var v = Bindings.Bind(c.Modulate.A, k => c.Modulate = new Color(c.Modulate, Mathf.Clamp((float)k, 0f, 1f)));
                Engine.Tween(v, a, 0.2);
            }
            Wake();
        }
    }
}
