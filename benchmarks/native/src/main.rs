//! Native benchmark harness. Prints JSON (environment + results) to stdout.
//!
//! `cargo run --release -p umx-bench [-- --quick]`
//!
//! Every scenario reports wall-clock nanoseconds measured with `std::time::Instant` on the
//! machine running it; nothing is extrapolated. Results depend on hardware and load, so
//! compare runs from the same machine (see `benchmarks/compare.mjs`).

use std::hint::black_box;
use std::time::Instant;
use umx_core::{AnimationSpec, InterruptPolicy, Priority};
use umx_physics::field::{Emitter, Force, ParticleField};
use umx_physics::{Spring, SpringParams};
use umx_render::{Composer, Layer, LayerTree, Rect};
use umx_runtime::Engine;
use umx_telemetry::Distribution;

fn measure(iterations: usize, mut f: impl FnMut()) -> Distribution {
    // Warm-up.
    for _ in 0..(iterations / 10).max(1) {
        f();
    }
    let mut samples = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let t = Instant::now();
        f();
        samples.push(t.elapsed().as_nanos() as f64);
    }
    Distribution::from_values(&samples)
}

fn cpu_model() -> String {
    std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("model name"))
                .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
        })
        .unwrap_or_else(|| "unknown".into())
}

fn main() {
    let quick = std::env::args().any(|a| a == "--quick");
    let iters = if quick { 50 } else { 300 };
    let mut results = serde_json::Map::new();

    let spring = Spring::new(SpringParams::default(), 0.0, 1.0, 0.0).unwrap();
    let d = measure(iters, || {
        let mut acc = 0.0;
        for i in 0..10_000 {
            acc += spring.sample(i as f64 * 1e-4).position;
        }
        black_box(acc);
    });
    results.insert(
        "spring_sample_10k".into(),
        serde_json::json!({"unit": "ns per 10k samples", "dist": d}),
    );

    for n in [100usize, 1_000, 10_000] {
        let mut e = Engine::default();
        let spec = AnimationSpec::spring(SpringParams::new(300.0, 30.0, 1.0).unwrap());
        let handles: Vec<_> = (0..n).map(|i| e.create_value(i as f64).unwrap()).collect();
        let mut flip = false;
        let d = measure(iters, || {
            flip = !flip;
            for (i, h) in handles.iter().enumerate() {
                if i % 4 == 0 {
                    let _ = e.animate(
                        *h,
                        if flip { 500.0 } else { 0.0 },
                        &spec,
                        Priority::Normal,
                        InterruptPolicy::Replace,
                    );
                }
            }
            e.advance(1.0 / 120.0);
            e.drain_events();
        });
        results.insert(
            format!("engine_frame_{n}_values"),
            serde_json::json!({"unit": "ns per frame (25% retargeted each frame)", "dist": d}),
        );
    }

    let mdl = include_str!("../../../examples/mdl/app.umx.json");
    let d = measure(iters, || {
        black_box(umx_compiler::compile_str(mdl));
    });
    results.insert(
        "compile_example_app".into(),
        serde_json::json!({"unit": "ns per compilation", "dist": d}),
    );

    let mut e = Engine::default();
    e.load_mdl(mdl).unwrap();
    let insts: Vec<_> = (0..500).map(|_| e.instantiate("drawer").unwrap()).collect();
    let d = measure(iters, || {
        for i in &insts {
            let _ = e.send(*i, "toggle");
        }
        e.advance(1.0 / 120.0);
    });
    results.insert(
        "graph_500_instances_toggle_and_tick".into(),
        serde_json::json!({"unit": "ns per frame", "dist": d}),
    );

    let mut field = ParticleField::new(20_000, 1).unwrap();
    field.forces.push(Force::Gravity { x: 0.0, y: 300.0 });
    field.forces.push(Force::Turbulence {
        strength: 80.0,
        scale: 60.0,
    });
    field
        .add_emitter(Emitter {
            rate: 8000.0,
            life_min: 2.0,
            life_max: 3.0,
            ..Emitter::default()
        })
        .unwrap();
    for _ in 0..240 {
        field.advance(1.0 / 60.0);
    }
    let alive = field.alive();
    let d = measure(iters, || {
        field.step_fixed();
    });
    results.insert(
        "particles_step".into(),
        serde_json::json!({"unit": "ns per fixed step", "alive": alive, "dist": d}),
    );

    let mut tree = LayerTree::new();
    let root = tree
        .insert(
            Layer::new("root", Rect::new(0.0, 0.0, 1920.0, 1080.0)),
            None,
        )
        .unwrap();
    let layers: Vec<_> = (0..2000)
        .map(|i| {
            tree.insert(
                Layer::new(
                    "l",
                    Rect::new((i % 40) as f64 * 48.0, (i / 40) as f64 * 20.0, 40.0, 16.0),
                ),
                Some(root),
            )
            .unwrap()
        })
        .collect();
    let composer = Composer::new(Rect::new(0.0, 0.0, 1920.0, 1080.0));
    composer.compose(&mut tree);
    let mut k = 0usize;
    let d = measure(iters, || {
        k += 1;
        for l in layers.iter().skip(k % 10).step_by(10) {
            if let Some(layer) = tree.get_mut(*l) {
                layer.transform.y = (k % 7) as f64;
            }
        }
        black_box(composer.compose(&mut tree));
    });
    results.insert(
        "compose_2000_layers_10pct_dirty".into(),
        serde_json::json!({"unit": "ns per composition", "dist": d}),
    );

    let report = serde_json::json!({
        "kind": "umx-native-bench",
        "version": env!("CARGO_PKG_VERSION"),
        "environment": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "cpu": cpu_model(),
            "threads": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
            "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
            "quick": quick,
            "iterations": iters,
        },
        "results": results,
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&report).unwrap_or_default()
    );
}
