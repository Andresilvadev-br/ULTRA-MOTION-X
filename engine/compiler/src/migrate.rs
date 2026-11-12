//! Schema migrations. Each step transforms a document from version N to N+1 and records
//! what it changed. Migrations are pure JSON → JSON functions, so they can be applied by the
//! CLI to rewrite files on disk (`umx migrate`) as well as transparently at compile time.

use crate::diag::Diagnostics;
use crate::MDL_VERSION;
use serde_json::{Map, Value};

/// Known versions, oldest first.
pub const VERSIONS: [&str; 2] = ["umx/0", "umx/1"];

/// Detects the document version. Missing `version` is an error (never guessed).
pub fn detect_version(doc: &Value) -> Option<String> {
    match doc.get("version") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) if n.as_u64() == Some(0) => Some("umx/0".into()),
        _ => None,
    }
}

/// Migrates `doc` to [`MDL_VERSION`]. Returns the migrated doc and the original version if
/// a migration happened.
pub fn migrate(doc: Value, diags: &mut Diagnostics) -> Option<(Value, Option<String>)> {
    if !doc.is_object() {
        diags.error("E_ROOT", "$", "an MDL document must be a JSON object");
        return None;
    }
    let Some(version) = detect_version(&doc) else {
        diags.error(
            "E_VERSION",
            "version",
            format!("missing `version`; expected \"{MDL_VERSION}\""),
        );
        return None;
    };
    match version.as_str() {
        v if v == MDL_VERSION => Some((doc, None)),
        "umx/0" => {
            let migrated = v0_to_v1(doc, diags);
            diags.info(
                "I_MIGRATED",
                "version",
                "document migrated from umx/0 to umx/1",
            );
            Some((migrated, Some(version)))
        }
        other => {
            diags.error(
                "E_VERSION",
                "version",
                format!(
                    "unsupported version `{other}`; supported: {}",
                    VERSIONS.join(", ")
                ),
            );
            None
        }
    }
}

/// umx/0 → umx/1:
/// * `variants` → `states`
/// * spring `tension`/`friction` → `stiffness`/`damping`
/// * durations and delays in seconds → milliseconds
pub fn v0_to_v1(mut doc: Value, diags: &mut Diagnostics) -> Value {
    if let Some(obj) = doc.as_object_mut() {
        obj.insert("version".into(), Value::String("umx/1".into()));
        if let Some(Value::Object(components)) = obj.get_mut("components") {
            for (name, comp) in components.iter_mut() {
                if let Some(c) = comp.as_object_mut() {
                    if let Some(v) = c.remove("variants") {
                        c.insert("states".into(), v);
                        diags.info(
                            "I_MIGRATE_VARIANTS",
                            format!("components.{name}"),
                            "`variants` renamed to `states`",
                        );
                    }
                }
            }
        }
        convert_specs(&mut doc);
    }
    doc
}

fn convert_specs(v: &mut Value) {
    match v {
        Value::Object(map) => {
            convert_spec_object(map);
            for (_, child) in map.iter_mut() {
                convert_specs(child);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(convert_specs),
        _ => {}
    }
}

fn convert_spec_object(map: &mut Map<String, Value>) {
    if let Some(t) = map.remove("tension") {
        map.insert("stiffness".into(), t);
    }
    if let Some(f) = map.remove("friction") {
        map.insert("damping".into(), f);
    }
    let is_spec = matches!(
        map.get("type").and_then(Value::as_str),
        Some("tween" | "keyframes" | "spring")
    );
    if is_spec {
        for key in ["duration", "delay"] {
            if let Some(Value::Number(n)) = map.get(key) {
                if let Some(s) = n.as_f64() {
                    map.insert(key.into(), serde_json::json!(s * 1000.0));
                }
            }
        }
    }
}
