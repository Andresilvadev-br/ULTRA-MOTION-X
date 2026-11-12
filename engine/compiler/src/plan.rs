//! Execution plan: the compiled, serialisable output consumed by every runtime.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use umx_core::{AnimationSpec, Priority};
use umx_graph::{GraphDef, Interrupt, PropertyDef, Relation, TransitionDef};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositorHint {
    /// CSS easing (`cubic-bezier(...)` or baked `linear(...)` for springs started at rest).
    pub easing: String,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledSpec {
    pub spec: AnimationSpec,
    #[serde(default)]
    pub compositor: Option<CompositorHint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledTransition {
    pub from: String,
    pub to: String,
    pub event: String,
    pub spec: Option<usize>,
    #[serde(default)]
    pub property_specs: BTreeMap<String, usize>,
    /// Seconds.
    #[serde(default)]
    pub delays: BTreeMap<String, f64>,
    #[serde(default)]
    pub guard: Option<String>,
    #[serde(default)]
    pub interrupt: Interrupt,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledGesture {
    pub kind: String,
    pub property: String,
    pub axis: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub rubber_band: f64,
    pub snap_points: Vec<f64>,
    pub snap_states: Vec<String>,
    pub fling_threshold: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledComponent {
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub priority: Priority,
    pub properties: BTreeMap<String, PropertyDef>,
    #[serde(default)]
    pub units: BTreeMap<String, String>,
    pub states: BTreeMap<String, BTreeMap<String, f64>>,
    pub initial: String,
    pub default_spec: usize,
    pub transitions: Vec<CompiledTransition>,
    #[serde(default)]
    pub relations: Vec<Relation>,
    #[serde(default)]
    pub gestures: Vec<CompiledGesture>,
    #[serde(default)]
    pub effects: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEntry {
    pub component: String,
    pub property: String,
    /// Seconds.
    pub start: f64,
    pub duration: f64,
    pub spec: usize,
    pub from: Option<f64>,
    pub to: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledTimeline {
    pub duration: f64,
    pub entries: Vec<TimelineEntry>,
    pub labels: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FidelityPlan {
    pub min: u8,
    pub max: u8,
    pub initial: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformancePlan {
    pub fidelity: FidelityPlan,
    pub budget_fraction: f64,
}

impl Default for PerformancePlan {
    fn default() -> Self {
        Self {
            fidelity: FidelityPlan {
                min: 0,
                max: 4,
                initial: 3,
            },
            budget_fraction: 0.5,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityPlan {
    /// `user` (follow platform preference), `always` or `never`.
    pub reduced_motion: String,
    pub max_intensity: f64,
}

impl Default for AccessibilityPlan {
    fn default() -> Self {
        Self {
            reduced_motion: "user".into(),
            max_intensity: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanStats {
    pub components: usize,
    pub states: usize,
    pub transitions: usize,
    pub spec_requests: usize,
    pub unique_specs: usize,
    pub removed_noop_transitions: usize,
    pub removed_redundant_property_specs: usize,
    pub folded_relations: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlan {
    pub plan_version: u32,
    #[serde(default)]
    pub name: Option<String>,
    pub profile: String,
    pub specs: Vec<CompiledSpec>,
    pub components: BTreeMap<String, CompiledComponent>,
    #[serde(default)]
    pub timelines: BTreeMap<String, CompiledTimeline>,
    #[serde(default)]
    pub effects: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub performance: PerformancePlan,
    #[serde(default)]
    pub accessibility: AccessibilityPlan,
    #[serde(default)]
    pub stats: PlanStats,
}

impl ExecutionPlan {
    pub fn spec(&self, idx: usize) -> Option<&AnimationSpec> {
        self.specs.get(idx).map(|s| &s.spec)
    }

    /// Materialises a component as a [`GraphDef`] for `umx-graph`.
    pub fn graph_def(&self, component: &str) -> Option<GraphDef> {
        let c = self.components.get(component)?;
        let get = |i: usize| self.specs.get(i).map(|s| s.spec.clone());
        Some(GraphDef {
            properties: c.properties.clone(),
            states: c.states.clone(),
            initial: c.initial.clone(),
            transitions: c
                .transitions
                .iter()
                .map(|t| TransitionDef {
                    from: t.from.clone(),
                    to: t.to.clone(),
                    event: t.event.clone(),
                    spec: t.spec.and_then(get),
                    property_specs: t
                        .property_specs
                        .iter()
                        .filter_map(|(k, i)| get(*i).map(|s| (k.clone(), s)))
                        .collect(),
                    delays: t.delays.clone(),
                    guard: t.guard.clone(),
                    interrupt: t.interrupt,
                })
                .collect(),
            default_spec: get(c.default_spec)?,
            relations: c.relations.clone(),
        })
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".into())
    }

    pub fn from_json(s: &str) -> Result<Self, String> {
        let p: Self = serde_json::from_str(s).map_err(|e| e.to_string())?;
        if p.plan_version != crate::PLAN_VERSION {
            return Err(format!("unsupported plan version {}", p.plan_version));
        }
        Ok(p)
    }
}
