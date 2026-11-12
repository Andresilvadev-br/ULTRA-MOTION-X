//! Temporal coherence: property arbitration.
//!
//! Two animations must never fight over the same property. Every animated property has at
//! most one *owner*. A new request is resolved with an explicit policy:
//!
//! | situation                         | `Replace`            | `Queue`  | `Reject` | `Additive` |
//! |-----------------------------------|----------------------|----------|----------|------------|
//! | free property                     | acquire              | acquire  | acquire  | acquire    |
//! | owner has lower or equal priority | interrupt + acquire  | queued   | rejected | add layer  |
//! | owner has higher priority         | rejected             | queued   | rejected | add layer  |
//!
//! Interrupting hands the owner's current value and velocity to the newcomer (see
//! `Generator::retarget`), which is what keeps rapid open/close/open sequences continuous.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

/// Identifies one animatable property of one target.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct PropertyKey {
    pub target: u64,
    pub property: String,
}

impl PropertyKey {
    pub fn new(target: u64, property: impl Into<String>) -> Self {
        Self {
            target,
            property: property.into(),
        }
    }
}

/// Priority classes, from least to most important.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
#[serde(rename_all = "camelCase")]
pub enum Priority {
    Decorative = 0,
    Ambient = 1,
    #[default]
    Normal = 2,
    Interaction = 3,
    /// Direct manipulation (the finger/pointer owns the value).
    Gesture = 4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum InterruptPolicy {
    #[default]
    Replace,
    Queue,
    Reject,
    Additive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grant {
    /// The requester now owns the property; `interrupted` is the previous owner, if any.
    Acquired {
        interrupted: Option<u64>,
    },
    /// The requester runs as an additive layer on top of the owner.
    Additive,
    /// The requester will be granted ownership when the current owner releases.
    Queued,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Owner {
    anim: u64,
    priority: Priority,
}

/// Arbitration statistics, exposed to telemetry and DevTools.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct ArbiterStats {
    pub acquisitions: u64,
    pub interruptions: u64,
    pub rejections: u64,
    pub queued: u64,
    pub additive: u64,
}

#[derive(Debug, Default, Clone)]
pub struct Arbiter {
    owners: BTreeMap<PropertyKey, Owner>,
    queues: BTreeMap<PropertyKey, VecDeque<Owner>>,
    layers: BTreeMap<PropertyKey, Vec<u64>>,
    stats: ArbiterStats,
}

impl Arbiter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stats(&self) -> ArbiterStats {
        self.stats
    }

    pub fn owner(&self, key: &PropertyKey) -> Option<u64> {
        self.owners.get(key).map(|o| o.anim)
    }

    pub fn layers(&self, key: &PropertyKey) -> &[u64] {
        self.layers.get(key).map_or(&[], Vec::as_slice)
    }

    pub fn request(
        &mut self,
        key: &PropertyKey,
        anim: u64,
        priority: Priority,
        policy: InterruptPolicy,
    ) -> Grant {
        let current = self.owners.get(key).copied();
        let grant = match (current, policy) {
            (None, InterruptPolicy::Additive) | (None, _) => {
                self.owners.insert(key.clone(), Owner { anim, priority });
                Grant::Acquired { interrupted: None }
            }
            (Some(o), _) if o.anim == anim => Grant::Acquired { interrupted: None },
            (Some(_), InterruptPolicy::Additive) => {
                self.layers.entry(key.clone()).or_default().push(anim);
                Grant::Additive
            }
            (Some(_), InterruptPolicy::Queue) => {
                self.queues
                    .entry(key.clone())
                    .or_default()
                    .push_back(Owner { anim, priority });
                Grant::Queued
            }
            (Some(o), InterruptPolicy::Replace) if priority >= o.priority => {
                self.owners.insert(key.clone(), Owner { anim, priority });
                Grant::Acquired {
                    interrupted: Some(o.anim),
                }
            }
            (Some(_), _) => Grant::Rejected,
        };
        match grant {
            Grant::Acquired { interrupted } => {
                self.stats.acquisitions += 1;
                if interrupted.is_some() {
                    self.stats.interruptions += 1;
                }
            }
            Grant::Additive => self.stats.additive += 1,
            Grant::Queued => self.stats.queued += 1,
            Grant::Rejected => self.stats.rejections += 1,
        }
        grant
    }

    /// Releases `anim`'s claim on `key`. Returns the queued animation that becomes owner.
    pub fn release(&mut self, key: &PropertyKey, anim: u64) -> Option<u64> {
        if let Some(layers) = self.layers.get_mut(key) {
            layers.retain(|a| *a != anim);
            if layers.is_empty() {
                self.layers.remove(key);
            }
        }
        if let Some(q) = self.queues.get_mut(key) {
            q.retain(|o| o.anim != anim);
        }
        if self.owners.get(key).map(|o| o.anim) != Some(anim) {
            return None;
        }
        self.owners.remove(key);
        let next = self.queues.get_mut(key).and_then(VecDeque::pop_front);
        if self.queues.get(key).is_some_and(VecDeque::is_empty) {
            self.queues.remove(key);
        }
        next.map(|o| {
            self.owners.insert(key.clone(), o);
            self.stats.acquisitions += 1;
            o.anim
        })
    }

    /// Releases every claim held by `anim` (cancellation). Returns promoted animations.
    pub fn release_all(&mut self, anim: u64) -> Vec<(PropertyKey, u64)> {
        let keys: Vec<PropertyKey> = self
            .owners
            .iter()
            .filter(|(_, o)| o.anim == anim)
            .map(|(k, _)| k.clone())
            .chain(
                self.layers
                    .iter()
                    .filter(|(_, l)| l.contains(&anim))
                    .map(|(k, _)| k.clone()),
            )
            .chain(
                self.queues
                    .iter()
                    .filter(|(_, q)| q.iter().any(|o| o.anim == anim))
                    .map(|(k, _)| k.clone()),
            )
            .collect();
        let mut promoted = Vec::new();
        for k in keys {
            if let Some(next) = self.release(&k, anim) {
                promoted.push((k, next));
            }
        }
        promoted
    }

    /// Removes every claim on a target (target destroyed / unmounted).
    pub fn forget_target(&mut self, target: u64) {
        self.owners.retain(|k, _| k.target != target);
        self.queues.retain(|k, _| k.target != target);
        self.layers.retain(|k, _| k.target != target);
    }

    pub fn owned_count(&self) -> usize {
        self.owners.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k() -> PropertyKey {
        PropertyKey::new(1, "x")
    }

    #[test]
    fn replace_interrupts_lower_or_equal() {
        let mut a = Arbiter::new();
        assert_eq!(
            a.request(&k(), 1, Priority::Normal, InterruptPolicy::Replace),
            Grant::Acquired { interrupted: None }
        );
        assert_eq!(
            a.request(&k(), 2, Priority::Normal, InterruptPolicy::Replace),
            Grant::Acquired {
                interrupted: Some(1)
            }
        );
        assert_eq!(a.owner(&k()), Some(2));
        assert_eq!(a.stats().interruptions, 1);
    }

    #[test]
    fn gesture_cannot_be_stolen_by_decoration() {
        let mut a = Arbiter::new();
        a.request(&k(), 1, Priority::Gesture, InterruptPolicy::Replace);
        assert_eq!(
            a.request(&k(), 2, Priority::Decorative, InterruptPolicy::Replace),
            Grant::Rejected
        );
        assert_eq!(a.owner(&k()), Some(1));
    }

    #[test]
    fn queue_promotes_on_release() {
        let mut a = Arbiter::new();
        a.request(&k(), 1, Priority::Normal, InterruptPolicy::Replace);
        assert_eq!(
            a.request(&k(), 2, Priority::Normal, InterruptPolicy::Queue),
            Grant::Queued
        );
        assert_eq!(a.release(&k(), 1), Some(2));
        assert_eq!(a.owner(&k()), Some(2));
        assert_eq!(a.release(&k(), 2), None);
        assert_eq!(a.owner(&k()), None);
    }

    #[test]
    fn additive_layers() {
        let mut a = Arbiter::new();
        a.request(&k(), 1, Priority::Normal, InterruptPolicy::Replace);
        assert_eq!(
            a.request(&k(), 5, Priority::Decorative, InterruptPolicy::Additive),
            Grant::Additive
        );
        assert_eq!(a.layers(&k()), &[5]);
        a.release_all(5);
        assert!(a.layers(&k()).is_empty());
    }

    #[test]
    fn forget_target_cleans_everything() {
        let mut a = Arbiter::new();
        a.request(&k(), 1, Priority::Normal, InterruptPolicy::Replace);
        a.request(&k(), 2, Priority::Normal, InterruptPolicy::Queue);
        a.forget_target(1);
        assert_eq!(a.owned_count(), 0);
        assert_eq!(a.release(&k(), 1), None);
    }
}
