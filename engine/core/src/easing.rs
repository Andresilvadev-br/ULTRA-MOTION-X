//! Easing curves mapping linear progress `p ∈ [0, 1]` to eased progress.

use crate::error::CoreError;
use serde::{Deserialize, Serialize};

/// An easing curve. Serialised as `{"type": "...", ...}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Easing {
    Linear,
    /// CSS-compatible cubic Bézier with control points `(x1, y1)`, `(x2, y2)`; x ∈ [0, 1].
    CubicBezier {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
    /// CSS `steps(n, jump-end | jump-start)`.
    Steps {
        count: u32,
        jump_start: bool,
    },
    /// CSS `linear()` style piecewise-linear curve with evenly spaced points.
    Points {
        values: Vec<f64>,
    },
}

impl Default for Easing {
    fn default() -> Self {
        Easing::standard()
    }
}

impl Easing {
    pub fn cubic(x1: f64, y1: f64, x2: f64, y2: f64) -> Result<Self, CoreError> {
        let e = Easing::CubicBezier { x1, y1, x2, y2 };
        e.validate()?;
        Ok(e)
    }
    pub fn standard() -> Self {
        Easing::CubicBezier {
            x1: 0.2,
            y1: 0.0,
            x2: 0.0,
            y2: 1.0,
        }
    }

    /// Resolves CSS / platform names.
    pub fn named(name: &str) -> Option<Self> {
        let (x1, y1, x2, y2) = match name {
            "linear" => return Some(Easing::Linear),
            "ease" => (0.25, 0.1, 0.25, 1.0),
            "easeIn" | "ease-in" => (0.42, 0.0, 1.0, 1.0),
            "easeOut" | "ease-out" => (0.0, 0.0, 0.58, 1.0),
            "easeInOut" | "ease-in-out" => (0.42, 0.0, 0.58, 1.0),
            "standard" => (0.2, 0.0, 0.0, 1.0),
            "emphasized" => (0.05, 0.7, 0.1, 1.0),
            "decelerate" => (0.0, 0.0, 0.2, 1.0),
            "accelerate" => (0.4, 0.0, 1.0, 1.0),
            "backOut" => (0.34, 1.56, 0.64, 1.0),
            "backIn" => (0.36, 0.0, 0.66, -0.56),
            "circOut" => (0.0, 0.55, 0.45, 1.0),
            "expoOut" => (0.16, 1.0, 0.3, 1.0),
            "stepEnd" | "step-end" => {
                return Some(Easing::Steps {
                    count: 1,
                    jump_start: false,
                })
            }
            "stepStart" | "step-start" => {
                return Some(Easing::Steps {
                    count: 1,
                    jump_start: true,
                })
            }
            _ => return None,
        };
        Some(Easing::CubicBezier { x1, y1, x2, y2 })
    }

    pub fn validate(&self) -> Result<(), CoreError> {
        match self {
            Easing::Linear => Ok(()),
            Easing::CubicBezier { x1, y1, x2, y2 } => {
                if ![x1, y1, x2, y2].iter().all(|v| v.is_finite()) {
                    return Err(CoreError::InvalidEasing(
                        "bezier control points must be finite".into(),
                    ));
                }
                if !(0.0..=1.0).contains(x1) || !(0.0..=1.0).contains(x2) {
                    return Err(CoreError::InvalidEasing(
                        "bezier x1/x2 must be within [0, 1]".into(),
                    ));
                }
                Ok(())
            }
            Easing::Steps { count, .. } => {
                if *count == 0 {
                    Err(CoreError::InvalidEasing("steps count must be ≥ 1".into()))
                } else {
                    Ok(())
                }
            }
            Easing::Points { values } => {
                if values.len() < 2 || values.iter().any(|v| !v.is_finite()) {
                    Err(CoreError::InvalidEasing(
                        "linear() needs ≥ 2 finite points".into(),
                    ))
                } else {
                    Ok(())
                }
            }
        }
    }

    /// Eased progress for linear progress `p` (clamped to [0, 1]).
    pub fn apply(&self, p: f64) -> f64 {
        let p = if p.is_nan() { 0.0 } else { p.clamp(0.0, 1.0) };
        match self {
            Easing::Linear => p,
            Easing::CubicBezier { x1, y1, x2, y2 } => {
                if p == 0.0 || p == 1.0 {
                    return p;
                }
                let t = solve_bezier_x(p, *x1, *x2);
                bezier(t, *y1, *y2)
            }
            Easing::Steps { count, jump_start } => {
                let n = f64::from(*count);
                let mut step = libm::floor(p * n);
                if *jump_start {
                    step += 1.0;
                }
                if p >= 1.0 {
                    return 1.0;
                }
                (step / n).clamp(0.0, 1.0)
            }
            Easing::Points { values } => {
                let n = values.len() - 1;
                let x = p * n as f64;
                let i = (libm::floor(x) as usize).min(n - 1);
                let f = x - i as f64;
                values[i] + (values[i + 1] - values[i]) * f
            }
        }
    }

