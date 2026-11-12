// WPF driver: advances Ultra Motion X on CompositionTarget.Rendering (once per composed frame)
// and subscribes only while animations are running (no idle per-frame work).
#if WPF
using System;
using System.Windows;
using System.Windows.Media;

namespace UltraMotionX.Wpf
{
    public sealed class WpfMotionDriver : IDisposable
    {
        public MotionEngine Engine { get; } = new MotionEngine();
        public MotionBindings Bindings { get; }
        private bool _subscribed;
        private TimeSpan _last = TimeSpan.MinValue;

        public WpfMotionDriver()
        {
            Bindings = new MotionBindings(Engine);
            Engine.ReducedMotion = !SystemParameters.ClientAreaAnimation;
        }

        /// <summary>Ensures frames are delivered (call after starting an animation).</summary>
        public void Wake()
        {
            if (_subscribed) return;
            CompositionTarget.Rendering += OnRendering;
            _subscribed = true;
        }

        private void OnRendering(object? sender, EventArgs e)
        {
            // RenderingTime is the time of the frame being composed; skip duplicate callbacks.
            var t = ((RenderingEventArgs)e).RenderingTime;
            if (t == _last) return;
            _last = t;
            if (!Bindings.Tick(t.TotalMilliseconds))
            {
                CompositionTarget.Rendering -= OnRendering;
                _subscribed = false;
            }
        }

        /// <summary>Springs a TranslateTransform to (x, y).</summary>
        public void SpringTranslate(TranslateTransform t, double x, double y, SpringConfig? spring = null)
        {
            var vx = Bindings.Bind(t.X, v => t.X = v);
            var vy = Bindings.Bind(t.Y, v => t.Y = v);
            Engine.Spring(vx, x, spring, Priority.Interaction);
            Engine.Spring(vy, y, spring, Priority.Interaction);
            Wake();
        }

        /// <summary>Springs UIElement.Opacity.</summary>
        public ulong AnimateOpacity(UIElement el, double to, double seconds = 0.2)
        {
            var v = Bindings.Bind(el.Opacity, x => el.Opacity = Math.Max(0, Math.Min(1, x)));
            Engine.Tween(v, to, seconds);
            Wake();
            return v;
        }

        public void Dispose()
        {
            if (_subscribed) CompositionTarget.Rendering -= OnRendering;
            Bindings.Dispose();
            Engine.Dispose();
        }
    }
}
#endif
