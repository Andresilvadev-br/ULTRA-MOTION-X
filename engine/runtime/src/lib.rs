//! # umx-runtime — Ultra Motion Runtime
//!
//! The runtime used by native hosts (via the C ABI), WebAssembly and Rust applications.
//!
//! * Lazy: nothing runs until a value is animated; [`Engine::needs_frame`] is `false` when
//!   idle so hosts can stop their frame loop.
//! * Safe handles: values and graph instances are addressed with generational handles —
//!   stale handles are rejected, never aliased.
//! * Pooled: slots are recycled through free lists; completed animations are dropped.
//! * Coherent: every animation request goes through the property [`Arbiter`].

#![forbid(unsafe_code)]

mod engine;
mod handle;

pub use engine::{AnimationEvent, AnimationEventKind, Engine, EngineConfig, EngineStats};
pub use handle::Handle;
pub use umx_compiler::plan::ExecutionPlan;
pub use umx_core::{AnimationSpec, Arbiter, Easing, InterruptPolicy, Priority};

/// Runtime errors with stable numeric codes (exposed through the C ABI).
#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeError {
    InvalidHandle,
    InvalidArgument(String),
    Core(umx_core::CoreError),
    Graph(umx_graph::GraphError),
    Compile(Vec<umx_graph::Diagnostic>),
    NotFound(String),
    Capacity(usize),
}

impl RuntimeError {
    pub fn code(&self) -> i32 {
        match self {
            RuntimeError::InvalidHandle => 1,
            RuntimeError::InvalidArgument(_) => 2,
            RuntimeError::Core(_) => 3,
            RuntimeError::Graph(_) => 4,
            RuntimeError::Compile(_) => 5,
            RuntimeError::NotFound(_) => 6,
            RuntimeError::Capacity(_) => 7,
        }
    }
}

impl core::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            RuntimeError::InvalidHandle => write!(f, "invalid or stale handle"),
            RuntimeError::InvalidArgument(m) => write!(f, "invalid argument: {m}"),
            RuntimeError::Core(e) => write!(f, "{e}"),
            RuntimeError::Graph(e) => write!(f, "{e}"),
            RuntimeError::Compile(d) => {
                write!(f, "compilation failed with {} diagnostics", d.len())
            }
            RuntimeError::NotFound(m) => write!(f, "not found: {m}"),
            RuntimeError::Capacity(n) => write!(f, "capacity limit reached ({n})"),
        }
    }
}

impl std::error::Error for RuntimeError {}

impl From<umx_core::CoreError> for RuntimeError {
    fn from(e: umx_core::CoreError) -> Self {
        RuntimeError::Core(e)
    }
}
impl From<umx_graph::GraphError> for RuntimeError {
    fn from(e: umx_graph::GraphError) -> Self {
        RuntimeError::Graph(e)
    }
}
