//! Timelines: tracks of generators positioned in time (sequences, parallel groups, labels,
//! staggers). Sampling is stateless — `sample(t)` can be called for any `t` in any order,
//! which is what makes scrubbing, reversing and frame-by-frame stepping exact.

use crate::error::CoreError;
use crate::generator::{AnimationSpec, Generator, Sample};
use std::collections::BTreeMap;

/// Where to place a new entry.
#[derive(Debug, Clone, PartialEq)]
pub enum Position {
    /// Absolute time (s).
    At(f64),
    /// After the end of the previously added entry, plus offset (may be negative = overlap).
    AfterPrevious(f64),
    /// Together with the start of the previously added entry, plus offset.
    WithPrevious(f64),
    /// Relative to a named label.
    Label(String, f64),
    /// After the end of everything added so far, plus offset.
    End(f64),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub track: String,
    pub start: f64,
    pub generator: Generator,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Timeline {
    entries: Vec<Entry>,
    labels: BTreeMap<String, f64>,
    initial: BTreeMap<String, f64>,
    last_start: f64,
    last_end: f64,
}

impl Timeline {
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the value a track has before its first entry.
    pub fn set_initial(&mut self, track: &str, value: f64) {
        self.initial.insert(track.to_string(), value);
    }

    pub fn add_label(&mut self, name: &str, position: Position) -> Result<f64, CoreError> {
        let t = self.resolve(&position)?;
        self.labels.insert(name.to_string(), t);
        Ok(t)
    }

    fn resolve(&self, position: &Position) -> Result<f64, CoreError> {
        let t = match position {
            Position::At(t) => *t,
            Position::AfterPrevious(o) => self.last_end + o,
            Position::WithPrevious(o) => self.last_start + o,
            Position::End(o) => self.duration() + o,
            Position::Label(name, o) => {
                self.labels.get(name).copied().ok_or_else(|| CoreError::InvalidTimeline(format!("unknown label `{name}`")))? + o
            }
        };
        if !t.is_finite() {
            return Err(CoreError::InvalidTimeline("position must be finite".into()));
        }
        Ok(t.max(0.0))
    }

    /// Value the track holds at the given time considering only entries starting before it.
    fn track_value_before(&self, track: &str, start: f64) -> f64 {
        let mut best: Option<&Entry> = None;
        for e in self.entries.iter().filter(|e| e.track == track && e.start <= start) {
            if best.map_or(true, |b| e.start >= b.start) {
                best = Some(e);
            }
        }
        match best {
            Some(e) => e.generator.sample(start - e.start).value,
            None => self.initial.get(track).copied().unwrap_or(0.0),
        }
    }

    /// Adds an animation of `track` to `to`. `from = None` continues from the value the track
    /// has at that point in the timeline. Returns the entry start time.
    pub fn add(&mut self, track: &str, from: Option<f64>, to: f64, spec: &AnimationSpec, position: Position) -> Result<f64, CoreError> {
        let start = self.resolve(&position)?;
        let from = from.unwrap_or_else(|| self.track_value_before(track, start));
        let generator = Generator::new(spec, from, to, 0.0)?;
        let d = generator.duration();
        if !d.is_finite() {
            return Err(CoreError::InvalidTimeline(format!("entry on `{track}` never settles; timeline entries need finite durations")));
        }
        self.last_start = start;
        self.last_end = start + d;
        self.entries.push(Entry { track: track.to_string(), start, generator });
        Ok(start)
    }

    /// Adds the same animation to several tracks, each offset by `stagger` seconds.
    pub fn add_staggered(&mut self, tracks: &[&str], to: f64, spec: &AnimationSpec, position: Position, stagger: f64) -> Result<(), CoreError> {
        let base = self.resolve(&position)?;
        let mut end: f64 = base;
        for (i, track) in tracks.iter().enumerate() {
            let start = base + stagger * i as f64;
            self.add(track, None, to, spec, Position::At(start))?;
            end = end.max(self.last_end);
        }
        self.last_start = base;
        self.last_end = end;
        Ok(())
    }

    pub fn duration(&self) -> f64 {
        self.entries.iter().map(|e| e.start + e.generator.duration()).fold(0.0, f64::max)
    }

