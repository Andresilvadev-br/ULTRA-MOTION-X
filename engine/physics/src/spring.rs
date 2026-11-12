//! Closed-form damped harmonic oscillator.
//!
//! The equation of motion is `m·x'' + c·x' + k·(x − target) = 0`. Its exact solution is
//! evaluated directly for any elapsed time `t`, so:
//!
//! * the trajectory is identical regardless of display refresh rate or frame jitter;
//! * the state at any instant can be queried in O(1) (scrubbing, time travel, retargeting);
//! * there is no integration error and no numerical instability for stiff springs.
//!
//! Under-damped, critically damped and over-damped regimes are handled separately.

use crate::error::{check_finite, check_range, PhysicsError};
use crate::math;

/// Damping ratios within this distance of 1 are treated as critically damped to avoid the
/// catastrophic cancellation of `ω_d → 0`.
const CRITICAL_EPSILON: f64 = 1e-6;

/// Physical description of a spring plus the rest criteria used to decide completion.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct SpringParams {
    /// Spring constant `k` (> 0).
    pub stiffness: f64,
    /// Viscous damping coefficient `c` (≥ 0).
    pub damping: f64,
    /// Mass `m` (> 0).
    pub mass: f64,
    /// Distance from the target under which the spring may come to rest.
    pub rest_delta: f64,
    /// Speed (units/s) under which the spring may come to rest.
    pub rest_speed: f64,
    /// When `true`, the spring finishes the first time it reaches the target (no overshoot).
    pub clamp_overshoot: bool,
    /// Optional cap on the number of target crossings (oscillation limit). `0` = unlimited.
    pub max_oscillations: u32,
}

impl Default for SpringParams {
    fn default() -> Self {
        Self {
            stiffness: 170.0,
            damping: 26.0,
            mass: 1.0,
            rest_delta: 0.001,
            rest_speed: 0.01,
            clamp_overshoot: false,
            max_oscillations: 0,
        }
    }
}

impl SpringParams {
    /// Creates validated parameters from physical constants.
    pub fn new(stiffness: f64, damping: f64, mass: f64) -> Result<Self, PhysicsError> {
        let p = Self { stiffness, damping, mass, ..Self::default() };
        p.validate()?;
        Ok(p)
    }

    /// Perceptual parametrisation: `response` is the undamped period in seconds and
    /// `damping_ratio` is ζ (1 = critical, < 1 bouncy, > 1 sluggish).
    pub fn from_response(response: f64, damping_ratio: f64) -> Result<Self, PhysicsError> {
        check_range("response", response, 1e-4, 1e4)?;
        check_range("damping_ratio", damping_ratio, 0.0, 1e3)?;
        let mass = 1.0;
        let omega = 2.0 * core::f64::consts::PI / response;
        let stiffness = omega * omega * mass;
        let damping = 2.0 * damping_ratio * math::sqrt(stiffness * mass);
        Self::new(stiffness, damping, mass)
    }

    /// Designer parametrisation: `duration` (s) is the perceived duration and `bounce`
    /// in `[-1, 1]` controls overshoot (0 = critically damped, > 0 bouncy, < 0 overdamped).
    pub fn from_duration_bounce(duration: f64, bounce: f64) -> Result<Self, PhysicsError> {
        check_range("bounce", bounce, -1.0, 1.0)?;
        let ratio = if bounce >= 0.0 { 1.0 - bounce } else { 1.0 / (1.0 + bounce).max(1e-3) };
        Self::from_response(duration, ratio)
    }

    /// Checks every field for finiteness and admissible ranges.
    pub fn validate(&self) -> Result<(), PhysicsError> {
        check_range("stiffness", self.stiffness, 1e-6, 1e9)?;
        check_range("damping", self.damping, 0.0, 1e9)?;
        check_range("mass", self.mass, 1e-6, 1e9)?;
        check_range("rest_delta", self.rest_delta, 0.0, 1e9)?;
        check_range("rest_speed", self.rest_speed, 0.0, 1e9)?;
        Ok(())
    }

    /// Undamped angular frequency ω₀ = √(k/m) in rad/s.
    pub fn natural_frequency(&self) -> f64 {
        math::sqrt(self.stiffness / self.mass)
    }

    /// Damping ratio ζ = c / (2√(km)).
    pub fn damping_ratio(&self) -> f64 {
        self.damping / (2.0 * math::sqrt(self.stiffness * self.mass))
    }

