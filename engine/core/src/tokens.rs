//! Universal Motion DNA: shared motion tokens and named profiles.
//!
//! The canonical data lives in `presets/profiles.json` at the repository root and is
//! embedded at compile time, so the Rust runtime and the TypeScript SDK (which generates a
//! module from the same file) always agree.

use crate::easing::Easing;
use crate::error::CoreError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use umx_physics::SpringParams;

const BUILTIN: &str = include_str!("../../../presets/profiles.json");

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpringToken {
    pub response: f64,
    pub damping_ratio: f64,
}

impl SpringToken {
    pub fn params(&self) -> Result<SpringParams, CoreError> {
        Ok(SpringParams::from_response(self.response, self.damping_ratio)?)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DurationTokens {
    pub instant: f64,
    pub fast: f64,
    pub normal: f64,
    pub slow: f64,
    pub page: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpringTokens {
    pub snappy: SpringToken,
    pub standard: SpringToken,
    pub gentle: SpringToken,
    pub bouncy: SpringToken,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EasingTokens {
    pub standard: [f64; 4],
    pub enter: [f64; 4],
    pub exit: [f64; 4],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionProfile {
    pub label: String,
    pub description: String,
    /// Durations in milliseconds.
    pub duration: DurationTokens,
    pub spring: SpringTokens,
    pub easing: EasingTokens,
    pub press_scale: f64,
    pub hover_lift: f64,
    pub depth: f64,
    /// Stagger between siblings, milliseconds.
    pub stagger: f64,
    pub parallax: f64,
    pub intensity: f64,
    pub elasticity: f64,
    /// Fling time constant (s).
    pub fling_time_constant: f64,
    /// How much durations grow with travelled distance (context-aware dynamics).
    pub distance_scale: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReducedMotionPolicy {
    pub strategy: String,
    pub max_duration: f64,
    pub allow_spatial: bool,
    pub allow_parallax: bool,
    pub allow_particles: bool,
    pub allow_scale: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profiles {
    pub schema_version: u32,
    pub default: String,
    pub profiles: BTreeMap<String, MotionProfile>,
    pub reduced_motion: ReducedMotionPolicy,
}

/// Canonical profile names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileName {
    Minimal,
    Professional,
    Cinematic,
    Dynamic,
    Fluid,
    Sport,
    Elegant,
    UltraResponsive,
    Singularity,
}

impl ProfileName {
    pub const ALL: [ProfileName; 9] = [
        ProfileName::Minimal,
        ProfileName::Professional,
        ProfileName::Cinematic,
        ProfileName::Dynamic,
        ProfileName::Fluid,
        ProfileName::Sport,
        ProfileName::Elegant,
        ProfileName::UltraResponsive,
        ProfileName::Singularity,
    ];
    pub fn key(self) -> &'static str {
        match self {
            ProfileName::Minimal => "minimal",
            ProfileName::Professional => "professional",
            ProfileName::Cinematic => "cinematic",
            ProfileName::Dynamic => "dynamic",
            ProfileName::Fluid => "fluid",
            ProfileName::Sport => "sport",
            ProfileName::Elegant => "elegant",
            ProfileName::UltraResponsive => "ultraResponsive",
            ProfileName::Singularity => "singularity",
        }
    }
}

impl Profiles {
    /// Loads the embedded built-in profiles.
    pub fn builtin() -> Self {
        // The embedded JSON is validated by tests; failure here is a build defect.
        Self::from_json(BUILTIN).unwrap_or_else(|e| panic!("embedded profiles.json is invalid: {e}"))
    }

    pub fn from_json(json: &str) -> Result<Self, CoreError> {
        let p: Profiles = serde_json::from_str(json).map_err(|e| CoreError::Token(e.to_string()))?;
        p.validate()?;
        Ok(p)
    }

    pub fn get(&self, name: &str) -> Result<&MotionProfile, CoreError> {
        self.profiles.get(name).ok_or_else(|| CoreError::UnknownProfile(name.to_string()))
    }

    pub fn validate(&self) -> Result<(), CoreError> {
        if !self.profiles.contains_key(&self.default) {
            return Err(CoreError::UnknownProfile(self.default.clone()));
        }
        for (name, p) in &self.profiles {
            p.validate().map_err(|e| CoreError::Token(format!("profile `{name}`: {e}")))?;
        }
        Ok(())
    }
}

impl MotionProfile {
    pub fn validate(&self) -> Result<(), CoreError> {
        let d = &self.duration;
        if !(d.instant <= d.fast && d.fast < d.normal && d.normal < d.slow && d.slow <= d.page) {
            return Err(CoreError::Token("durations must increase instant ≤ fast < normal < slow ≤ page".into()));
        }
        let s = &self.spring;
        if !(s.snappy.response <= s.standard.response && s.standard.response <= s.gentle.response) {
            return Err(CoreError::Token("spring responses must increase snappy ≤ standard ≤ gentle".into()));
        }
        for t in [s.snappy, s.standard, s.gentle, s.bouncy] {
            t.params()?;
            if !(0.3..=1.5).contains(&t.damping_ratio) {
                return Err(CoreError::Token("damping ratios must be within [0.3, 1.5]".into()));
            }
        }
        for e in [self.easing.standard, self.easing.enter, self.easing.exit] {
            Easing::cubic(e[0], e[1], e[2], e[3])?;
        }
        let unit = |name: &str, v: f64| {
            if (0.0..=1.0).contains(&v) {
                Ok(())
            } else {
                Err(CoreError::Token(format!("{name} must be within [0, 1]")))
            }
        };
        unit("intensity", self.intensity)?;
        unit("parallax", self.parallax)?;
        unit("elasticity", self.elasticity)?;
        unit("distanceScale", self.distance_scale)?;
        if !(0.8..=1.0).contains(&self.press_scale) {
            return Err(CoreError::Token("pressScale must be within [0.8, 1]".into()));
        }
        Ok(())
    }

    pub fn spring(&self, name: &str) -> Result<SpringParams, CoreError> {
        let t = match name {
            "snappy" => self.spring.snappy,
            "standard" | "default" => self.spring.standard,
            "gentle" => self.spring.gentle,
            "bouncy" => self.spring.bouncy,
            other => return Err(CoreError::Token(format!("unknown spring token `{other}`"))),
        };
        t.params()
    }

    pub fn duration_ms(&self, name: &str) -> Result<f64, CoreError> {
        let d = &self.duration;
        Ok(match name {
            "instant" => d.instant,
            "fast" => d.fast,
            "normal" => d.normal,
            "slow" => d.slow,
            "page" => d.page,
            other => return Err(CoreError::Token(format!("unknown duration token `{other}`"))),
        })
    }

    pub fn easing(&self, name: &str) -> Result<Easing, CoreError> {
        let e = match name {
            "standard" => self.easing.standard,
            "enter" => self.easing.enter,
            "exit" => self.easing.exit,
            other => return Err(CoreError::Token(format!("unknown easing token `{other}`"))),
        };
        Easing::cubic(e[0], e[1], e[2], e[3])
    }

    /// Context-aware duration: grows logarithmically with travelled distance (px).
    pub fn duration_for_distance(&self, base_ms: f64, distance: f64) -> f64 {
        base_ms * (1.0 + self.distance_scale * libm::log(1.0 + distance.abs() / 200.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_profiles_are_valid_and_complete() {
        let p = Profiles::builtin();
        for name in ProfileName::ALL {
            p.get(name.key()).unwrap();
        }
        assert_eq!(p.profiles.len(), 9);
        assert!(p.get("nope").is_err());
    }

    #[test]
    fn minimal_never_overshoots() {
        let p = Profiles::builtin();
        let m = p.get("minimal").unwrap();
        for t in [m.spring.snappy, m.spring.standard, m.spring.gentle, m.spring.bouncy] {
            assert!(t.damping_ratio >= 1.0);
        }
    }

    #[test]
    fn ultra_responsive_is_fastest() {
        let p = Profiles::builtin();
        let ur = p.get("ultraResponsive").unwrap();
        for (name, prof) in &p.profiles {
            if name != "ultraResponsive" {
                assert!(ur.duration.normal <= prof.duration.normal, "{name}");
                assert!(ur.spring.standard.response <= prof.spring.standard.response, "{name}");
            }
        }
    }

    #[test]
    fn distance_scaling_is_monotonic() {
        let p = Profiles::builtin();
        let c = p.get("cinematic").unwrap();
        assert_eq!(c.duration_for_distance(300.0, 0.0), 300.0);
        assert!(c.duration_for_distance(300.0, 800.0) > c.duration_for_distance(300.0, 100.0));
    }

    #[test]
    fn rejects_bad_profile() {
        let mut p = Profiles::builtin();
        p.profiles.get_mut("minimal").unwrap().duration.fast = 999.0;
        assert!(p.validate().is_err());
    }
}