    pub fn tracks(&self) -> Vec<String> {
        let mut v: Vec<String> = self.entries.iter().map(|e| e.track.clone()).collect();
        v.extend(self.initial.keys().cloned());
        v.sort();
        v.dedup();
        v
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn labels(&self) -> &BTreeMap<String, f64> {
        &self.labels
    }

    /// Samples one track at time `t`. Conflict policy: if entries overlap on the same track,
    /// the entry that started most recently (at or before `t`) wins.
    pub fn sample_track(&self, track: &str, t: f64) -> Sample {
        let mut active: Option<&Entry> = None;
        for e in self.entries.iter().filter(|e| e.track == track) {
            if e.start <= t && active.map_or(true, |a| e.start >= a.start) {
                active = Some(e);
            }
        }
        match active {
            Some(e) => e.generator.sample(t - e.start),
            None => {
                // Before the first entry: hold the first entry's start value.
                let first = self.entries.iter().filter(|e| e.track == track).min_by(|a, b| a.start.total_cmp(&b.start));
                let value = first.map(|e| e.generator.sample(0.0).value).or_else(|| self.initial.get(track).copied()).unwrap_or(0.0);
                Sample { value, velocity: 0.0, done: false }
            }
        }
    }

    /// Samples every track at time `t`.
    pub fn sample(&self, t: f64) -> BTreeMap<String, Sample> {
        self.tracks().into_iter().map(|tr| {
            let s = self.sample_track(&tr, t);
            (tr, s)
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::easing::Easing;

    fn lin(d: f64) -> AnimationSpec {
        AnimationSpec::tween(d, Easing::Linear)
    }

    #[test]
    fn sequence_and_parallel() {
        let mut tl = Timeline::new();
        tl.add("x", Some(0.0), 100.0, &lin(1.0), Position::At(0.0)).unwrap();
        tl.add("y", Some(0.0), 50.0, &lin(0.5), Position::WithPrevious(0.0)).unwrap();
        tl.add("x", None, 0.0, &lin(1.0), Position::AfterPrevious(0.5)).unwrap();
        // second x starts after y ends (0.5) + 0.5 = 1.0
        assert_eq!(tl.duration(), 2.0);
        assert_eq!(tl.sample_track("x", 0.5).value, 50.0);
        assert_eq!(tl.sample_track("y", 0.25).value, 25.0);
        assert_eq!(tl.sample_track("x", 1.5).value, 50.0);
        assert_eq!(tl.sample_track("x", 2.0).value, 0.0);
    }

    #[test]
    fn continuation_from_previous_value() {
        let mut tl = Timeline::new();
        tl.set_initial("o", 0.2);
        tl.add("o", None, 1.0, &lin(1.0), Position::At(1.0)).unwrap();
        assert!((tl.sample_track("o", 0.0).value - 0.2).abs() < 1e-12);
        assert!((tl.sample_track("o", 1.5).value - 0.6).abs() < 1e-12);
    }

    #[test]
    fn labels_and_stagger() {
        let mut tl = Timeline::new();
        tl.add_label("intro", Position::At(0.3)).unwrap();
        tl.add_staggered(&["a", "b", "c"], 1.0, &lin(0.2), Position::Label("intro".into(), 0.0), 0.1).unwrap();
        let starts: Vec<f64> = tl.entries().iter().map(|e| e.start).collect();
        assert_eq!(starts.len(), 3);
        assert!((starts[2] - 0.5).abs() < 1e-12);
        assert!((tl.duration() - 0.7).abs() < 1e-12);
        assert!(tl.add("z", None, 1.0, &lin(1.0), Position::Label("nope".into(), 0.0)).is_err());
    }

    #[test]
    fn springs_in_timelines_have_finite_duration() {
        let mut tl = Timeline::new();
        let spec = AnimationSpec::spring(umx_physics::SpringParams::default());
        tl.add("s", Some(0.0), 1.0, &spec, Position::At(0.0)).unwrap();
        assert!(tl.duration().is_finite());
        let undamped = AnimationSpec::spring(umx_physics::SpringParams::new(100.0, 0.0, 1.0).unwrap());
        assert!(tl.add("s", None, 0.0, &undamped, Position::End(0.0)).is_err());
    }

    #[test]
    fn scrubbing_is_order_independent() {
        let mut tl = Timeline::new();
        tl.add("x", Some(0.0), 10.0, &AnimationSpec::spring(umx_physics::SpringParams::default()), Position::At(0.0)).unwrap();
        let forward: Vec<f64> = (0..50).map(|i| tl.sample_track("x", i as f64 * 0.02).value).collect();
        let backward: Vec<f64> = (0..50).rev().map(|i| tl.sample_track("x", i as f64 * 0.02).value).collect();
        let mut b = backward.clone();
        b.reverse();
        assert_eq!(forward, b);
    }
}
