//! # umx-graph — Universal Motion Graph
//!
//! A motion graph describes *what* a component looks like in each state and *how* it moves
//! between states. The runtime is incremental: when an event arrives or a state definition
//! changes during execution, only properties whose goal actually changed are retargeted —
//! every other in-flight animation continues untouched, with position and velocity intact.
//!
//! Concepts:
//! * **properties** — animatable scalars with an initial value and optional constraints;
//! * **states** — named sets of property goals;
//! * **transitions** — `(from | "*", event) → to`, with an animation spec, optional
//!   per-property specs, a guard condition and an interruption behaviour;
//! * **relations** — dependencies `target = map(source)` evaluated in topological order
//!   (cycles are rejected at validation);
//! * **gestures** — a property can be temporarily owned by direct manipulation; on release
//!   the graph resumes with the gesture's velocity.

#![forbid(unsafe_code)]

mod def;
mod runtime;

pub use def::{Diagnostic, GraphDef, Interrupt, PropertyDef, Relation, Severity, TransitionDef};
pub use runtime::{GraphEvent, GraphRuntime};

/// Errors reported by graph operations.
#[derive(Debug, Clone, PartialEq)]
pub enum GraphError {
    Invalid(Vec<Diagnostic>),
    UnknownState(String),
    UnknownProperty(String),
    Core(umx_core::CoreError),
}

impl core::fmt::Display for GraphError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            GraphError::Invalid(d) => {
                write!(f, "invalid motion graph:")?;
                for x in d {
                    write!(f, " [{}] {}: {};", x.code, x.path, x.message)?;
                }
                Ok(())
            }
            GraphError::UnknownState(s) => write!(f, "unknown state `{s}`"),
            GraphError::UnknownProperty(p) => write!(f, "unknown property `{p}`"),
            GraphError::Core(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for GraphError {}

impl From<umx_core::CoreError> for GraphError {
    fn from(e: umx_core::CoreError) -> Self {
        GraphError::Core(e)
    }
}
