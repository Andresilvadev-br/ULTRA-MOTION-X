//! Visual effects with fidelity-aware scaling. Decorative effects are dropped first.

use serde::{Deserialize, Serialize};
use umx_scheduler::fidelity::FidelitySettings;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Effect {
    Blur {
        radius: f64,
    },
    BackdropBlur {
        radius: f64,
    },
    Shadow {
        x: f64,
        y: f64,
        blur: f64,
        opacity: f64,
    },
    /// Pointer-driven specular highlight.
    Lighting {
        intensity: f64,
        x: f64,
        y: f64,
    },
    /// Shader material (glass, ripple, gradient, refraction…); requires shader support.
    Material {
        id: u32,
        intensity: f64,
    },
}

impl Effect {
    pub fn is_decorative(&self) -> bool {
        matches!(self, Effect::Lighting { .. } | Effect::Material { .. })
    }

    /// Extra pixels the effect paints outside the layer bounds (for damage tracking).
    pub fn outset(&self) -> f64 {
        match self {
            Effect::Blur { radius } | Effect::BackdropBlur { radius } => radius * 2.0,
            Effect::Shadow { x, y, blur, .. } => blur * 2.0 + x.abs().max(y.abs()),
            _ => 0.0,
        }
    }

    /// Returns the effect adjusted to the fidelity settings, or `None` if it must be skipped.
    pub fn scaled(&self, f: &FidelitySettings) -> Option<Effect> {
        match *self {
            Effect::Blur { radius } => (f.blur > 0.0).then_some(Effect::Blur {
                radius: radius * f.blur,
            }),
            Effect::BackdropBlur { radius } => (f.blur > 0.0).then_some(Effect::BackdropBlur {
                radius: radius * f.blur,
            }),
            Effect::Shadow {
                x,
                y,
                blur,
                opacity,
            } => f.shadows.then_some(Effect::Shadow {
                x,
                y,
                blur: blur * f.blur.max(0.5),
                opacity,
            }),
            Effect::Lighting { intensity, x, y } => {
                f.lighting.then_some(Effect::Lighting { intensity, x, y })
            }
            Effect::Material { id, intensity } => {
                f.shaders.then_some(Effect::Material { id, intensity })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fidelity_scaling() {
        let low = FidelitySettings::for_level(0);
        let high = FidelitySettings::for_level(4);
        let blur = Effect::Blur { radius: 10.0 };
        assert!(blur.scaled(&low).is_none());
        assert_eq!(blur.scaled(&high), Some(Effect::Blur { radius: 10.0 }));
        let mat = Effect::Material {
            id: 1,
            intensity: 0.5,
        };
        assert!(mat.scaled(&FidelitySettings::for_level(1)).is_none());
        assert!(mat.is_decorative());
    }
}
