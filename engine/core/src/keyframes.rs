//! Multi-stop keyframes with per-segment easing and explicit offsets.

use crate::easing::Easing;
use crate::error::CoreError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframes {
    pub values: Vec<f64>,
    /// Offsets in [0, 1], non-decreasing, same length as `values`. Empty = evenly spaced.
    #[serde(default)]
    pub offsets: Vec<f64>,
    /// One easing for all segments, or one per segment (`values.len() - 1`).
    #[serde(default)]
    pub easings: Vec<Easing>,
}

impl Keyframes {
    pub fn new(
        values: Vec<f64>,
        offsets: Vec<f64>,
        easings: Vec<Easing>,
    ) -> Result<Self, CoreError> {
        let k = Self {
            values,
            offsets,
            easings,
        };
        k.validate()?;
        Ok(k.normalized())
    }

    fn normalized(mut self) -> Self {
        if self.offsets.is_empty() {
            let n = self.values.len();
            self.offsets = (0..n)
                .map(|i| {
                    if n == 1 {
                        1.0
                    } else {
                        i as f64 / (n - 1) as f64
                    }
                })
                .collect();
        }
        self
    }

    pub fn validate(&self) -> Result<(), CoreError> {
        if self.values.is_empty() {
            return Err(CoreError::InvalidKeyframes(
                "at least one value is required".into(),
            ));
        }
        // The first value may be NaN, meaning "start from the current value".
        if self
            .values
            .iter()
            .enumerate()
            .any(|(i, v)| !(v.is_finite() || (i == 0 && v.is_nan())))
        {
            return Err(CoreError::InvalidKeyframes("values must be finite".into()));
        }
        if !self.offsets.is_empty() {
            if self.offsets.len() != self.values.len() {
                return Err(CoreError::InvalidKeyframes(
                    "offsets must match values length".into(),
                ));
            }
            let mut last = 0.0;
            for &o in &self.offsets {
                if !(0.0..=1.0).contains(&o) || o < last {
                    return Err(CoreError::InvalidKeyframes(
                        "offsets must be non-decreasing within [0, 1]".into(),
                    ));
                }
                last = o;
            }
        }
        let segs = self.values.len().saturating_sub(1);
        if self.easings.len() > 1 && self.easings.len() != segs {
            return Err(CoreError::InvalidKeyframes(format!(
                "expected 1 or {segs} easings, got {}",
                self.easings.len()
            )));
        }
        for e in &self.easings {
            e.validate()?;
        }
        Ok(())
    }

    fn easing(&self, seg: usize) -> Option<&Easing> {
        match self.easings.len() {
            0 => None,
            1 => self.easings.first(),
            _ => self.easings.get(seg),
        }
    }

    /// Value and d(value)/d(progress) at linear progress `p ∈ [0, 1]`.
    pub fn sample(&self, p: f64) -> (f64, f64) {
        let p = p.clamp(0.0, 1.0);
        let n = self.values.len();
        if n == 1 {
            return (self.values[0], 0.0);
        }
        let offsets = &self.offsets;
        let mut seg = n - 2;
        for i in 0..n - 1 {
            if p <= offsets[i + 1] {
                seg = i;
                break;
            }
        }
        let (o0, o1) = (offsets[seg], offsets[seg + 1]);
        let span = o1 - o0;
        let local = if span <= 0.0 { 1.0 } else { (p - o0) / span };
        let (eased, d) = match self.easing(seg) {
            Some(e) => (e.apply(local), e.derivative(local)),
            None => (local, 1.0),
        };
        let (a, b) = (self.values[seg], self.values[seg + 1]);
        let dv = if span <= 0.0 { 0.0 } else { (b - a) * d / span };
        (a + (b - a) * eased, dv)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evenly_spaced() {
        let k = Keyframes::new(vec![0.0, 10.0, 0.0], vec![], vec![]).unwrap();
        assert_eq!(k.sample(0.0).0, 0.0);
        assert_eq!(k.sample(0.5).0, 10.0);
        assert_eq!(k.sample(0.25).0, 5.0);
        assert_eq!(k.sample(1.0).0, 0.0);
    }

    #[test]
    fn explicit_offsets() {
        let k = Keyframes::new(vec![0.0, 100.0, 100.0], vec![0.0, 0.2, 1.0], vec![]).unwrap();
        assert!((k.sample(0.1).0 - 50.0).abs() < 1e-9);
        assert_eq!(k.sample(0.6).0, 100.0);
    }

    #[test]
    fn validation() {
        assert!(Keyframes::new(vec![], vec![], vec![]).is_err());
        assert!(Keyframes::new(vec![0.0, 1.0], vec![0.5, 0.2], vec![]).is_err());
        assert!(Keyframes::new(
            vec![0.0, 1.0, 2.0],
            vec![],
            vec![Easing::Linear, Easing::Linear, Easing::Linear]
        )
        .is_err());
    }
}
