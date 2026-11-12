//! Minimal 4×4 matrix math (column-major, f64) for 2.5D UI transforms.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub const fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }
    pub fn is_empty(&self) -> bool {
        self.w <= 0.0 || self.h <= 0.0
    }
    pub fn union(&self, o: &Rect) -> Rect {
        if self.is_empty() {
            return *o;
        }
        if o.is_empty() {
            return *self;
        }
        let x0 = self.x.min(o.x);
        let y0 = self.y.min(o.y);
        let x1 = (self.x + self.w).max(o.x + o.w);
        let y1 = (self.y + self.h).max(o.y + o.h);
        Rect::new(x0, y0, x1 - x0, y1 - y0)
    }
    pub fn intersects(&self, o: &Rect) -> bool {
        !self.is_empty()
            && !o.is_empty()
            && self.x < o.x + o.w
            && o.x < self.x + self.w
            && self.y < o.y + o.h
            && o.y < self.y + self.h
    }
    pub fn inflate(&self, d: f64) -> Rect {
        Rect::new(self.x - d, self.y - d, self.w + 2.0 * d, self.h + 2.0 * d)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Mat4(pub [f64; 16]);

impl Default for Mat4 {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Mat4 {
    pub const IDENTITY: Mat4 = Mat4([
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]);

    #[inline]
    fn at(&self, row: usize, col: usize) -> f64 {
        self.0[col * 4 + row]
    }

    pub fn mul(&self, o: &Mat4) -> Mat4 {
        let mut r = [0.0; 16];
        for c in 0..4 {
            for rr in 0..4 {
                r[c * 4 + rr] = (0..4).map(|k| self.at(rr, k) * o.at(k, c)).sum();
            }
        }
        Mat4(r)
    }

    pub fn translate(x: f64, y: f64, z: f64) -> Mat4 {
        let mut m = Self::IDENTITY;
        m.0[12] = x;
        m.0[13] = y;
        m.0[14] = z;
        m
    }
    pub fn scale(x: f64, y: f64, z: f64) -> Mat4 {
        let mut m = Self::IDENTITY;
        m.0[0] = x;
        m.0[5] = y;
        m.0[10] = z;
        m
    }
    pub fn rotate_z(rad: f64) -> Mat4 {
        let (s, c) = rad.sin_cos();
        let mut m = Self::IDENTITY;
        m.0[0] = c;
        m.0[1] = s;
        m.0[4] = -s;
        m.0[5] = c;
        m
    }
    pub fn rotate_x(rad: f64) -> Mat4 {
        let (s, c) = rad.sin_cos();
        let mut m = Self::IDENTITY;
        m.0[5] = c;
        m.0[6] = s;
        m.0[9] = -s;
        m.0[10] = c;
        m
    }
    pub fn rotate_y(rad: f64) -> Mat4 {
        let (s, c) = rad.sin_cos();
        let mut m = Self::IDENTITY;
        m.0[0] = c;
        m.0[2] = -s;
        m.0[8] = s;
        m.0[10] = c;
        m
    }
    pub fn skew(ax: f64, ay: f64) -> Mat4 {
        let mut m = Self::IDENTITY;
        m.0[4] = ax.tan();
        m.0[1] = ay.tan();
        m
    }
    /// CSS-style perspective with distance `d`.
    pub fn perspective(d: f64) -> Mat4 {
        let mut m = Self::IDENTITY;
        if d > 0.0 {
            m.0[11] = -1.0 / d;
        }
        m
    }

    /// Transforms a 2D point (z = 0) with perspective divide.
    pub fn transform_point(&self, x: f64, y: f64) -> (f64, f64) {
        let px = self.at(0, 0) * x + self.at(0, 1) * y + self.at(0, 3);
        let py = self.at(1, 0) * x + self.at(1, 1) * y + self.at(1, 3);
        let w = self.at(3, 0) * x + self.at(3, 1) * y + self.at(3, 3);
        let w = if w.abs() < 1e-9 { 1e-9 } else { w };
        (px / w, py / w)
    }

    /// Screen-space bounding box of a transformed rect.
    pub fn bounds(&self, r: &Rect) -> Rect {
        let pts = [
            self.transform_point(r.x, r.y),
            self.transform_point(r.x + r.w, r.y),
            self.transform_point(r.x, r.y + r.h),
            self.transform_point(r.x + r.w, r.y + r.h),
        ];
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for (x, y) in pts {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        Rect::new(x0, y0, x1 - x0, y1 - y0)
    }

    /// CSS `matrix3d(...)` string (column-major, as CSS expects).
    pub fn to_css(&self) -> String {
        let parts: Vec<String> = self
            .0
            .iter()
            .map(|v| format!("{}", (v * 1e6).round() / 1e6))
            .collect();
        format!("matrix3d({})", parts.join(","))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_and_composition() {
        let t = Mat4::translate(10.0, 20.0, 0.0);
        let s = Mat4::scale(2.0, 2.0, 1.0);
        let m = t.mul(&s);
        assert_eq!(m.transform_point(1.0, 1.0), (12.0, 22.0));
        assert_eq!(Mat4::IDENTITY.mul(&m), m);
    }

    #[test]
    fn rotation_quarter_turn() {
        let (x, y) = Mat4::rotate_z(std::f64::consts::FRAC_PI_2).transform_point(1.0, 0.0);
        assert!(x.abs() < 1e-12 && (y - 1.0).abs() < 1e-12);
    }

    #[test]
    fn perspective_shrinks_receding_points() {
        let m = Mat4::perspective(500.0).mul(&Mat4::rotate_y(0.5));
        let (x, _) = m.transform_point(100.0, 0.0);
        assert!(x.abs() < 100.0);
    }

    #[test]
    fn rect_ops() {
        let a = Rect::new(0.0, 0.0, 10.0, 10.0);
        let b = Rect::new(5.0, 5.0, 10.0, 10.0);
        assert_eq!(a.union(&b), Rect::new(0.0, 0.0, 15.0, 15.0));
        assert!(a.intersects(&b));
        assert!(!a.intersects(&Rect::new(20.0, 0.0, 1.0, 1.0)));
    }
}
