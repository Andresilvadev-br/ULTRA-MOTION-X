//! Gesture helpers: velocity estimation, rubber banding, snap points and magnetism.

use crate::math;

/// Maximum age (s) of samples considered by the velocity tracker.
pub const VELOCITY_HORIZON: f64 = 0.1;
/// If no sample arrived for this long (s), the pointer is assumed to have stopped.
pub const STOP_THRESHOLD: f64 = 0.04;

/// Estimates pointer velocity with a weighted least-squares line fit over a short horizon.
/// Robust to irregular event delivery (coalesced events, high-frequency mice).
#[derive(Debug, Clone)]
pub struct VelocityTracker {
    samples: [(f64, f64); 20],
    len: usize,
    head: usize,
}

impl Default for VelocityTracker {
    fn default() -> Self {
        Self { samples: [(0.0, 0.0); 20], len: 0, head: 0 }
    }
}

impl VelocityTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self) {
        self.len = 0;
        self.head = 0;
    }

    /// Adds a sample at `time` (seconds, monotonic) with `position`.
    pub fn add(&mut self, time: f64, position: f64) {
        if !time.is_finite() || !position.is_finite() {
            return;
        }
        if self.len > 0 {
            let last = self.samples[(self.head + 20 - 1) % 20];
            if time < last.0 {
                // Non-monotonic clock: restart tracking rather than produce garbage.
                self.reset();
            } else if time == last.0 {
                self.samples[(self.head + 20 - 1) % 20] = (time, position);
                return;
            }
        }
        self.samples[self.head] = (time, position);
        self.head = (self.head + 1) % 20;
        self.len = (self.len + 1).min(20);
    }

    /// Velocity in units/s at `now`. Returns 0 if the pointer has been still.
    pub fn velocity(&self, now: f64) -> f64 {
        if self.len < 2 {
            return 0.0;
        }
        let newest = self.samples[(self.head + 20 - 1) % 20];
        if now - newest.0 > STOP_THRESHOLD {
            return 0.0;
        }
        let (mut sw, mut st, mut sx, mut stt, mut stx) = (0.0, 0.0, 0.0, 0.0, 0.0);
        let mut count = 0;
        for i in 0..self.len {
            let (t, x) = self.samples[(self.head + 20 - 1 - i) % 20];
            let age = newest.0 - t;
            if age > VELOCITY_HORIZON {
                break;
            }
            // Recent samples weigh more.
            let w = 1.0 - 0.5 * age / VELOCITY_HORIZON;
            let rt = t - newest.0;
            sw += w;
            st += w * rt;
            sx += w * x;
            stt += w * rt * rt;
            stx += w * rt * x;
            count += 1;
        }
        if count < 2 {
            return 0.0;
        }
        let denom = sw * stt - st * st;
        if denom.abs() < 1e-18 {
            return 0.0;
        }
        (sw * stx - st * sx) / denom
    }
}

/// Rubber-band mapping for overscroll: maps an unbounded overshoot to a resisted offset that
/// asymptotically approaches `dimension`. `coefficient` ≈ 0.55 matches common platform feel.
pub fn rubber_band(overshoot: f64, dimension: f64, coefficient: f64) -> f64 {
    if dimension <= 0.0 || overshoot == 0.0 {
        return 0.0;
    }
    let sign = overshoot.signum();
    let x = overshoot.abs();
    sign * (1.0 - 1.0 / (x * coefficient / dimension + 1.0)) * dimension
}

/// Applies rubber banding to `value` outside `[min, max]`.
pub fn rubber_band_clamp(value: f64, min: f64, max: f64, dimension: f64, coefficient: f64) -> f64 {
    if value < min {
        min + rubber_band(value - min, dimension, coefficient)
    } else if value > max {
        max + rubber_band(value - max, dimension, coefficient)
    } else {
        value
    }
}

/// Picks the snap point closest to `projected` (ties resolved to the earlier point).
pub fn select_snap_point(projected: f64, points: &[f64]) -> Option<f64> {
    points
        .iter()
        .copied()
        .filter(|p| p.is_finite())
        .fold(None, |best: Option<f64>, p| match best {
            Some(b) if (b - projected).abs() <= (p - projected).abs() => Some(b),
            _ => Some(p),
        })
}

/// Projects where a fling would end under exponential decay with time constant `tau`.
pub fn project(position: f64, velocity: f64, tau: f64) -> f64 {
    position + velocity * tau
}

