use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use umx_core::AnimationSpec;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// A validation finding with a JSON-path-like location.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub code: String,
    pub path: String,
    pub message: String,
}

impl Diagnostic {
    pub fn error(code: &str, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            code: code.into(),
            path: path.into(),
            message: message.into(),
        }
    }
    pub fn warning(code: &str, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Warning,
            code: code.into(),
            path: path.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PropertyDef {
    #[serde(default)]
    pub initial: f64,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
}

impl PropertyDef {
    pub fn clamp(&self, v: f64) -> f64 {
        let mut v = v;
        if let Some(m) = self.min {
            v = v.max(m);
        }
        if let Some(m) = self.max {
            v = v.min(m);
        }
        v
    }
}

/// What happens when an event arrives while a transition is still running.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Interrupt {
    /// Retarget in-flight properties preserving velocity (default).
    #[default]
    Retarget,
    /// Wait until the running transition completes.
    Queue,
    /// Drop the event.
    Ignore,
    /// Jump the running transition to its end, then start the new one.
    Snap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionDef {
    /// Source state, or `"*"` for any state.
    pub from: String,
    pub to: String,
    pub event: String,
    #[serde(default)]
    pub spec: Option<AnimationSpec>,
    #[serde(default)]
    pub property_specs: BTreeMap<String, AnimationSpec>,
    /// Per-property delays (s), e.g. for choreography inside a component.
    #[serde(default)]
    pub delays: BTreeMap<String, f64>,
    /// Name of a condition that must be set for the transition to fire.
    #[serde(default)]
    pub guard: Option<String>,
    /// Behaviour of *later* events arriving while this transition runs.
    #[serde(default)]
    pub interrupt: Interrupt,
}

/// `target = output0 + (source − input0) · (output1 − output0) / (input1 − input0)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub source: String,
    pub target: String,
    pub input: [f64; 2],
    pub output: [f64; 2],
    #[serde(default = "yes")]
    pub clamp: bool,
}

fn yes() -> bool {
    true
}