    /// d(eased)/d(p): used to compute tween velocity for momentum hand-off.
    pub fn derivative(&self, p: f64) -> f64 {
        let p = p.clamp(0.0, 1.0);
        match self {
            Easing::Linear => 1.0,
            Easing::CubicBezier { x1, y1, x2, y2 } => {
                let t = solve_bezier_x(p, *x1, *x2);
                let dx = bezier_d(t, *x1, *x2);
                if dx.abs() < 1e-12 {
                    0.0
                } else {
                    bezier_d(t, *y1, *y2) / dx
                }
            }
            Easing::Steps { .. } => 0.0,
            Easing::Points { values } => {
                let n = values.len() - 1;
                let i = (libm::floor(p * n as f64) as usize).min(n - 1);
                (values[i + 1] - values[i]) * n as f64
            }
        }
    }

    /// Serialises to a CSS easing string (used by the Web compositor path).
    pub fn to_css(&self) -> String {
        match self {
            Easing::Linear => "linear".into(),
            Easing::CubicBezier { x1, y1, x2, y2 } => {
                format!("cubic-bezier({x1}, {y1}, {x2}, {y2})")
            }
            Easing::Steps { count, jump_start } => {
                format!(
                    "steps({count}, {})",
                    if *jump_start {
                        "jump-start"
                    } else {
                        "jump-end"
                    }
                )
            }
            Easing::Points { values } => {
                let parts: Vec<String> = values
                    .iter()
                    .map(|v| format!("{}", (v * 10000.0).round() / 10000.0))
                    .collect();
                format!("linear({})", parts.join(", "))
            }
        }
    }
}

#[inline]
fn bezier(t: f64, p1: f64, p2: f64) -> f64 {
    // B(t) with P0 = 0, P3 = 1.
    let u = 1.0 - t;
    3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t
}

#[inline]
fn bezier_d(t: f64, p1: f64, p2: f64) -> f64 {
    let u = 1.0 - t;
    3.0 * u * u * p1 + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2)
}

/// Solves `B_x(t) = x` with Newton–Raphson, falling back to bisection.
fn solve_bezier_x(x: f64, x1: f64, x2: f64) -> f64 {
    let mut t = x;
    for _ in 0..8 {
        let err = bezier(t, x1, x2) - x;
        if err.abs() < 1e-9 {
            return t;
        }
        let d = bezier_d(t, x1, x2);
        if d.abs() < 1e-7 {
            break;
        }
        t -= err / d;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    t = x;
    for _ in 0..60 {
        let v = bezier(t, x1, x2);
        if (v - x).abs() < 1e-10 {
            break;
        }
        if v < x {
            lo = t;
        } else {
            hi = t;
        }
        t = 0.5 * (lo + hi);
    }
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints() {
        for name in [
            "linear",
            "ease",
            "easeIn",
            "easeOut",
            "easeInOut",
            "standard",
            "backOut",
        ] {
            let e = Easing::named(name).unwrap();
            assert_eq!(e.apply(0.0), 0.0, "{name}");
            assert_eq!(e.apply(1.0), 1.0, "{name}");
        }
    }

    #[test]
    fn linear_bezier_is_identity() {
        let e = Easing::cubic(0.25, 0.25, 0.75, 0.75).unwrap();
        for i in 0..=20 {
            let p = i as f64 / 20.0;
            assert!((e.apply(p) - p).abs() < 1e-7);
        }
    }

    #[test]
    fn ease_known_value() {
        // CSS `ease` at 0.5 ≈ 0.8024 (reference value from browser implementations).
        let e = Easing::named("ease").unwrap();
        assert!((e.apply(0.5) - 0.8024).abs() < 1e-3);
    }

    #[test]
    fn derivative_matches_finite_difference() {
        let e = Easing::named("easeInOut").unwrap();
        for p in [0.1, 0.3, 0.5, 0.8] {
            let h = 1e-6;
            let fd = (e.apply(p + h) - e.apply(p - h)) / (2.0 * h);
            assert!((e.derivative(p) - fd).abs() < 1e-3, "p={p}");
        }
    }

    #[test]
    fn steps_and_points() {
        let s = Easing::Steps {
            count: 4,
            jump_start: false,
        };
        assert_eq!(s.apply(0.3), 0.25);
        let l = Easing::Points {
            values: vec![0.0, 1.2, 1.0],
        };
        assert!((l.apply(0.5) - 1.2).abs() < 1e-12);
        assert!(l.to_css().starts_with("linear("));
    }

    #[test]
    fn rejects_invalid() {
        assert!(Easing::cubic(1.5, 0.0, 0.5, 1.0).is_err());
        assert!(Easing::Steps {
            count: 0,
            jump_start: false
        }
        .validate()
        .is_err());
    }

    #[test]
    fn serde_roundtrip() {
        let e = Easing::named("ease").unwrap();
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("cubicBezier"));
        let back: Easing = serde_json::from_str(&s).unwrap();
        assert_eq!(e, back);
    }
}
