//! Composition pass: world transforms, opacity, culling, effect scaling and damage.

use crate::effects::Effect;
use crate::layer::{LayerId, LayerTree};
use crate::math::{Mat4, Rect};
use serde::Serialize;
use umx_scheduler::fidelity::FidelitySettings;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawCommand {
    pub layer: LayerId,
    pub matrix: Mat4,
    pub opacity: f64,
    pub clip: Option<Rect>,
    pub corner_radius: f64,
    pub effects: Vec<Effect>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawList {
    pub commands: Vec<DrawCommand>,
    /// Union of regions that changed since the previous composition.
    pub damage: Option<Rect>,
    pub culled: usize,
    pub recomputed: usize,
    pub decorative_skipped: usize,
}

#[derive(Debug, Clone)]
pub struct Composer {
    pub viewport: Rect,
    pub fidelity: FidelitySettings,
}

impl Composer {
    pub fn new(viewport: Rect) -> Self {
        Self {
            viewport,
            fidelity: FidelitySettings::for_level(3),
        }
    }

    pub fn compose(&self, tree: &mut LayerTree) -> DrawList {
        let mut out = DrawList::default();
        let mut damage: Option<Rect> = None;
        for r in std::mem::take(&mut tree.pending_damage) {
            damage = Some(damage.map_or(r, |d| d.union(&r)));
        }
        let mut decorative_layers = 0u32;
        let roots: Vec<(i32, usize, LayerId)> = tree
            .roots()
            .iter()
            .enumerate()
            .map(|(i, id)| (tree.get(*id).map_or(0, |l| l.z_index), i, *id))
            .collect();
        let mut stack: Vec<(LayerId, Mat4, f64, bool, Option<Rect>)> = Vec::new();
        let mut ordered = roots;
        ordered.sort_by_key(|(z, i, _)| (*z, *i));
        for (_, _, id) in ordered.into_iter().rev() {
            stack.push((id, Mat4::IDENTITY, 1.0, false, None));
        }
        while let Some((id, parent_world, parent_opacity, parent_dirty, parent_clip)) = stack.pop()
        {
            let Some(layer) = tree.slot_mut(id) else {
                continue;
            };
            let dirty = layer.dirty || parent_dirty;
            if dirty {
                let old = layer.screen_bounds;
                layer.world = parent_world.mul(&layer.transform.matrix(&layer.bounds));
                layer.world_opacity = parent_opacity * layer.opacity.clamp(0.0, 1.0);
                let outset = layer.effects.iter().map(Effect::outset).fold(0.0, f64::max);
                layer.screen_bounds = layer.world.bounds(&layer.bounds).inflate(outset);
                let changed = old.union(&layer.screen_bounds);
                damage = Some(damage.map_or(changed, |d| d.union(&changed)));
                layer.dirty = false;
                out.recomputed += 1;
            }
            let clip = match (layer.clip.map(|c| layer.world.bounds(&c)), parent_clip) {
                (Some(a), Some(b)) => Some(intersect(&a, &b)),
                (a, b) => a.or(b),
            };
            let invisible = !layer.visible
                || layer.world_opacity <= 0.0
                || !layer.screen_bounds.intersects(&self.viewport);
            let world = layer.world;
            let opacity = layer.world_opacity;
            let mut children: Vec<(i32, usize, LayerId)> = Vec::new();
            let child_ids = layer.children.clone();
            let corner = layer.corner_radius;
            let effects_src = layer.effects.clone();
            if invisible {
                out.culled += 1;
            } else {
                let mut effects = Vec::new();
                for e in &effects_src {
                    if e.is_decorative() {
                        if decorative_layers >= self.fidelity.max_decorative_layers {
                            out.decorative_skipped += 1;
                            continue;
                        }
                        decorative_layers += 1;
                    }
                    match e.scaled(&self.fidelity) {
                        Some(s) => effects.push(s),
                        None => out.decorative_skipped += 1,
                    }
                }
                out.commands.push(DrawCommand {
                    layer: id,
                    matrix: world,
                    opacity,
                    clip,
                    corner_radius: corner,
                    effects,
                });
            }
            if layer_visible_for_children(tree, id) {
                for (i, c) in child_ids.iter().enumerate() {
                    children.push((tree.get(*c).map_or(0, |l| l.z_index), i, *c));
                }
                children.sort_by_key(|(z, i, _)| (*z, *i));
                for (_, _, c) in children.into_iter().rev() {
                    stack.push((c, world, opacity, dirty, clip));
                }
            }
        }
        out.damage = damage.filter(|d| !d.is_empty());
        out
    }
}

fn layer_visible_for_children(tree: &LayerTree, id: LayerId) -> bool {
    tree.get(id).is_some_and(|l| l.visible)
}

fn intersect(a: &Rect, b: &Rect) -> Rect {
    let x0 = a.x.max(b.x);
    let y0 = a.y.max(b.y);
    let x1 = (a.x + a.w).min(b.x + b.w);
    let y1 = (a.y + a.h).min(b.y + b.h);
    Rect::new(x0, y0, (x1 - x0).max(0.0), (y1 - y0).max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layer::Layer;

    fn tree() -> (LayerTree, LayerId, LayerId) {
        let mut t = LayerTree::new();
        let root = t
            .insert(Layer::new("root", Rect::new(0.0, 0.0, 800.0, 600.0)), None)
            .unwrap();
        let child = t
            .insert(
                Layer::new("child", Rect::new(100.0, 100.0, 50.0, 50.0)),
                Some(root),
            )
            .unwrap();
        (t, root, child)
    }

    #[test]
    fn inherits_transform_and_opacity() {
        let (mut t, root, child) = tree();
        t.get_mut(root).unwrap().transform.x = 10.0;
        t.get_mut(root).unwrap().opacity = 0.5;
        t.get_mut(child).unwrap().opacity = 0.5;
        let c = Composer::new(Rect::new(0.0, 0.0, 800.0, 600.0));
        let dl = c.compose(&mut t);
        assert_eq!(dl.commands.len(), 2);
        let cc = dl.commands.iter().find(|c| c.layer == child).unwrap();
        assert!((cc.opacity - 0.25).abs() < 1e-12);
        assert_eq!(cc.matrix.transform_point(100.0, 100.0), (110.0, 100.0));
    }

    #[test]
    fn partial_updates_only_recompute_dirty_subtrees() {
        let (mut t, _root, child) = tree();
        let c = Composer::new(Rect::new(0.0, 0.0, 800.0, 600.0));
        c.compose(&mut t);
        let idle = c.compose(&mut t);
        assert_eq!(idle.recomputed, 0);
        assert!(idle.damage.is_none(), "nothing changed ⇒ no damage");
        t.get_mut(child).unwrap().transform.x = 20.0;
        let dl = c.compose(&mut t);
        assert_eq!(dl.recomputed, 1);
        let dmg = dl.damage.unwrap();
        assert_eq!(dmg, Rect::new(100.0, 100.0, 70.0, 50.0));
    }

    #[test]
    fn culls_offscreen_and_transparent() {
        let (mut t, _root, child) = tree();
        t.get_mut(child).unwrap().transform.x = 5000.0;
        let c = Composer::new(Rect::new(0.0, 0.0, 800.0, 600.0));
        let dl = c.compose(&mut t);
        assert_eq!(dl.culled, 1);
        t.get_mut(child).unwrap().transform.x = 0.0;
        t.get_mut(child).unwrap().opacity = 0.0;
        assert_eq!(c.compose(&mut t).culled, 1);
    }

    #[test]
    fn decorative_budget_and_removal_damage() {
        let (mut t, root, child) = tree();
        for _ in 0..5 {
            t.get_mut(child).unwrap().effects.push(Effect::Material {
                id: 1,
                intensity: 1.0,
            });
        }
        let mut c = Composer::new(Rect::new(0.0, 0.0, 800.0, 600.0));
        c.fidelity = FidelitySettings::for_level(1);
        let dl = c.compose(&mut t);
        assert_eq!(
            dl.decorative_skipped, 5,
            "level 1 disables shader materials"
        );
        t.remove(child).unwrap();
        let dl = c.compose(&mut t);
        assert!(dl.damage.is_some());
        assert_eq!(dl.commands.len(), 1);
        assert!(t.get(root).is_some());
    }
}
