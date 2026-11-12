// Unity driver: one MotionEngine per scene, advanced in LateUpdate with Time.unscaledTimeAsDouble
// (UI motion should not freeze when gameplay time is paused). Uses Unity's own renderer.
using System;
using System.Collections.Generic;
using UnityEngine;

namespace UltraMotionX.Unity
{
    [DefaultExecutionOrder(1000)]
    public sealed class UmxDriver : MonoBehaviour
    {
        private static UmxDriver _instance;
        public static UmxDriver Instance
        {
            get
            {
                if (_instance == null)
                {
                    var go = new GameObject("[Ultra Motion X]");
                    DontDestroyOnLoad(go);
                    _instance = go.AddComponent<UmxDriver>();
                }
                return _instance;
            }
        }

        public MotionEngine Engine { get; private set; }
        public MotionBindings Bindings { get; private set; }
        [Tooltip("Use unscaled time so UI keeps animating while the game is paused.")]
        public bool unscaledTime = true;
        private bool _active;

        private void Awake()
        {
            if (_instance != null && _instance != this) { Destroy(gameObject); return; }
            _instance = this;
            Engine = new MotionEngine();
            Bindings = new MotionBindings(Engine);
        }

        /// <summary>Marks the driver active (call after starting animations).</summary>
        public void Wake() => _active = true;

        private void LateUpdate()
        {
            if (!_active) return; // no per-frame work while idle
            var t = (unscaledTime ? Time.unscaledTimeAsDouble : Time.timeAsDouble) * 1000.0;
            _active = Bindings.Tick(t);
        }

        private void OnDestroy()
        {
            if (_instance != this) return;
            Bindings?.Dispose();
            Engine?.Dispose();
            _instance = null;
        }
    }

    /// <summary>Spring-animates a RectTransform (position, scale) and a CanvasGroup (alpha).</summary>
    [RequireComponent(typeof(RectTransform))]
    public sealed class UmxRectAnimator : MonoBehaviour
    {
        public float stiffness = 320f, damping = 33f, mass = 1f;
        private RectTransform _rt;
        private CanvasGroup _group;
        private ulong _x, _y, _scale, _alpha;
        private readonly List<ulong> _owned = new List<ulong>();

        private void Awake()
        {
            _rt = (RectTransform)transform;
            _group = GetComponent<CanvasGroup>();
            var b = UmxDriver.Instance.Bindings;
            _x = Own(b.Bind(_rt.anchoredPosition.x, v => _rt.anchoredPosition = new Vector2((float)v, _rt.anchoredPosition.y)));
            _y = Own(b.Bind(_rt.anchoredPosition.y, v => _rt.anchoredPosition = new Vector2(_rt.anchoredPosition.x, (float)v)));
            _scale = Own(b.Bind(_rt.localScale.x, v => _rt.localScale = new Vector3((float)v, (float)v, 1f)));
            if (_group != null) _alpha = Own(b.Bind(_group.alpha, v => _group.alpha = Mathf.Clamp01((float)v)));
        }

        private ulong Own(ulong v) { _owned.Add(v); return v; }
        private SpringConfig Spring => new SpringConfig(stiffness, damping, mass);

        public void MoveTo(Vector2 p)
        {
            var e = UmxDriver.Instance.Engine;
            e.Spring(_x, p.x, Spring, Priority.Interaction);
            e.Spring(_y, p.y, Spring, Priority.Interaction);
            UmxDriver.Instance.Wake();
        }

        public void ScaleTo(float s) { UmxDriver.Instance.Engine.Spring(_scale, s, Spring); UmxDriver.Instance.Wake(); }

        public void FadeTo(float a, float seconds = 0.2f)
        {
            if (_group == null) return;
            UmxDriver.Instance.Engine.Tween(_alpha, a, seconds);
            UmxDriver.Instance.Wake();
        }

        private void OnDestroy()
        {
            if (UmxDriver.Instance == null || UmxDriver.Instance.Bindings == null) return;
            foreach (var v in _owned) UmxDriver.Instance.Bindings.Unbind(v);
        }
    }
}
