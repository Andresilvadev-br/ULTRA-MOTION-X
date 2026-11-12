//! # umx-core
//!
//! Time-based motion primitives shared by every Ultra Motion X runtime:
//!
//! * [`easing`] — cubic Bézier, steps, piecewise-linear and named curves (with derivatives).
//! * [`color`] — sRGB ⇄ OKLab conversion for perceptually uniform colour interpolation.
//! * [`generator`] — tween / spring / decay / inertia / keyframe generators. Every generator
//!   is a pure function of elapsed time: `sample(t) → (value, velocity, done)`.
//! * [`timeline`] — sequences, parallel tracks, labels, stagger and offsets.
//! * [`playback`] — play / pause / seek / reverse / rate / loop controller.
//! * [`arbitration`] — temporal coherence: exactly one owner per animated property with
//!   explicit priority and interruption policies.
//! * [`tokens`] — Universal Motion DNA profiles loaded from `presets/profiles.json`.

#![forbid(unsafe_code)]

pub mod arbitration;
pub mod color;
pub mod easing;
pub mod error;
pub mod generator;
pub mod keyframes;
pub mod playback;
pub mod timeline;
pub mod tokens;

pub use arbitration::{Arbiter, Grant, InterruptPolicy, Priority, PropertyKey};
pub use easing::Easing;
pub use error::CoreError;
pub use generator::{AnimationSpec, Generator, Sample};
pub use playback::{Playback, PlaybackState};
pub use timeline::{Position, Timeline};
pub use tokens::{MotionProfile, ProfileName, Profiles};

/// Library version, kept in sync with the workspace version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
