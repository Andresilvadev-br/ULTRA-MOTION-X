//! # umx-telemetry — Frame Intelligence Telemetry
//!
//! Decoupled, allocation-free (after construction) collection of frame timing and engine
//! counters. Every reported number carries a [`Provenance`] so consumers can distinguish
//! real measurements from estimates and from data the platform does not provide.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

/// Where a number comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provenance {
    /// Directly measured on this run.
    Measured,
    /// Derived from measurements through a model (e.g. dropped frames from intervals).
    Estimated,
    /// The platform does not expose this information.
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Metric {
    pub value: f64,
    pub provenance: Provenance,
}

impl Metric {
    pub fn measured(value: f64) -> Self {
        Self {
            value,
            provenance: Provenance::Measured,
        }
    }
    pub fn estimated(value: f64) -> Self {
        Self {
            value,
            provenance: Provenance::Estimated,
        }
    }
    pub fn unavailable() -> Self {
        Self {
            value: f64::NAN,
            provenance: Provenance::Unavailable,
        }
    }
}

/// Fixed-capacity ring buffer.
#[derive(Debug, Clone)]
pub struct Ring {
    data: Vec<f64>,
    head: usize,
    len: usize,
}

impl Ring {
    pub fn new(capacity: usize) -> Self {
        Self {
            data: vec![0.0; capacity.max(1)],
            head: 0,
            len: 0,
        }
    }
    pub fn push(&mut self, v: f64) {
        if !v.is_finite() {
            return;
        }
        self.data[self.head] = v;
        self.head = (self.head + 1) % self.data.len();
        self.len = (self.len + 1).min(self.data.len());
    }
    pub fn len(&self) -> usize {
        self.len
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    pub fn clear(&mut self) {
        self.len = 0;
        self.head = 0;
    }
    /// Values from oldest to newest.
    pub fn iter(&self) -> impl DoubleEndedIterator<Item = f64> + '_ {
        let cap = self.data.len();
        let start = (self.head + cap - self.len) % cap;
        (0..self.len).map(move |i| self.data[(start + i) % cap])
    }
    pub fn last(&self) -> Option<f64> {
        (self.len > 0).then(|| self.data[(self.head + self.data.len() - 1) % self.data.len()])
    }
}

/// Percentile with linear interpolation (`q` in [0, 1]) over unsorted data.
pub fn percentile(values: &[f64], q: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut v: Vec<f64> = values.iter().copied().filter(|x| x.is_finite()).collect();
    if v.is_empty() {
        return None;
    }
    v.sort_by(f64::total_cmp);
    let pos = q.clamp(0.0, 1.0) * (v.len() - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    Some(v[lo] + (v[hi] - v[lo]) * (pos - lo as f64))
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct Distribution {
    pub count: usize,
    pub mean: f64,
    pub min: f64,
    pub max: f64,
    pub stddev: f64,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
}

impl Distribution {
    pub fn from_values(values: &[f64]) -> Self {
        let v: Vec<f64> = values.iter().copied().filter(|x| x.is_finite()).collect();
        if v.is_empty() {
            return Self::default();
        }
        let n = v.len() as f64;
        let mean = v.iter().sum::<f64>() / n;
        let var = v.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / n;
        Self {
            count: v.len(),
            mean,
            min: v.iter().copied().fold(f64::INFINITY, f64::min),
            max: v.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            stddev: var.sqrt(),
            p50: percentile(&v, 0.5).unwrap_or(0.0),
            p95: percentile(&v, 0.95).unwrap_or(0.0),
            p99: percentile(&v, 0.99).unwrap_or(0.0),
        }
    }
}

/// Engine counters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Counters {
    pub animations_started: u64,
    pub animations_completed: u64,
    pub animations_interrupted: u64,
    pub animations_cancelled: u64,
    /// Writes skipped because the value did not change (partial updates).
    pub redundant_writes_skipped: u64,
    pub writes: u64,
    pub tasks_deferred: u64,
    pub tasks_dropped_obsolete: u64,
}

/// Collects frame timing.
#[derive(Debug, Clone)]
pub struct FrameStats {
    intervals: Ring,
    work: Ring,
    last_timestamp: Option<f64>,
    expected_interval: f64,
    dropped: u64,
    frames: u64,
    pub counters: Counters,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub frames: u64,
    /// Interval between presented frames (ms).
    pub frame_interval: Distribution,
    /// Engine work per frame (ms).
    pub engine_work: Distribution,
    pub estimated_fps: Metric,
    pub dropped_frames: Metric,
    /// Fraction of intervals within ±25% of the expected interval.
    pub regularity: Metric,
    pub expected_interval_ms: f64,
    pub counters: Counters,
}

impl FrameStats {
    pub fn new(window: usize) -> Self {
        Self {
            intervals: Ring::new(window),
            work: Ring::new(window),
            last_timestamp: None,
            expected_interval: 1000.0 / 60.0,
            dropped: 0,
            frames: 0,
            counters: Counters::default(),
        }
    }

    /// Sets the expected interval (ms) from the detected refresh rate.
    pub fn set_expected_interval(&mut self, ms: f64) {
        if ms.is_finite() && ms > 0.0 {
            self.expected_interval = ms;
        }
    }

    /// Records one frame: presentation timestamp (ms) and engine work (ms).
    pub fn record(&mut self, timestamp_ms: f64, work_ms: f64) {
        if let Some(last) = self.last_timestamp {
            let interval = timestamp_ms - last;
            if interval > 0.0 && interval < 1000.0 {
                self.intervals.push(interval);
                // A frame interval > 1.5× expected means at least one refresh was missed.
                if interval > self.expected_interval * 1.5 {
                    self.dropped +=
                        ((interval / self.expected_interval).round() as u64).saturating_sub(1);
                }
            }
        }
        self.last_timestamp = Some(timestamp_ms);
        self.work.push(work_ms);
        self.frames += 1;
    }

    /// Breaks interval continuity (loop stopped while idle; idle gaps are not jank).
    pub fn mark_idle(&mut self) {
        self.last_timestamp = None;
    }

    pub fn intervals(&self) -> &Ring {
        &self.intervals
    }

    pub fn report(&self) -> Report {
        let iv: Vec<f64> = self.intervals.iter().collect();
        let wk: Vec<f64> = self.work.iter().collect();
        let fi = Distribution::from_values(&iv);
        let regular = if iv.is_empty() {
            Metric::unavailable()
        } else {
            let ok = iv
                .iter()
                .filter(|x| (*x / self.expected_interval - 1.0).abs() <= 0.25)
                .count();
            Metric::measured(ok as f64 / iv.len() as f64)
        };
        Report {
            frames: self.frames,
            frame_interval: fi,
            engine_work: Distribution::from_values(&wk),
            estimated_fps: if fi.p50 > 0.0 {
                Metric::estimated(1000.0 / fi.p50)
            } else {
                Metric::unavailable()
            },
            dropped_frames: Metric::estimated(self.dropped as f64),
            regularity: regular,
            expected_interval_ms: self.expected_interval,
            counters: self.counters,
        }
    }
}

/// A detected regression between two reports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Regression {
    pub metric: String,
    pub baseline: f64,
    pub current: f64,
    pub change: f64,
}

