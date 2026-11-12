//! Numeric integrators and a fixed-step accumulator.
//!
//! Systems with closed-form solutions (single springs, decay) are sampled analytically.
//! Everything else (coupled springs, worlds, particles) advances with a *fixed* time step:
//! variable frame intervals are fed into [`FixedStepper`], which runs an integer number of
//! identical steps and reports the interpolation factor for presentation. The simulated
//! trajectory therefore only depends on the step size, never on the display refresh rate.

/// A state with position and velocity in N dimensions.
pub trait State: Clone {
    fn axpy(&self, a: f64, other: &Self) -> Self;
}

impl State for f64 {
    fn axpy(&self, a: f64, other: &Self) -> Self {
        self + a * other
    }
}

impl State for Vec<f64> {
    fn axpy(&self, a: f64, other: &Self) -> Self {
        self.iter().zip(other).map(|(x, y)| x + a * y).collect()
    }
}

/// Classic 4th-order Runge–Kutta step for `y' = f(t, y)`.
pub fn rk4<S: State>(t: f64, y: &S, dt: f64, f: impl Fn(f64, &S) -> S) -> S {
    let k1 = f(t, y);
    let k2 = f(t + 0.5 * dt, &y.axpy(0.5 * dt, &k1));
    let k3 = f(t + 0.5 * dt, &y.axpy(0.5 * dt, &k2));
    let k4 = f(t + dt, &y.axpy(dt, &k3));
    let sum = k1.axpy(2.0, &k2).axpy(2.0, &k3).axpy(1.0, &k4);
    y.axpy(dt / 6.0, &sum)
}

/// Semi-implicit (symplectic) Euler: velocity first, then position. Cheap and stable for
/// oscillators at UI step sizes.
#[inline]
pub fn semi_implicit_euler(x: f64, v: f64, a: f64, dt: f64) -> (f64, f64) {
    let v1 = v + a * dt;
    (x + v1 * dt, v1)
}

/// Fixed-step accumulator.
#[derive(Debug, Clone)]
pub struct FixedStepper {
    step: f64,
    accumulator: f64,
    max_steps: u32,
    /// Total number of fixed steps executed so far (simulation tick counter).
    pub ticks: u64,
}

impl FixedStepper {
    /// `step` in seconds (e.g. 1/240). `max_steps` caps the work per frame to avoid a
    /// "spiral of death" after long stalls; excess time is dropped and reported.
    pub fn new(step: f64, max_steps: u32) -> Self {
        let step = if step.is_finite() && step > 0.0 {
            step
        } else {
            1.0 / 240.0
        };
        Self {
            step,
            accumulator: 0.0,
            max_steps: max_steps.max(1),
            ticks: 0,
        }
    }

    pub fn step(&self) -> f64 {
        self.step
    }

    /// Feeds `dt` seconds. Returns `(steps_to_run, dropped_time)`.
    pub fn advance(&mut self, dt: f64) -> (u32, f64) {
        if !dt.is_finite() || dt <= 0.0 {
            return (0, 0.0);
        }
        self.accumulator += dt;
        let mut n = 0;
        while self.accumulator >= self.step && n < self.max_steps {
            self.accumulator -= self.step;
            n += 1;
        }
        let mut dropped = 0.0;
        if n == self.max_steps && self.accumulator >= self.step {
            dropped = self.accumulator - self.accumulator % self.step;
            self.accumulator %= self.step;
        }
        self.ticks += u64::from(n);
        (n, dropped)
    }

    /// Interpolation factor in `[0, 1)` between the previous and current simulated states.
    pub fn alpha(&self) -> f64 {
        self.accumulator / self.step
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rk4_exponential() {
        let mut y = 1.0;
        let dt = 0.01;
        for i in 0..100 {
            y = rk4(i as f64 * dt, &y, dt, |_, y| -y);
        }
        assert!((y - (-1.0f64).exp()).abs() < 1e-9);
    }

    #[test]
    fn fixed_stepper_is_refresh_independent() {
        // Same wall time fed at 60 Hz and 240 Hz yields the same number of steps.
        let mut a = FixedStepper::new(1.0 / 480.0, 64);
        let mut b = FixedStepper::new(1.0 / 480.0, 64);
        let (mut na, mut nb) = (0, 0);
        for _ in 0..60 {
            na += a.advance(1.0 / 60.0).0;
        }
        for _ in 0..240 {
            nb += b.advance(1.0 / 240.0).0;
        }
        assert!((na as i64 - nb as i64).abs() <= 1);
        assert!((na as i64 - 480).abs() <= 1);
    }

    #[test]
    fn stall_is_capped() {
        let mut s = FixedStepper::new(0.01, 5);
        let (n, dropped) = s.advance(1.0);
        assert_eq!(n, 5);
        assert!(dropped > 0.9);
        assert!(s.alpha() < 1.0);
    }
}
