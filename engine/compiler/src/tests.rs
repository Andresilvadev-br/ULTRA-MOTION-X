use super::*;
use crate::diag::Severity;
use umx_graph::GraphRuntime;

const APP: &str = include_str!("../../../examples/mdl/app.umx.json");

fn codes(out: &CompileOutput) -> Vec<String> {
    out.diagnostics.iter().map(|d| d.code.clone()).collect()
}

#[test]
fn compiles_example_app() {
    let out = compile_str(APP);
    assert!(out.ok, "{:#?}", out.diagnostics);
    let plan = out.plan.unwrap();
    assert_eq!(plan.profile, "fluid");
    assert_eq!(plan.components.len(), 3);
    assert!(
        plan.stats.unique_specs < plan.stats.spec_requests,
        "specs must be de-duplicated"
    );
    let tl = &plan.timelines["intro"];
    assert_eq!(tl.entries.len(), 3);
    assert!(
        (tl.entries[1].start - tl.entries[0].start).abs() < 1e-12,
        "`<` places with previous"
    );
    assert!((tl.entries[2].start - 0.25).abs() < 1e-12, "label+=50ms");
    // Springs started at rest get a baked compositor easing.
    assert!(plan.specs.iter().any(|s| s
        .compositor
        .as_ref()
        .is_some_and(|c| c.easing.starts_with("linear("))));
}

#[test]
fn plan_drives_graph_runtime() {
    let plan = compile_str(APP).plan.unwrap();
    let mut g = GraphRuntime::new(plan.graph_def("drawer").unwrap()).unwrap();
    g.send("toggle").unwrap();
    for _ in 0..120 {
        g.tick(1.0 / 60.0);
    }
    assert!((g.value("x").unwrap()).abs() < 0.01);
    assert!((g.value("scrim").unwrap() - 0.45).abs() < 1e-3);
}

#[test]
fn plan_roundtrips_through_json() {
    let plan = compile_str(APP).plan.unwrap();
    let json = plan.to_json();
    let back = plan::ExecutionPlan::from_json(&json).unwrap();
    assert_eq!(plan, back);
}

#[test]
fn reports_parse_and_version_errors() {
    assert!(codes(&compile_str("{")).contains(&"E_PARSE".to_string()));
    assert!(codes(&compile_str("{}")).contains(&"E_VERSION".to_string()));
    assert!(codes(&compile_str(r#"{"version":"umx/9"}"#)).contains(&"E_VERSION".to_string()));
    assert!(codes(&compile_str("[]")).contains(&"E_ROOT".to_string()));
}

#[test]
fn detects_reference_cycles() {
    let doc = r#"{"version":"umx/1","transitions":{"a":"$transitions.b","b":"$transitions.a"}}"#;
    let out = compile_str(doc);
    assert!(!out.ok);
    assert!(codes(&out).contains(&"E_REF_CYCLE".to_string()));
}

#[test]
fn validates_components() {
    let doc = r#"{
      "version":"umx/1",
      "profile":"nope",
      "components":{
        "c":{
          "properties":{"x":0},
          "states":{"a":{"x":0,"ghost":1},"b":{"x":1}},
          "transitions":[{"from":"a","to":"zzz","on":"go"}],
          "gestures":{"drag":{"property":"nope"}}
        }
      }
    }"#;
    let out = compile_str(doc);
    let c = codes(&out);
    for expected in [
        "E_PROFILE",
        "E_INITIAL_REQUIRED",
        "E_UNKNOWN_PROPERTY",
        "E_UNKNOWN_STATE",
    ] {
        assert!(
            c.contains(&expected.to_string()),
            "missing {expected} in {c:?}"
        );
    }
    assert!(out.diagnostics.iter().all(|d| !d.path.is_empty()));
}

#[test]
fn removes_noop_transitions_and_folds_relations() {
    let doc = r#"{
      "version":"umx/1",
      "components":{"c":{
        "properties":{"x":0,"k":{"initial":5},"y":0},
        "states":{"a":{"x":1},"b":{"x":1}},
        "initial":"a",
        "transitions":[{"from":"a","to":"b","on":"go"}],
        "relations":[{"source":"k","target":"y","input":[0,10],"output":[0,100]}]
      }}
    }"#;
    let out = compile_str(doc);
    assert!(out.ok, "{:#?}", out.diagnostics);
    let plan = out.plan.unwrap();
    assert_eq!(plan.stats.removed_noop_transitions, 1);
    assert_eq!(plan.stats.folded_relations, 1);
    assert_eq!(plan.components["c"].properties["y"].initial, 50.0);
}

#[test]
fn migrates_v0_documents() {
    let doc = r#"{
      "version":"umx/0",
      "components":{"btn":{
        "properties":{"scale":1},
        "variants":{"rest":{"scale":1},"pressed":{"scale":0.95}},
        "initial":"rest",
        "transition":{"type":"spring","tension":400,"friction":28},
        "transitions":[{"to":"pressed","on":"down","transition":{"type":"tween","duration":0.12,"easing":"easeOut"}}]
      }}
    }"#;
    let out = compile_str(doc);
    assert!(out.ok, "{:#?}", out.diagnostics);
    assert_eq!(out.migrated_from.as_deref(), Some("umx/0"));
    let plan = out.plan.unwrap();
    let c = &plan.components["btn"];
    match plan.spec(c.default_spec).unwrap() {
        umx_core::AnimationSpec::Spring { spring, .. } => assert_eq!(spring.stiffness, 400.0),
        other => panic!("{other:?}"),
    }
    match plan.spec(c.transitions[0].spec.unwrap()).unwrap() {
        umx_core::AnimationSpec::Tween { duration, .. } => assert!((duration - 0.12).abs() < 1e-12),
        other => panic!("{other:?}"),
    }
}

#[test]
fn warns_about_unknown_keys_and_a11y_never() {
    let out =
        compile_str(r#"{"version":"umx/1","bogus":1,"accessibility":{"reducedMotion":"never"}}"#);
    assert!(out.ok);
    let warnings: Vec<&str> = out
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Warning)
        .map(|d| d.code.as_str())
        .collect();
    assert!(warnings.contains(&"W_UNKNOWN_KEY"));
    assert!(warnings.contains(&"W_A11Y"));
}

#[test]
fn inspection_outputs() {
    let plan = compile_str(APP).plan.unwrap();
    let s = inspect::summary(&plan);
    assert!(s.contains("component `drawer`"));
    let dot = inspect::to_dot(&plan);
    assert!(dot.starts_with("digraph"));
    assert!(dot.contains("drawer.closed"));
}

#[test]
fn rejects_oversized_documents() {
    let big = format!(
        "{{\"version\":\"umx/1\",\"name\":\"{}\"}}",
        "x".repeat(MAX_DOCUMENT_BYTES)
    );
    assert!(codes(&compile_str(&big)).contains(&"E_TOO_LARGE".to_string()));
}
