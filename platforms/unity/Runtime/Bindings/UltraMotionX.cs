// Ultra Motion X — managed API over the C ABI. Shared by the WPF, WinUI, Unity and Godot adapters.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace UltraMotionX
{
    public enum Priority { Decorative = 0, Ambient = 1, Normal = 2, Interaction = 3, Gesture = 4 }
    public enum Policy { Replace = 0, Queue = 1, Reject = 2, Additive = 3 }
    public enum EventKind { Started = 0, Completed = 1, Interrupted = 2, Cancelled = 3, Rejected = 4, Queued = 5 }

    public sealed class MotionException : Exception
    {
        public int Code { get; }
        public MotionException(int code, string message) : base(message) { Code = code; }

        internal static MotionException Last()
        {
            var msg = Marshal.PtrToStringAnsi(Native.umx_last_error_message()) ?? "unknown error";
            return new MotionException(Native.umx_last_error_code(), msg);
        }
    }

    /// <summary>Spring parameters (stiffness k, damping c, mass m).</summary>
    public readonly struct SpringConfig
    {
        public readonly double Stiffness, Damping, Mass;
        public SpringConfig(double stiffness, double damping, double mass = 1.0) { Stiffness = stiffness; Damping = damping; Mass = mass; }
        public static readonly SpringConfig Snappy = new SpringConfig(504, 42.7, 1);
        public static readonly SpringConfig Standard = new SpringConfig(322, 33.0, 1);
        public static readonly SpringConfig Gentle = new SpringConfig(158, 25.1, 1);
        public static readonly SpringConfig Bouncy = new SpringConfig(247, 25.1, 1);

        /// <summary>Perceptual form: response = period (s), dampingRatio = ζ.</summary>
        public static SpringConfig FromResponse(double response, double dampingRatio)
        {
            var w = 2 * Math.PI / response;
            var k = w * w;
            return new SpringConfig(k, 2 * dampingRatio * Math.Sqrt(k), 1);
        }
    }

    /// <summary>One Ultra Motion X runtime. Use from a single thread (typically the UI thread).</summary>
    public sealed class MotionEngine : IDisposable
    {
        private IntPtr _ptr;

        public static string Version => Marshal.PtrToStringAnsi(Native.umx_version()) ?? "";

        public MotionEngine(double fixedStepSeconds = 0)
        {
            if (Native.umx_abi_version() != 1) throw new MotionException(-1, "incompatible ultra_motion_x native library (ABI)");
            _ptr = Native.umx_engine_new(fixedStepSeconds);
            if (_ptr == IntPtr.Zero) throw MotionException.Last();
        }

        private IntPtr Ptr => _ptr != IntPtr.Zero ? _ptr : throw new ObjectDisposedException(nameof(MotionEngine));
        private static int Check(int r) => r < 0 ? throw MotionException.Last() : r;
        private static ulong Check(ulong r) => r == 0 ? throw MotionException.Last() : r;
        private static byte[] Utf8(string s) => Encoding.UTF8.GetBytes(s);

        public bool ReducedMotion { set => Check(Native.umx_engine_set_reduced_motion(Ptr, value ? 1 : 0)); }

        public ulong CreateValue(double initial) => Check(Native.umx_value_create(Ptr, initial));
        public void DestroyValue(ulong v) => Check(Native.umx_value_destroy(Ptr, v));
        public double Get(ulong v) => Native.umx_value_get(Ptr, v);
        public double Velocity(ulong v) => Native.umx_value_velocity(Ptr, v);
        public void Set(ulong v, double value, double velocity = 0) => Check(Native.umx_value_set(Ptr, v, value, velocity));
        public void Stop(ulong v) => Check(Native.umx_value_stop(Ptr, v));

        public ulong Spring(ulong v, double to, SpringConfig? spring = null, Priority priority = Priority.Normal, Policy policy = Policy.Replace)
        {
            var s = spring ?? SpringConfig.Standard;
            return Check(Native.umx_animate_spring(Ptr, v, to, s.Stiffness, s.Damping, s.Mass, (int)priority, (int)policy));
        }

        public ulong Tween(ulong v, double to, double seconds, double x1 = 0.2, double y1 = 0, double x2 = 0, double y2 = 1, Priority priority = Priority.Normal)
            => Check(Native.umx_animate_tween(Ptr, v, to, seconds, x1, y1, x2, y2, (int)priority, 0));

        public ulong Decay(ulong v, double velocity, double timeConstantSeconds = 0.325)
            => Check(Native.umx_animate_decay(Ptr, v, velocity, timeConstantSeconds, (int)Priority.Interaction));

        /// <summary>Call once per presented frame. Returns true while another frame is needed.</summary>
        public bool Frame(double timestampMs) => Check(Native.umx_engine_frame(Ptr, timestampMs)) == 1;
        public bool Advance(double dtSeconds) => Check(Native.umx_engine_advance(Ptr, dtSeconds)) == 1;
        public bool NeedsFrame => Native.umx_engine_needs_frame(Ptr) == 1;

        public IEnumerable<UmxEvent> DrainEvents()
        {
            while (Native.umx_engine_poll_event(Ptr, out var ev) == 1) yield return ev;
        }

        public void LoadMdl(string json) { var b = Utf8(json); Check(Native.umx_engine_load_mdl(Ptr, b, (UIntPtr)b.Length)); }
        public ulong Instance(string component) { var b = Utf8(component); return Check(Native.umx_instance_create(Ptr, b, (UIntPtr)b.Length)); }
        public bool Send(ulong instance, string ev) { var b = Utf8(ev); return Check(Native.umx_instance_send(Ptr, instance, b, (UIntPtr)b.Length)) == 1; }
        public double Get(ulong instance, string prop) { var b = Utf8(prop); return Native.umx_instance_get(Ptr, instance, b, (UIntPtr)b.Length); }

        public string TelemetryJson() => TakeString(Native.umx_engine_telemetry_json(Ptr));

        public static string Compile(string mdl) { var b = Utf8(mdl); return TakeString(Native.umx_compile(b, (UIntPtr)b.Length)); }

        internal static string TakeString(IntPtr s)
        {
            if (s == IntPtr.Zero) throw MotionException.Last();
            try
            {
                var len = (int)Native.umx_string_len(s);
                var bytes = new byte[len];
                Marshal.Copy(Native.umx_string_ptr(s), bytes, 0, len);
                return Encoding.UTF8.GetString(bytes);
            }
            finally { Native.umx_string_free(s); }
        }

        public void Dispose()
        {
            if (_ptr != IntPtr.Zero) { Native.umx_engine_free(_ptr); _ptr = IntPtr.Zero; }
            GC.SuppressFinalize(this);
        }

        ~MotionEngine() { if (_ptr != IntPtr.Zero) Native.umx_engine_free(_ptr); }
    }

    /// <summary>
    /// Binds engine values to setters and drives the engine from a host frame callback.
    /// Platform drivers (WPF, WinUI, Unity, Godot) call <see cref="Tick"/> once per frame.
    /// </summary>
    public sealed class MotionBindings : IDisposable
    {
        private readonly MotionEngine _engine;
        private readonly Dictionary<ulong, Action<double>> _setters = new Dictionary<ulong, Action<double>>();
        public MotionBindings(MotionEngine engine) { _engine = engine; }

        public ulong Bind(double initial, Action<double> setter)
        {
            var v = _engine.CreateValue(initial);
            _setters[v] = setter;
            setter(initial);
            return v;
        }

        public void Unbind(ulong v) { _setters.Remove(v); _engine.DestroyValue(v); }

        /// <summary>Advances to <paramref name="timestampMs"/> and pushes values. Returns true while animating.</summary>
        public bool Tick(double timestampMs)
        {
            var more = _engine.Frame(timestampMs);
            foreach (var kv in _setters) kv.Value(_engine.Get(kv.Key));
            return more;
        }

        public void Dispose() { foreach (var v in new List<ulong>(_setters.Keys)) Unbind(v); }
    }
}
