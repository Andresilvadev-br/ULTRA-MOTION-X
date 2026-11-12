//! Human-readable inspection and Graphviz export of execution plans.

use crate::plan::ExecutionPlan;
use std::fmt::Write;
use umx_core::AnimationSpec;

pub fn describe_spec(spec: &AnimationSpec) -> String {
    match spec {
        AnimationSpec::Tween {
            duration,
            easing,
            delay,
        } => format!(
            "tween {:.0}ms {} delay {:.0}ms",
            duration * 1000.0,
            easing.to_css(),
            delay * 1000.0
        ),
        AnimationSpec::Spring { spring, delay } => format!(
            "spring k={:.1} c={:.2} m={:.2} ζ={:.2} delay {:.0}ms",
            spring.stiffness,
            spring.damping,
            spring.mass,
            spring.damping_ratio(),
            delay * 1000.0
        ),
        AnimationSpec::Decay { decay } => format!("decay τ={:.0}ms", decay.time_constant * 1000.0),
        AnimationSpec::Inertia { .. } => "inertia".into(),
        AnimationSpec::Keyframes {
            keyframes,
            duration,
            ..
        } => format!(
            "keyframes {:?} over {:.0}ms",
            keyframes.values,
            duration * 1000.0
        ),
        AnimationSpec::Instant => "instant".into(),
    }
}

/// Multi-line textual summary.
pub fn summary(plan: &ExecutionPlan) -> String {
    let mut s = String::new();
    let _ = writeln!(
        s,
        "plan v{} — profile `{}`{}",
        plan.plan_version,
        plan.profile,
        plan.name
            .as_ref()
            .map(|n| format!(" — {n}"))
            .unwrap_or_default()
    );
    let st = &plan.stats;
    let _ = writeln!(
        s,
        "{} components, {} states, {} transitions, {} specs ({} requested), {} no-op transitions removed, {} relations folded",
        st.components, st.states, st.transitions, st.unique_specs, st.spec_requests, st.removed_noop_transitions, st.folded_relations
    );
    for (i, spec) in plan.specs.iter().enumerate() {
        let _ = writeln!(
            s,
            "  spec#{i}: {}{}",
            describe_spec(&spec.spec),
            spec.compositor
                .as_ref()
                .map(|c| format!(" [compositor {:.0}ms]", c.duration_ms))
                .unwrap_or_default()
        );
    }
    for (name, c) in &plan.components {
        let _ = writeln!(
            s,
            "component `{name}` role={} initial={}",
            c.role.as_deref().unwrap_or("-"),
            c.initial
        );
        for t in &c.transitions {
            let _ = writeln!(
                s,
                "  {} --{}--> {} (spec#{})",
                t.from,
                t.event,
                t.to,
                t.spec.unwrap_or(c.default_spec)
            );
        }
    }
    for (name, t) in &plan.timelines {
        let _ = writeln!(
            s,
            "timeline `{name}` {:.0}ms, {} entries",
            t.duration * 1000.0,
            t.entries.len()
        );
    }
    s
}

/// Graphviz DOT representation of every component state machine.
pub fn to_dot(plan: &ExecutionPlan) -> String {
    let mut s = String::from("digraph umx {\n  rankdir=LR;\n  node [shape=box, style=rounded];\n");
    for (name, c) in &plan.components {
        let _ = writeln!(s, "  subgraph \"cluster_{name}\" {{\n    label=\"{name}\";");
        for st in c.states.keys() {
            let shape = if *st == c.initial {
                "doubleoctagon"
            } else {
                "box"
            };
            let _ = writeln!(s, "    \"{name}.{st}\" [label=\"{st}\", shape={shape}];");
        }
        for t in &c.transitions {
            let froms: Vec<&String> = if t.from == "*" {
                c.states.keys().filter(|k| **k != t.to).collect()
            } else {
                vec![&t.from]
            };
            for f in froms {
                let _ = writeln!(
                    s,
                    "    \"{name}.{f}\" -> \"{name}.{}\" [label=\"{}\"];",
                    t.to, t.event
                );
            }
        }
        s.push_str("  }\n");
    }
    s.push_str("}\n");
    s
}
