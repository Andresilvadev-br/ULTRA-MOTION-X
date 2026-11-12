//! Adaptive Fidelity Engine.
//!
//! Observes frame regularity and adjusts visual complexity. Priorities (highest first):
//! input response → stability → frame regularity → motion continuity → visual quality →
//! decorative effects. Only *visual* fidelity is adjusted; motion timing is never altered.
//!
//! Anti-oscillation measures: separate down/up thresholds, sustained-evidence windows, a
//! cooldown after every change and exponential back-off for failed upgrades.

use serde::{Deserialize, Serialize};

pub type FidelityLevel = u8;
pub const MAX_LEVEL: FidelityLevel = 4;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FidelityConfig {
    pub min_level: FidelityLevel,
    pub max_level: FidelityLevel,
    pub initial_level: FidelityLevel,
    /// EWMA smoothing for the miss rate.
    pub smoothing: f64,
    /// Downgrade when the smoothed miss rate exceeds this.
    pub downgrade_threshold: f64,
    /// Consider upgrading when the smoothed miss rate is below this.
    pub upgrade_threshold: f64,
    /// Stable frames required before an upgrade.
    pub upgrade_after: u32,
    /// Frames to wait after any change.
    pub cooldown: u32,
    /// When set, the level never changes automatically.
    pub locked: bool,
}

impl Default for FidelityConfig {
    fn default() -> Self {
        Self {
            min_level: 0,
            max_level: MAX_LEVEL,
            initial_level: 3,
            smoothing: 0.08,
            downgrade_threshold: 0.2,
            upgrade_threshold: 0.02,
            upgrade_after: 180,
            cooldown: 45,
            locked: false,
        }
    }
}

/// Concrete knobs derived from a level. Effects read these.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FidelitySettings {
    pub level: FidelityLevel,
    /// Multiplier on particle emission/capacity.
    pub particles: f64,
    /// Multiplier on blur radii.
    pub blur: f64,
    /// Render scale for offscreen effects (shaders).
    pub effect_resolution: f64,
    /// Maximum simultaneously composited decorative layers.
    pub max_decorative_layers: u32,
    /// Decorative animations update every N-th frame.
    pub decorative_frame_divisor: u32,
    pub shadows: bool,
    pub lighting: bool,
    pub shaders: bool,
}

