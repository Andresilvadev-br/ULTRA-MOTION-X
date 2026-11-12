use crate::def::{GraphDef, Interrupt, TransitionDef};
use crate::GraphError;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use umx_core::{AnimationSpec, Generator};

/// Events emitted by the graph runtime (drained with [`GraphRuntime::drain_events`]).
#[derive(Debug, Clone, PartialEq)]
pub enum GraphEvent {
    TransitionStarted {
        from: String,
        to: String,
        event: String,
    },
    TransitionInterrupted {
        from: String,
        to: String,
        by: String,
    },
    TransitionCompleted {
        to: String,
    },
    EventIgnored {
        event: String,
        reason: &'static str,
    },
    EventQueued {
        event: String,
    },
}

#[derive(Debug, Clone)]
struct Prop {
    value: f64,
    velocity: f64,
    goal: f64,
    gen: Option<Generator>,
    started: f64,
    gesture: bool,
}

#[derive(Debug, Clone)]
struct Active {
    from: String,
    to: String,
    interrupt: Interrupt,
}

/// Executes a [`GraphDef`].
#[derive(Debug, Clone)]
pub struct GraphRuntime {
    def: GraphDef,
    relation_order: Vec<usize>,
    state: String,
    active: Option<Active>,
    props: BTreeMap<String, Prop>,
    time: f64,
    conditions: BTreeSet<String>,
    pending: VecDeque<String>,
    events: Vec<GraphEvent>,
    reduced_motion: bool,
    /// Number of generator (re)builds — lets tests and telemetry verify incremental updates.
    pub rebuilds: u64,
}

impl GraphRuntime {
    pub fn new(def: GraphDef) -> Result<Self, GraphError> {
        let diags = def.validate();
        if GraphDef::has_errors(&diags) {
            return Err(GraphError::Invalid(diags));
        }
        let relation_order = def.relation_order().unwrap_or_default();
        let initial_goals = def.states.get(&def.initial).cloned().unwrap_or_default();
        let props = def
            .properties
            .iter()
            .map(|(name, p)| {
                let v = p.clamp(initial_goals.get(name).copied().unwrap_or(p.initial));
                (
                    name.clone(),
                    Prop {
                        value: v,
                        velocity: 0.0,
                        goal: v,
                        gen: None,
                        started: 0.0,
                        gesture: false,
                    },
                )
            })
            .collect();
        let mut rt = Self {
            state: def.initial.clone(),
            def,
            relation_order,
            active: None,
            props,
            time: 0.0,
            conditions: BTreeSet::new(),
            pending: VecDeque::new(),
            events: Vec::new(),
            reduced_motion: false,
            rebuilds: 0,
        };
        rt.apply_relations();
        Ok(rt)
    }

    pub fn def(&self) -> &GraphDef {
        &self.def
    }
    /// Current (or, during a transition, destination) state.
    pub fn state(&self) -> &str {
        self.active.as_ref().map_or(&self.state, |a| &a.to)
    }
    /// Last fully settled state.
    pub fn settled_state(&self) -> &str {
        &self.state
    }
    pub fn is_transitioning(&self) -> bool {
        self.active.is_some()
    }
    pub fn time(&self) -> f64 {
        self.time
    }

    /// When enabled, transitions jump to their goals (accessibility).
    pub fn set_reduced_motion(&mut self, on: bool) {
        self.reduced_motion = on;
    }

    pub fn set_condition(&mut self, name: &str, on: bool) {
        if on {
            self.conditions.insert(name.to_string());
        } else {
            self.conditions.remove(name);
        }
    }

