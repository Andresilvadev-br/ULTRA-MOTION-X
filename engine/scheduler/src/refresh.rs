//! Refresh-rate estimation. Uses the median of recent presentation intervals (robust to
//! occasional long frames), snaps to common panel rates, and flags variable refresh when
//! intervals are spread out but not multiples of a base interval.

use umx_telemetry::{percentile, Ring};

/// Panel rates the estimator snaps to (Hz).
pub const COMMON_RATES: [f64; 14] = [
    24.0, 30.0, 48.0, 50.0, 60.0, 72.0, 75.0, 90.0, 100.0, 120.0, 144.0, 165.0, 180.0, 240.0,
];
const HIGH_RATES: [f64; 3] = [300.0, 360.0, 480.0];

#[derive(Debug, Clone)]
pub struct RefreshEstimator {
    intervals: Ring,
    last: Option<f64>,
    estimate_hz: f64,
    variable: bool,
    changes: u32,
}

impl Default for RefreshEstimator {
    fn default() -> Self {
        Self::new()
    }
}

impl RefreshEstimator {
    pub fn new() -> Self {
        Self {
            intervals: Ring::new(90),
            last: None,
            estimate_hz: 60.0,
            variable: false,
            changes: 0,
        }
    }

    /// Feeds a presentation timestamp in milliseconds. Returns `true` if the estimate changed
    /// (e.g. window moved to another monitor).
    pub fn sample(&mut self, timestamp_ms: f64) -> bool {
        if let Some(last) = self.last {
            let dt = timestamp_ms - last;
            if dt > 0.5 && dt < 100.0 {
                self.intervals.push(dt);
            }
        }
        self.last = Some(timestamp_ms);
        if self.intervals.len() < 8 {
            return false;
        }
        // Use the most recent 30 intervals for responsiveness to monitor changes.
        let recent: Vec<f64> = self.intervals.iter().rev().take(30).collect();
        let lower = percentile(&recent, 0.25).unwrap_or(16.67);
        let median = percentile(&recent, 0.5).unwrap_or(16.67);
        let upper = percentile(&recent, 0.75).unwrap_or(16.67);
        // Missed frames produce multiples of the base interval; the lower quartile is the
        // most reliable base when the system is under load.
        let base = if median > lower * 1.6 { lower } else { median };
        let hz = snap(1000.0 / base);
        self.variable = (upper - lower) / median > 0.2
            && (median / lower).fract().min(1.0 - (median / lower).fract()) > 0.15;
        let changed = (hz - self.estimate_hz).abs() > 0.5;
        if changed {
            self.changes += 1;
            self.estimate_hz = hz;
        }
        changed
    }

    /// Resets continuity (loop stopped, tab hidden, window moved).
    pub fn break_continuity(&mut self) {
        self.last = None;
    }

    pub fn hz(&self) -> f64 {
        self.estimate_hz
    }
    pub fn interval_ms(&self) -> f64 {
        1000.0 / self.estimate_hz
    }
    pub fn is_variable(&self) -> bool {
        self.variable
    }
    pub fn changes(&self) -> u32 {
        self.changes
    }
    pub fn has_estimate(&self) -> bool {
        self.intervals.len() >= 8
    }
}

/// Snaps a raw rate to the nearest common rate within 6 %, otherwise rounds.
pub fn snap(raw: f64) -> f64 {
    let all = COMMON_RATES.iter().chain(HIGH_RATES.iter());
    let mut best = raw.round();
    let mut best_err = f64::INFINITY;
    for &r in all {
        let err = (raw - r).abs() / r;
        if err < 0.06 && err < best_err {
            best = r;
            best_err = err;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(e: &mut RefreshEstimator, hz: f64, n: usize, start: f64) -> f64 {
        let mut t = start;
        for i in 0..n {
            // ±3% jitter, deterministic.
            let jitter = 1.0 + 0.03 * (((i * 7919) % 13) as f64 / 13.0 - 0.5);
            t += 1000.0 / hz * jitter;
            e.sample(t);
        }
        t
    }

    #[test]
    fn detects_common_rates() {
        for hz in [60.0, 75.0, 90.0, 120.0, 144.0, 165.0, 240.0, 360.0] {
            let mut e = RefreshEstimator::new();
            feed(&mut e, hz, 60, 0.0);
            assert_eq!(e.hz(), hz, "rate {hz}");
        }
    }

    #[test]
    fn robust_to_dropped_frames() {
        let mut e = RefreshEstimator::new();
        let mut t = 0.0;
        for i in 0..60 {
            t += if i % 5 == 0 {
                2.0 * 1000.0 / 144.0
            } else {
                1000.0 / 144.0
            };
            e.sample(t);
        }
        assert_eq!(e.hz(), 144.0);
    }

    #[test]
    fn follows_monitor_change() {
        let mut e = RefreshEstimator::new();
        let t = feed(&mut e, 60.0, 60, 0.0);
        feed(&mut e, 144.0, 60, t);
        assert_eq!(e.hz(), 144.0);
        assert!(e.changes() >= 1);
    }

    #[test]
    fn snapping() {
        assert_eq!(snap(59.94), 60.0);
        assert_eq!(snap(143.9), 144.0);
        assert_eq!(snap(500.0), 480.0);
        assert_eq!(snap(1000.0), 1000.0);
    }
}
