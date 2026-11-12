//! Layer tree with generational ids and dirty tracking.

use crate::effects::Effect;
use crate::math::{Mat4, Rect};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct LayerId {
    pub index: u32,
    pub generation: u32,
}

/// Transform components applied in a fixed, documented order around the origin:
/// translate · perspective · rotateX · rotateY · rotateZ · skew · scale.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TransformProps {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotate: f64,
    pub rotate_x: f64,
    pub rotate_y: f64,
    pub skew_x: f64,
    pub skew_y: f64,
    pub perspective: f64,
    /// Origin as a fraction of the layer bounds.
    pub origin_x: f64,
    pub origin_y: f64,
}

impl Default for TransformProps {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotate: 0.0,
            rotate_x: 0.0,
            rotate_y: 0.0,
            skew_x: 0.0,
            skew_y: 0.0,
            perspective: 0.0,
            origin_x: 0.5,
            origin_y: 0.5,
        }
    }
}

impl TransformProps {
    pub fn matrix(&self, bounds: &Rect) -> Mat4 {
        let ox = bounds.x + bounds.w * self.origin_x;
        let oy = bounds.y + bounds.h * self.origin_y;
        let deg = std::f64::consts::PI / 180.0;
        Mat4::translate(self.x + ox, self.y + oy, self.z)
            .mul(&Mat4::perspective(self.perspective))
            .mul(&Mat4::rotate_x(self.rotate_x * deg))
            .mul(&Mat4::rotate_y(self.rotate_y * deg))
            .mul(&Mat4::rotate_z(self.rotate * deg))
            .mul(&Mat4::skew(self.skew_x * deg, self.skew_y * deg))
            .mul(&Mat4::scale(self.scale_x, self.scale_y, 1.0))
            .mul(&Mat4::translate(-ox, -oy, 0.0))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layer {
    pub name: String,
    pub bounds: Rect,
    pub transform: TransformProps,
    pub opacity: f64,
    pub visible: bool,
    pub z_index: i32,
    pub clip: Option<Rect>,
    pub corner_radius: f64,
    pub effects: Vec<Effect>,
    pub(crate) parent: Option<LayerId>,
    pub(crate) children: Vec<LayerId>,
    pub(crate) dirty: bool,
    pub(crate) world: Mat4,
    pub(crate) world_opacity: f64,
    pub(crate) screen_bounds: Rect,
}

impl Layer {
    pub fn new(name: &str, bounds: Rect) -> Self {
        Self {
            name: name.to_string(),
            bounds,
            transform: TransformProps::default(),
            opacity: 1.0,
            visible: true,
            z_index: 0,
            clip: None,
            corner_radius: 0.0,
            effects: Vec::new(),
            parent: None,
            children: Vec::new(),
            dirty: true,
            world: Mat4::IDENTITY,
            world_opacity: 1.0,
            screen_bounds: Rect::default(),
        }
    }
    pub fn parent(&self) -> Option<LayerId> {
        self.parent
    }
    pub fn children(&self) -> &[LayerId] {
        &self.children
    }
    pub fn world(&self) -> &Mat4 {
        &self.world
    }
    pub fn world_opacity(&self) -> f64 {
        self.world_opacity
    }
    pub fn screen_bounds(&self) -> Rect {
        self.screen_bounds
    }
}

#[derive(Debug, Clone)]
struct Slot {
    generation: u32,
    layer: Option<Layer>,
}

/// Upper bound on layers (protects against runaway creation).
pub const MAX_LAYERS: usize = 65_536;

#[derive(Debug, Clone, Default)]
pub struct LayerTree {
    slots: Vec<Slot>,
    free: Vec<u32>,
    roots: Vec<LayerId>,
    len: usize,
    pub(crate) pending_damage: Vec<Rect>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TreeError {
    StaleId,
    Cycle,
    Capacity,
}

impl LayerTree {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn len(&self) -> usize {
        self.len
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    pub fn roots(&self) -> &[LayerId] {
        &self.roots
    }

    pub fn get(&self, id: LayerId) -> Option<&Layer> {
        self.slots
            .get(id.index as usize)
            .filter(|s| s.generation == id.generation)
            .and_then(|s| s.layer.as_ref())
    }

    /// Mutable access marks the layer dirty (it will be recomposed).
    pub fn get_mut(&mut self, id: LayerId) -> Option<&mut Layer> {
        let l = self
            .slots
            .get_mut(id.index as usize)
            .filter(|s| s.generation == id.generation)
            .and_then(|s| s.layer.as_mut())?;
        l.dirty = true;
        Some(l)
    }

    pub fn insert(&mut self, layer: Layer, parent: Option<LayerId>) -> Result<LayerId, TreeError> {
        if self.len >= MAX_LAYERS {
            return Err(TreeError::Capacity);
        }
        if let Some(p) = parent {
            self.get(p).ok_or(TreeError::StaleId)?;
        }
        let id = match self.free.pop() {
            Some(i) => {
                let slot = &mut self.slots[i as usize];
                slot.generation = slot.generation.wrapping_add(1);
                slot.layer = Some(layer);
                LayerId {
                    index: i,
                    generation: slot.generation,
                }
            }
            None => {
                self.slots.push(Slot {
                    generation: 0,
                    layer: Some(layer),
                });
                LayerId {
                    index: (self.slots.len() - 1) as u32,
                    generation: 0,
                }
            }
        };
        self.len += 1;
        self.attach(id, parent);
        Ok(id)
    }

    fn attach(&mut self, id: LayerId, parent: Option<LayerId>) {
        if let Some(l) = self.slots[id.index as usize].layer.as_mut() {
            l.parent = parent;
            l.dirty = true;
        }
        match parent {
            Some(p) => {
                if let Some(pl) = self.slots[p.index as usize].layer.as_mut() {
                    pl.children.push(id);
                }
            }
            None => self.roots.push(id),
        }
    }

    fn detach(&mut self, id: LayerId) {
        let parent = self.get(id).and_then(|l| l.parent);
        match parent {
            Some(p) => {
                if let Some(pl) = self.slots[p.index as usize].layer.as_mut() {
                    pl.children.retain(|c| *c != id);
                }
            }
            None => self.roots.retain(|r| *r != id),
        }
    }

    pub fn reparent(&mut self, id: LayerId, new_parent: Option<LayerId>) -> Result<(), TreeError> {
        self.get(id).ok_or(TreeError::StaleId)?;
        if let Some(p) = new_parent {
            self.get(p).ok_or(TreeError::StaleId)?;
            // Reject cycles: new parent must not be inside `id`'s subtree.
            let mut cur = Some(p);
            while let Some(c) = cur {
                if c == id {
                    return Err(TreeError::Cycle);
                }
                cur = self.get(c).and_then(|l| l.parent);
            }
        }
        if let Some(l) = self.get(id) {
            self.pending_damage.push(l.screen_bounds);
        }
        self.detach(id);
        self.attach(id, new_parent);
        Ok(())
    }

    /// Removes a layer and its subtree; their last screen area is damaged.
    pub fn remove(&mut self, id: LayerId) -> Result<usize, TreeError> {
        self.get(id).ok_or(TreeError::StaleId)?;
        self.detach(id);
        let mut stack = vec![id];
        let mut removed = 0;
        while let Some(cur) = stack.pop() {
            let slot = &mut self.slots[cur.index as usize];
            if let Some(l) = slot.layer.take() {
                self.pending_damage.push(l.screen_bounds);
                stack.extend(l.children);
                self.free.push(cur.index);
                self.len -= 1;
                removed += 1;
            }
        }
        Ok(removed)
    }

    pub(crate) fn slot_mut(&mut self, id: LayerId) -> Option<&mut Layer> {
        self.slots
            .get_mut(id.index as usize)
            .filter(|s| s.generation == id.generation)
            .and_then(|s| s.layer.as_mut())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_remove_and_reuse_slots() {
        let mut t = LayerTree::new();
        let a = t
            .insert(Layer::new("a", Rect::new(0.0, 0.0, 10.0, 10.0)), None)
            .unwrap();
        let b = t
            .insert(Layer::new("b", Rect::new(0.0, 0.0, 5.0, 5.0)), Some(a))
            .unwrap();
        assert_eq!(t.len(), 2);
        assert_eq!(t.remove(a).unwrap(), 2);
        assert!(t.get(b).is_none());
        let c = t.insert(Layer::new("c", Rect::default()), None).unwrap();
        assert_ne!(c, a, "generation must change on reuse");
        assert!(t.get(a).is_none());
    }

    #[test]
    fn reparent_rejects_cycles() {
        let mut t = LayerTree::new();
        let a = t.insert(Layer::new("a", Rect::default()), None).unwrap();
        let b = t.insert(Layer::new("b", Rect::default()), Some(a)).unwrap();
        assert_eq!(t.reparent(a, Some(b)), Err(TreeError::Cycle));
        t.reparent(b, None).unwrap();
        assert_eq!(t.roots().len(), 2);
    }
}