    pub fn value(&self, prop: &str) -> Option<f64> {
        self.props.get(prop).map(|p| p.value)
    }
    pub fn velocity(&self, prop: &str) -> Option<f64> {
        self.props.get(prop).map(|p| p.velocity)
    }
    pub fn goal(&self, prop: &str) -> Option<f64> {
        self.props.get(prop).map(|p| p.goal)
    }
    pub fn values(&self) -> BTreeMap<String, f64> {
        self.props
            .iter()
            .map(|(k, p)| (k.clone(), p.value))
            .collect()
    }
    pub fn animating_count(&self) -> usize {
        self.props.values().filter(|p| p.gen.is_some()).count()
    }

    pub fn drain_events(&mut self) -> Vec<GraphEvent> {
        std::mem::take(&mut self.events)
    }

    fn find_transition(&self, from: &str, event: &str) -> Option<TransitionDef> {
        let guard_ok = |t: &TransitionDef| {
            t.guard
                .as_ref()
                .map_or(true, |g| self.conditions.contains(g))
        };
        self.def
            .transitions
            .iter()
            .find(|t| t.from == from && t.event == event && guard_ok(t))
            .or_else(|| {
                self.def
                    .transitions
                    .iter()
                    .find(|t| t.from == "*" && t.event == event && guard_ok(t))
            })
            .cloned()
    }

    /// Dispatches an event. Returns `true` when a transition started.
    pub fn send(&mut self, event: &str) -> Result<bool, GraphError> {
        let current = self.state().to_string();
        let Some(t) = self.find_transition(&current, event) else {
            self.events.push(GraphEvent::EventIgnored {
                event: event.to_string(),
                reason: "no matching transition",
            });
            return Ok(false);
        };
        if let Some(active) = self.active.clone() {
            match active.interrupt {
                Interrupt::Queue => {
                    self.pending.push_back(event.to_string());
                    self.events.push(GraphEvent::EventQueued {
                        event: event.to_string(),
                    });
                    return Ok(false);
                }
                Interrupt::Ignore => {
                    self.events.push(GraphEvent::EventIgnored {
                        event: event.to_string(),
                        reason: "transition is not interruptible",
                    });
                    return Ok(false);
                }
                Interrupt::Snap => self.snap_to_goals(),
                Interrupt::Retarget => {}
            }
            self.events.push(GraphEvent::TransitionInterrupted {
                from: active.from,
                to: active.to,
                by: event.to_string(),
            });
        }
        self.start_transition(&t)?;
        Ok(true)
    }

    fn start_transition(&mut self, t: &TransitionDef) -> Result<(), GraphError> {
        let from = self.state().to_string();
        let goals = self
            .def
            .states
            .get(&t.to)
            .cloned()
            .ok_or_else(|| GraphError::UnknownState(t.to.clone()))?;
        let default = t
            .spec
            .clone()
            .unwrap_or_else(|| self.def.default_spec.clone());
        for (name, goal) in goals {
            let def = self.def.properties.get(&name).cloned().unwrap_or_default();
            let goal = def.clamp(goal);
            let mut spec = t
                .property_specs
                .get(&name)
                .cloned()
                .unwrap_or_else(|| default.clone());
            if let Some(delay) = t.delays.get(&name) {
                spec = with_delay(spec, *delay);
            }
            self.retarget(&name, goal, &spec)?;
        }
        self.active = Some(Active {
            from: from.clone(),
            to: t.to.clone(),
            interrupt: t.interrupt,
        });
        self.events.push(GraphEvent::TransitionStarted {
            from,
            to: t.to.clone(),
            event: t.event.clone(),
        });
        if self.animating_count() == 0 {
            self.complete();
        }
        Ok(())
    }