impl FidelitySettings {
    pub fn for_level(level: FidelityLevel) -> Self {
        match level.min(MAX_LEVEL) {
            0 => Self {
                level: 0,
                particles: 0.0,
                blur: 0.0,
                effect_resolution: 0.0,
                max_decorative_layers: 0,
                decorative_frame_divisor: 0,
                shadows: false,
                lighting: false,
                shaders: false,
            },
            1 => Self {
                level: 1,
                particles: 0.25,
                blur: 0.4,
                effect_resolution: 0.35,
                max_decorative_layers: 2,
                decorative_frame_divisor: 3,
                shadows: true,
                lighting: false,
                shaders: false,
            },
            2 => Self {
                level: 2,
                particles: 0.5,
                blur: 0.7,
                effect_resolution: 0.5,
                max_decorative_layers: 6,
                decorative_frame_divisor: 2,
                shadows: true,
                lighting: true,
                shaders: true,
            },
            3 => Self {
                level: 3,
                particles: 0.8,
                blur: 1.0,
                effect_resolution: 0.75,
                max_decorative_layers: 12,
                decorative_frame_divisor: 1,
                shadows: true,
                lighting: true,
                shaders: true,
            },
            _ => Self {
                level: 4,
                particles: 1.0,
                blur: 1.0,
                effect_resolution: 1.0,
                max_decorative_layers: 32,
                decorative_frame_divisor: 1,
                shadows: true,
                lighting: true,
                shaders: true,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FidelityChange {
    Downgraded {
        from: FidelityLevel,
        to: FidelityLevel,
    },
    Upgraded {
        from: FidelityLevel,
        to: FidelityLevel,
    },
}

#[derive(Debug, Clone)]
pub struct FidelityController {
    config: FidelityConfig,
    level: FidelityLevel,
    miss_rate: f64,
    stable_frames: u32,
    cooldown: u32,
    upgrade_penalty: u32,
    frames_since_upgrade: u32,
    frames_since_failure: u32,
    ceiling: FidelityLevel,
    history: Vec<FidelityChange>,
}

impl FidelityController {
    pub fn new(config: FidelityConfig) -> Self {
        let level = config
            .initial_level
            .clamp(config.min_level, config.max_level);
        Self {
            config,
            level,
            miss_rate: 0.0,
            stable_frames: 0,
            cooldown: 0,
            upgrade_penalty: 1,
            frames_since_upgrade: u32::MAX,
            frames_since_failure: 0,
            ceiling: MAX_LEVEL,
            history: Vec::new(),
        }
    }

    pub fn level(&self) -> FidelityLevel {
        self.level
    }
    pub fn settings(&self) -> FidelitySettings {
        FidelitySettings::for_level(self.level)
    }
    pub fn miss_rate(&self) -> f64 {
        self.miss_rate
    }
    pub fn history(&self) -> &[FidelityChange] {
        &self.history
    }
    pub fn config(&self) -> &FidelityConfig {
        &self.config
    }

    /// External cap (power policy, user setting). Applied immediately.
    pub fn set_ceiling(&mut self, ceiling: FidelityLevel) {
        self.ceiling = ceiling.min(MAX_LEVEL);
        let cap = self.effective_max();
        if self.level > cap {
            let from = self.level;
            self.level = cap;
            self.history
                .push(FidelityChange::Downgraded { from, to: cap });
        }
    }

    /// Manual override: sets and locks the level.
    pub fn set_manual(&mut self, level: Option<FidelityLevel>) {
        match level {
            Some(l) => {
                self.level = l.clamp(self.config.min_level, self.effective_max());
                self.config.locked = true;
            }
            None => self.config.locked = false,
        }
    }

    fn effective_max(&self) -> FidelityLevel {
        self.config
            .max_level
            .min(self.ceiling)
            .max(self.config.min_level)
    }

    /// Feeds one frame. `missed` is whether the frame missed its deadline.
    pub fn observe(&mut self, missed: bool) -> Option<FidelityChange> {
        let a = self.config.smoothing.clamp(0.001, 1.0);
        self.miss_rate = self.miss_rate * (1.0 - a) + if missed { a } else { 0.0 };
        self.frames_since_upgrade = self.frames_since_upgrade.saturating_add(1);
        // Failed upgrades are forgiven only after a very long time without failures
        // (≈ 25 min at 60 Hz with default settings), so retries stay rare.
        self.frames_since_failure = self.frames_since_failure.saturating_add(1);
        if self.frames_since_failure == self.config.upgrade_after.saturating_mul(512) {
            self.upgrade_penalty = 1;
        }
        if self.cooldown > 0 {
            self.cooldown -= 1;
            return None;
        }
        if self.config.locked {
            return None;
        }
        if self.miss_rate > self.config.downgrade_threshold && self.level > self.config.min_level {
            let from = self.level;
            self.level -= 1;
            self.cooldown = self.config.cooldown;
            self.stable_frames = 0;
            // An upgrade that fails quickly makes the next upgrade attempt wait longer.
            if self.frames_since_upgrade < self.config.upgrade_after {
                self.upgrade_penalty = (self.upgrade_penalty * 4).min(256);
                self.frames_since_failure = 0;
            }
            self.miss_rate *= 0.5;
            let c = FidelityChange::Downgraded {
                from,
                to: self.level,
            };
            self.history.push(c);
            return Some(c);
        }
        if self.miss_rate < self.config.upgrade_threshold {
            self.stable_frames += 1;
            if self.stable_frames >= self.config.upgrade_after * self.upgrade_penalty
                && self.level < self.effective_max()
            {
                let from = self.level;
                self.level += 1;
                self.cooldown = self.config.cooldown;
                self.stable_frames = 0;
                self.frames_since_upgrade = 0;
                let c = FidelityChange::Upgraded {
                    from,
                    to: self.level,
                };
                self.history.push(c);
                return Some(c);
            }
        } else {
            self.stable_frames = 0;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downgrades_under_sustained_load() {
        let mut f = FidelityController::new(FidelityConfig::default());
        let mut changes = 0;
        for _ in 0..200 {
            if f.observe(true).is_some() {
                changes += 1;
            }
        }
        assert!(f.level() < 3);
        assert!(changes >= 1);
    }

    #[test]
    fn single_hiccup_does_not_downgrade() {
        let mut f = FidelityController::new(FidelityConfig::default());
        for i in 0..600 {
            f.observe(i % 100 == 0);
        }
        assert!(f.level() >= 3);
    }

    #[test]
    fn upgrades_after_stability_with_hysteresis() {
        let mut f = FidelityController::new(FidelityConfig {
            initial_level: 1,
            ..FidelityConfig::default()
        });
        for _ in 0..170 {
            f.observe(false);
        }
        assert_eq!(f.level(), 1, "must wait for the stability window");
        for _ in 0..30 {
            f.observe(false);
        }
        assert_eq!(f.level(), 2);
    }

    #[test]
    fn no_oscillation_on_borderline_load() {
        // A workload that fails only at level 4 must not flip-flop forever.
        let mut f = FidelityController::new(FidelityConfig {
            initial_level: 4,
            ..FidelityConfig::default()
        });
        let mut changes = 0;
        for i in 0..20_000 {
            let missed = f.level() == 4 && i % 2 == 0;
            if f.observe(missed).is_some() {
                changes += 1;
            }
        }
        assert!(changes < 12, "changes = {changes}");
    }

    #[test]
    fn ceiling_and_manual() {
        let mut f = FidelityController::new(FidelityConfig::default());
        f.set_ceiling(1);
        assert_eq!(f.level(), 1);
        f.set_manual(Some(0));
        for _ in 0..1000 {
            f.observe(false);
        }
        assert_eq!(f.level(), 0);
        assert_eq!(FidelitySettings::for_level(0).particles, 0.0);
        assert!(FidelitySettings::for_level(4).shaders);
    }
}
