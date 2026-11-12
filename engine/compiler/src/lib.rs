//! # umx-compiler — Ultra Motion Compiler
//!
//! Compiles Motion Design Language (MDL) documents into validated, optimised, serialisable
//! [`plan::ExecutionPlan`]s.
//!
//! Pipeline: **parse → migrate → resolve references → validate → build graphs → optimise →
//! emit plan**.
//!
//! Compile-time work (this crate) is everything that only depends on the document: schema
//! migration, token resolution, reference and cycle checks, graph validation, de-duplication
//! of animation specs, removal of no-op transitions, and pre-baking compositor easings for
//! springs. Runtime decisions — fidelity level, reduced motion, actual distances travelled,
//! interruption timing — are deliberately *not* made here.

#![forbid(unsafe_code)]

pub mod diag;
pub mod inspect;
pub mod migrate;
pub mod plan;
mod resolve;

use diag::{Diagnostic, Diagnostics};
use plan::ExecutionPlan;
use serde_json::Value;

/// Current MDL version string.
pub const MDL_VERSION: &str = "umx/1";
/// Version of the execution-plan format.
pub const PLAN_VERSION: u32 = 1;
/// Maximum accepted document size (bytes) — protects hosts from accidental huge inputs.
pub const MAX_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;

/// Result of a compilation.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileOutput {
    pub ok: bool,
    pub plan: Option<ExecutionPlan>,
    pub diagnostics: Vec<Diagnostic>,
    pub migrated_from: Option<String>,
}

/// Compiles an MDL document given as JSON text.
pub fn compile_str(source: &str) -> CompileOutput {
    if source.len() > MAX_DOCUMENT_BYTES {
        let mut d = Diagnostics::default();
        d.error(
            "E_TOO_LARGE",
            "$",
            format!("document exceeds {MAX_DOCUMENT_BYTES} bytes"),
        );
        return CompileOutput {
            ok: false,
            plan: None,
            diagnostics: d.into_vec(),
            migrated_from: None,
        };
    }
    match serde_json::from_str::<Value>(source) {
        Ok(v) => compile_value(v),
        Err(e) => {
            let mut d = Diagnostics::default();
            d.error(
                "E_PARSE",
                format!("line {}:{}", e.line(), e.column()),
                e.to_string(),
            );
            CompileOutput {
                ok: false,
                plan: None,
                diagnostics: d.into_vec(),
                migrated_from: None,
            }
        }
    }
}

/// Compiles an already-parsed document.
pub fn compile_value(doc: Value) -> CompileOutput {
    let mut diags = Diagnostics::default();
    let (doc, migrated_from) = match migrate::migrate(doc, &mut diags) {
        Some(x) => x,
        None => {
            return CompileOutput {
                ok: false,
                plan: None,
                diagnostics: diags.into_vec(),
                migrated_from: None,
            }
        }
    };
    let plan = resolve::build_plan(&doc, &mut diags);
    let ok = !diags.has_errors();
    CompileOutput {
        ok,
        plan: if ok { plan } else { None },
        diagnostics: diags.into_vec(),
        migrated_from,
    }
}

/// Validates without producing a plan (same diagnostics as [`compile_str`]).
pub fn validate_str(source: &str) -> Vec<Diagnostic> {
    compile_str(source).diagnostics
}

#[cfg(test)]
mod tests;
