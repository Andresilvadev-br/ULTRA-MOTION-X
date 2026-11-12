use crate::handle::{Arena, Handle};
use crate::RuntimeError;
use serde::Serialize;
use std::collections::BTreeMap;
use umx_compiler::plan::ExecutionPlan;
use umx_core::{AnimationSpec, Arbiter, Generator, Grant, InterruptPolicy, Priority, PropertyKey};
use umx_graph::GraphRuntime;
use umx_scheduler::fidelity::{FidelityConfig, FidelityController, FidelitySettings};
use umx_scheduler::refresh::RefreshEstimator;
use umx_telemetry::{FrameStats, Report};

/// Hard cap on live motion values per engine instance.
pub const MAX_VALUES: usize = 1 << 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    /// Clamp for a single frame delta (s); longer stalls are treated as this long for
    /// physics-based animations. Time-based tweens still finish on schedule because they
    /// are sampled from absolute elapsed time.
    pub max_delta: f64,
    /// When set, `frame()` ignores timestamps and advances by exactly this step (s):
    /// deterministic simulation (tests, replays, servers).
    pub fixed_step: Option<f64>,
    pub reduced_motion: bool,
    pub fidelity: FidelityConfig,
    pub telemetry_window: usize,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            max_delta: 0.1,
            fixed_step: None,
            reduced_motion: false,
            fidelity: FidelityConfig::default(),
            telemetry_window: 240,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AnimationEventKind {
    Started,
    Completed,
    Interrupted,
    Cancelled,
    Rejected,
    Queued,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationEvent {
    pub value: u64,
    pub animation: u64,
    pub kind: AnimationEventKind,
}

#[derive(Debug, Clone)]
struct Running {
    id: u64,
    gen: Generator,
    started: f64,
}

#[derive(Debug, Clone)]
struct Queued {
    id: u64,
    spec: AnimationSpec,
    to: f64,
}

#[derive(Debug, Clone)]
struct Value {
    value: f64,
    velocity: f64,
    running: Option<Running>,
    additive: Vec<(Running, f64)>,
    queued: Vec<Queued>,
    min: f64,
    max: f64,
}

#[derive(Debug, Clone)]
struct Instance {
    component: String,
    graph: GraphRuntime,
}

#[derive(Debug, Clone)]
struct Player {
    timeline: String,
    bindings: BTreeMap<String, Handle>,
    time: f64,
    rate: f64,
    paused: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStats {
    pub values: usize,
    pub value_slots: usize,
    pub animating: usize,
    pub instances: usize,
    pub timelines_playing: usize,
    pub pending_events: usize,
}

/// The Ultra Motion runtime.
#[derive(Debug)]
pub struct Engine {
    config: EngineConfig,
    time: f64,
    last_timestamp: Option<f64>,
    values: Arena<Value>,
    instances: Arena<Instance>,
    players: Arena<Player>,
    arbiter: Arbiter,
    next_anim: u64,
    events: Vec<AnimationEvent>,
    plan: Option<ExecutionPlan>,
    refresh: RefreshEstimator,
    fidelity: FidelityController,
    stats: FrameStats,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new(EngineConfig::default())
    }
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        Self {
            fidelity: FidelityController::new(config.fidelity),
            stats: FrameStats::new(config.telemetry_window),
            config,
            time: 0.0,
            last_timestamp: None,
            values: Arena::default(),
            instances: Arena::default(),
            players: Arena::default(),
            arbiter: Arbiter::new(),
            next_anim: 1,
            events: Vec::new(),
            plan: None,
            refresh: RefreshEstimator::new(),
        }
    }

    pub fn config(&self) -> &EngineConfig {
        &self.config
    }
    pub fn time(&self) -> f64 {
        self.time
    }

    pub fn set_reduced_motion(&mut self, on: bool) {
        self.config.reduced_motion = on;
        for (_, inst) in self.instances.iter_mut() {
            inst.graph.set_reduced_motion(on);
        }
    }

    // ---------------------------------------------------------------- values

    pub fn create_value(&mut self, initial: f64) -> Result<Handle, RuntimeError> {
        if !initial.is_finite() {
            return Err(RuntimeError::InvalidArgument(
                "initial value must be finite".into(),
            ));
        }
        if self.values.len() >= MAX_VALUES {
            return Err(RuntimeError::Capacity(MAX_VALUES));
        }
        Ok(self.values.insert(Value {
            value: initial,
            velocity: 0.0,
            running: None,
            additive: Vec::new(),
            queued: Vec::new(),
            min: f64::NEG_INFINITY,
            max: f64::INFINITY,
        }))
    }

    pub fn destroy_value(&mut self, h: Handle) -> Result<(), RuntimeError> {
        self.values.remove(h).ok_or(RuntimeError::InvalidHandle)?;
        self.arbiter.forget_target(h.0);
        Ok(())
    }

    pub fn set_bounds(&mut self, h: Handle, min: f64, max: f64) -> Result<(), RuntimeError> {
        if min.is_nan() || max.is_nan() || min > max {
            return Err(RuntimeError::InvalidArgument(
                "bounds must satisfy min ≤ max".into(),
            ));
        }
        let v = self.values.get_mut(h).ok_or(RuntimeError::InvalidHandle)?;
        v.min = min;
        v.max = max;
        v.value = v.value.clamp(min, max);
        Ok(())
    }

    pub fn get(&self, h: Handle) -> Result<f64, RuntimeError> {
        let v = self.values.get(h).ok_or(RuntimeError::InvalidHandle)?;
        let add: f64 = v.additive.iter().map(|(_, x)| *x).sum();
        Ok((v.value + add).clamp(v.min, v.max))
    }

    pub fn velocity(&self, h: Handle) -> Result<f64, RuntimeError> {
        Ok(self
            .values
            .get(h)
            .ok_or(RuntimeError::InvalidHandle)?
            .velocity)
    }

    pub fn is_animating(&self, h: Handle) -> bool {
        self.values
            .get(h)
            .is_some_and(|v| v.running.is_some() || !v.additive.is_empty())
    }

    /// Sets a value immediately (e.g. under a finger). Cancels its animation.
    pub fn set(&mut self, h: Handle, value: f64, velocity: f64) -> Result<(), RuntimeError> {
        if !value.is_finite() {
            return Err(RuntimeError::InvalidArgument("value must be finite".into()));
        }
        let v = self.values.get_mut(h).ok_or(RuntimeError::InvalidHandle)?;
        v.value = value.clamp(v.min, v.max);
        v.velocity = if velocity.is_finite() { velocity } else { 0.0 };
        if let Some(r) = v.running.take() {
            self.events.push(AnimationEvent {
                value: h.0,
                animation: r.id,
                kind: AnimationEventKind::Cancelled,
            });
            self.arbiter.release_all(r.id);
        }
        Ok(())
    }

    /// Animates `h` to `to`. Returns the animation id. Interruptions retarget from the
    /// current position *and* velocity.
    pub fn animate(
        &mut self,
        h: Handle,
        to: f64,
        spec: &AnimationSpec,
        priority: Priority,
        policy: InterruptPolicy,
    ) -> Result<u64, RuntimeError> {
        spec.validate()?;
        if !to.is_finite()
            && !matches!(
                spec,
                AnimationSpec::Decay { .. } | AnimationSpec::Inertia { .. }
            )
        {
            return Err(RuntimeError::InvalidArgument(
                "target must be finite".into(),
            ));
        }
        let id = self.next_anim;
        self.next_anim += 1;
        let key = PropertyKey::new(h.0, "value");
        let reduced = self.config.reduced_motion;
        let time = self.time;
        let v = self.values.get_mut(h).ok_or(RuntimeError::InvalidHandle)?;
        let to_c = if to.is_finite() {
            to.clamp(v.min, v.max)
        } else {
            to
        };
        match self.arbiter.request(&key, id, priority, policy) {
            Grant::Rejected => {
                self.events.push(AnimationEvent {
                    value: h.0,
                    animation: id,
                    kind: AnimationEventKind::Rejected,
                });
                return Ok(id);
            }
            Grant::Queued => {
                v.queued.push(Queued {
                    id,
                    spec: spec.clone(),
                    to: to_c,
                });
                self.events.push(AnimationEvent {
                    value: h.0,
                    animation: id,
                    kind: AnimationEventKind::Queued,
                });
                return Ok(id);
            }
            Grant::Additive => {
                // Additive layers animate an offset from 0 → (to − base) and back to 0.
                let gen = Generator::new(spec, 0.0, to_c - v.value, 0.0)?;
                v.additive.push((
                    Running {
                        id,
                        gen,
                        started: time,
                    },
                    0.0,
                ));
                self.events.push(AnimationEvent {
                    value: h.0,
                    animation: id,
                    kind: AnimationEventKind::Started,
                });
                return Ok(id);
            }
            Grant::Acquired { interrupted } => {
                if let Some(old) = v.running.take() {
                    let _ = interrupted;
                    self.events.push(AnimationEvent {
                        value: h.0,
                        animation: old.id,
                        kind: AnimationEventKind::Interrupted,
                    });
                }
            }
        }
        if reduced && !matches!(spec, AnimationSpec::Instant) {
            // Reduced motion: no travel, jump to the destination (decay/inertia still resolve
            // their physical end point so content positions stay correct).
            let gen = Generator::new(spec, v.value, to_c, v.velocity)?;
            v.value = gen.target().clamp(v.min, v.max);
            v.velocity = 0.0;
            self.arbiter.release(&key, id);
            self.events.push(AnimationEvent {
                value: h.0,
                animation: id,
                kind: AnimationEventKind::Started,
            });
            self.events.push(AnimationEvent {
                value: h.0,
                animation: id,
                kind: AnimationEventKind::Completed,
            });
            return Ok(id);
        }
        let v0 = if spec.preserves_velocity() {
            v.velocity
        } else {
            0.0
        };
        let gen = Generator::new(spec, v.value, to_c, v0)?;
        v.running = Some(Running {
            id,
            gen,
            started: time,
        });
        self.events.push(AnimationEvent {
            value: h.0,
            animation: id,
            kind: AnimationEventKind::Started,
        });
        Ok(id)
    }

    /// Stops the animation of a value at its current position.
    pub fn stop(&mut self, h: Handle) -> Result<(), RuntimeError> {
        let v = self.values.get_mut(h).ok_or(RuntimeError::InvalidHandle)?;
        let mut cancelled = Vec::new();
        if let Some(r) = v.running.take() {
            cancelled.push(r.id);
        }
        for (r, _) in v.additive.drain(..) {
            cancelled.push(r.id);
        }
        for q in v.queued.drain(..) {
            cancelled.push(q.id);
        }
        v.velocity = 0.0;
        for id in cancelled {
            self.arbiter.release_all(id);
            self.events.push(AnimationEvent {
                value: h.0,
                animation: id,
                kind: AnimationEventKind::Cancelled,
            });
        }
        Ok(())
    }

    // ---------------------------------------------------------------- plans and graphs

    /// Loads (and validates) a compiled plan.
    pub fn load_plan(&mut self, plan: ExecutionPlan) {
        self.fidelity = FidelityController::new(FidelityConfig {
            min_level: plan.performance.fidelity.min,
            max_level: plan.performance.fidelity.max,
            initial_level: plan.performance.fidelity.initial,
            ..self.config.fidelity
        });
        match plan.accessibility.reduced_motion.as_str() {
            "always" => self.set_reduced_motion(true),
            "never" => self.set_reduced_motion(false),
            _ => {}
        }
        self.plan = Some(plan);
    }

    /// Compiles MDL source and loads it.
    pub fn load_mdl(&mut self, source: &str) -> Result<Vec<umx_graph::Diagnostic>, RuntimeError> {
        let out = umx_compiler::compile_str(source);
        match out.plan {
            Some(p) if out.ok => {
                self.load_plan(p);
                Ok(out.diagnostics)
            }
            _ => Err(RuntimeError::Compile(out.diagnostics)),
        }
    }

    pub fn plan(&self) -> Option<&ExecutionPlan> {
        self.plan.as_ref()
    }

    pub fn instantiate(&mut self, component: &str) -> Result<Handle, RuntimeError> {
        let plan = self
            .plan
            .as_ref()
            .ok_or_else(|| RuntimeError::NotFound("no plan loaded".into()))?;
        let def = plan
            .graph_def(component)
            .ok_or_else(|| RuntimeError::NotFound(format!("component `{component}`")))?;
        let mut graph = GraphRuntime::new(def)?;
        graph.set_reduced_motion(self.config.reduced_motion);
        Ok(self.instances.insert(Instance {
            component: component.to_string(),
            graph,
        }))
    }

    pub fn destroy_instance(&mut self, h: Handle) -> Result<(), RuntimeError> {
        self.instances
            .remove(h)
            .map(|_| ())
            .ok_or(RuntimeError::InvalidHandle)
    }

    pub fn send(&mut self, instance: Handle, event: &str) -> Result<bool, RuntimeError> {
        let inst = self
            .instances
            .get_mut(instance)
            .ok_or(RuntimeError::InvalidHandle)?;
        Ok(inst.graph.send(event)?)
    }

    pub fn instance_value(&self, instance: Handle, prop: &str) -> Result<f64, RuntimeError> {
        let inst = self
            .instances
            .get(instance)
            .ok_or(RuntimeError::InvalidHandle)?;
        inst.graph
            .value(prop)
            .ok_or_else(|| RuntimeError::NotFound(format!("property `{prop}`")))
    }

    pub fn instance_state(&self, instance: Handle) -> Result<String, RuntimeError> {
        Ok(self
            .instances
            .get(instance)
            .ok_or(RuntimeError::InvalidHandle)?
            .graph
            .state()
            .to_string())
    }

    pub fn instance_component(&self, instance: Handle) -> Result<String, RuntimeError> {
        Ok(self
            .instances
            .get(instance)
            .ok_or(RuntimeError::InvalidHandle)?
            .component
            .clone())
    }

    pub fn graph_mut(&mut self, instance: Handle) -> Result<&mut GraphRuntime, RuntimeError> {
        Ok(&mut self
            .instances
            .get_mut(instance)
            .ok_or(RuntimeError::InvalidHandle)?
            .graph)
    }

    /// Plays a compiled timeline; `bindings` maps `component.property` tracks to values.
    pub fn play_timeline(
        &mut self,
        name: &str,
        bindings: BTreeMap<String, Handle>,
    ) -> Result<Handle, RuntimeError> {
        let plan = self
            .plan
            .as_ref()
            .ok_or_else(|| RuntimeError::NotFound("no plan loaded".into()))?;
        let tl = plan
            .timelines
            .get(name)
            .ok_or_else(|| RuntimeError::NotFound(format!("timeline `{name}`")))?;
        for e in &tl.entries {
            let k = format!("{}.{}", e.component, e.property);
            if !bindings.contains_key(&k) {
                return Err(RuntimeError::InvalidArgument(format!(
                    "missing binding for track `{k}`"
                )));
            }
        }
        for h in bindings.values() {
            self.values.get(*h).ok_or(RuntimeError::InvalidHandle)?;
        }
        Ok(self.players.insert(Player {
            timeline: name.to_string(),
            bindings,
            time: 0.0,
            rate: 1.0,
            paused: false,
        }))
    }

    pub fn seek_timeline(&mut self, player: Handle, t: f64) -> Result<(), RuntimeError> {
        let p = self
            .players
            .get_mut(player)
            .ok_or(RuntimeError::InvalidHandle)?;
        p.time = t.max(0.0);
        self.apply_players(0.0);
        Ok(())
    }

    pub fn set_timeline_rate(
        &mut self,
        player: Handle,
        rate: f64,
        paused: bool,
    ) -> Result<(), RuntimeError> {
        let p = self
            .players
            .get_mut(player)
            .ok_or(RuntimeError::InvalidHandle)?;
        if rate.is_finite() {
            p.rate = rate;
        }
        p.paused = paused;
        Ok(())
    }

    fn apply_players(&mut self, dt: f64) {
        let Some(plan) = self.plan.as_ref() else {
            return;
        };
        let mut finished = Vec::new();
        let mut writes: Vec<(Handle, f64, f64)> = Vec::new();
        for (ph, p) in self.players.iter_mut() {
            let Some(tl) = plan.timelines.get(&p.timeline) else {
                finished.push(ph);
                continue;
            };
            if !p.paused {
                p.time = (p.time + dt * p.rate).clamp(0.0, tl.duration);
            }
            // Latest-started entry per track wins (same policy as umx-core timelines).
            let mut active: BTreeMap<String, (f64, f64, f64)> = BTreeMap::new();
            for e in &tl.entries {
                let key = format!("{}.{}", e.component, e.property);
                let Some(spec) = plan.spec(e.spec) else {
                    continue;
                };
                let from = e
                    .from
                    .unwrap_or_else(|| active.get(&key).map_or(0.0, |a| a.1));
                if e.start <= p.time {
                    if let Ok(g) = Generator::new(spec, from, e.to, 0.0) {
                        let s = g.sample(p.time - e.start);
                        active.insert(key, (e.start, s.value, s.velocity));
                    }
                } else {
                    active.entry(key).or_insert((e.start, from, 0.0));
                }
            }
            for (k, (_, v, vel)) in active {
                if let Some(h) = p.bindings.get(&k) {
                    writes.push((*h, v, vel));
                }
            }
            if !p.paused
                && ((p.rate > 0.0 && p.time >= tl.duration) || (p.rate < 0.0 && p.time <= 0.0))
            {
                finished.push(ph);
            }
        }
        for (h, v, vel) in writes {
            if let Some(val) = self.values.get_mut(h) {
                val.value = v.clamp(val.min, val.max);
                val.velocity = vel;
            }
        }
        for f in finished {
            self.players.remove(f);
        }
    }

    // ---------------------------------------------------------------- frame loop

    /// Advances simulation time by `dt` seconds.
    pub fn advance(&mut self, dt: f64) {
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }
        let dt = dt.min(self.config.max_delta.max(1e-4));
        self.time += dt;
        let t = self.time;
        let mut done: Vec<(Handle, u64)> = Vec::new();
        let mut additive_done: Vec<(Handle, u64)> = Vec::new();
        for (h, v) in self.values.iter_mut() {
            if let Some(r) = &v.running {
                let s = r.gen.sample(t - r.started);
                v.value = s.value.clamp(v.min, v.max);
                v.velocity = if s.done { 0.0 } else { s.velocity };
                if s.done {
                    done.push((h, r.id));
                }
            }
            for (r, offset) in &mut v.additive {
                let s = r.gen.sample(t - r.started);
                *offset = s.value;
                if s.done {
                    additive_done.push((h, r.id));
                }
            }
        }
        for (h, id) in additive_done {
            if let Some(v) = self.values.get_mut(h) {
                if let Some(pos) = v.additive.iter().position(|(r, _)| r.id == id) {
                    // Fold the finished layer into the base value so nothing jumps.
                    let (_, off) = v.additive.remove(pos);
                    v.value += off;
                }
            }
            self.arbiter.release_all(id);
            self.events.push(AnimationEvent {
                value: h.0,
                animation: id,
                kind: AnimationEventKind::Completed,
            });
        }
        for (h, id) in done {
            if let Some(v) = self.values.get_mut(h) {
                v.running = None;
            }
            self.events.push(AnimationEvent {
                value: h.0,
                animation: id,
                kind: AnimationEventKind::Completed,
            });
            let key = PropertyKey::new(h.0, "value");
            if let Some(next) = self.arbiter.release(&key, id) {
                self.start_queued(h, next);
            }
        }
        for (_, inst) in self.instances.iter_mut() {
            inst.graph.tick(dt);
        }
        self.apply_players(dt);
    }

    fn start_queued(&mut self, h: Handle, id: u64) {
        let time = self.time;
        let Some(v) = self.values.get_mut(h) else {
            return;
        };
        let Some(pos) = v.queued.iter().position(|q| q.id == id) else {
            return;
        };
        let q = v.queued.remove(pos);
        let v0 = if q.spec.preserves_velocity() {
            v.velocity
        } else {
            0.0
        };
        if let Ok(gen) = Generator::new(&q.spec, v.value, q.to, v0) {
            v.running = Some(Running {
                id,
                gen,
                started: time,
            });
            self.events.push(AnimationEvent {
                value: h.0,
                animation: id,
                kind: AnimationEventKind::Started,
            });
        }
    }

    /// Host frame entry point. `timestamp_ms` is the presentation timestamp (e.g. vsync
    /// time). Returns whether another frame is needed.
    pub fn frame(&mut self, timestamp_ms: f64, work_ms: Option<f64>) -> bool {
        let dt = match (self.config.fixed_step, self.last_timestamp) {
            (Some(step), _) => step,
            (None, Some(last)) => ((timestamp_ms - last) / 1000.0).max(0.0),
            (None, None) => 0.0,
        };
        self.last_timestamp = Some(timestamp_ms);
        if self.refresh.sample(timestamp_ms) {
            self.stats.set_expected_interval(self.refresh.interval_ms());
        }
        let missed = dt * 1000.0 > self.refresh.interval_ms() * 1.5 && self.refresh.has_estimate();
        self.fidelity.observe(missed);
        self.advance(dt);
        self.stats.record(timestamp_ms, work_ms.unwrap_or(0.0));
        let needs = self.needs_frame();
        if !needs {
            // Idle: next frame starts a new interval series (idle gaps are not jank).
            self.last_timestamp = None;
            self.stats.mark_idle();
            self.refresh.break_continuity();
        }
        needs
    }

    /// `true` while any animation, graph transition or timeline is active.
    pub fn needs_frame(&self) -> bool {
        self.values
            .iter()
            .any(|(_, v)| v.running.is_some() || !v.additive.is_empty())
            || self
                .instances
                .iter()
                .any(|(_, i)| i.graph.is_transitioning())
            || self.players.iter().any(|(_, p)| !p.paused)
    }

    pub fn drain_events(&mut self) -> Vec<AnimationEvent> {
        std::mem::take(&mut self.events)
    }

    pub fn poll_event(&mut self) -> Option<AnimationEvent> {
        if self.events.is_empty() {
            None
        } else {
            Some(self.events.remove(0))
        }
    }

    pub fn refresh_hz(&self) -> f64 {
        self.refresh.hz()
    }
    pub fn fidelity(&self) -> FidelitySettings {
        self.fidelity.settings()
    }
    pub fn fidelity_mut(&mut self) -> &mut FidelityController {
        &mut self.fidelity
    }
    pub fn telemetry(&self) -> Report {
        self.stats.report()
    }
    pub fn arbiter(&self) -> &Arbiter {
        &self.arbiter
    }

    pub fn stats(&self) -> EngineStats {
        EngineStats {
            values: self.values.len(),
            value_slots: self.values.capacity(),
            animating: self
                .values
                .iter()
                .filter(|(_, v)| v.running.is_some() || !v.additive.is_empty())
                .count(),
            instances: self.instances.len(),
            timelines_playing: self.players.len(),
            pending_events: self.events.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use umx_core::Easing;
    use umx_physics::SpringParams;

    fn spring() -> AnimationSpec {
        AnimationSpec::spring(SpringParams::new(300.0, 26.0, 1.0).unwrap())
    }

    #[test]
    fn animates_and_goes_idle() {
        let mut e = Engine::default();
        let v = e.create_value(0.0).unwrap();
        assert!(!e.needs_frame());
        e.animate(
            v,
            100.0,
            &spring(),
            Priority::Normal,
            InterruptPolicy::Replace,
        )
        .unwrap();
        let mut t = 0.0;
        while e.frame(t, None) {
            t += 1000.0 / 120.0;
            assert!(t < 10_000.0, "never settled");
        }
        assert_eq!(e.get(v).unwrap(), 100.0);
        let kinds: Vec<AnimationEventKind> = e.drain_events().iter().map(|e| e.kind).collect();
        assert_eq!(
            kinds,
            vec![AnimationEventKind::Started, AnimationEventKind::Completed]
        );
    }

    #[test]
    fn rapid_retargets_are_continuous() {
        let mut e = Engine::default();
        let v = e.create_value(0.0).unwrap();
        let mut last = 0.0;
        let mut max_step: f64 = 0.0;
        for frame in 0..300 {
            if frame % 7 == 0 {
                let to = if (frame / 7) % 2 == 0 { 300.0 } else { 0.0 };
                e.animate(
                    v,
                    to,
                    &spring(),
                    Priority::Interaction,
                    InterruptPolicy::Replace,
                )
                .unwrap();
            }
            e.advance(1.0 / 120.0);
            let x = e.get(v).unwrap();
            max_step = max_step.max((x - last).abs());
            last = x;
        }
        assert!(max_step < 30.0, "discontinuity: {max_step}");
        let interrupted = e
            .drain_events()
            .iter()
            .filter(|ev| ev.kind == AnimationEventKind::Interrupted)
            .count();
        assert!(interrupted > 10);
    }

    #[test]
    fn priority_and_queue() {
        let mut e = Engine::default();
        let v = e.create_value(0.0).unwrap();
        e.animate(
            v,
            100.0,
            &spring(),
            Priority::Gesture,
            InterruptPolicy::Replace,
        )
        .unwrap();
        e.animate(
            v,
            -100.0,
            &spring(),
            Priority::Decorative,
            InterruptPolicy::Replace,
        )
        .unwrap();
        assert!(e
            .drain_events()
            .iter()
            .any(|x| x.kind == AnimationEventKind::Rejected));
        e.animate(
            v,
            50.0,
            &AnimationSpec::tween(0.1, Easing::Linear),
            Priority::Normal,
            InterruptPolicy::Queue,
        )
        .unwrap();
        for _ in 0..600 {
            e.advance(1.0 / 60.0);
        }
        assert!((e.get(v).unwrap() - 50.0).abs() < 1e-9);
    }

    #[test]
    fn additive_layer_folds_back() {
        let mut e = Engine::default();
        let v = e.create_value(10.0).unwrap();
        e.animate(
            v,
            20.0,
            &AnimationSpec::tween(0.5, Easing::Linear),
            Priority::Normal,
            InterruptPolicy::Replace,
        )
        .unwrap();
        e.animate(
            v,
            15.0,
            &AnimationSpec::tween(0.2, Easing::Linear),
            Priority::Decorative,
            InterruptPolicy::Additive,
        )
        .unwrap();
        e.advance(0.1);
        // base 12, additive offset 2.5 (half of 5)
        assert!((e.get(v).unwrap() - 14.5).abs() < 1e-9);
        for _ in 0..60 {
            e.advance(1.0 / 60.0);
        }
        assert!(!e.is_animating(v));
    }

    #[test]
    fn stale_handles_are_rejected() {
        let mut e = Engine::default();
        let a = e.create_value(1.0).unwrap();
        e.destroy_value(a).unwrap();
        let b = e.create_value(2.0).unwrap();
        assert_ne!(a, b);
        assert_eq!(e.get(a), Err(RuntimeError::InvalidHandle));
        assert_eq!(e.get(b).unwrap(), 2.0);
        assert!(e.create_value(f64::NAN).is_err());
    }

    #[test]
    fn mount_unmount_cycles_do_not_grow() {
        let mut e = Engine::default();
        for _ in 0..1000 {
            let v = e.create_value(0.0).unwrap();
            e.animate(
                v,
                1.0,
                &spring(),
                Priority::Normal,
                InterruptPolicy::Replace,
            )
            .unwrap();
            e.advance(0.016);
            e.destroy_value(v).unwrap();
            e.drain_events();
        }
        let s = e.stats();
        assert_eq!(s.values, 0);
        assert_eq!(s.value_slots, 1, "slots must be recycled");
        assert_eq!(e.arbiter().owned_count(), 0, "no orphan ownership");
    }

    #[test]
    fn reduced_motion_jumps() {
        let mut e = Engine::new(EngineConfig {
            reduced_motion: true,
            ..EngineConfig::default()
        });
        let v = e.create_value(0.0).unwrap();
        e.animate(
            v,
            42.0,
            &spring(),
            Priority::Normal,
            InterruptPolicy::Replace,
        )
        .unwrap();
        assert_eq!(e.get(v).unwrap(), 42.0);
        assert!(!e.needs_frame());
    }

    #[test]
    fn deterministic_fixed_step() {
        let run = || {
            let mut e = Engine::new(EngineConfig {
                fixed_step: Some(1.0 / 240.0),
                ..EngineConfig::default()
            });
            let v = e.create_value(0.0).unwrap();
            e.animate(
                v,
                1.0,
                &spring(),
                Priority::Normal,
                InterruptPolicy::Replace,
            )
            .unwrap();
            let mut out = Vec::new();
            for i in 0..100 {
                // Irregular timestamps are ignored in fixed-step mode.
                e.frame(i as f64 * 7.3, None);
                out.push(e.get(v).unwrap().to_bits());
            }
            out
        };
        assert_eq!(run(), run());
    }

    #[test]
    fn plan_instances_and_timelines() {
        let src = include_str!("../../../examples/mdl/app.umx.json");
        let mut e = Engine::default();
        e.load_mdl(src).unwrap();
        let drawer = e.instantiate("drawer").unwrap();
        assert!(e.send(drawer, "toggle").unwrap());
        assert!(e.needs_frame());
        for _ in 0..120 {
            e.advance(1.0 / 60.0);
        }
        assert!(e.instance_value(drawer, "x").unwrap().abs() < 0.01);
        assert_eq!(e.instance_state(drawer).unwrap(), "open");

        let op = e.create_value(0.0).unwrap();
        let y = e.create_value(24.0).unwrap();
        let sc = e.create_value(1.0).unwrap();
        let bindings = BTreeMap::from([
            ("toast.opacity".to_string(), op),
            ("toast.y".to_string(), y),
            ("card.scale".to_string(), sc),
        ]);
        let p = e.play_timeline("intro", bindings).unwrap();
        e.seek_timeline(p, 0.1).unwrap();
        let mid = e.get(op).unwrap();
        assert!(mid > 0.05 && mid < 0.95, "mid-way opacity {mid}");
        e.seek_timeline(p, 0.15).unwrap();
        assert!(
            e.get(op).unwrap() > mid,
            "seeking forward increases opacity"
        );
        for _ in 0..120 {
            e.advance(1.0 / 60.0);
        }
        assert!((e.get(op).unwrap() - 1.0).abs() < 1e-9);
        assert!((e.get(sc).unwrap() - 1.0).abs() < 1e-9);
        assert_eq!(e.stats().timelines_playing, 0);
        assert!(e.load_mdl("{").is_err());
    }
}
