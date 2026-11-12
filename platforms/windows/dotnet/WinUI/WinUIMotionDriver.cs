// WinUI 3 driver: Microsoft.UI.Xaml.Media.CompositionTarget.Rendering, subscribed only while animating.
#if WINUI
using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace UltraMotionX.WinUI
{
    public sealed class WinUIMotionDriver : IDisposable
    {
        public MotionEngine Engine { get; } = new MotionEngine();
        public MotionBindings Bindings { get; }
        private bool _subscribed;

        public WinUIMotionDriver()
        {
            Bindings = new MotionBindings(Engine);
            Engine.ReducedMotion = !new Windows.UI.ViewManagement.UISettings().AnimationsEnabled;
        }

        public void Wake()
        {
            if (_subscribed) return;
            CompositionTarget.Rendering += OnRendering;
            _subscribed = true;
        }

        private void OnRendering(object? sender, object e)
        {
            var t = e is RenderingEventArgs r ? r.RenderingTime.TotalMilliseconds : Environment.TickCount64;
            if (!Bindings.Tick(t))
            {
                CompositionTarget.Rendering -= OnRendering;
                _subscribed = false;
            }
        }

        public void SpringTranslate(UIElement el, double x, double y, SpringConfig? spring = null)
        {
            var vx = Bindings.Bind(el.Translation.X, v => el.Translation = new System.Numerics.Vector3((float)v, el.Translation.Y, el.Translation.Z));
            var vy = Bindings.Bind(el.Translation.Y, v => el.Translation = new System.Numerics.Vector3(el.Translation.X, (float)v, el.Translation.Z));
            Engine.Spring(vx, x, spring, Priority.Interaction);
            Engine.Spring(vy, y, spring, Priority.Interaction);
            Wake();
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
