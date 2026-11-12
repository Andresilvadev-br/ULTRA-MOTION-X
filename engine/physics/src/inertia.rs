//! Inertia with boundaries: a fling decays freely until it crosses a boundary, then hands
//! off — with the exact crossing position *and* velocity — to a spring that pulls it back to
//! the boundary (rubber banding). Optionally the resting point is snapped to the nearest
//! snap point of the projected end position. The piecewise solution is analytic, hence
//! frame-rate independent.

use crate::decay::{Decay, DecayParams};
use crate::error::{check_finite, PhysicsError};
use crate::gesture::select_snap_point;
use crate::spring::{Spring, SpringParams};
use crate::MotionState;

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct InertiaParams {
    pub decay: DecayParams,
    /// Spring used when bouncing off a boundary or settling on a snap point.
    pub bounce_spring: SpringParams,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Snap points; when non-empty the motion settles on the point closest to the projection.
    pub snap_points: Vec<f64>,
}

impl Default for InertiaParams {
    fn default() -> Self {
        Self {
            decay: DecayParams::default(),
            bounce_spring: SpringParams { stiffness: 500.0, damping: 40.0, ..SpringParams::default() },
            min: None,
            max: None,
            snap_points: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Phase {
    /// Pure spring (started out of bounds or snapping).
    Spring(Spring),
    /// Decay, then a spring starting at `switch_time`.
    DecayThenSpring { decay: Decay, switch_time: f64, spring: Spring },
    /// Decay only (never hits a bound).
    Decay(Decay),
}

/// Piecewise analytic inertia animation.
#[derive(Debug, Clone, PartialEq)]
pub struct Inertia {
    phase: Phase,
    target: f64,
}

impl Inertia {
    pub fn new(params: &InertiaParams, from: f64, velocity: f64) -> Result<Self, PhysicsError> {
        check_finite("from", from)?;
        check_finite("velocity", velocity)?;
        let (min, max) = (params.min.unwrap_or(f64::NEG_INFINITY), params.max.unwrap_or(f64::INFINITY));
        // Out of bounds at release: spring straight back (keeping the release velocity).
        if from < min || from > max {
            let bound = if from < min { min } else { max };
            let spring = Spring::new(params.bounce_spring, from, bound, velocity)?;
            return Ok(Self { phase: Phase::Spring(spring), target: bound });
        }
        let decay = Decay::new(params.decay, from, velocity)?;
        if !params.snap_points.is_empty() {
            let projected = decay.projected_end().max(min).min(max);
            let snap = select_snap_point(projected, &params.snap_points).unwrap_or(projected).max(min).min(max);
            // Snapping: a single spring towards the snap point carries the fling momentum.
            let spring = Spring::new(params.bounce_spring, from, snap, velocity)?;
            return Ok(Self { phase: Phase::Spring(spring), target: snap });
        }
        let end = decay.projected_end();
        let bound = if end > max {
            Some(max)
        } else if end < min {
            Some(min)
        } else {
            None
        };
        match bound.and_then(|b| decay.time_to_reach(b).map(|t| (b, t))) {
            Some((b, t)) => {
                let (state, _) = decay.sample(t);
                let spring = Spring::new(params.bounce_spring, b, b, state.velocity)?;
                Ok(Self { phase: Phase::DecayThenSpring { decay, switch_time: t, spring }, target: b })
            }
            None => Ok(Self { phase: Phase::Decay(decay), target: end }),
        }
    }

    /// Where the motion will come to rest.
    pub fn target(&self) -> f64 {
        self.target
    }

    pub fn finish_time(&self) -> f64 {
        match &self.phase {
            Phase::Spring(s) => s.finish_time(),
            Phase::DecayThenSpring { switch_time, spring, .. } => switch_time + spring.finish_time(),
            Phase::Decay(d) => d.finish_time(),
        }
    }

    pub fn sample(&self, t: f64) -> (MotionState, bool) {
        match &self.phase {
            Phase::Spring(s) => {
                let st = s.sample(t);
                (MotionState::new(st.position, st.velocity), st.done)
            }
            Phase::Decay(d) => d.sample(t),
            Phase::DecayThenSpring { decay, switch_time, spring } => {
                if t < *switch_time {
                    let (s, _) = decay.sample(t);
                    (s, false)
                } else {
                    let st = spring.sample(t - switch_time);
                    (MotionState::new(st.position, st.velocity), st.done)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_decay_without_bounds() {
        let i = Inertia::new(&InertiaParams::default(), 0.0, 500.0).unwrap();
        let (s, done) = i.sample(i.finish_time() + 1.0);
        assert!(done);
        assert!((s.position - i.target()).abs() < 1.0);
    }

    #[test]
    fn bounces_off_max_with_continuity() {
        let p = InertiaParams { max: Some(100.0), ..InertiaParams::default() };
        let i = Inertia::new(&p, 0.0, 2000.0).unwrap();
        assert_eq!(i.target(), 100.0);
        // Find switch and check continuity across it.
        if let Phase::DecayThenSpring { switch_time, .. } = &i.phase {
            let a = i.sample(switch_time - 1e-7).0;
            let b = i.sample(switch_time + 1e-7).0;
            assert!((a.position - b.position).abs() < 1e-3);
            assert!((a.velocity - b.velocity).abs() < 1e-1);
        } else {
            panic!("expected decay-then-spring");
        }
        let (end, done) = i.sample(i.finish_time() + 0.01);
        assert!(done);
        assert_eq!(end.position, 100.0);
    }

    #[test]
    fn released_out_of_bounds_springs_back() {
        let p = InertiaParams { min: Some(0.0), max: Some(100.0), ..InertiaParams::default() };
        let i = Inertia::new(&p, -40.0, -100.0).unwrap();
        assert_eq!(i.target(), 0.0);
        assert!(i.sample(i.finish_time() + 0.1).1);
    }

    #[test]
    fn snaps_to_projected_point() {
        let p = InertiaParams { snap_points: vec![0.0, 300.0, 600.0], ..InertiaParams::default() };
        // projection = 50 + 900*0.325 ≈ 342 → snap 300
        let i = Inertia::new(&p, 50.0, 900.0).unwrap();
        assert_eq!(i.target(), 300.0);
        let (s0, _) = i.sample(0.0);
        assert!((s0.velocity - 900.0).abs() < 1e-9);
    }
}
