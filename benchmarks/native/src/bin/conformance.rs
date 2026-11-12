//! Generates cross-implementation conformance vectors from the Rust reference
//! implementation. The TypeScript SDK test-suite (`sdk/typescript/test/conformance.test.ts`)
//! asserts its own results match within tolerance.
//!
//! `cargo run -p umx-bench --bin conformance > tests/conformance/vectors.json`

use umx_core::easing::Easing;
use umx_physics::{Decay, DecayParams, Inertia, InertiaParams, Spring, SpringParams};

fn main() {
    let times = [0.0, 0.016, 0.05, 0.1, 0.2, 0.35, 0.5, 0.8, 1.2, 2.0];
    let mut springs = Vec::new();
    for (k, c, m, from, to, v0) in [
        (170.0, 26.0, 1.0, 0.0, 1.0, 0.0),
        (300.0, 10.0, 1.0, 0.0, 100.0, 0.0),
        (100.0, 20.0, 1.0, 50.0, -50.0, 300.0),
        (100.0, 60.0, 2.0, 0.0, 1.0, -5.0),
        (1000.0, 30.0, 0.5, -10.0, 10.0, 0.0),
    ] {
        let p = SpringParams::new(k, c, m).unwrap();
        let s = Spring::new(p, from, to, v0).unwrap();
        let samples: Vec<_> = times
            .iter()
            .map(|&t| {
                let st = s.sample(t);
                serde_json::json!([t, st.position, st.velocity, st.done])
            })
            .collect();
        springs.push(serde_json::json!({"stiffness": k, "damping": c, "mass": m, "from": from, "to": to, "v0": v0, "finishTime": s.finish_time(), "samples": samples}));
    }
    let mut easings = Vec::new();
    for name in [
        "ease",
        "easeIn",
        "easeOut",
        "easeInOut",
        "standard",
        "backOut",
        "emphasized",
    ] {
        let e = Easing::named(name).unwrap();
        let samples: Vec<_> = (0..=20)
            .map(|i| {
                let p = i as f64 / 20.0;
                serde_json::json!([p, e.apply(p), e.derivative(p)])
            })
            .collect();
        easings.push(serde_json::json!({"name": name, "samples": samples}));
    }
    let d = Decay::new(DecayParams::default(), 10.0, 1200.0).unwrap();
    let decay: Vec<_> = times
        .iter()
        .map(|&t| {
            let (s, done) = d.sample(t);
            serde_json::json!([t, s.position, s.velocity, done])
        })
        .collect();
    let ip = InertiaParams {
        max: Some(200.0),
        ..InertiaParams::default()
    };
    let inertia = Inertia::new(&ip, 0.0, 2500.0).unwrap();
    let inertia_samples: Vec<_> = times
        .iter()
        .map(|&t| {
            let (s, done) = inertia.sample(t);
            serde_json::json!([t, s.position, s.velocity, done])
        })
        .collect();
    let out = serde_json::json!({
        "generator": "umx-bench/conformance",
        "version": env!("CARGO_PKG_VERSION"),
        "springs": springs,
        "easings": easings,
        "decay": {"timeConstant": 0.325, "restSpeed": 0.5, "from": 10.0, "velocity": 1200.0, "samples": decay},
        "inertia": {"max": 200.0, "from": 0.0, "velocity": 2500.0, "bounce": {"stiffness": 500.0, "damping": 40.0}, "target": inertia.target(), "samples": inertia_samples},
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