    /// Regime classification.
    pub fn regime(&self) -> Regime {
        let z = self.damping_ratio();
        if (z - 1.0).abs() < CRITICAL_EPSILON {
            Regime::Critical
        } else if z < 1.0 {
            Regime::Underdamped
        } else {
            Regime::Overdamped
        }
    }
}

/// Damping regime of a spring.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Regime {
    Underdamped,
    Critical,
    Overdamped,
}

/// Internal closed-form coefficients.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Solution {
    /// x(t) = e^{-αt}(A cos ωd t + B sin ωd t)
    Under { alpha: f64, wd: f64, a: f64, b: f64 },
    /// x(t) = e^{-ω t}(A + B t)
    Critical { w: f64, a: f64, b: f64 },
    /// x(t) = C1 e^{r1 t} + C2 e^{r2 t}
    Over { r1: f64, r2: f64, c1: f64, c2: f64 },
}

/// A spring animation from `from` to `to` with an initial velocity.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Spring {
    params: SpringParams,
    from: f64,
    to: f64,
    initial_velocity: f64,
    solution: Solution,
    /// Time at which the animation is considered finished (may be `f64::INFINITY`).
    finish_time: f64,
}

/// Result of sampling a spring at a time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpringState {
    pub position: f64,
    pub velocity: f64,
    pub done: bool,
}

impl Spring {
    /// Builds a spring. `initial_velocity` is in units per second.
    pub fn new(params: SpringParams, from: f64, to: f64, initial_velocity: f64) -> Result<Self, PhysicsError> {
        params.validate()?;
        check_finite("from", from)?;
        check_finite("to", to)?;
        check_finite("initial_velocity", initial_velocity)?;
        let x0 = from - to;
        let v0 = initial_velocity;
        let w0 = params.natural_frequency();
        let zeta = params.damping_ratio();
        let solution = match params.regime() {
            Regime::Underdamped => {
                let alpha = zeta * w0;
                let wd = w0 * math::sqrt(1.0 - zeta * zeta);
                Solution::Under { alpha, wd, a: x0, b: (v0 + alpha * x0) / wd }
            }
            Regime::Critical => Solution::Critical { w: w0, a: x0, b: v0 + w0 * x0 },
            Regime::Overdamped => {
                let s = math::sqrt(zeta * zeta - 1.0);
                let r1 = -w0 * (zeta - s);
                let r2 = -w0 * (zeta + s);
                let c1 = (v0 - r2 * x0) / (r1 - r2);
                Solution::Over { r1, r2, c1, c2: x0 - c1 }
            }
        };
        let mut spring = Self { params, from, to, initial_velocity, solution, finish_time: f64::INFINITY };
        spring.finish_time = spring.compute_finish_time();
        Ok(spring)
    }

    pub fn params(&self) -> &SpringParams {
        &self.params
    }
    pub fn from(&self) -> f64 {
        self.from
    }
    pub fn to(&self) -> f64 {
        self.to
    }
    pub fn initial_velocity(&self) -> f64 {
        self.initial_velocity
    }

    /// Time (s) after which the spring is at rest. `INFINITY` for undamped springs without
    /// an oscillation cap.
    pub fn finish_time(&self) -> f64 {
        self.finish_time
    }

    /// Raw displacement/velocity relative to the target, without completion logic.
    pub fn displacement(&self, t: f64) -> (f64, f64) {
        match self.solution {
            Solution::Under { alpha, wd, a, b } => {
                let e = math::exp(-alpha * t);
                let (s, c) = (math::sin(wd * t), math::cos(wd * t));
                let x = e * (a * c + b * s);
                let v = e * ((b * wd - alpha * a) * c - (a * wd + alpha * b) * s);
                (x, v)
            }
            Solution::Critical { w, a, b } => {
                let e = math::exp(-w * t);
                let x = e * (a + b * t);
                let v = e * (b - w * (a + b * t));
                (x, v)
            }
            Solution::Over { r1, r2, c1, c2 } => {
                let (e1, e2) = (math::exp(r1 * t), math::exp(r2 * t));
                (c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2)
            }
        }
    }

    /// Samples the spring at elapsed time `t` (seconds, clamped to ≥ 0).
    pub fn sample(&self, t: f64) -> SpringState {
        let t = if t.is_finite() { t.max(0.0) } else { f64::INFINITY };
        if t >= self.finish_time {
            return SpringState { position: self.to, velocity: 0.0, done: true };
        }
        let (x, v) = self.displacement(t);
        SpringState { position: self.to + x, velocity: v, done: false }
    }