impl Relation {
    pub fn map(&self, v: f64) -> f64 {
        let [i0, i1] = self.input;
        let [o0, o1] = self.output;
        if i1 == i0 {
            return o0;
        }
        let mut t = (v - i0) / (i1 - i0);
        if self.clamp {
            t = t.clamp(0.0, 1.0);
        }
        o0 + (o1 - o0) * t
    }
    pub fn slope(&self) -> f64 {
        let [i0, i1] = self.input;
        let [o0, o1] = self.output;
        if i1 == i0 {
            0.0
        } else {
            (o1 - o0) / (i1 - i0)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDef {
    pub properties: BTreeMap<String, PropertyDef>,
    pub states: BTreeMap<String, BTreeMap<String, f64>>,
    pub initial: String,
    #[serde(default)]
    pub transitions: Vec<TransitionDef>,
    pub default_spec: AnimationSpec,
    #[serde(default)]
    pub relations: Vec<Relation>,
}

impl GraphDef {
    /// Validates references, constraints, relation cycles and reachability.
    pub fn validate(&self) -> Vec<Diagnostic> {
        let mut d = Vec::new();
        if !self.states.contains_key(&self.initial) {
            d.push(Diagnostic::error(
                "E_INITIAL",
                "initial",
                format!("initial state `{}` is not defined", self.initial),
            ));
        }
        if let Err(e) = self.default_spec.validate() {
            d.push(Diagnostic::error("E_SPEC", "defaultSpec", e.to_string()));
        }
        let relation_targets: BTreeSet<&str> =
            self.relations.iter().map(|r| r.target.as_str()).collect();
        for (sname, goals) in &self.states {
            for (p, v) in goals {
                let path = format!("states.{sname}.{p}");
                match self.properties.get(p) {
                    None => d.push(Diagnostic::error(
                        "E_UNKNOWN_PROPERTY",
                        path,
                        format!("property `{p}` is not declared"),
                    )),
                    Some(def) => {
                        if !v.is_finite() {
                            d.push(Diagnostic::error(
                                "E_VALUE",
                                path.clone(),
                                "value must be finite",
                            ));
                        } else if def.clamp(*v) != *v {
                            d.push(Diagnostic::warning(
                                "W_CONSTRAINT",
                                path.clone(),
                                "value violates property constraints and will be clamped",
                            ));
                        }
                        if relation_targets.contains(p.as_str()) {
                            d.push(Diagnostic::error(
                                "E_OWNERSHIP",
                                path,
                                format!("`{p}` is driven by a relation and cannot also be set by states"),
                            ));
                        }
                    }
                }
            }
        }
        for (i, t) in self.transitions.iter().enumerate() {
            let path = format!("transitions[{i}]");
            if t.from != "*" && !self.states.contains_key(&t.from) {
                d.push(Diagnostic::error(
                    "E_UNKNOWN_STATE",
                    format!("{path}.from"),
                    format!("state `{}` is not defined", t.from),
                ));
            }
            if !self.states.contains_key(&t.to) {
                d.push(Diagnostic::error(
                    "E_UNKNOWN_STATE",
                    format!("{path}.to"),
                    format!("state `{}` is not defined", t.to),
                ));
            }
            if t.event.is_empty() {
                d.push(Diagnostic::error(
                    "E_EVENT",
                    format!("{path}.event"),
                    "event name must not be empty",
                ));
            }
            if let Some(s) = &t.spec {
                if let Err(e) = s.validate() {
                    d.push(Diagnostic::error(
                        "E_SPEC",
                        format!("{path}.spec"),
                        e.to_string(),
                    ));
                }
            }
            for (p, s) in &t.property_specs {
                if !self.properties.contains_key(p) {
                    d.push(Diagnostic::error(
                        "E_UNKNOWN_PROPERTY",
                        format!("{path}.propertySpecs.{p}"),
                        format!("property `{p}` is not declared"),
                    ));
                }
                if let Err(e) = s.validate() {
                    d.push(Diagnostic::error(
                        "E_SPEC",
                        format!("{path}.propertySpecs.{p}"),
                        e.to_string(),
                    ));
                }
            }
            for (p, v) in &t.delays {
                if !v.is_finite() || *v < 0.0 {
                    d.push(Diagnostic::error(
                        "E_DELAY",
                        format!("{path}.delays.{p}"),
                        "delay must be ≥ 0",
                    ));
                }
            }
            if t.from == t.to {
                d.push(Diagnostic::warning(
                    "W_SELF_TRANSITION",
                    path.clone(),
                    "transition targets its own source state",
                ));
            }
        }
        // Ambiguity: same (from, event, guard) twice.
        let mut seen = BTreeSet::new();
        for (i, t) in self.transitions.iter().enumerate() {
            if !seen.insert((t.from.clone(), t.event.clone(), t.guard.clone())) {
                d.push(Diagnostic::warning(
                    "W_AMBIGUOUS",
                    format!("transitions[{i}]"),
                    "an earlier transition with the same source, event and guard shadows this one",
                ));
            }
        }
        for (i, r) in self.relations.iter().enumerate() {
            for p in [&r.source, &r.target] {
                if !self.properties.contains_key(p) {
                    d.push(Diagnostic::error(
                        "E_UNKNOWN_PROPERTY",
                        format!("relations[{i}]"),
                        format!("property `{p}` is not declared"),
                    ));
                }
            }
            if ![r.input[0], r.input[1], r.output[0], r.output[1]]
                .iter()
                .all(|v| v.is_finite())
            {
                d.push(Diagnostic::error(
                    "E_VALUE",
                    format!("relations[{i}]"),
                    "relation ranges must be finite",
                ));
            }
        }
        if self.relation_order().is_none() {
            d.push(Diagnostic::error(
                "E_CYCLE",
                "relations",
                "relations contain a dependency cycle",
            ));
        }
        // Reachability (warning only).
        if self.states.contains_key(&self.initial) {
            let mut reach = BTreeSet::from([self.initial.clone()]);
            let mut q = VecDeque::from([self.initial.clone()]);
            while let Some(s) = q.pop_front() {
                for t in &self.transitions {
                    if (t.from == s || t.from == "*") && reach.insert(t.to.clone()) {
                        q.push_back(t.to.clone());
                    }
                }
            }
            for s in self.states.keys() {
                if !reach.contains(s) {
                    d.push(Diagnostic::warning(
                        "W_UNREACHABLE",
                        format!("states.{s}"),
                        format!("state `{s}` is not reachable from `{}`", self.initial),
                    ));
                }
            }
        }
        d
    }

    pub fn has_errors(diags: &[Diagnostic]) -> bool {
        diags.iter().any(|d| d.severity == Severity::Error)
    }

    /// Topological order of relations (Kahn). `None` when a cycle exists.
    #[allow(clippy::needless_range_loop)]
    pub fn relation_order(&self) -> Option<Vec<usize>> {
        let n = self.relations.len();
        let mut indeg = vec![0usize; n];
        // Edge i → j when relation j reads what relation i writes.
        let mut edges = vec![Vec::new(); n];
        for i in 0..n {
            for j in 0..n {
                if i != j && self.relations[i].target == self.relations[j].source {
                    edges[i].push(j);
                    indeg[j] += 1;
                }
            }
            if self.relations[i].target == self.relations[i].source {
                return None;
            }
        }
        let mut q: VecDeque<usize> = (0..n).filter(|&i| indeg[i] == 0).collect();
        let mut out = Vec::with_capacity(n);
        while let Some(i) = q.pop_front() {
            out.push(i);
            for &j in &edges[i] {
                indeg[j] -= 1;
                if indeg[j] == 0 {
                    q.push_back(j);
                }
            }
        }
        (out.len() == n).then_some(out)
    }
}
