//! # umx-scheduler
//!
//! * [`refresh`] — refresh-rate estimation from presentation timestamps (60…360+ Hz, VRR).
//! * [`frame`] — the Smart Frame Scheduler: prioritised, de-duplicated, budget-aware tasks.
//! * [`fidelity`] — Adaptive Fidelity controller with hysteresis.
//! * [`power`] — power/visibility policy derived from *reported* platform signals only.

#![forbid(unsafe_code)]

pub mod fidelity;
pub mod frame;
pub mod power;
pub mod refresh;

pub use fidelity::{FidelityConfig, FidelityController, FidelityLevel};
pub use frame::{FrameScheduler, TaskPriority};
pub use power::{PowerPolicy, PowerSignals};
pub use refresh::RefreshEstimator;
