//! # umx-physics
//!
//! Interface-oriented physics for Ultra Motion X.
//!
//! * [`spring`] — closed-form (analytic) damped harmonic oscillator. Results are a pure
//!   function of elapsed time, so a spring looks identical at 60 Hz and at 240 Hz.
//! * [`decay`] — exponential momentum decay (inertia / fling).
//! * [`inertia`] — decay with boundary hand-off to springs (rubber banding at edges).
//! * [`gesture`] — velocity tracking, rubber-band mapping, snap-point and magnetic helpers.
//! * [`integrator`] — numeric integrators plus a fixed-step accumulator for deterministic
//!   simulation of systems without closed-form solutions.
//! * [`coupled`] — chains/meshes of coupled springs solved with fixed-step RK4.
//! * [`world`] — deterministic 2D body world with constraints and collisions.
//! * [`field`] — capacity-bounded particle field (emitters, forces, lifetimes).
//!
//! All transcendental functions go through the pure-Rust `libm` crate so that results are
//! bit-reproducible across operating systems and CPU architectures for a given build
//! (see `docs/physics.md` for the precise determinism contract).

#![forbid(unsafe_code)]

pub mod coupled;
pub mod decay;
pub mod error;
pub mod field;
pub mod gesture;
pub mod inertia;
pub mod integrator;
pub mod math;
pub mod rng;
pub mod spring;
pub mod world;

pub use decay::{Decay, DecayParams};
pub use error::PhysicsError;
pub use inertia::{Inertia, InertiaParams};
pub use spring::{Spring, SpringParams, SpringState};

/// A sampled motion state: position and velocity (units per second).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MotionState {
    pub position: f64,
    pub velocity: f64,
}

impl MotionState {
    pub const fn new(position: f64, velocity: f64) -> Self {
        Self { position, velocity }
    }
}
