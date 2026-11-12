//! LRU resource cache with a byte budget (textures, baked paths, shader programs…).

use std::collections::HashMap;

#[derive(Debug)]
struct Entry<V> {
    value: V,
    bytes: usize,
    last_use: u64,
}

#[derive(Debug)]
pub struct ResourceCache<V> {
    entries: HashMap<String, Entry<V>>,
    budget: usize,
    used: usize,
    clock: u64,
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
}

impl<V> ResourceCache<V> {
    pub fn new(budget_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            budget: budget_bytes,
            used: 0,
            clock: 0,
            hits: 0,
            misses: 0,
            evictions: 0,
        }
    }

    pub fn used_bytes(&self) -> usize {
        self.used
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get(&mut self, key: &str) -> Option<&V> {
        self.clock += 1;
        match self.entries.get_mut(key) {
            Some(e) => {
                e.last_use = self.clock;
                self.hits += 1;
                Some(&e.value)
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    /// Inserts a resource. Resources larger than the whole budget are rejected (returned).
    pub fn insert(&mut self, key: &str, value: V, bytes: usize) -> Result<(), V> {
        if bytes > self.budget {
            return Err(value);
        }
        if let Some(old) = self.entries.remove(key) {
            self.used -= old.bytes;
        }
        while self.used + bytes > self.budget {
            let Some(victim) = self
                .entries
                .iter()
                .min_by_key(|(_, e)| e.last_use)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some(e) = self.entries.remove(&victim) {
                self.used -= e.bytes;
                self.evictions += 1;
            }
        }
        self.clock += 1;
        self.entries.insert(
            key.to_string(),
            Entry {
                value,
                bytes,
                last_use: self.clock,
            },
        );
        self.used += bytes;
        Ok(())
    }

    pub fn remove(&mut self, key: &str) -> Option<V> {
        self.entries.remove(key).map(|e| {
            self.used -= e.bytes;
            e.value
        })
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.used = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evicts_least_recently_used() {
        let mut c = ResourceCache::new(100);
        c.insert("a", 1, 40).unwrap();
        c.insert("b", 2, 40).unwrap();
        c.get("a");
        c.insert("c", 3, 40).unwrap();
        assert!(c.get("b").is_none());
        assert!(c.get("a").is_some());
        assert_eq!(c.used_bytes(), 80);
        assert_eq!(c.evictions, 1);
        assert!(c.insert("huge", 4, 1000).is_err());
    }
}