    /// Returns a new spring heading to `new_target` that starts exactly at this spring's state
    /// at time `t` — position *and* velocity are preserved (momentum-preserving retarget).
    pub fn retarget(&self, t: f64, new_target: f64) -> Result<Spring, PhysicsError> {
        let s = self.sample(t);
        Spring::new(self.params, s.position, new_target, s.velocity)
    }

    /// Same as [`retarget`](Self::retarget) but also swaps the physical parameters.
    pub fn retarget_with(&self, t: f64, new_target: f64, params: SpringParams) -> Result<Spring, PhysicsError> {
        let s = self.sample(t);
        Spring::new(params, s.position, new_target, s.velocity)
    }

    /// Times (s) at which the trajectory crosses the target, in increasing order, up to `limit`.
    pub fn crossing_times(&self, limit: usize) -> Vec<f64> {
        let mut out = Vec::new();
        match self.solution {
            Solution::Under { wd, a, b, .. } => {
                if a == 0.0 && b == 0.0 {
                    return out;
                }
                // A cos + B sin = R cos(wd t − φ), zeros at wd t = φ + π/2 + nπ.
                let phi = math::atan2(b, a);
                let pi = core::f64::consts::PI;
                let mut n = libm::floor((-phi - pi / 2.0) / pi);
                while out.len() < limit {
                    let t = (phi + pi / 2.0 + n * pi) / wd;
                    if t > 1e-12 {
                        out.push(t);
                    }
                    n += 1.0;
                    if n > 1e7 {
                        break;
                    }
                }
            }
            Solution::Critical { a, b, .. } => {
                if b != 0.0 {
                    let t = -a / b;
                    if t > 1e-12 && limit > 0 {
                        out.push(t);
                    }
                }
            }
            Solution::Over { r1, r2, c1, c2 } => {
                if c1 != 0.0 {
                    let ratio = -c2 / c1;
                    if ratio > 0.0 {
                        let t = math::ln(ratio) / (r1 - r2);
                        if t > 1e-12 && limit > 0 {
                            out.push(t);
                        }
                    }
                }
            }
        }
        out
    }

    fn compute_finish_time(&self) -> f64 {
        let p = &self.params;
        if self.from == self.to && self.initial_velocity == 0.0 {
            return 0.0;
        }
        if p.clamp_overshoot {
            if let Some(&t) = self.crossing_times(1).first() {
                return t;
            }
        }
        if p.max_oscillations > 0 {
            let crossings = self.crossing_times(p.max_oscillations as usize);
            if crossings.len() == p.max_oscillations as usize {
                let cap = crossings[crossings.len() - 1];
                return cap.min(self.envelope_rest_time());
            }
        }
        self.envelope_rest_time()
    }

