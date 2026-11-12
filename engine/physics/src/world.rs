//! Deterministic 2D body world for spatial UI: bodies with mass and radius, anchor springs,
//! attractors, rectangular bounds with restitution and circle–circle collisions.
//! Advanced with a fixed step (semi-implicit Euler) in a fixed iteration order.

use crate::error::{check_finite, check_range, PhysicsError};
use crate::integrator::FixedStepper;
use crate::math;

pub const MAX_BODIES: usize = 2048;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Body {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub mass: f64,
    pub radius: f64,
    /// Static bodies do not move but still collide.
    pub fixed: bool,
    /// Optional spring anchor `(x, y, stiffness, damping)`.
    pub anchor: Option<(f64, f64, f64, f64)>,
}

impl Body {
    pub fn new(x: f64, y: f64, radius: f64) -> Self {
        Self {
            x,
            y,
            vx: 0.0,
            vy: 0.0,
            mass: 1.0,
            radius,
            fixed: false,
            anchor: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Attractor {
    pub x: f64,
    pub y: f64,
    /// Positive attracts, negative repels.
    pub strength: f64,
    pub radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub restitution: f64,
}

#[derive(Debug, Clone)]
pub struct World {
    bodies: Vec<Body>,
    pub attractors: Vec<Attractor>,
    pub bounds: Option<Bounds>,
    pub gravity: (f64, f64),
    /// Linear drag coefficient (1/s).
    pub drag: f64,
    pub collisions: bool,
    pub restitution: f64,
    stepper: FixedStepper,
}

impl World {
    pub fn new(step: f64) -> Self {
        Self {
            bodies: Vec::new(),
            attractors: Vec::new(),
            bounds: None,
            gravity: (0.0, 0.0),
            drag: 0.0,
            collisions: true,
            restitution: 0.5,
            stepper: FixedStepper::new(step, 256),
        }
    }

    pub fn add(&mut self, body: Body) -> Result<usize, PhysicsError> {
        if self.bodies.len() >= MAX_BODIES {
            return Err(PhysicsError::CapacityExceeded {
                requested: self.bodies.len() + 1,
                limit: MAX_BODIES,
            });
        }
        check_finite("x", body.x)?;
        check_finite("y", body.y)?;
        check_range("mass", body.mass, 1e-6, 1e9)?;
        check_range("radius", body.radius, 0.0, 1e7)?;
        self.bodies.push(body);
        Ok(self.bodies.len() - 1)
    }

    pub fn bodies(&self) -> &[Body] {
        &self.bodies
    }

    pub fn body_mut(&mut self, i: usize) -> Option<&mut Body> {
        self.bodies.get_mut(i)
    }

    pub fn ticks(&self) -> u64 {
        self.stepper.ticks
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
        let (gx, gy) = self.gravity;
        for b in self.bodies.iter_mut().filter(|b| !b.fixed) {
            let (mut fx, mut fy) = (gx * b.mass, gy * b.mass);
            if let Some((ax, ay, k, c)) = b.anchor {
                fx += -k * (b.x - ax) - c * b.vx;
                fy += -k * (b.y - ay) - c * b.vy;
            }
            for a in &self.attractors {
                let (dx, dy) = (a.x - b.x, a.y - b.y);
                let d = math::hypot(dx, dy);
                if d > 1e-9 && d < a.radius {
                    let falloff = 1.0 - d / a.radius;
                    fx += a.strength * falloff * dx / d;
                    fy += a.strength * falloff * dy / d;
                }
            }
            fx -= self.drag * b.mass * b.vx;
            fy -= self.drag * b.mass * b.vy;
            b.vx += fx / b.mass * h;
            b.vy += fy / b.mass * h;
            b.x += b.vx * h;
            b.y += b.vy * h;
        }
        if self.collisions {
            self.resolve_collisions();
        }
        if let Some(bd) = self.bounds {
            for b in self.bodies.iter_mut().filter(|b| !b.fixed) {
                if b.x - b.radius < bd.min_x {
                    b.x = bd.min_x + b.radius;
                    b.vx = b.vx.abs() * bd.restitution;
                } else if b.x + b.radius > bd.max_x {
                    b.x = bd.max_x - b.radius;
                    b.vx = -b.vx.abs() * bd.restitution;
                }
                if b.y - b.radius < bd.min_y {
                    b.y = bd.min_y + b.radius;
                    b.vy = b.vy.abs() * bd.restitution;
                } else if b.y + b.radius > bd.max_y {
                    b.y = bd.max_y - b.radius;
                    b.vy = -b.vy.abs() * bd.restitution;
                }
            }
        }
    }

    fn resolve_collisions(&mut self) {
        let n = self.bodies.len();
        for i in 0..n {
            for j in (i + 1)..n {
                let (a, b) = (self.bodies[i], self.bodies[j]);
                if a.fixed && b.fixed {
                    continue;
                }
                let (dx, dy) = (b.x - a.x, b.y - a.y);
                let dist = math::hypot(dx, dy);
                let min = a.radius + b.radius;
                if dist >= min || min == 0.0 {
                    continue;
                }
                let (nx, ny) = if dist > 1e-12 {
                    (dx / dist, dy / dist)
                } else {
                    (1.0, 0.0)
                };
                let inv_a = if a.fixed { 0.0 } else { 1.0 / a.mass };
                let inv_b = if b.fixed { 0.0 } else { 1.0 / b.mass };
                let inv_sum = inv_a + inv_b;
                // Positional correction.
                let pen = min - dist;
                let (ca, cb) = (pen * inv_a / inv_sum, pen * inv_b / inv_sum);
                // Impulse along the normal.
                let rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                let j_imp = if rel < 0.0 {
                    -(1.0 + self.restitution) * rel / inv_sum
                } else {
                    0.0
                };
                let ba = &mut self.bodies[i];
                ba.x -= nx * ca;
                ba.y -= ny * ca;
                ba.vx -= j_imp * inv_a * nx;
                ba.vy -= j_imp * inv_a * ny;
                let bb = &mut self.bodies[j];
                bb.x += nx * cb;
                bb.y += ny * cb;
                bb.vx += j_imp * inv_b * nx;
                bb.vy += j_imp * inv_b * ny;
            }
        }
    }

    /// Order-independent digest of the world state, used by determinism tests and the
    /// Time Machine to compare runs.
    pub fn digest(&self) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in &self.bodies {
            for v in [b.x, b.y, b.vx, b.vy] {
                for byte in v.to_bits().to_le_bytes() {
                    h ^= u64::from(byte);
                    h = h.wrapping_mul(0x0100_0000_01b3);
                }
            }
        }
        h
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene() -> World {
        let mut w = World::new(1.0 / 240.0);
        w.gravity = (0.0, 900.0);
        w.bounds = Some(Bounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 400.0,
            max_y: 300.0,
            restitution: 0.6,
        });
        for i in 0..20 {
            let mut b = Body::new(20.0 + (i as f64) * 18.0, 10.0 + (i % 3) as f64 * 15.0, 8.0);
            b.vx = (i as f64 - 10.0) * 12.0;
            w.add(b).unwrap();
        }
        w
    }

    #[test]
    fn deterministic_replay() {
        let mut a = scene();
        let mut b = scene();
        for _ in 0..300 {
            a.advance(1.0 / 60.0);
        }
        // b receives the same wall time in irregular slices.
        let slices = [0.004, 0.011, 0.0167, 0.002, 0.0333];
        let mut t = 0.0;
        let mut i = 0;
        while t + slices[i % slices.len()] <= 5.0 + 1e-12 {
            b.advance(slices[i % slices.len()]);
            t += slices[i % slices.len()];
            i += 1;
        }
        b.advance(5.0 - t);
        // Identical tick count ⇒ identical bits.
        if a.ticks() == b.ticks() {
            assert_eq!(a.digest(), b.digest());
        }
        assert!((a.ticks() as i64 - b.ticks() as i64).abs() <= 1);
    }

    #[test]
    fn bodies_stay_in_bounds_and_do_not_overlap_much() {
        let mut w = scene();
        for _ in 0..600 {
            w.advance(1.0 / 60.0);
        }
        for b in w.bodies() {
            assert!(b.x >= b.radius - 1e-6 && b.x <= 400.0 - b.radius + 1e-6);
            assert!(b.y >= b.radius - 1e-6 && b.y <= 300.0 - b.radius + 1e-6);
        }
    }

    #[test]
    fn anchored_body_returns() {
        let mut w = World::new(1.0 / 240.0);
        let mut b = Body::new(100.0, 100.0, 5.0);
        b.anchor = Some((0.0, 0.0, 200.0, 30.0));
        w.add(b).unwrap();
        for _ in 0..240 {
            w.advance(1.0 / 60.0);
        }
        let b = w.bodies()[0];
        assert!(b.x.abs() < 0.01 && b.y.abs() < 0.01);
    }
}
