//! Thermal & power awareness. Only signals that the platform actually reports are used;
//! unknown signals (`None`) never restrict anything and are never fabricated.

use crate::fidelity::{FidelityLevel, MAX_LEVEL};
use serde::{Deserialize, Serialize};

/// Compute-pressure states as reported by platforms that expose them (e.g. the Web
/// Compute Pressure API: nominal / fair / serious / critical).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Pressure {
    Nominal,
    Fair,
    Serious,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PowerSignals {
    pub visible: Option<bool>,
    pub focused: Option<bool>,
    pub battery_level: Option<f64>,
    pub charging: Option<bool>,
    pub power_saver: Option<bool>,
    pub pressure: Option<Pressure>,
    pub reduced_motion: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerPolicy {
    /// Stop requesting frames entirely (content not visible).
    pub suspend: bool,
    pub pause_decorative: bool,
    pub max_fidelity: FidelityLevel,
    /// Upper bound for decorative update rate (Hz), `None` = refresh rate.
    pub decorative_hz: Option<f64>,
    pub reasons: [Option<&'static str>; 4],
}

impl PowerPolicy {
    pub fn from_signals(s: &PowerSignals) -> Self {
        let mut p = PowerPolicy {
            suspend: false,
            pause_decorative: false,
            max_fidelity: MAX_LEVEL,
            decorative_hz: None,
            reasons: [None; 4],
        };
        let mut r = 0;
        let mut why = |p: &mut PowerPolicy, msg: &'static str| {
            if r < 4 {
                p.reasons[r] = Some(msg);
                r += 1;
            }
        };
        if s.visible == Some(false) {
            p.suspend = true;
            p.pause_decorative = true;
            why(&mut p, "not visible");
        }
        let low_battery =
            matches!((s.battery_level, s.charging), (Some(l), Some(false)) if l < 0.2);
        if s.power_saver == Some(true) || low_battery {
            p.max_fidelity = p.max_fidelity.min(2);
            p.decorative_hz = Some(30.0);
            why(
                &mut p,
                if low_battery {
                    "low battery"
                } else {
                    "power saver"
                },
            );
        }
        match s.pressure {
            Some(Pressure::Serious) => {
                p.max_fidelity = p.max_fidelity.min(1);
                p.decorative_hz = Some(p.decorative_hz.unwrap_or(30.0).min(30.0));
                why(&mut p, "serious compute pressure");
            }
            Some(Pressure::Critical) => {
                p.max_fidelity = 0;
                p.pause_decorative = true;
                why(&mut p, "critical compute pressure");
            }
            _ => {}
        }
        if s.reduced_motion == Some(true) {
            p.pause_decorative = true;
            why(&mut p, "reduced motion");
        }
        p
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_signals_do_not_restrict() {
        let p = PowerPolicy::from_signals(&PowerSignals::default());
        assert!(!p.suspend && !p.pause_decorative);
        assert_eq!(p.max_fidelity, MAX_LEVEL);
        assert!(p.decorative_hz.is_none());
    }

    #[test]
    fn hidden_suspends() {
        let p = PowerPolicy::from_signals(&PowerSignals {
            visible: Some(false),
            ..Default::default()
        });
        assert!(p.suspend);
    }

    #[test]
    fn battery_and_pressure() {
        let p = PowerPolicy::from_signals(&PowerSignals {
            battery_level: Some(0.1),
            charging: Some(false),
            ..Default::default()
        });
        assert_eq!(p.max_fidelity, 2);
        let charging = PowerPolicy::from_signals(&PowerSignals {
            battery_level: Some(0.1),
            charging: Some(true),
            ..Default::default()
        });
        assert_eq!(charging.max_fidelity, MAX_LEVEL);
        let crit = PowerPolicy::from_signals(&PowerSignals {
            pressure: Some(Pressure::Critical),
            ..Default::default()
        });
        assert_eq!(crit.max_fidelity, 0);
        assert!(crit.pause_decorative);
    }
}
