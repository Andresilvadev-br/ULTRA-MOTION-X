//! Particle field: capacity-bounded particle simulation with emitters and force fields.
//!
//! Storage is structure-of-arrays (cache-friendly, zero allocations per step after
//! construction). Emission is scaled by a fidelity factor so the adaptive quality engine can
//! reduce cost. A field with no live particles and no active emitter reports `is_idle()` so
//! hosts can stop their frame loop entirely.

use crate::error::{check_range, PhysicsError};
use crate::integrator::FixedStepper;
use crate::math;
use crate::rng::Pcg32;

pub const MAX_PARTICLES: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Force {
    Gravity { x: f64, y: f64 },
    /// Linear velocity dissipation (1/s).
    Drag { coefficient: f64 },
    /// Point attractor (`strength` > 0) or repulsor (< 0) with linear falloff.
    Point { x: f64, y: f64, strength: f64, radius: f64 },
    /// Swirl around a point.
    Vortex { x: f64, y: f64, strength: f64, radius: f64 },
    /// Deterministic value-noise turbulence.
    Turbulence { strength: f64, scale: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Emitter {
    pub x: f64,
    pub y: f64,
    /// Particles per second (continuous emission).
    pub rate: f64,
    /// Emission direction (radians) and spread (radians, full cone).
    pub direction: f64,
    pub spread: f64,
    pub speed_min: f64,
    pub speed_max: f64,
    pub life_min: f64,
    pub life_max: f64,
    pub size_min: f64,
    pub size_max: f64,
    pub active: bool,
}

impl Default for Emitter {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            rate: 60.0,
            direction: -core::f64::consts::FRAC_PI_2,
            spread: core::f64::consts::FRAC_PI_3,
            speed_min: 40.0,
            speed_max: 120.0,
            life_min: 0.6,
            life_max: 1.4,
            size_min: 2.0,
            size_max: 5.0,
            active: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParticleField {
    capacity: usize,
    x: Vec<f32>,
    y: Vec<f32>,
    vx: Vec<f32>,
    vy: Vec<f32>,
    age: Vec<f32>,
    life: Vec<f32>,
    size: Vec<f32>,
    alive: usize,
    pub emitters: Vec<Emitter>,
    pub forces: Vec<Force>,
    /// Fidelity factor in [0, 1] applied to emission rates.
    pub fidelity: f64,
    emit_accumulators: Vec<f64>,
    rng: Pcg32,
    stepper: FixedStepper,
}

impl ParticleField {
    pub fn new(capacity: usize, seed: u64) -> Result<Self, PhysicsError> {
        if capacity > MAX_PARTICLES {
            return Err(PhysicsError::CapacityExceeded { requested: capacity, limit: MAX_PARTICLES });
        }
        Ok(Self {
            capacity,
            x: vec![0.0; capacity],
            y: vec![0.0; capacity],
            vx: vec![0.0; capacity],
            vy: vec![0.0; capacity],
            age: vec![0.0; capacity],
            life: vec![0.0; capacity],
            size: vec![0.0; capacity],
            alive: 0,
            emitters: Vec::new(),
            forces: Vec::new(),
            fidelity: 1.0,
            emit_accumulators: Vec::new(),
            rng: Pcg32::new(seed),
            stepper: FixedStepper::new(1.0 / 120.0, 32),
        })
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }
    pub fn alive(&self) -> usize {
        self.alive
    }

    pub fn add_emitter(&mut self, e: Emitter) -> Result<usize, PhysicsError> {
        check_range("rate", e.rate, 0.0, 1e6)?;
        check_range("life_max", e.life_max, 0.0, 1e4)?;
        self.emitters.push(e);
        self.emit_accumulators.push(0.0);
        Ok(self.emitters.len() - 1)
    }

    /// True when nothing is alive and nothing will be emitted: hosts may stop ticking.
    pub fn is_idle(&self) -> bool {
        self.alive == 0 && !self.emitters.iter().any(|e| e.active && e.rate > 0.0)
    }

    /// Emits `count` particles immediately from emitter `index` (bounded by capacity).
    pub fn burst(&mut self, index: usize, count: usize) -> usize {
        let Some(e) = self.emitters.get(index).copied() else { return 0 };
        let mut n = 0;
        for _ in 0..count {
            if !self.spawn(&e) {
                break;
            }
            n += 1;
        }
        n
    }

    fn spawn(&mut self, e: &Emitter) -> bool {
        if self.alive >= self.capacity {
            return false;
        }
        let i = self.alive;
        let angle = e.direction + (self.rng.next_f64() - 0.5) * e.spread;
        let speed = self.rng.range(e.speed_min, e.speed_max);
        self.x[i] = e.x as f32;
        self.y[i] = e.y as f32;
        self.vx[i] = (math::cos(angle) * speed) as f32;
        self.vy[i] = (math::sin(angle) * speed) as f32;
        self.age[i] = 0.0;
        self.life[i] = self.rng.range(e.life_min, e.life_max).max(1e-3) as f32;
        self.size[i] = self.rng.range(e.size_min, e.size_max) as f32;
        self.alive += 1;
        true
    }

    pub fn advance(&mut self, dt: f64) -> u32 {
        let (n, _) = self.stepper.advance(dt);
        for _ in 0..n {
            self.step_fixed();
        }
        n
    }

    pub fn step_fixed(&mut self) {
        let h = self.stepper.step();
        // Emission.
        let fidelity = self.fidelity.clamp(0.0, 1.0);
        for k in 0..self.emitters.len() {
            let e = self.emitters[k];
            if !e.active {
                continue;
            }
            self.emit_accumulators[k] += e.rate * fidelity * h;
            while self.emit_accumulators[k] >= 1.0 {
                self.emit_accumulators[k] -= 1.0;
                if !self.spawn(&e) {
                    self.emit_accumulators[k] = 0.0;
                    break;
                }
            }
        }
        // Integration.
        let hf = h as f32;
        let mut i = 0;
        while i < self.alive {
            self.age[i] += hf;
            if self.age[i] >= self.life[i] {
                self.kill(i);
                continue;
            }
            let (px, py) = (f64::from(self.x[i]), f64::from(self.y[i]));
            let (mut ax, mut ay) = (0.0f64, 0.0f64);
            for f in &self.forces {
                match *f {
                    Force::Gravity { x, y } => {
                        ax += x;
                        ay += y;
                    }
                    Force::Drag { coefficient } => {
                        ax -= coefficient * f64::from(self.vx[i]);
                        ay -= coefficient * f64::from(self.vy[i]);
                    }
                    Force::Point { x, y, strength, radius } => {
                        let (dx, dy) = (x - px, y - py);
                        let d = math::hypot(dx, dy);
                        if d > 1e-6 && d < radius {
                            let s = strength * (1.0 - d / radius);
                            ax += s * dx / d;
                            ay += s * dy / d;
                        }
                    }
                    Force::Vortex { x, y, strength, radius } => {
                        let (dx, dy) = (px - x, py - y);
                        let d = math::hypot(dx, dy);
                        if d > 1e-6 && d < radius {
                            let s = strength * (1.0 - d / radius);
                            ax += -s * dy / d;
                            ay += s * dx / d;
                        }
                    }
                    Force::Turbulence { strength, scale } => {
                        let s = scale.max(1e-6);
                        ax += strength * value_noise(px / s, py / s, 0.0);
                        ay += strength * value_noise(px / s, py / s, 17.0);
                    }
                }
            }
            self.vx[i] += (ax * h) as f32;
            self.vy[i] += (ay * h) as f32;
            self.x[i] += self.vx[i] * hf;
            self.y[i] += self.vy[i] * hf;
            i += 1;
        }
    }

    fn kill(&mut self, i: usize) {
        let last = self.alive - 1;
        self.x.swap(i, last);
        self.y.swap(i, last);
        self.vx.swap(i, last);
        self.vy.swap(i, last);
        self.age.swap(i, last);
        self.life.swap(i, last);
        self.size.swap(i, last);
        self.alive -= 1;
    }

    pub fn clear(&mut self) {
        self.alive = 0;
    }

    /// Writes `[x, y, size, alpha]` per live particle into `out`; returns particles written.
    pub fn write_render_buffer(&self, out: &mut [f32]) -> usize {
        let n = self.alive.min(out.len() / 4);
        for i in 0..n {
            let t = self.age[i] / self.life[i];
            out[i * 4] = self.x[i];
            out[i * 4 + 1] = self.y[i];
            out[i * 4 + 2] = self.size[i];
            out[i * 4 + 3] = (1.0 - t).clamp(0.0, 1.0);
        }
        n
    }
}

/// Smooth deterministic 2D value noise in [-1, 1].
pub fn value_noise(x: f64, y: f64, seed: f64) -> f64 {
    let hash = |ix: i64, iy: i64| -> f64 {
        let mut h = (ix as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ (iy as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
        h ^= (seed.to_bits()).wrapping_mul(0x1656_67B1_9E37_79F9);
        h ^= h >> 31;
        h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        h ^= h >> 29;
        (h >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    };
    let (fx, fy) = (libm::floor(x), libm::floor(y));
    let (ix, iy) = (fx as i64, fy as i64);
    let (tx, ty) = (x - fx, y - fy);
    let (sx, sy) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
    let a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * sx;
    let b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * sx;
    a + (b - a) * sy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capacity_is_respected() {
        let mut f = ParticleField::new(100, 1).unwrap();
        let e = f.add_emitter(Emitter { rate: 100_000.0, life_min: 10.0, life_max: 10.0, ..Emitter::default() }).unwrap();
        for _ in 0..60 {
            f.advance(1.0 / 60.0);
        }
        assert_eq!(f.alive(), 100);
        assert_eq!(f.burst(e, 10), 0);
        assert!(ParticleField::new(MAX_PARTICLES + 1, 0).is_err());
    }

    #[test]
    fn becomes_idle_after_emitters_stop() {
        let mut f = ParticleField::new(500, 3).unwrap();
        let e = f.add_emitter(Emitter { rate: 0.0, ..Emitter::default() }).unwrap();
        f.burst(e, 50);
        assert!(!f.is_idle());
        for _ in 0..200 {
            f.advance(1.0 / 60.0);
        }
        assert!(f.is_idle());
    }

    #[test]
    fn fidelity_scales_emission() {
        let run = |fid: f64| {
            let mut f = ParticleField::new(10_000, 9).unwrap();
            f.fidelity = fid;
            f.add_emitter(Emitter { rate: 1000.0, life_min: 5.0, life_max: 5.0, ..Emitter::default() }).unwrap();
            for _ in 0..60 {
                f.advance(1.0 / 60.0);
            }
            f.alive()
        };
        let full = run(1.0);
        let half = run(0.5);
        assert!((half as f64 - full as f64 * 0.5).abs() < 5.0, "{full} {half}");
    }

    #[test]
    fn same_seed_same_output() {
        let run = || {
            let mut f = ParticleField::new(1000, 77).unwrap();
            f.forces.push(Force::Gravity { x: 0.0, y: 200.0 });
            f.forces.push(Force::Turbulence { strength: 50.0, scale: 40.0 });
            f.add_emitter(Emitter::default()).unwrap();
            for _ in 0..120 {
                f.advance(1.0 / 60.0);
            }
            let mut buf = vec![0.0f32; 4000];
            let n = f.write_render_buffer(&mut buf);
            buf.truncate(n * 4);
            buf
        };
        assert_eq!(run(), run());
    }

    #[test]
    fn noise_is_bounded() {
        for i in 0..1000 {
            let v = value_noise(i as f64 * 0.37, i as f64 * 0.11, 3.0);
            assert!((-1.0..=1.0).contains(&v));
        }
    }
}