    /// Retargets a single property; untouched when the goal is unchanged.
    fn retarget(&mut self, name: &str, goal: f64, spec: &AnimationSpec) -> Result<(), GraphError> {
        let reduced = self.reduced_motion;
        let time = self.time;
        let prop = self
            .props
            .get_mut(name)
            .ok_or_else(|| GraphError::UnknownProperty(name.to_string()))?;
        if prop.gesture {
            prop.goal = goal;
            return Ok(());
        }
        let same_goal = (prop.goal - goal).abs() < 1e-12;
        if same_goal && (prop.gen.is_some() || (prop.value - goal).abs() < 1e-12) {
            return Ok(());
        }
        prop.goal = goal;
        if reduced {
            prop.value = goal;
            prop.velocity = 0.0;
            prop.gen = None;
            return Ok(());
        }
        let v0 = if spec.preserves_velocity() {
            prop.velocity
        } else {
            0.0
        };
        prop.gen = Some(Generator::new(spec, prop.value, goal, v0)?);
        prop.started = time;
        self.rebuilds += 1;
        Ok(())
    }

    fn snap_to_goals(&mut self) {
        for p in self.props.values_mut().filter(|p| !p.gesture) {
            p.value = p.goal;
            p.velocity = 0.0;
            p.gen = None;
        }
        self.apply_relations();
        if let Some(a) = self.active.take() {
            self.state = a.to.clone();
            self.events
                .push(GraphEvent::TransitionCompleted { to: a.to });
        }
    }

    /// Jumps directly to a state without animation.
    pub fn jump_to(&mut self, state: &str) -> Result<(), GraphError> {
        let goals = self
            .def
            .states
            .get(state)
            .cloned()
            .ok_or_else(|| GraphError::UnknownState(state.to_string()))?;
        for (name, goal) in goals {
            if let Some(p) = self.props.get_mut(&name) {
                let g = self
                    .def
                    .properties
                    .get(&name)
                    .map_or(goal, |d| d.clamp(goal));
                p.value = g;
                p.goal = g;
                p.velocity = 0.0;
                p.gen = None;
            }
        }
        self.state = state.to_string();
        self.active = None;
        self.pending.clear();
        self.apply_relations();
        Ok(())
    }

    /// Advances by `dt` seconds.
    pub fn tick(&mut self, dt: f64) {
        if !dt.is_finite() || dt < 0.0 {
            return;
        }
        self.time += dt;
        let t = self.time;
        for p in self.props.values_mut() {
            if p.gesture {
                continue;
            }
            if let Some(g) = &p.gen {
                let s = g.sample(t - p.started);
                p.value = s.value;
                p.velocity = s.velocity;
                if s.done {
                    p.gen = None;
                    p.velocity = 0.0;
                }
            }
        }
        self.apply_relations();
        if self.active.is_some()
            && self.animating_count() == 0
            && !self.props.values().any(|p| p.gesture)
        {
            self.complete();
        }
    }

    fn complete(&mut self) {
        if let Some(a) = self.active.take() {
            self.state = a.to.clone();
            self.events
                .push(GraphEvent::TransitionCompleted { to: a.to });
        }
        while let Some(ev) = self.pending.pop_front() {
            if self.send(&ev).unwrap_or(false) {
                break;
            }
        }
    }

    fn apply_relations(&mut self) {
        for &i in &self.relation_order {
            let r = &self.def.relations[i];
            let Some(src) = self.props.get(&r.source) else {
                continue;
            };
            let (v, vel) = (src.value, src.velocity);
            let mapped = r.map(v);
            let slope = if r.clamp
                && (mapped == r.output[0] || mapped == r.output[1])
                && r.map(v + 1e-9) == mapped
            {
                0.0
            } else {
                r.slope()
            };
            if let Some(dst) = self.props.get_mut(&r.target) {
                dst.value = mapped;
                dst.goal = mapped;
                dst.velocity = vel * slope;
            }
        }
    }

    // ---- Gestures -------------------------------------------------------------------------

    /// Hands a property to direct manipulation. Any running animation on it stops at its
    /// current value; the graph will not animate it until [`end_gesture`](Self::end_gesture).
    pub fn begin_gesture(&mut self, prop: &str) -> Result<(), GraphError> {
        let p = self
            .props
            .get_mut(prop)
            .ok_or_else(|| GraphError::UnknownProperty(prop.to_string()))?;
        p.gesture = true;
        p.gen = None;
        Ok(())
    }