    /// Conservative rest time: the earliest time after which the *envelope* of both
    /// displacement and velocity stays under the rest thresholds. Unlike instantaneous
    /// checks, this cannot stop a spring at a zero crossing while it is still moving fast.
    fn envelope_rest_time(&self) -> f64 {
        let p = &self.params;
        let delta = p.rest_delta.max(1e-12);
        let speed = p.rest_speed.max(1e-12);
        match self.solution {
            Solution::Under { alpha, wd, a, b } => {
                if alpha <= 0.0 {
                    return f64::INFINITY;
                }
                let r = math::hypot(a, b);
                let w0 = math::hypot(wd, alpha);
                let tx = if r > delta { math::ln(r / delta) / alpha } else { 0.0 };
                let tv = if r * w0 > speed { math::ln(r * w0 / speed) / alpha } else { 0.0 };
                tx.max(tv)
            }
            Solution::Over { r1, r2, c1, c2 } => {
                let bx = c1.abs() + c2.abs();
                let bv = (c1 * r1).abs() + (c2 * r2).abs();
                // r1 is the slow root (closest to zero, negative).
                let tx = if bx > delta { math::ln(bx / delta) / -r1 } else { 0.0 };
                let tv = if bv > speed { math::ln(bv / speed) / -r1 } else { 0.0 };
                tx.max(tv)
            }
            Solution::Critical { w, a, b } => {
                // Bounds: |x| ≤ (|a| + |b| t) e^{-wt}, |v| ≤ (|b| + w|a| + w|b| t) e^{-wt}.
                let fx = |t: f64| (a.abs() + b.abs() * t) * math::exp(-w * t) - delta;
                let fv = |t: f64| (b.abs() + w * a.abs() + w * b.abs() * t) * math::exp(-w * t) - speed;
                let f = |t: f64| fx(t).max(fv(t));
                // Both bounds are decreasing after t ≥ 1/w; search from there.
                let lo0 = 0.0;
                if f(lo0) <= 0.0 && f(1.0 / w) <= 0.0 {
                    return 0.0;
                }
                let mut lo = 1.0 / w;
                let mut hi = lo.max(1e-3);
                let mut guard = 0;
                while f(hi) > 0.0 && guard < 200 {
                    lo = hi;
                    hi *= 2.0;
                    guard += 1;
                }
                for _ in 0..80 {
                    let mid = 0.5 * (lo + hi);
                    if f(mid) > 0.0 {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
                hi
            }
        }
    }

    /// Generates `count + 1` evenly spaced samples over `[0, finish_time]`, normalised to
    /// progress (0 = from, 1 = to). Used to bake springs into CSS `linear()` easings.
    pub fn bake_progress(&self, count: usize) -> Vec<f64> {
        let span = self.to - self.from;
        let end = if self.finish_time.is_finite() { self.finish_time } else { 10.0 };
        let n = count.max(1);
        (0..=n)
            .map(|i| {
                let t = end * i as f64 / n as f64;
                let p = self.sample(t).position;
                if span == 0.0 {
                    1.0
                } else {
                    (p - self.from) / span
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn numeric(params: SpringParams, from: f64, to: f64, v0: f64, t_end: f64) -> (f64, f64) {
        // RK4 with a tiny step as ground truth.
        let (k, c, m) = (params.stiffness, params.damping, params.mass);
        let acc = |x: f64, v: f64| (-k * (x - to) - c * v) / m;
        let (mut x, mut v) = (from, v0);
        let dt = 1e-5;
        let steps = (t_end / dt).round() as usize;
        for _ in 0..steps {
            let (k1x, k1v) = (v, acc(x, v));
            let (k2x, k2v) = (v + 0.5 * dt * k1v, acc(x + 0.5 * dt * k1x, v + 0.5 * dt * k1v));
            let (k3x, k3v) = (v + 0.5 * dt * k2v, acc(x + 0.5 * dt * k2x, v + 0.5 * dt * k2v));
            let (k4x, k4v) = (v + dt * k3v, acc(x + dt * k3x, v + dt * k3v));
            x += dt / 6.0 * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
            v += dt / 6.0 * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
        }
        (x, v)
    }

    #[test]
    fn analytic_matches_numeric_in_all_regimes() {
        for (k, c) in [(170.0, 10.0), (100.0, 20.0), (100.0, 40.0), (300.0, 5.0)] {
            let p = SpringParams::new(k, c, 1.0).unwrap();
            let s = Spring::new(p, 0.0, 100.0, 250.0).unwrap();
            for t in [0.05, 0.13, 0.4, 0.9] {
                let (x, v) = numeric(p, 0.0, 100.0, 250.0, t);
                let st = s.displacement(t);
                assert!((st.0 + 100.0 - x).abs() < 1e-6, "k={k} c={c} t={t}");
                assert!((st.1 - v).abs() < 1e-5, "k={k} c={c} t={t}");
            }
        }
    }

    #[test]
    fn initial_conditions_hold() {
        for c in [5.0, 20.0, 60.0] {
            let p = SpringParams::new(100.0, c, 1.0).unwrap();
            let s = Spring::new(p, 10.0, 50.0, -30.0).unwrap();
            let st = s.sample(0.0);
            assert!((st.position - 10.0).abs() < 1e-12);
            assert!((st.velocity + 30.0).abs() < 1e-9);
        }
    }

    #[test]
    fn frame_rate_independence() {
        let p = SpringParams::new(220.0, 18.0, 1.0).unwrap();
        let s = Spring::new(p, 0.0, 1.0, 0.0).unwrap();
        // Accumulating time with different frame intervals yields the same state at t = 0.5 s.
        let mut t60 = 0.0;
        for _ in 0..30 {
            t60 += 1.0 / 60.0;
        }
        let mut t240 = 0.0;
        for _ in 0..120 {
            t240 += 1.0 / 240.0;
        }
        let a = s.sample(t60);
        let b = s.sample(t240);
        assert!((a.position - b.position).abs() < 1e-9);
    }

    #[test]
    fn settles_and_reports_done() {
        let p = SpringParams::default();
        let s = Spring::new(p, 0.0, 100.0, 0.0).unwrap();
        let ft = s.finish_time();
        assert!(ft.is_finite() && ft > 0.1 && ft < 5.0, "finish={ft}");
        let end = s.sample(ft + 0.001);
        assert!(end.done);
        assert_eq!(end.position, 100.0);
        // Before rest it must not be done; just before finish it is within thresholds.
        assert!(!s.sample(ft * 0.5).done);
        let near = s.sample(ft - 1e-6);
        assert!((near.position - 100.0).abs() <= p.rest_delta * 1.0001);
    }

    #[test]
    fn retarget_preserves_position_and_velocity() {
        let p = SpringParams::new(200.0, 12.0, 1.0).unwrap();
        let s = Spring::new(p, 0.0, 100.0, 0.0).unwrap();
        let t = 0.12;
        let before = s.sample(t);
        let r = s.retarget(t, -50.0).unwrap();
        let after = r.sample(0.0);
        assert!((before.position - after.position).abs() < 1e-12);
        assert!((before.velocity - after.velocity).abs() < 1e-9);
        assert_eq!(r.to(), -50.0);
    }

    #[test]
    fn clamp_overshoot_stops_at_target() {
        let p = SpringParams { clamp_overshoot: true, ..SpringParams::new(300.0, 5.0, 1.0).unwrap() };
        let s = Spring::new(p, 0.0, 10.0, 0.0).unwrap();
        let mut t = 0.0;
        while t < 2.0 {
            assert!(s.sample(t).position <= 10.0 + 1e-9);
            t += 1.0 / 240.0;
        }
        assert!(s.finish_time() < 0.2);
    }

    #[test]
    fn oscillation_cap() {
        let mut p = SpringParams::new(400.0, 2.0, 1.0).unwrap();
        let unlimited = Spring::new(p, 0.0, 1.0, 0.0).unwrap().finish_time();
        p.max_oscillations = 3;
        let capped = Spring::new(p, 0.0, 1.0, 0.0).unwrap();
        assert!(capped.finish_time() < unlimited);
        assert_eq!(capped.crossing_times(3).len(), 3);
    }

    #[test]
    fn crossings_are_zeros() {
        let p = SpringParams::new(300.0, 6.0, 1.0).unwrap();
        let s = Spring::new(p, 0.0, 5.0, 40.0).unwrap();
        for t in s.crossing_times(5) {
            assert!(s.displacement(t).0.abs() < 1e-9, "t={t}");
        }
        let over = Spring::new(SpringParams::new(100.0, 60.0, 1.0).unwrap(), 0.0, 5.0, 400.0).unwrap();
        for t in over.crossing_times(1) {
            assert!(over.displacement(t).0.abs() < 1e-9);
        }
    }

    #[test]
    fn invalid_parameters_are_rejected() {
        assert!(SpringParams::new(f64::NAN, 1.0, 1.0).is_err());
        assert!(SpringParams::new(-1.0, 1.0, 1.0).is_err());
        assert!(SpringParams::new(1.0, -1.0, 1.0).is_err());
        assert!(SpringParams::new(1.0, 1.0, 0.0).is_err());
        assert!(Spring::new(SpringParams::default(), f64::INFINITY, 0.0, 0.0).is_err());
    }

    #[test]
    fn perceptual_constructors() {
        let p = SpringParams::from_response(0.5, 1.0).unwrap();
        assert!((p.damping_ratio() - 1.0).abs() < 1e-9);
        assert_eq!(p.regime(), Regime::Critical);
        let b = SpringParams::from_duration_bounce(0.4, 0.3).unwrap();
        assert!((b.damping_ratio() - 0.7).abs() < 1e-9);
        let o = SpringParams::from_duration_bounce(0.4, -0.5).unwrap();
        assert!(o.damping_ratio() > 1.0);
    }

    #[test]
    fn undamped_never_finishes_without_cap() {
        let p = SpringParams::new(100.0, 0.0, 1.0).unwrap();
        let s = Spring::new(p, 0.0, 1.0, 0.0).unwrap();
        assert!(s.finish_time().is_infinite());
    }

    #[test]
    fn bake_progress_ends_at_one() {
        let s = Spring::new(SpringParams::default(), 10.0, 20.0, 0.0).unwrap();
        let samples = s.bake_progress(32);
        assert_eq!(samples.len(), 33);
        assert!((samples[0]).abs() < 1e-12);
        assert!((samples[32] - 1.0).abs() < 1e-12);
    }
}
