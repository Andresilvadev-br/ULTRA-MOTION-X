//! Animation generators. A generator is created from a spec plus the starting value,
//! target and velocity, and is then sampled with elapsed time. Generators are pure, which
//! makes them deterministic, scrubbable and trivially retargetable.

use crate::easing::Easing;
use crate::error::CoreError;
use crate::keyframes::Keyframes;
use serde::{Deserialize, Serialize};
use umx_physics::{Decay, DecayParams, Inertia, InertiaParams, Spring, SpringParams};

/// Declarative description of how to animate a value. Times are in **seconds**.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AnimationSpec {
    Tween {
        duration: f64,
        #[serde(default)]
        easing: Easing,
        #[serde(default)]
        delay: f64,
    },
    Spring {
        #[serde(default)]
        spring: SpringParams,
        #[serde(default)]
        delay: f64,
    },
    Decay {
        #[serde(default)]
        decay: DecayParams,
    },
    Inertia {
        #[serde(default)]
        inertia: InertiaParams,
    },
    Keyframes {
        keyframes: Keyframes,
        duration: f64,
        #[serde(default)]
        delay: f64,
    },
    /// Jump immediately (used for reduced motion and snapping).
    Instant,
}

impl AnimationSpec {
    pub fn spring(params: SpringParams) -> Self {
        AnimationSpec::Spring {
            spring: params,
            delay: 0.0,
        }
    }
    pub fn tween(duration: f64, easing: Easing) -> Self {
        AnimationSpec::Tween {
            duration,
            easing,
            delay: 0.0,
        }
    }
    pub fn delay(&self) -> f64 {
        match self {
            AnimationSpec::Tween { delay, .. }
            | AnimationSpec::Spring { delay, .. }
            | AnimationSpec::Keyframes { delay, .. } => *delay,
            _ => 0.0,
        }
    }
    /// True when the generator honours the initial velocity (physics-based).
    pub fn preserves_velocity(&self) -> bool {
        matches!(
            self,
            AnimationSpec::Spring { .. }
                | AnimationSpec::Decay { .. }
                | AnimationSpec::Inertia { .. }
        )
    }
    pub fn validate(&self) -> Result<(), CoreError> {
        let check_time = |name: &str, v: f64| {
            if v.is_finite() && (0.0..=3600.0).contains(&v) {
                Ok(())
            } else {
                Err(CoreError::InvalidTimeline(format!(
                    "{name} must be within [0, 3600] s, got {v}"
                )))
            }
        };
        match self {
            AnimationSpec::Tween {
                duration,
                easing,
                delay,
            } => {
                check_time("duration", *duration)?;
                check_time("delay", *delay)?;
                easing.validate()
            }
            AnimationSpec::Spring { spring, delay } => {
                check_time("delay", *delay)?;
                spring.validate().map_err(CoreError::from)
            }
            AnimationSpec::Decay { decay } => decay.validate().map_err(CoreError::from),
            AnimationSpec::Inertia { inertia } => {
                inertia.decay.validate()?;
                inertia.bounce_spring.validate().map_err(CoreError::from)
            }
            AnimationSpec::Keyframes {
                keyframes,
                duration,
                delay,
            } => {
                check_time("duration", *duration)?;
                check_time("delay", *delay)?;
                keyframes.validate()
            }
            AnimationSpec::Instant => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Sample {
    pub value: f64,
    pub velocity: f64,
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq)]
enum Kind {
    Tween {
        from: f64,
        to: f64,
        duration: f64,
        easing: Easing,
    },
    Spring(Spring),
    Decay(Decay),
    Inertia(Inertia),
    Keyframes {
        kf: Keyframes,
        duration: f64,
    },
    Instant {
        to: f64,
    },
}

/// A running animation curve for a single scalar.
#[derive(Debug, Clone, PartialEq)]
pub struct Generator {
    kind: Kind,
    delay: f64,
    from: f64,
    initial_velocity: f64,
}

impl Generator {
    /// Builds a generator. For `Decay`/`Inertia` the `to` argument is ignored (the physics
    /// decides where the motion ends). For keyframes, `from` replaces the first keyframe if
    /// it is `NaN` ("start from current value").
    pub fn new(spec: &AnimationSpec, from: f64, to: f64, velocity: f64) -> Result<Self, CoreError> {
        spec.validate()?;
        if !from.is_finite() || !velocity.is_finite() {
            return Err(CoreError::InvalidTimeline(
                "from and velocity must be finite".into(),
            ));
        }
        let kind = match spec {
            AnimationSpec::Tween {
                duration, easing, ..
            } => {
                if !to.is_finite() {
                    return Err(CoreError::InvalidTimeline("target must be finite".into()));
                }
                if *duration == 0.0 {
                    Kind::Instant { to }
                } else {
                    Kind::Tween {
                        from,
                        to,
                        duration: *duration,
                        easing: easing.clone(),
                    }
                }
            }
            AnimationSpec::Spring { spring, .. } => {
                Kind::Spring(Spring::new(*spring, from, to, velocity)?)
            }
            AnimationSpec::Decay { decay } => Kind::Decay(Decay::new(*decay, from, velocity)?),
            AnimationSpec::Inertia { inertia } => {
                Kind::Inertia(Inertia::new(inertia, from, velocity)?)
            }
            AnimationSpec::Keyframes {
                keyframes,
                duration,
                ..
            } => {
                let mut kf = keyframes.clone();
                if let Some(first) = kf.values.first_mut() {
                    if first.is_nan() {
                        *first = from;
                    }
                }
                Kind::Keyframes {
                    kf: Keyframes::new(kf.values, kf.offsets, kf.easings)?,
                    duration: *duration,
                }
            }
            AnimationSpec::Instant => Kind::Instant { to },
        };
        Ok(Self {
            kind,
            delay: spec.delay(),
            from,
            initial_velocity: velocity,
        })
    }

    /// Total duration including delay; may be infinite for undamped springs.
    pub fn duration(&self) -> f64 {
        self.delay
            + match &self.kind {
                Kind::Tween { duration, .. } | Kind::Keyframes { duration, .. } => *duration,
                Kind::Spring(s) => s.finish_time(),
                Kind::Decay(d) => d.finish_time(),
                Kind::Inertia(i) => i.finish_time(),
                Kind::Instant { .. } => 0.0,
            }
    }

    /// Final value of the animation.
    pub fn target(&self) -> f64 {
        match &self.kind {
            Kind::Tween { to, .. } | Kind::Instant { to } => *to,
            Kind::Spring(s) => s.to(),
            Kind::Decay(d) => d.sample(f64::INFINITY).0.position,
            Kind::Inertia(i) => i.target(),
            Kind::Keyframes { kf, .. } => *kf.values.last().unwrap_or(&self.from),
        }
    }

    pub fn is_physics(&self) -> bool {
        matches!(
            self.kind,
            Kind::Spring(_) | Kind::Decay(_) | Kind::Inertia(_)
        )
    }

    /// Samples at elapsed time `t` seconds since the generator started (delay included).
    pub fn sample(&self, t: f64) -> Sample {
        let t = if t.is_nan() { 0.0 } else { t };
        if t < self.delay {
            return Sample {
                value: self.from,
                velocity: 0.0,
                done: false,
            };
        }
        let lt = t - self.delay;
        match &self.kind {
            Kind::Instant { to } => Sample {
                value: *to,
                velocity: 0.0,
                done: true,
            },
            Kind::Tween {
                from,
                to,
                duration,
                easing,
            } => {
                if lt >= *duration {
                    return Sample {
                        value: *to,
                        velocity: 0.0,
                        done: true,
                    };
                }
                let p = lt / duration;
                Sample {
                    value: from + (to - from) * easing.apply(p),
                    velocity: (to - from) * easing.derivative(p) / duration,
                    done: false,
                }
            }
            Kind::Keyframes { kf, duration } => {
                if lt >= *duration {
                    return Sample {
                        value: kf.sample(1.0).0,
                        velocity: 0.0,
                        done: true,
                    };
                }
                let (v, dv) = kf.sample(lt / duration);
                Sample {
                    value: v,
                    velocity: dv / duration,
                    done: false,
                }
            }
            Kind::Spring(s) => {
                let st = s.sample(lt);
                Sample {
                    value: st.position,
                    velocity: st.velocity,
                    done: st.done,
                }
            }
            Kind::Decay(d) => {
                let (st, done) = d.sample(lt);
                Sample {
                    value: st.position,
                    velocity: st.velocity,
                    done,
                }
            }
            Kind::Inertia(i) => {
                let (st, done) = i.sample(lt);
                Sample {
                    value: st.position,
                    velocity: st.velocity,
                    done,
                }
            }
        }
    }

    /// Momentum-preserving retarget: builds a new generator that starts at this generator's
    /// state at time `t`. If `spec` is physics-based the current velocity carries over.
    pub fn retarget(&self, t: f64, spec: &AnimationSpec, to: f64) -> Result<Generator, CoreError> {
        let s = self.sample(t);
        Generator::new(
            spec,
            s.value,
            to,
            if spec.preserves_velocity() {
                s.velocity
            } else {
                0.0
            },
        )
    }

    pub fn initial_velocity(&self) -> f64 {
        self.initial_velocity
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tween_basics() {
        let g =
            Generator::new(&AnimationSpec::tween(0.5, Easing::Linear), 0.0, 100.0, 0.0).unwrap();
        assert_eq!(g.sample(0.25).value, 50.0);
        assert!((g.sample(0.25).velocity - 200.0).abs() < 1e-9);
        assert!(g.sample(0.5).done);
        assert_eq!(g.duration(), 0.5);
    }

    #[test]
    fn delay_holds_from() {
        let spec = AnimationSpec::Tween {
            duration: 1.0,
            easing: Easing::Linear,
            delay: 0.2,
        };
        let g = Generator::new(&spec, 5.0, 10.0, 0.0).unwrap();
        assert_eq!(g.sample(0.1).value, 5.0);
        assert!((g.sample(0.7).value - 7.5).abs() < 1e-9);
        assert!((g.duration() - 1.2).abs() < 1e-12);
    }

    #[test]
    fn tween_to_spring_handoff_preserves_velocity() {
        let tween =
            Generator::new(&AnimationSpec::tween(1.0, Easing::Linear), 0.0, 100.0, 0.0).unwrap();
        let spring = tween
            .retarget(0.5, &AnimationSpec::spring(SpringParams::default()), 0.0)
            .unwrap();
        let s = spring.sample(0.0);
        assert!((s.value - 50.0).abs() < 1e-9);
        assert!((s.velocity - 100.0).abs() < 1e-9);
    }

    #[test]
    fn keyframes_from_current() {
        let kf = Keyframes {
            values: vec![f64::NAN, 1.0],
            offsets: vec![],
            easings: vec![],
        };
        let g = Generator::new(
            &AnimationSpec::Keyframes {
                keyframes: kf,
                duration: 1.0,
                delay: 0.0,
            },
            0.4,
            0.0,
            0.0,
        )
        .unwrap();
        assert!((g.sample(0.0).value - 0.4).abs() < 1e-12);
        assert_eq!(g.target(), 1.0);
    }

    #[test]
    fn spec_serde() {
        let json = r#"{"type":"spring","spring":{"stiffness":300,"damping":20}}"#;
        let s: AnimationSpec = serde_json::from_str(json).unwrap();
        match s {
            AnimationSpec::Spring { spring, .. } => {
                assert_eq!(spring.stiffness, 300.0);
                assert_eq!(spring.mass, 1.0);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn invalid_specs() {
        assert!(
            Generator::new(&AnimationSpec::tween(-1.0, Easing::Linear), 0.0, 1.0, 0.0).is_err()
        );
        assert!(Generator::new(
            &AnimationSpec::tween(1.0, Easing::Linear),
            f64::NAN,
            1.0,
            0.0
        )
        .is_err());
    }
}