    /// Sets a gesture-owned property's value (and the measured pointer velocity).
    pub fn set_gesture_value(
        &mut self,
        prop: &str,
        value: f64,
        velocity: f64,
    ) -> Result<(), GraphError> {
        let def = self
            .def
            .properties
            .get(prop)
            .cloned()
            .ok_or_else(|| GraphError::UnknownProperty(prop.to_string()))?;
        let p = self
            .props
            .get_mut(prop)
            .ok_or_else(|| GraphError::UnknownProperty(prop.to_string()))?;
        if value.is_finite() {
            p.value = def.clamp(value);
        }
        if velocity.is_finite() {
            p.velocity = velocity;
        }
        self.apply_relations();
        Ok(())
    }

    /// Releases a gesture. If `event` is given, it is dispatched (e.g. chosen from the release
    /// projection); the release velocity carries into the resulting spring.
    pub fn end_gesture(
        &mut self,
        prop: &str,
        velocity: f64,
        event: Option<&str>,
        spec: Option<&AnimationSpec>,
    ) -> Result<(), GraphError> {
        {
            let p = self
                .props
                .get_mut(prop)
                .ok_or_else(|| GraphError::UnknownProperty(prop.to_string()))?;
            p.gesture = false;
            if velocity.is_finite() {
                p.velocity = velocity;
            }
        }
        let started = match event {
            Some(e) => self.send(e)?,
            None => false,
        };
        let p = &self.props[prop];
        if !started || p.gen.is_none() {
            let goal = p.goal;
            let spec = spec
                .cloned()
                .unwrap_or_else(|| self.def.default_spec.clone());
            // Force a rebuild even if the goal is unchanged: the value moved under the finger.
            if let Some(p) = self.props.get_mut(prop) {
                p.goal = f64::NAN;
            }
            self.retarget(prop, goal, &spec)?;
        }
        Ok(())
    }

    // ---- Live mutation ----------------------------------------------------------------------

    /// Changes a state's goal for one property at runtime. If the state is current, only that
    /// property is retargeted.
    pub fn set_state_value(
        &mut self,
        state: &str,
        prop: &str,
        value: f64,
    ) -> Result<(), GraphError> {
        if !self.def.properties.contains_key(prop) {
            return Err(GraphError::UnknownProperty(prop.to_string()));
        }
        self.def
            .states
            .get_mut(state)
            .ok_or_else(|| GraphError::UnknownState(state.to_string()))?
            .insert(prop.to_string(), value);
        if self.state() == state {
            let spec = self.def.default_spec.clone();
            let g = self.def.properties[prop].clamp(value);
            self.retarget(prop, g, &spec)?;
        }
        Ok(())
    }

    pub fn add_state(
        &mut self,
        name: &str,
        goals: BTreeMap<String, f64>,
    ) -> Result<(), GraphError> {
        for k in goals.keys() {
            if !self.def.properties.contains_key(k) {
                return Err(GraphError::UnknownProperty(k.clone()));
            }
        }
        self.def.states.insert(name.to_string(), goals);
        Ok(())
    }

    pub fn add_transition(&mut self, t: TransitionDef) -> Result<(), GraphError> {
        let mut candidate = self.def.clone();
        candidate.transitions.push(t);
        let diags = candidate.validate();
        if GraphDef::has_errors(&diags) {
            return Err(GraphError::Invalid(diags));
        }
        self.def = candidate;
        Ok(())
    }

    pub fn remove_transitions(&mut self, event: &str) -> usize {
        let before = self.def.transitions.len();
        self.def.transitions.retain(|t| t.event != event);
        before - self.def.transitions.len()
    }
}

