// Ultra Motion X — P/Invoke declarations for the C ABI (sdk/ffi/include/ultra_motion_x.h, ABI 1).
// Canonical copy: platforms/windows/dotnet/src. Synced into the Unity and Godot adapters by
// scripts/sync-dotnet-bindings.mjs (CI verifies the copies are identical).
using System;
using System.Runtime.InteropServices;

namespace UltraMotionX
{
    [StructLayout(LayoutKind.Sequential)]
    public struct UmxEvent
    {
        public ulong Value;
        public ulong Animation;
        public int Kind;
    }

    internal static class Native
    {
#if UNITY_IOS && !UNITY_EDITOR
        private const string Lib = "__Internal";
#else
        private const string Lib = "ultra_motion_x";
#endif
        [DllImport(Lib)] public static extern IntPtr umx_version();
        [DllImport(Lib)] public static extern uint umx_abi_version();
        [DllImport(Lib)] public static extern int umx_last_error_code();
        [DllImport(Lib)] public static extern IntPtr umx_last_error_message();
        [DllImport(Lib)] public static extern IntPtr umx_string_ptr(IntPtr s);
        [DllImport(Lib)] public static extern UIntPtr umx_string_len(IntPtr s);
        [DllImport(Lib)] public static extern void umx_string_free(IntPtr s);

        [DllImport(Lib)] public static extern IntPtr umx_engine_new(double fixedStep);
        [DllImport(Lib)] public static extern void umx_engine_free(IntPtr e);
        [DllImport(Lib)] public static extern int umx_engine_set_reduced_motion(IntPtr e, int on);
        [DllImport(Lib)] public static extern int umx_engine_frame(IntPtr e, double timestampMs);
        [DllImport(Lib)] public static extern int umx_engine_advance(IntPtr e, double dtSeconds);
        [DllImport(Lib)] public static extern int umx_engine_needs_frame(IntPtr e);
        [DllImport(Lib)] public static extern int umx_engine_poll_event(IntPtr e, out UmxEvent ev);
        [DllImport(Lib)] public static extern IntPtr umx_engine_telemetry_json(IntPtr e);

        [DllImport(Lib)] public static extern ulong umx_value_create(IntPtr e, double initial);
        [DllImport(Lib)] public static extern int umx_value_destroy(IntPtr e, ulong v);
        [DllImport(Lib)] public static extern double umx_value_get(IntPtr e, ulong v);
        [DllImport(Lib)] public static extern double umx_value_velocity(IntPtr e, ulong v);
        [DllImport(Lib)] public static extern int umx_value_set(IntPtr e, ulong v, double value, double velocity);
        [DllImport(Lib)] public static extern int umx_value_set_bounds(IntPtr e, ulong v, double min, double max);
        [DllImport(Lib)] public static extern int umx_value_stop(IntPtr e, ulong v);
        [DllImport(Lib)] public static extern ulong umx_animate_spring(IntPtr e, ulong v, double to, double k, double c, double m, int priority, int policy);
        [DllImport(Lib)] public static extern ulong umx_animate_tween(IntPtr e, ulong v, double to, double durationS, double x1, double y1, double x2, double y2, int priority, int policy);
        [DllImport(Lib)] public static extern ulong umx_animate_decay(IntPtr e, ulong v, double velocity, double timeConstantS, int priority);
        [DllImport(Lib)] public static extern ulong umx_animate_json(IntPtr e, ulong v, double to, byte[] json, UIntPtr len, int priority, int policy);

        [DllImport(Lib)] public static extern IntPtr umx_compile(byte[] src, UIntPtr len);
        [DllImport(Lib)] public static extern int umx_engine_load_mdl(IntPtr e, byte[] src, UIntPtr len);
        [DllImport(Lib)] public static extern ulong umx_instance_create(IntPtr e, byte[] component, UIntPtr len);
        [DllImport(Lib)] public static extern int umx_instance_destroy(IntPtr e, ulong instance);
        [DllImport(Lib)] public static extern int umx_instance_send(IntPtr e, ulong instance, byte[] ev, UIntPtr len);
        [DllImport(Lib)] public static extern double umx_instance_get(IntPtr e, ulong instance, byte[] prop, UIntPtr len);
        [DllImport(Lib)] public static extern int umx_instance_gesture(IntPtr e, ulong instance, byte[] prop, UIntPtr len, int phase, double value, double velocity);

        [DllImport(Lib)] public static extern double umx_spring_position(double k, double c, double m, double from, double to, double v0, double t);
        [DllImport(Lib)] public static extern double umx_spring_velocity(double k, double c, double m, double from, double to, double v0, double t);
    }
}
