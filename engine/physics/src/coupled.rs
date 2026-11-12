//! Coupled springs: N masses connected by springs to their targets and to each other.
//! Typical uses: trailing chains (follow-the-leader), linked panels, elastic groups.
//! Advanced with fixed-step RK4 so that results are deterministic.

use crate::error::{check_finite, check_range, PhysicsError};
use crate::integrator::{rk4, FixedStepper};

/// Upper bound on nodes to protect against accidental excessive allocation.
pub const MAX_NODES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Link {
    pub a: usize,
    pub b: usize,
    pub stiffness: f64,
    pub damping: f64,
    pub rest_length: f64,
}

#[derive(Debug, Clone)]
pub struct CoupledSystem {
    positions: Vec<f64>,
    velocities: Vec<f64>,
    targets: Vec<Option<f64>>,
    mass: Vec<f64>,
    anchor_stiffness: f64,
    anchor_damping: f64,
    links: Vec<Link>,
    stepper: FixedStepper,
}

impl CoupledSystem {
    pub fn new(count: usize, anchor_stiffness: f64, anchor_damping: f64) -> Result<Self, PhysicsError> {
        if count > MAX_NODES {
            return Err(PhysicsError::CapacityExceeded { requested: count, limit: MAX_NODES });
        }
        check_range("anchor_stiffness", anchor_stiffness, 0.0, 1e7)?;
        check_range("anchor_damping", anchor_damping, 0.0, 1e7)?;
        Ok(Self {
            positions: vec![0.0; count],
            velocities: vec![0.0; count],
            targets: vec![None; count],
            mass: vec![1.0; count],
            anchor_stiffness,
            anchor_damping,
            links: Vec::new(),
            stepper: FixedStepper::new(1.0 / 480.0, 240),
        })
    }

    /// Builds a follow-the-leader chain: node 0 is anchored, others are linked in series.
    pub fn chain(count: usize, stiffness: f64, damping: f64) -> Result<Self, PhysicsError> {
        let mut s = Self::new(count, stiffness, damping)?;
        for i in 1..count {
            s.link(Link { a: i - 1, b: i, stiffness, damping, rest_length: 0.0 })?;
        }
        Ok(s)
    }

    pub fn len(&self) -> usize {
        self.positions.len()
    }
    pub fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }

    pub fn link(&mut self, link: Link) -> Result<(), PhysicsError> {
        if link.a >= self.len() || link.b >= self.len() {
            return Err(PhysicsError::OutOfRange {
                name: "link index",
                value: link.a.max(link.b) as f64,
                min: 0.0,
                max: self.len() as f64 - 1.0,
            });
        }
        check_finite("stiffness", link.stiffness)?;
        check_finite("damping", link.damping)?;
        self.links.push(link);
        Ok(())
    }

    pub fn set_target(&mut self, i: usize, target: Option<f64>) {
        if let Some(t) = self.targets.get_mut(i) {
            *t = target.filter(|v| v.is_finite());
        }
    }

    pub fn set_position(&mut self, i: usize, x: f64) {
        if x.is_finite() {
            if let Some(p) = self.positions.get_mut(i) {
                *p = x;
            }
        }
    }

    pub fn set_mass(&mut self, i: usize, m: f64) -> Result<(), PhysicsError> {
        check_range("mass", m, 1e-6, 1e9)?;
        if let Some(slot) = self.mass.get_mut(i) {
            *slot = m;
        }
        Ok(())
    }

    pub fn positions(&self) -> &[f64] {
        &self.positions
    }
    pub fn velocities(&self) -> &[f64] {
        &self.velocities
    }

    fn derivative(&self, y: &Vec<f64>) -> Vec<f64> {
        let n = self.len();
        let mut d = vec![0.0; 2 * n];
        let mut force = vec![0.0; n];
        for i in 0..n {
            let (x, v) = (y[i], y[n + i]);
            if let Some(t) = self.targets[i] {
                force[i] += -self.anchor_stiffness * (x - t) - self.anchor_damping * v;
            }
        }
        for l in &self.links {
            let (xa, xb) = (y[l.a], y[l.b]);
            let (va, vb) = (y[n + l.a], y[n + l.b]);
            let stretch = (xb - xa) - l.rest_length;
            let f = l.stiffness * stretch + l.damping * (vb - va);
            force[l.a] += f;
            force[l.b] -= f;
        }
        for i in 0..n {
            d[i] = y[n + i];
            d[n + i] = force[i] / self.mass[i];
        }
        d
    }

    /// Advances by wall-clock `dt`; internally runs fixed steps. Returns steps executed.
    pub fn advance(&mut self, dt: f64) -> u32 {
        let (steps, _) = self.stepper.advance(dt);
        for _ in 0..steps {
            self.step_fixed();
        }
        steps
    }

    /// Runs exactly one fixed step.
    pub fn step_fixed(&mut self) {
        let n = self.len();
        let h = self.stepper.step();
        let mut y = Vec::with_capacity(2 * n);
        y.extend_from_slice(&self.positions);
        y.extend_from_slice(&self.velocities);
        let next = rk4(0.0, &y, h, |_, s| self.derivative(s));
        self.positions.copy_from_slice(&next[..n]);
        self.velocities.copy_from_slice(&next[n..]);
    }

    /// Total kinetic + potential energy — useful for stability tests.
    pub fn energy(&self) -> f64 {
        let n = self.len();
        let mut e = 0.0;
        for i in 0..n {
            e += 0.5 * self.mass[i] * self.velocities[i] * self.velocities[i];
            if let Some(t) = self.targets[i] {
                let d = self.positions[i] - t;
                e += 0.5 * self.anchor_stiffness * d * d;
            }
        }
        for l in &self.links {
            let s = self.positions[l.b] - self.positions[l.a] - l.rest_length;
            e += 0.5 * l.stiffness * s * s;
        }
        e
    }

    pub fn is_at_rest(&self, delta: f64, speed: f64) -> bool {
        self.velocities.iter().all(|v| v.abs() < speed)
            && self.targets.iter().zip(&self.positions).all(|(t, x)| t.map_or(true, |t| (x - t).abs() < delta))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain_follows_leader() {
        let mut c = CoupledSystem::chain(5, 200.0, 20.0).unwrap();
        c.set_target(0, Some(100.0));
        for _ in 0..1800 {
            c.advance(1.0 / 120.0);
        }
        for x in c.positions() {
            assert!((x - 100.0).abs() < 0.5, "x={x}");
        }
    }

    #[test]
    fn energy_decays_with_damping() {
        let mut c = CoupledSystem::chain(4, 150.0, 8.0).unwrap();
        c.set_target(0, Some(50.0));
        let e0 = c.energy();
        for _ in 0..240 {
            c.advance(1.0 / 60.0);
        }
        assert!(c.energy() < e0);
    }

    #[test]
    fn deterministic_across_frame_rates() {
        let run = |hz: f64, frames: usize| {
            let mut c = CoupledSystem::chain(3, 300.0, 10.0).unwrap();
            c.set_target(0, Some(1.0));
            for _ in 0..frames {
                c.advance(1.0 / hz);
            }
            c.positions().to_vec()
        };
        let a = run(60.0, 60);
        let b = run(240.0, 240);
        // Same number of fixed steps ⇒ bit-identical, or within one step of drift.
        for (x, y) in a.iter().zip(&b) {
            assert!((x - y).abs() < 1e-2);
        }
    }

    #[test]
    fn capacity_guard() {
        assert!(CoupledSystem::new(MAX_NODES + 1, 1.0, 1.0).is_err());
    }
}