/// Compares lower-is-better metrics; reports changes above `tolerance` (relative, e.g. 0.1).
pub fn compare(baseline: &Report, current: &Report, tolerance: f64) -> Vec<Regression> {
    let pairs = [
        (
            "frameInterval.p95",
            baseline.frame_interval.p95,
            current.frame_interval.p95,
        ),
        (
            "frameInterval.p99",
            baseline.frame_interval.p99,
            current.frame_interval.p99,
        ),
        (
            "engineWork.p50",
            baseline.engine_work.p50,
            current.engine_work.p50,
        ),
        (
            "engineWork.p95",
            baseline.engine_work.p95,
            current.engine_work.p95,
        ),
    ];
    pairs
        .iter()
        .filter(|(_, b, c)| *b > 0.0 && (c - b) / b > tolerance)
        .map(|(m, b, c)| Regression {
            metric: (*m).into(),
            baseline: *b,
            current: *c,
            change: (c - b) / b,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_wraps() {
        let mut r = Ring::new(3);
        for i in 0..5 {
            r.push(i as f64);
        }
        assert_eq!(r.iter().collect::<Vec<_>>(), vec![2.0, 3.0, 4.0]);
        assert_eq!(r.last(), Some(4.0));
        r.push(f64::NAN);
        assert_eq!(r.len(), 3);
    }

    #[test]
    fn percentiles() {
        let v: Vec<f64> = (1..=100).map(f64::from).collect();
        assert!((percentile(&v, 0.5).unwrap() - 50.5).abs() < 1e-9);
        assert!((percentile(&v, 0.99).unwrap() - 99.01).abs() < 1e-9);
        assert!(percentile(&[], 0.5).is_none());
    }

    #[test]
    fn dropped_frame_estimation() {
        let mut s = FrameStats::new(120);
        s.set_expected_interval(1000.0 / 60.0);
        let mut t = 0.0;
        for i in 0..60 {
            t += if i == 30 { 50.0 } else { 1000.0 / 60.0 };
            s.record(t, 1.0);
        }
        let r = s.report();
        assert_eq!(r.dropped_frames.value, 2.0);
        assert_eq!(r.dropped_frames.provenance, Provenance::Estimated);
        assert!((r.estimated_fps.value - 60.0).abs() < 0.5);
        assert!(r.regularity.value > 0.95);
    }

    #[test]
    fn idle_gaps_are_not_jank() {
        let mut s = FrameStats::new(10);
        s.record(0.0, 0.5);
        s.record(16.7, 0.5);
        s.mark_idle();
        s.record(5000.0, 0.5);
        s.record(5016.7, 0.5);
        assert_eq!(s.report().dropped_frames.value, 0.0);
        assert_eq!(s.intervals().len(), 2);
    }

    #[test]
    fn regression_detection() {
        let mut a = FrameStats::new(100);
        let mut b = FrameStats::new(100);
        for i in 0..100 {
            a.record(i as f64 * 16.7, 1.0);
            b.record(i as f64 * 16.7, 2.0);
        }
        let regs = compare(&a.report(), &b.report(), 0.1);
        assert!(regs.iter().any(|r| r.metric == "engineWork.p50"));
        assert!(compare(&a.report(), &a.report(), 0.1).is_empty());
    }
}
