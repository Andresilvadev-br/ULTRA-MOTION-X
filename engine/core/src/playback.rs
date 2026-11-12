//! Playback controller: maps wall-clock deltas to timeline time with rate, direction,
//! iterations, alternation (yoyo), pause/resume, seek, cancellation and completion.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackState {
    Idle,
    Running,
    Paused,
    Finished,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackEvent {
    Iteration(u32),
    Finished,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Playback {
    /// Position within the whole play-through (all iterations), seconds.
    time: f64,
    duration: f64,
    rate: f64,
    iterations: f64,
    alternate: bool,
    state: PlaybackState,
}

impl Playback {
    pub fn new(duration: f64) -> Self {
        Self {
            time: 0.0,
            duration: if duration.is_finite() { duration.max(0.0) } else { 0.0 },
            rate: 1.0,
            iterations: 1.0,
            alternate: false,
            state: PlaybackState::Idle,
        }
    }

    pub fn with_iterations(mut self, n: f64, alternate: bool) -> Self {
        self.iterations = if n.is_nan() || n <= 0.0 { 1.0 } else { n };
        self.alternate = alternate;
        self
    }

    pub fn state(&self) -> PlaybackState {
        self.state
    }
    pub fn rate(&self) -> f64 {
        self.rate
    }
    pub fn duration(&self) -> f64 {
        self.duration
    }

    /// Total length of all iterations (`INFINITY` for endless loops).
    pub fn total(&self) -> f64 {
        self.duration * self.iterations
    }

    pub fn play(&mut self) {
        if matches!(self.state, PlaybackState::Finished) {
            self.time = if self.rate >= 0.0 { 0.0 } else { self.total() };
        }
        if !matches!(self.state, PlaybackState::Cancelled) {
            self.state = PlaybackState::Running;
        }
    }
    pub fn pause(&mut self) {
        if self.state == PlaybackState::Running {
            self.state = PlaybackState::Paused;
        }
    }
    pub fn cancel(&mut self) {
        self.state = PlaybackState::Cancelled;
        self.time = 0.0;
    }
    pub fn finish(&mut self) {
        if self.total().is_finite() {
            self.time = if self.rate >= 0.0 { self.total() } else { 0.0 };
        }
        self.state = PlaybackState::Finished;
    }
    /// Reverses direction, keeping the current position (no jump).
    pub fn reverse(&mut self) {
        self.rate = -self.rate;
        if self.state == PlaybackState::Finished {
            self.state = PlaybackState::Running;
        }
    }
    pub fn set_rate(&mut self, rate: f64) {
        if rate.is_finite() {
            self.rate = rate;
        }
    }
    pub fn seek(&mut self, t: f64) {
        if t.is_finite() {
            let total = self.total();
            self.time = if total.is_finite() { t.clamp(0.0, total) } else { t.max(0.0) };
        }
    }

    pub fn time(&self) -> f64 {
        self.time
    }

    /// Time inside the current iteration, accounting for alternation.
    pub fn local_time(&self) -> f64 {
        if self.duration == 0.0 {
            return 0.0;
        }
        let total = self.total();
        if total.is_finite() && self.time >= total {
            let last = (libm::ceil(self.iterations) as u64).saturating_sub(1);
            let frac = self.iterations - libm::floor(self.iterations);
            let end = if frac > 0.0 { frac * self.duration } else { self.duration };
            return if self.alternate && last % 2 == 1 { self.duration - end } else { end };
        }
        let iter = libm::floor(self.time / self.duration) as u64;
        let t = self.time - iter as f64 * self.duration;
        if self.alternate && iter % 2 == 1 {
            self.duration - t
        } else {
            t
        }
    }

    pub fn iteration(&self) -> u32 {
        if self.duration == 0.0 {
            return 0;
        }
        (libm::floor(self.time / self.duration) as u32).min(libm::ceil(self.iterations).max(1.0) as u32 - 1)
    }

    /// Advances by wall-clock `dt` seconds.
    pub fn advance(&mut self, dt: f64) -> Vec<PlaybackEvent> {
        let mut events = Vec::new();
        if self.state != PlaybackState::Running || !dt.is_finite() {
            return events;
        }
        let before = self.iteration();
        self.time += dt * self.rate;
        let total = self.total();
        if self.rate >= 0.0 && total.is_finite() && self.time >= total {
            self.time = total;
            self.state = PlaybackState::Finished;
        } else if self.rate < 0.0 && self.time <= 0.0 {
            self.time = 0.0;
            self.state = PlaybackState::Finished;
        }
        let after = self.iteration();
        if after != before {
            events.push(PlaybackEvent::Iteration(after));
        }
        if self.state == PlaybackState::Finished {
            events.push(PlaybackEvent::Finished);
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn play_pause_finish() {
        let mut p = Playback::new(1.0);
        p.play();
        p.advance(0.4);
        p.pause();
        p.advance(10.0);
        assert!((p.time() - 0.4).abs() < 1e-12);
        p.play();
        let ev = p.advance(1.0);
        assert_eq!(p.state(), PlaybackState::Finished);
        assert!(ev.contains(&PlaybackEvent::Finished));
    }

    #[test]
    fn reverse_without_jump() {
        let mut p = Playback::new(1.0);
        p.play();
        p.advance(0.7);
        p.reverse();
        assert!((p.local_time() - 0.7).abs() < 1e-12);
        p.advance(0.2);
        assert!((p.local_time() - 0.5).abs() < 1e-12);
        p.advance(5.0);
        assert_eq!(p.state(), PlaybackState::Finished);
        assert_eq!(p.time(), 0.0);
    }

    #[test]
    fn yoyo_iterations() {
        let mut p = Playback::new(1.0).with_iterations(3.0, true);
        p.play();
        p.advance(1.25);
        assert!((p.local_time() - 0.75).abs() < 1e-12);
        assert_eq!(p.iteration(), 1);
        p.advance(2.0);
        assert_eq!(p.state(), PlaybackState::Finished);
        assert!((p.local_time() - 1.0).abs() < 1e-12);
    }

    #[test]
    fn rate_and_seek() {
        let mut p = Playback::new(2.0);
        p.set_rate(2.0);
        p.play();
        p.advance(0.5);
        assert!((p.time() - 1.0).abs() < 1e-12);
        p.seek(5.0);
        assert_eq!(p.time(), 2.0);
        p.cancel();
        assert_eq!(p.state(), PlaybackState::Cancelled);
        p.play();
        assert_eq!(p.state(), PlaybackState::Cancelled);
    }
}