fn with_delay(spec: AnimationSpec, d: f64) -> AnimationSpec {
    match spec {
        AnimationSpec::Tween {
            duration, easing, ..
        } => AnimationSpec::Tween {
            duration,
            easing,
            delay: d,
        },
        AnimationSpec::Spring { spring, .. } => AnimationSpec::Spring { spring, delay: d },
        AnimationSpec::Keyframes {
            keyframes,
            duration,
            ..
        } => AnimationSpec::Keyframes {
            keyframes,
            duration,
            delay: d,
        },
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::def::{PropertyDef, Relation};
    use umx_physics::SpringParams;

    fn panel() -> GraphDef {
        let mut properties = BTreeMap::new();
        properties.insert(
            "x".into(),
            PropertyDef {
                initial: -300.0,
                min: Some(-320.0),
                max: Some(0.0),
            },
        );
        properties.insert(
            "opacity".into(),
            PropertyDef {
                initial: 0.0,
                min: Some(0.0),
                max: Some(1.0),
            },
        );
        properties.insert("backdrop".into(), PropertyDef::default());
        let mut states = BTreeMap::new();
        states.insert(
            "closed".into(),
            BTreeMap::from([("x".into(), -300.0), ("opacity".into(), 0.0)]),
        );
        states.insert(
            "open".into(),
            BTreeMap::from([("x".into(), 0.0), ("opacity".into(), 1.0)]),
        );
        GraphDef {
            properties,
            states,
            initial: "closed".into(),
            transitions: vec![
                TransitionDef {
                    from: "closed".into(),
                    to: "open".into(),
                    event: "toggle".into(),
                    spec: None,
                    property_specs: BTreeMap::new(),
                    delays: BTreeMap::new(),
                    guard: None,
                    interrupt: Interrupt::Retarget,
                },
                TransitionDef {
                    from: "open".into(),
                    to: "closed".into(),
                    event: "toggle".into(),
                    spec: None,
                    property_specs: BTreeMap::new(),
                    delays: BTreeMap::new(),
                    guard: None,
                    interrupt: Interrupt::Retarget,
                },
            ],
            default_spec: AnimationSpec::spring(SpringParams::new(300.0, 30.0, 1.0).unwrap()),
            relations: vec![Relation {
                source: "x".into(),
                target: "backdrop".into(),
                input: [-300.0, 0.0],
                output: [0.0, 0.5],
                clamp: true,
            }],
        }
    }

    #[test]
    fn open_close_reopen_is_continuous() {
        let mut g = GraphRuntime::new(panel()).unwrap();
        g.send("toggle").unwrap();
        let mut last = g.value("x").unwrap();
        let mut max_jump: f64 = 0.0;
        let dt = 1.0 / 120.0;
        for frame in 0..240 {
            if frame == 10 || frame == 14 || frame == 30 {
                g.send("toggle").unwrap();
            }
            g.tick(dt);
            let x = g.value("x").unwrap();
            max_jump = max_jump.max((x - last).abs());
            last = x;
        }
        // Velocity-preserving retargets: per-frame displacement stays bounded (no teleport).
        assert!(max_jump < 40.0, "max jump {max_jump}");
        assert_eq!(g.state(), "closed");
        assert!(!g.is_transitioning());
        assert!((g.value("x").unwrap() + 300.0).abs() < 0.01);
    }

    #[test]
    fn relations_follow_source() {
        let mut g = GraphRuntime::new(panel()).unwrap();
        assert_eq!(g.value("backdrop"), Some(0.0));
        g.send("toggle").unwrap();
        for _ in 0..240 {
            g.tick(1.0 / 60.0);
        }
        assert!((g.value("backdrop").unwrap() - 0.5).abs() < 1e-3);
        let events = g.drain_events();
        assert!(events
            .iter()
            .any(|e| matches!(e, GraphEvent::TransitionCompleted { to } if to == "open")));
    }

    #[test]
    fn incremental_update_only_rebuilds_changed_property() {
        let mut g = GraphRuntime::new(panel()).unwrap();
        g.send("toggle").unwrap();
        let after_send = g.rebuilds;
        assert_eq!(after_send, 2);
        g.tick(0.05);
        g.set_state_value("open", "x", -20.0).unwrap();
        assert_eq!(g.rebuilds, after_send + 1, "only `x` must be rebuilt");
        for _ in 0..200 {
            g.tick(1.0 / 60.0);
        }
        assert!((g.value("x").unwrap() + 20.0).abs() < 0.01);
    }

    #[test]
    fn queue_and_ignore_policies() {
        let mut def = panel();
        def.transitions[0].interrupt = Interrupt::Ignore;
        let mut g = GraphRuntime::new(def.clone()).unwrap();
        g.send("toggle").unwrap();
        g.tick(0.01);
        assert!(!g.send("toggle").unwrap());
        def.transitions[0].interrupt = Interrupt::Queue;
        let mut q = GraphRuntime::new(def).unwrap();
        q.send("toggle").unwrap();
        q.tick(0.01);
        assert!(!q.send("toggle").unwrap());
        for _ in 0..240 {
            q.tick(1.0 / 60.0);
        }
        // The queued toggle ran after "open" completed and brought it back to closed.
        assert_eq!(q.state(), "closed");
    }

    #[test]
    fn guards() {
        let mut def = panel();
        def.transitions[0].guard = Some("enabled".into());
        let mut g = GraphRuntime::new(def).unwrap();
        assert!(!g.send("toggle").unwrap());
        g.set_condition("enabled", true);
        assert!(g.send("toggle").unwrap());
    }

    #[test]
    fn gesture_handoff_keeps_velocity() {
        let mut g = GraphRuntime::new(panel()).unwrap();
        g.begin_gesture("x").unwrap();
        g.set_gesture_value("x", -150.0, 900.0).unwrap();
        assert_eq!(g.value("backdrop"), Some(0.25));
        g.end_gesture("x", 900.0, Some("toggle"), None).unwrap();
        assert_eq!(g.velocity("x"), Some(900.0));
        g.tick(1e-4);
        assert!(g.velocity("x").unwrap() > 800.0);
        for _ in 0..240 {
            g.tick(1.0 / 60.0);
        }
        assert_eq!(g.state(), "open");
    }

    #[test]
    fn validation_catches_errors() {
        let mut def = panel();
        def.states
            .get_mut("open")
            .unwrap()
            .insert("ghost".into(), 1.0);
        def.relations.push(Relation {
            source: "backdrop".into(),
            target: "x".into(),
            input: [0.0, 1.0],
            output: [0.0, 1.0],
            clamp: true,
        });
        let diags = def.validate();
        let codes: Vec<&str> = diags.iter().map(|d| d.code.as_str()).collect();
        assert!(codes.contains(&"E_UNKNOWN_PROPERTY"));
        assert!(codes.contains(&"E_CYCLE"));
        assert!(codes.contains(&"E_OWNERSHIP"));
        assert!(GraphRuntime::new(def).is_err());
    }

    #[test]
    fn reduced_motion_jumps() {
        let mut g = GraphRuntime::new(panel()).unwrap();
        g.set_reduced_motion(true);
        g.send("toggle").unwrap();
        assert_eq!(g.value("x"), Some(0.0));
        assert!(!g.is_transitioning());
    }

    #[test]
    fn deterministic_across_refresh_rates() {
        let run = |hz: f64| {
            let mut g = GraphRuntime::new(panel()).unwrap();
            g.send("toggle").unwrap();
            let frames = (0.25 * hz) as usize;
            for _ in 0..frames {
                g.tick(1.0 / hz);
            }
            g.value("x").unwrap()
        };
        let (a, b, c) = (run(60.0), run(144.0), run(240.0));
        assert!((a - b).abs() < 1e-6 && (a - c).abs() < 1e-6, "{a} {b} {c}");
    }
}
