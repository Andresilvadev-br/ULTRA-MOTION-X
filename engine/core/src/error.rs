use core::fmt;
use umx_physics::PhysicsError;

#[derive(Debug, Clone, PartialEq)]
pub enum CoreError {
    Physics(PhysicsError),
    InvalidEasing(String),
    InvalidKeyframes(String),
    InvalidTimeline(String),
    UnknownProfile(String),
    Token(String),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::Physics(e) => write!(f, "physics: {e}"),
            CoreError::InvalidEasing(m) => write!(f, "invalid easing: {m}"),
            CoreError::InvalidKeyframes(m) => write!(f, "invalid keyframes: {m}"),
            CoreError::InvalidTimeline(m) => write!(f, "invalid timeline: {m}"),
            CoreError::UnknownProfile(m) => write!(f, "unknown motion profile `{m}`"),
            CoreError::Token(m) => write!(f, "token error: {m}"),
        }
    }
}

impl std::error::Error for CoreError {}

impl From<PhysicsError> for CoreError {
    fn from(e: PhysicsError) -> Self {
        CoreError::Physics(e)
    }
}
