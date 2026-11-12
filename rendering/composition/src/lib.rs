//! # umx-render — composition intermediate representation
//!
//! This crate is the boundary between *motion* (values computed by the runtime) and
//! *presentation* (pixels drawn by a platform). It does not draw anything itself: it
//! maintains a layer tree with 2.5D transforms, computes world matrices and opacity,
//! tracks damaged regions for partial updates, scales effects to the current fidelity level
//! and emits a [`compose::DrawList`] that adapters (DOM, WPF, Unity UI, Godot Control,
//! Qt Quick, …) present with their native compositor.

#![forbid(unsafe_code)]

pub mod cache;
pub mod compose;
pub mod effects;
pub mod layer;
pub mod math;

pub use cache::ResourceCache;
pub use compose::{Composer, DrawCommand, DrawList};
pub use effects::Effect;
pub use layer::{Layer, LayerId, LayerTree, TransformProps};
pub use math::{Mat4, Rect};
