//! Exponential momentum decay: `v(t) = v₀·e^{−t/τ}`, `x(t) = x₀ + v₀·τ·(1 − e^{−t/τ})`.
//!
//! Position and velocity are continuous with the gesture that started the fling: the
//! initial velocity of the decay *is* the release velocity.

use crate::error::{check_finite, check_range, PhysicsError};
use crate::math;
use crate::MotionState;

#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct DecayParams {
    /// Time constant τ in seconds (time to lose ~63% of the velocity).
    pub time_constant: f64,
    /// Speed (units/s) below which the motion is considered finished.
    pub rest_speed: f64,
}

impl Default for DecayParams {
    fn default() -> Self {
        Self { time_constant: 0.325, rest_speed: 0.5 }
    }
}

impl DecayParams {
    pub fn new(time_constant: f64, rest_speed: f64) -> Result<Self, PhysicsError> {
        let p = Self { time_constant, rest_speed };
        p.validate()?;
        Ok(p)
    }

    /// Scroll-view style parametrisation: velocity is multiplied by `rate` every millisecond
    /// (e.g. 0.998 "normal", 0.99 "fast").
    pub fn from_deceleration_rate(rate: f64) -> Result<Self, PhysicsError> {
        check_range("deceleration_rate", rate, 0.5, 0.999_999)?;
        Self::new(-1.0 / (1000.0 * math::ln(rate)), DecayParams::default().rest_speed)
    }

    pub fn validate(&self) -> Result<(), PhysicsError> {
        check_range("time_constant", self.time_constant, 1e-4, 1e3)?;
        check_range("rest_speed", self.rest_speed, 1e-9, 1e9)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Decay {
    params: DecayParams,
    from: f64,
    velocity: f64,
    finish_time: f64,
}

impl Decay {
    pub fn new(params: DecayParams, from: f64, velocity: f64) -> Result<Self, PhysicsError> {
        params.validate()?;
        check_finite("from", from)?;
        check_finite("velocity", velocity)?;
        let finish_time = if velocity.abs() <= params.rest_speed {
            0.0
        } else {
            params.time_constant * math::ln(velocity.abs() / params.rest_speed)
        };
        Ok(Self { params, from, velocity, finish_time })
    }

    /// Final resting position `x₀ + v₀τ` (the limit as t → ∞).
    pub fn projected_end(&self) -> f64 {
        self.from + self.velocity * self.params.time_constant
    }

    pub fn finish_time(&self) -> f64 {
        self.finish_time
    }

    pub fn params(&self) -> &DecayParams {
        &self.params
    }

    pub fn sample(&self, t: f64) -> (MotionState, bool) {
        let t = t.max(0.0);
        let tau = self.params.time_constant;
        if t >= self.finish_time {
            let e = math::exp(-self.finish_time / tau);
            let x = self.from + self.velocity * tau * (1.0 - e);
            return (MotionState::new(x, 0.0), true);
        }
        let e = math::exp(-t / tau);
        (MotionState::new(self.from + self.velocity * tau * (1.0 - e), self.velocity * e), false)
    }

    /// Analytic time at which the trajectory reaches `x`, if it ever does.
    pub fn time_to_reach(&self, x: f64) -> Option<f64> {
        let tau = self.params.time_constant;
        let d = x - self.from;
        if self.velocity == 0.0 {
            return if d == 0.0 { Some(0.0) } else { None };
        }
        let frac = d / (self.velocity * tau);
        if !(0.0..1.0).contains(&frac) {
            return None;
        }
        Some(-tau * math::ln(1.0 - frac))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn continuity_with_release_velocity() {
        let d = Decay::new(DecayParams::default(), 10.0, 800.0).unwrap();
        let (s, done) = d.sample(0.0);
        assert!(!done);
        assert_eq!(s.position, 10.0);
        assert!((s.velocity - 800.0).abs() < 1e-12);
    }

    #[test]
    fn converges_to_projection() {
        let d = Decay::new(DecayParams::default(), 0.0, 1000.0).unwrap();
        let (end, done) = d.sample(100.0);
        assert!(done);
        assert!((end.position - d.projected_end()).abs() < DecayParams::default().rest_speed * 0.4);
    }

    #[test]
    fn reach_time_is_exact() {
        let d = Decay::new(DecayParams::default(), 0.0, 1000.0).unwrap();
        let t = d.time_to_reach(200.0).unwrap();
        assert!((d.sample(t).0.position - 200.0).abs() < 1e-9);
        assert!(d.time_to_reach(10_000.0).is_none());
    }

    #[test]
    fn deceleration_rate_mapping() {
        let p = DecayParams::from_deceleration_rate(0.998).unwrap();
        // After 1 ms the velocity must be multiplied by 0.998.
        let d = Decay::new(p, 0.0, 1000.0).unwrap();
        assert!((d.sample(0.001).0.velocity - 998.0).abs() < 1e-6);
    }
}
