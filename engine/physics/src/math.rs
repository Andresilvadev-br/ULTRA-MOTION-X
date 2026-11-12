//! Portable math wrappers. Every transcendental used by the engine is routed through
//! `libm` so the results do not depend on the platform C library.

#[inline]
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}
#[inline]
pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}
#[inline]
pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}
#[inline]
pub fn sqrt(x: f64) -> f64 {
    libm::sqrt(x)
}
#[inline]
pub fn ln(x: f64) -> f64 {
    libm::log(x)
}
#[inline]
pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}
#[inline]
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}
#[inline]
pub fn hypot(x: f64, y: f64) -> f64 {
    libm::hypot(x, y)
}

/// Linear interpolation.
#[inline]
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Clamp that tolerates `min > max` by swapping.
#[inline]
pub fn clamp(v: f64, min: f64, max: f64) -> f64 {
    let (lo, hi) = if min <= max { (min, max) } else { (max, min) };
    v.max(lo).min(hi)
}

/// Maps `v` from `[in0, in1]` to `[out0, out1]` (no clamping).
#[inline]
pub fn remap(v: f64, in0: f64, in1: f64, out0: f64, out1: f64) -> f64 {
    if in1 == in0 {
        return out0;
    }
    out0 + (v - in0) * (out1 - out0) / (in1 - in0)
}