/// Magnetic pull: offset applied towards an attractor when within `radius`.
/// `strength` in [0, 1]; the pull fades smoothly (smoothstep) to zero at the radius edge.
pub fn magnetic_offset(distance: f64, radius: f64, strength: f64) -> f64 {
    if radius <= 0.0 || distance.abs() >= radius {
        return 0.0;
    }
    let t = 1.0 - distance.abs() / radius;
    let s = t * t * (3.0 - 2.0 * t);
    distance * strength.clamp(0.0, 1.0) * s
}

/// 2D magnetic offset towards an attractor point.
pub fn magnetic_offset_2d(dx: f64, dy: f64, radius: f64, strength: f64) -> (f64, f64) {
    let d = math::hypot(dx, dy);
    if d == 0.0 {
        return (0.0, 0.0);
    }
    let m = magnetic_offset(d, radius, strength);
    (dx / d * m, dy / d * m)
}

/// Gesture classification thresholds.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct IntentThresholds {
    /// Movement (px) before a press becomes a drag.
    pub drag_distance: f64,
    /// Press duration (s) before a press becomes a long-press.
    pub long_press: f64,
    /// Release speed (px/s) above which a drag is a swipe/fling.
    pub swipe_speed: f64,
}

impl Default for IntentThresholds {
    fn default() -> Self {
        Self { drag_distance: 6.0, long_press: 0.5, swipe_speed: 500.0 }
    }
}

/// Classified pointer intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Intent {
    Tap,
    LongPress,
    Drag,
    Swipe,
    Cancel,
}

/// Classifies a finished pointer sequence.
pub fn classify(distance: f64, duration: f64, release_speed: f64, cancelled: bool, th: &IntentThresholds) -> Intent {
    if cancelled {
        Intent::Cancel
    } else if distance < th.drag_distance {
        if duration >= th.long_press {
            Intent::LongPress
        } else {
            Intent::Tap
        }
    } else if release_speed >= th.swipe_speed {
        Intent::Swipe
    } else {
        Intent::Drag
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn velocity_of_constant_motion() {
        let mut v = VelocityTracker::new();
        for i in 0..10 {
            let t = i as f64 * 0.008;
            v.add(t, 500.0 * t);
        }
        assert!((v.velocity(0.072) - 500.0).abs() < 1e-6);
    }

    #[test]
    fn irregular_sampling() {
        let mut v = VelocityTracker::new();
        let times = [0.0, 0.004, 0.011, 0.013, 0.025, 0.031, 0.047];
        for t in times {
            v.add(t, -300.0 * t + 7.0);
        }
        assert!((v.velocity(0.047) + 300.0).abs() < 1e-6);
    }

    #[test]
    fn stopped_pointer_reports_zero() {
        let mut v = VelocityTracker::new();
        v.add(0.0, 0.0);
        v.add(0.01, 10.0);
        assert_eq!(v.velocity(0.2), 0.0);
    }

    #[test]
    fn rubber_band_is_bounded_and_monotonic() {
        let mut last = 0.0;
        for i in 1..1000 {
            let r = rubber_band(i as f64, 300.0, 0.55);
            assert!(r > last && r < 300.0);
            last = r;
        }
        assert!(rubber_band(-50.0, 300.0, 0.55) < 0.0);
        assert_eq!(rubber_band_clamp(50.0, 0.0, 100.0, 300.0, 0.55), 50.0);
    }

    #[test]
    fn snap_selection() {
        assert_eq!(select_snap_point(140.0, &[0.0, 100.0, 200.0]), Some(100.0));
        assert_eq!(select_snap_point(160.0, &[0.0, 100.0, 200.0]), Some(200.0));
        assert_eq!(select_snap_point(1.0, &[]), None);
    }

    #[test]
    fn magnetism_fades() {
        assert_eq!(magnetic_offset(100.0, 50.0, 1.0), 0.0);
        let near = magnetic_offset(5.0, 50.0, 0.5);
        assert!(near > 0.0 && near < 5.0);
        let (x, y) = magnetic_offset_2d(3.0, 4.0, 50.0, 1.0);
        assert!((x / y - 0.75).abs() < 1e-12);
    }

    #[test]
    fn intent_classification() {
        let th = IntentThresholds::default();
        assert_eq!(classify(2.0, 0.1, 0.0, false, &th), Intent::Tap);
        assert_eq!(classify(2.0, 0.8, 0.0, false, &th), Intent::LongPress);
        assert_eq!(classify(50.0, 0.3, 100.0, false, &th), Intent::Drag);
        assert_eq!(classify(50.0, 0.1, 1500.0, false, &th), Intent::Swipe);
        assert_eq!(classify(50.0, 0.1, 1500.0, true, &th), Intent::Cancel);
    }
}
