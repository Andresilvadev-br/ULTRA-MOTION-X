use core::fmt;

/// Errors raised when physics parameters are invalid.
#[derive(Debug, Clone, PartialEq)]
pub enum PhysicsError {
    /// A parameter is NaN or infinite.
    NotFinite(&'static str),
    /// A parameter is outside its admissible range.
    OutOfRange {
        name: &'static str,
        value: f64,
        min: f64,
        max: f64,
    },
    /// A capacity limit would be exceeded.
    CapacityExceeded { requested: usize, limit: usize },
}

impl fmt::Display for PhysicsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PhysicsError::NotFinite(name) => write!(f, "parameter `{name}` must be a finite number"),
            PhysicsError::OutOfRange { name, value, min, max } => {
                write!(f, "parameter `{name}` = {value} is outside [{min}, {max}]")
            }
            PhysicsError::CapacityExceeded { requested, limit } => {
                write!(f, "capacity exceeded: requested {requested}, limit {limit}")
            }
        }
    }
}

impl std::error::Error for PhysicsError {}

pub(crate) fn check_finite(name: &'static str, v: f64) -> Result<f64, PhysicsError> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(PhysicsError::NotFinite(name))
    }
}

pub(crate) fn check_range(name: &'static str, v: f64, min: f64, max: f64) -> Result<f64, PhysicsError> {
    check_finite(name, v)?;
    if v < min || v > max {
        Err(PhysicsError::OutOfRange { name, value: v, min, max })
    } else {
        Ok(v)
    }
}
