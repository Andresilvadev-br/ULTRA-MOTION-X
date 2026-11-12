//! Reference resolution, validation and plan construction.

use crate::diag::Diagnostics;
use crate::plan::*;
use crate::PLAN_VERSION;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use umx_core::easing::Easing;
use umx_core::keyframes::Keyframes;
use umx_core::tokens::{MotionProfile, Profiles};
use umx_core::{AnimationSpec, Position, Priority, Timeline};
use umx_graph::{GraphDef, Interrupt, PropertyDef, Relation};
use umx_physics::{DecayParams, Spring, SpringParams};

const TOP_LEVEL_KEYS: [&str; 12] = [
    "$schema",
    "version",
    "name",
    "profile",
    "tokens",
    "transitions",
    "components",
    "timelines",
    "effects",
    "performance",
    "accessibility",
    "description",
];
const MATERIALS: [&str; 7] = [
    "glass",
    "ripple",
    "gradient",
    "lighting",
    "noise",
    "refraction",
    "shadow",
];
const ROLES: [&str; 20] = [
    "button",
    "card",
    "menu",
    "tabs",
    "modal",
    "notification",
    "overlay",
    "list",
    "scroll",
    "page",
    "form",
    "window",
    "draggable",
    "tooltip",
    "navigation",
    "loading",
    "progress",
    "drawer",
    "panel",
    "custom",
];

struct SpecPool {
    specs: Vec<AnimationSpec>,
    index: HashMap<String, usize>,
    requests: usize,
}

impl SpecPool {
    fn intern(&mut self, spec: AnimationSpec) -> usize {
        self.requests += 1;
        let key = serde_json::to_string(&spec).unwrap_or_default();
        if let Some(&i) = self.index.get(&key) {
            return i;
        }
        self.specs.push(spec);
        self.index.insert(key, self.specs.len() - 1);
        self.specs.len() - 1
    }
}

struct Ctx<'a> {
    doc: &'a Value,
    profile: MotionProfile,
    d: &'a mut Diagnostics,
    pool: SpecPool,
    stack: Vec<String>,
}

fn obj(v: Option<&Value>) -> Option<&Map<String, Value>> {
    v.and_then(Value::as_object)
}

impl<'a> Ctx<'a> {
    fn token<'v>(&'v self, group: &str, name: &str) -> Option<&'v Value> {
        self.doc
            .get("tokens")
            .and_then(|t| t.get(group))
            .and_then(|g| g.get(name))
    }

    fn number(&mut self, v: &Value, path: &str, group: &str) -> Option<f64> {
        match v {
            Value::Number(n) => n.as_f64().filter(|x| x.is_finite()).or_else(|| {
                self.d.error("E_NUMBER", path, "expected a finite number");
                None
            }),
            Value::String(s) if s.starts_with('$') => {
                let (g, name) = s[1..].split_once('.').unwrap_or(("", ""));
                if g != group {
                    self.d.error(
                        "E_REF",
                        path,
                        format!("`{s}` is not a `${group}.*` reference"),
                    );
                    return None;
                }
                if let Some(t) = self.token(group, name).cloned() {
                    return self.number(&t, path, group);
                }
                if group == "duration" {
                    if let Ok(ms) = self.profile.duration_ms(name) {
                        return Some(ms);
                    }
                }
                self.d.error("E_REF", path, format!("unknown token `{s}`"));
                None
            }
            _ => {
                self.d
                    .error("E_NUMBER", path, "expected a number or token reference");
                None
            }
        }
    }

    fn easing(&mut self, v: &Value, path: &str) -> Option<Easing> {
        let e = match v {
            Value::String(s) if s.starts_with("$easing.") => {
                let name = &s["$easing.".len()..];
                if let Some(t) = self.token("easing", name).cloned() {
                    return self.easing(&t, path);
                }
                match self.profile.easing(name) {
                    Ok(e) => e,
                    Err(_) => {
                        self.d
                            .error("E_REF", path, format!("unknown easing token `{s}`"));
                        return None;
                    }
                }
            }
            Value::String(s) => match Easing::named(s) {
                Some(e) => e,
                None => {
                    self.d
                        .error("E_EASING", path, format!("unknown easing `{s}`"));
                    return None;
                }
            },
            Value::Array(a) if a.len() == 4 => {
                let n: Vec<f64> = a.iter().filter_map(Value::as_f64).collect();
                if n.len() != 4 {
                    self.d
                        .error("E_EASING", path, "cubic-bezier needs 4 numbers");
                    return None;
                }
                Easing::CubicBezier {
                    x1: n[0],
                    y1: n[1],
                    x2: n[2],
                    y2: n[3],
                }
            }
            Value::Object(o) if o.contains_key("steps") => Easing::Steps {
                count: o.get("steps").and_then(Value::as_u64).unwrap_or(0) as u32,
                jump_start: o.get("position").and_then(Value::as_str) == Some("start"),
            },
            Value::Object(o) if o.contains_key("linear") => Easing::Points {
                values: o
                    .get("linear")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_f64).collect())
                    .unwrap_or_default(),
            },
            _ => {
                self.d.error(
                    "E_EASING",
                    path,
                    "easing must be a name, a token, [x1,y1,x2,y2], {steps} or {linear}",
                );
                return None;
            }
        };
        if let Err(err) = e.validate() {
            self.d.error("E_EASING", path, err.to_string());
            return None;
        }
        Some(e)
    }

    fn spring(&mut self, v: &Value, path: &str) -> Option<SpringParams> {
        match v {
            Value::String(s) if s.starts_with("$spring.") => {
                let name = &s["$spring.".len()..];
                if let Some(t) = self.token("spring", name).cloned() {
                    return self.spring(&t, path);
                }
                match self.profile.spring(name) {
                    Ok(p) => Some(p),
                    Err(_) => {
                        self.d
                            .error("E_REF", path, format!("unknown spring token `{s}`"));
                        None
                    }
                }
            }
            Value::Object(o) => {
                let f = |k: &str| o.get(k).and_then(Value::as_f64);
                let base = if let (Some(r), Some(z)) = (f("response"), f("dampingRatio")) {
                    SpringParams::from_response(r, z)
                } else if let Some(dur) = f("duration") {
                    SpringParams::from_duration_bounce(dur / 1000.0, f("bounce").unwrap_or(0.0))
                } else {
                    let def = SpringParams::default();
                    SpringParams::new(
                        f("stiffness").unwrap_or(def.stiffness),
                        f("damping").unwrap_or(def.damping),
                        f("mass").unwrap_or(def.mass),
                    )
                };
                match base {
                    Ok(mut p) => {
                        if let Some(x) = f("restDelta") {
                            p.rest_delta = x;
                        }
                        if let Some(x) = f("restSpeed") {
                            p.rest_speed = x;
                        }
                        p.clamp_overshoot =
                            o.get("clamp").and_then(Value::as_bool).unwrap_or(false);
                        p.max_oscillations = o
                            .get("maxOscillations")
                            .and_then(Value::as_u64)
                            .unwrap_or(0) as u32;
                        if let Err(e) = p.validate() {
                            self.d.error("E_SPRING", path, e.to_string());
                            return None;
                        }
                        Some(p)
                    }
                    Err(e) => {
                        self.d.error("E_SPRING", path, e.to_string());
                        None
                    }
                }
            }
            _ => {
                self.d.error(
                    "E_SPRING",
                    path,
                    "spring must be a `$spring.*` token or an object",
                );
                None
            }
        }
    }

    /// Resolves an MDL transition value into an [`AnimationSpec`].
    fn spec(&mut self, v: &Value, path: &str) -> Option<AnimationSpec> {
        match v {
            Value::String(s) if s == "instant" => Some(AnimationSpec::Instant),
            Value::String(s) if s.starts_with("$transitions.") => {
                let name = s["$transitions.".len()..].to_string();
                if self.stack.contains(&name) {
                    self.d.error(
                        "E_REF_CYCLE",
                        path,
                        format!("reference cycle: {} → {name}", self.stack.join(" → ")),
                    );
                    return None;
                }
                let Some(target) = self
                    .doc
                    .get("transitions")
                    .and_then(|t| t.get(&name))
                    .cloned()
                else {
                    self.d
                        .error("E_REF", path, format!("unknown transition `{s}`"));
                    return None;
                };
                self.stack.push(name.clone());
                let r = self.spec(&target, &format!("transitions.{name}"));
                self.stack.pop();
                r
            }
            Value::String(s) if s.starts_with("$spring.") => {
                self.spring(v, path).map(AnimationSpec::spring)
            }
            Value::String(s) => {
                self.d.error(
                    "E_SPEC",
                    path,
                    format!("unknown transition reference `{s}`"),
                );
                None
            }
            Value::Object(o) => {
                let ty =
                    o.get("type")
                        .and_then(Value::as_str)
                        .unwrap_or(if o.contains_key("spring") {
                            "spring"
                        } else {
                            "tween"
                        });
                let delay = match o.get("delay") {
                    Some(d) => self.number(d, &format!("{path}.delay"), "duration")? / 1000.0,
                    None => 0.0,
                };
                let spec = match ty {
                    "spring" => {
                        let p = match o.get("spring") {
                            Some(s) => self.spring(s, &format!("{path}.spring"))?,
                            None => self.spring(v, path)?,
                        };
                        AnimationSpec::Spring { spring: p, delay }
                    }
                    "tween" => {
                        let duration = match o.get("duration") {
                            Some(d) => {
                                self.number(d, &format!("{path}.duration"), "duration")? / 1000.0
                            }
                            None => self.profile.duration.normal / 1000.0,
                        };
                        let easing = match o.get("easing") {
                            Some(e) => self.easing(e, &format!("{path}.easing"))?,
                            None => self.profile.easing("standard").ok()?,
                        };
                        AnimationSpec::Tween {
                            duration,
                            easing,
                            delay,
                        }
                    }
                    "keyframes" => {
                        let values: Vec<f64> = o
                            .get("values")
                            .and_then(Value::as_array)
                            .map(|a| a.iter().map(|x| x.as_f64().unwrap_or(f64::NAN)).collect())
                            .unwrap_or_default();
                        let offsets: Vec<f64> = o
                            .get("offsets")
                            .and_then(Value::as_array)
                            .map(|a| a.iter().filter_map(Value::as_f64).collect())
                            .unwrap_or_default();
                        let easings = match o.get("easing") {
                            Some(Value::Array(a)) if a.first().is_some_and(|x| !x.is_number()) => {
                                let mut out = Vec::new();
                                for (i, e) in a.iter().enumerate() {
                                    out.push(self.easing(e, &format!("{path}.easing[{i}]"))?);
                                }
                                out
                            }
                            Some(e) => vec![self.easing(e, &format!("{path}.easing"))?],
                            None => vec![],
                        };
                        let duration = match o.get("duration") {
                            Some(d) => {
                                self.number(d, &format!("{path}.duration"), "duration")? / 1000.0
                            }
                            None => self.profile.duration.normal / 1000.0,
                        };
                        let kf = Keyframes {
                            values,
                            offsets,
                            easings,
                        };
                        if let Err(e) = kf.validate() {
                            self.d.error("E_KEYFRAMES", path, e.to_string());
                            return None;
                        }
                        AnimationSpec::Keyframes {
                            keyframes: kf,
                            duration,
                            delay,
                        }
                    }
                    "decay" => {
                        let tc = match o.get("timeConstant") {
                            Some(t) => {
                                self.number(t, &format!("{path}.timeConstant"), "duration")?
                                    / 1000.0
                            }
                            None => self.profile.fling_time_constant,
                        };
                        match DecayParams::new(
                            tc,
                            o.get("restSpeed").and_then(Value::as_f64).unwrap_or(0.5),
                        ) {
                            Ok(decay) => AnimationSpec::Decay { decay },
                            Err(e) => {
                                self.d.error("E_DECAY", path, e.to_string());
                                return None;
                            }
                        }
                    }
                    "instant" => AnimationSpec::Instant,
                    other => {
                        self.d.error(
                            "E_SPEC_TYPE",
                            format!("{path}.type"),
                            format!("unknown transition type `{other}`"),
                        );
                        return None;
                    }
                };
                if let Err(e) = spec.validate() {
                    self.d.error("E_SPEC", path, e.to_string());
                    return None;
                }
                Some(spec)
            }
            _ => {
                self.d.error(
                    "E_SPEC",
                    path,
                    "a transition must be a reference string or an object",
                );
                None
            }
        }
    }

    fn intern(&mut self, v: &Value, path: &str) -> Option<usize> {
        let spec = self.spec(v, path)?;
        Some(self.pool.intern(spec))
    }
}

fn compositor_hint(spec: &AnimationSpec) -> Option<CompositorHint> {
    match spec {
        AnimationSpec::Tween {
            duration,
            easing,
            delay,
        } if *delay == 0.0 => Some(CompositorHint {
            easing: easing.to_css(),
            duration_ms: duration * 1000.0,
        }),
        AnimationSpec::Spring { spring, delay } if *delay == 0.0 => {
            let s = Spring::new(*spring, 0.0, 1.0, 0.0).ok()?;
            if !s.finish_time().is_finite() {
                return None;
            }
            let n = ((s.finish_time() * 60.0).ceil() as usize).clamp(16, 64);
            let pts = s.bake_progress(n);
            Some(CompositorHint {
                easing: Easing::Points { values: pts }.to_css(),
                duration_ms: s.finish_time() * 1000.0,
            })
        }
        _ => None,
    }
}

pub(crate) fn build_plan(doc: &Value, d: &mut Diagnostics) -> Option<ExecutionPlan> {
    let root = doc.as_object()?;
    for k in root.keys() {
        if !TOP_LEVEL_KEYS.contains(&k.as_str()) {
            d.warning(
                "W_UNKNOWN_KEY",
                k.clone(),
                format!("unknown top-level key `{k}` is ignored"),
            );
        }
    }
    let profiles = Profiles::builtin();
    let profile_name = root
        .get("profile")
        .and_then(Value::as_str)
        .unwrap_or(&profiles.default)
        .to_string();
    let profile = match profiles.get(&profile_name) {
        Ok(p) => p.clone(),
        Err(_) => {
            let names: Vec<&String> = profiles.profiles.keys().collect();
            d.error(
                "E_PROFILE",
                "profile",
                format!("unknown profile `{profile_name}`; available: {names:?}"),
            );
            profiles.get(&profiles.default).ok()?.clone()
        }
    };
    let mut ctx = Ctx {
        doc,
        profile,
        d,
        pool: SpecPool {
            specs: vec![],
            index: HashMap::new(),
            requests: 0,
        },
        stack: vec![],
    };
    let mut stats = PlanStats::default();

    // Validate every named transition, even unused ones.
    if let Some(ts) = obj(root.get("transitions")) {
        for (name, v) in ts.clone() {
            ctx.stack.push(name.clone());
            ctx.spec(&v, &format!("transitions.{name}"));
            ctx.stack.pop();
        }
    }

    let mut components = BTreeMap::new();
    if let Some(comps) = obj(root.get("components")) {
        for (name, cv) in comps.clone() {
            if let Some(c) = compile_component(&mut ctx, &name, &cv, &mut stats) {
                components.insert(name, c);
            }
        }
    } else if root.contains_key("components") {
        ctx.d
            .error("E_TYPE", "components", "`components` must be an object");
    }

    let mut timelines = BTreeMap::new();
    if let Some(tls) = obj(root.get("timelines")) {
        for (name, tv) in tls.clone() {
            if let Some(t) = compile_timeline(&mut ctx, &name, &tv, &components) {
                timelines.insert(name, t);
            }
        }
    }

    let mut effects = BTreeMap::new();
    if let Some(es) = obj(root.get("effects")) {
        for (name, ev) in es {
            let path = format!("effects.{name}");
            let material = ev.get("material").and_then(Value::as_str).unwrap_or("");
            if !MATERIALS.contains(&material) {
                ctx.d.error(
                    "E_EFFECT",
                    format!("{path}.material"),
                    format!("unknown material `{material}`; expected one of {MATERIALS:?}"),
                );
                continue;
            }
            if let Some(i) = ev.get("intensity") {
                if !i.as_f64().is_some_and(|x| (0.0..=1.0).contains(&x)) {
                    ctx.d.error(
                        "E_EFFECT",
                        format!("{path}.intensity"),
                        "intensity must be within [0, 1]",
                    );
                }
            }
            effects.insert(name.clone(), ev.clone());
        }
    }
    for (cname, c) in &components {
        for e in &c.effects {
            if !effects.contains_key(e) && !MATERIALS.contains(&e.as_str()) {
                ctx.d.error(
                    "E_EFFECT_REF",
                    format!("components.{cname}.effects"),
                    format!("unknown effect `{e}`"),
                );
            }
        }
    }

    let mut performance = PerformancePlan::default();
    if let Some(p) = obj(root.get("performance")) {
        if let Some(f) = obj(p.get("fidelity")) {
            let get = |k: &str, def: u8| f.get(k).and_then(Value::as_u64).map_or(def, |v| v as u8);
            performance.fidelity = FidelityPlan {
                min: get("min", 0),
                max: get("max", 4),
                initial: get("initial", 3),
            };
            let fp = &performance.fidelity;
            if fp.max > 4 || fp.min > fp.max || fp.initial < fp.min || fp.initial > fp.max {
                ctx.d.error(
                    "E_FIDELITY",
                    "performance.fidelity",
                    "fidelity levels must satisfy 0 ≤ min ≤ initial ≤ max ≤ 4",
                );
            }
        }
        if let Some(b) = p.get("budgetFraction").and_then(Value::as_f64) {
            if !(0.1..=0.9).contains(&b) {
                ctx.d.error(
                    "E_BUDGET",
                    "performance.budgetFraction",
                    "budgetFraction must be within [0.1, 0.9]",
                );
            }
            performance.budget_fraction = b;
        }
    }
    let mut accessibility = AccessibilityPlan::default();
    if let Some(a) = obj(root.get("accessibility")) {
        if let Some(r) = a.get("reducedMotion").and_then(Value::as_str) {
            if !["user", "always", "never"].contains(&r) {
                ctx.d.error(
                    "E_A11Y",
                    "accessibility.reducedMotion",
                    "reducedMotion must be `user`, `always` or `never`",
                );
            }
            if r == "never" {
                ctx.d.warning("W_A11Y", "accessibility.reducedMotion", "`never` ignores the user's reduced-motion preference; only use it for essential motion");
            }
            accessibility.reduced_motion = r.to_string();
        }
        if let Some(m) = a.get("maxIntensity").and_then(Value::as_f64) {
            accessibility.max_intensity = m.clamp(0.0, 1.0);
        }
    }

    let specs: Vec<CompiledSpec> = ctx
        .pool
        .specs
        .iter()
        .map(|s| CompiledSpec {
            spec: s.clone(),
            compositor: compositor_hint(s),
        })
        .collect();
    stats.spec_requests = ctx.pool.requests;
    stats.unique_specs = specs.len();
    stats.components = components.len();
    Some(ExecutionPlan {
        plan_version: PLAN_VERSION,
        name: root.get("name").and_then(Value::as_str).map(str::to_string),
        profile: profile_name,
        specs,
        components,
        timelines,
        effects,
        performance,
        accessibility,
        stats,
    })
}

fn compile_component(
    ctx: &mut Ctx,
    name: &str,
    cv: &Value,
    stats: &mut PlanStats,
) -> Option<CompiledComponent> {
    let base = format!("components.{name}");
    let Some(c) = cv.as_object() else {
        ctx.d.error("E_TYPE", base, "component must be an object");
        return None;
    };
    let role = c.get("role").and_then(Value::as_str).map(str::to_string);
    if let Some(r) = &role {
        if !ROLES.contains(&r.as_str()) {
            ctx.d.warning(
                "W_ROLE",
                format!("{base}.role"),
                format!("unknown role `{r}`; semantic defaults will not apply"),
            );
        }
    }
    let priority = match c.get("priority").and_then(Value::as_str) {
        None => Priority::Normal,
        Some(p) => match serde_json::from_value::<Priority>(Value::String(p.to_string())) {
            Ok(p) => p,
            Err(_) => {
                ctx.d.error(
                    "E_PRIORITY",
                    format!("{base}.priority"),
                    format!("unknown priority `{p}`"),
                );
                Priority::Normal
            }
        },
    };
    let mut properties = BTreeMap::new();
    let mut units = BTreeMap::new();
    match obj(c.get("properties")) {
        Some(ps) => {
            for (p, pv) in ps {
                let def = match pv {
                    Value::Number(n) => PropertyDef {
                        initial: n.as_f64().unwrap_or(0.0),
                        min: None,
                        max: None,
                    },
                    Value::Object(o) => {
                        if let Some(u) = o.get("unit").and_then(Value::as_str) {
                            units.insert(p.clone(), u.to_string());
                        }
                        PropertyDef {
                            initial: o.get("initial").and_then(Value::as_f64).unwrap_or(0.0),
                            min: o.get("min").and_then(Value::as_f64),
                            max: o.get("max").and_then(Value::as_f64),
                        }
                    }
                    _ => {
                        ctx.d.error(
                            "E_PROPERTY",
                            format!("{base}.properties.{p}"),
                            "property must be a number or an object",
                        );
                        continue;
                    }
                };
                if let (Some(a), Some(b)) = (def.min, def.max) {
                    if a > b {
                        ctx.d.error(
                            "E_CONSTRAINT",
                            format!("{base}.properties.{p}"),
                            "min must be ≤ max",
                        );
                    }
                }
                properties.insert(p.clone(), def);
            }
        }
        None => ctx.d.error(
            "E_PROPERTIES",
            format!("{base}.properties"),
            "component needs a `properties` object",
        ),
    }
    let mut states: BTreeMap<String, BTreeMap<String, f64>> = BTreeMap::new();
    match obj(c.get("states")) {
        Some(ss) => {
            for (s, sv) in ss {
                let mut goals = BTreeMap::new();
                match sv.as_object() {
                    Some(g) => {
                        for (p, v) in g {
                            match v.as_f64() {
                                Some(x) => {
                                    goals.insert(p.clone(), x);
                                }
                                None => ctx.d.error(
                                    "E_NUMBER",
                                    format!("{base}.states.{s}.{p}"),
                                    "state values must be numbers",
                                ),
                            }
                        }
                    }
                    None => ctx.d.error(
                        "E_TYPE",
                        format!("{base}.states.{s}"),
                        "state must be an object",
                    ),
                }
                states.insert(s.clone(), goals);
            }
        }
        None => ctx.d.error(
            "E_STATES",
            format!("{base}.states"),
            "component needs a `states` object",
        ),
    }
    let initial = match c.get("initial").and_then(Value::as_str) {
        Some(i) => i.to_string(),
        None if states.len() == 1 => states.keys().next().cloned().unwrap_or_default(),
        None => {
            ctx.d.error(
                "E_INITIAL_REQUIRED",
                format!("{base}.initial"),
                "`initial` is required when a component has several states",
            );
            String::new()
        }
    };
    let default_v = c
        .get("transition")
        .cloned()
        .unwrap_or_else(|| Value::String("$spring.standard".into()));
    let default_spec = ctx.intern(&default_v, &format!("{base}.transition"))?;

    let mut transitions = Vec::new();
    if let Some(ts) = c.get("transitions").and_then(Value::as_array) {
        for (i, tv) in ts.iter().enumerate() {
            let path = format!("{base}.transitions[{i}]");
            let Some(t) = tv.as_object() else {
                ctx.d.error("E_TYPE", path, "transition must be an object");
                continue;
            };
            let from = t
                .get("from")
                .and_then(Value::as_str)
                .unwrap_or("*")
                .to_string();
            let Some(to) = t.get("to").and_then(Value::as_str).map(str::to_string) else {
                ctx.d
                    .error("E_TRANSITION", format!("{path}.to"), "`to` is required");
                continue;
            };
            let event = t
                .get("on")
                .and_then(Value::as_str)
                .map_or_else(|| to.clone(), str::to_string);
            let spec = match t.get("transition") {
                Some(v) => ctx.intern(v, &format!("{path}.transition")),
                None => None,
            };
            let mut property_specs = BTreeMap::new();
            if let Some(ps) = obj(t.get("properties")) {
                for (p, v) in ps.clone() {
                    if let Some(idx) = ctx.intern(&v, &format!("{path}.properties.{p}")) {
                        if idx == spec.unwrap_or(default_spec) {
                            stats.removed_redundant_property_specs += 1;
                        } else {
                            property_specs.insert(p, idx);
                        }
                    }
                }
            }
            let mut delays = BTreeMap::new();
            if let Some(ds) = obj(t.get("delay")) {
                for (p, v) in ds.clone() {
                    if let Some(ms) = ctx.number(&v, &format!("{path}.delay.{p}"), "duration") {
                        delays.insert(p, ms / 1000.0);
                    }
                }
            }
            let interrupt = match t.get("interrupt").and_then(Value::as_str) {
                None => Interrupt::Retarget,
                Some(s) => serde_json::from_value(Value::String(s.into())).unwrap_or_else(|_| {
                    ctx.d.error(
                        "E_INTERRUPT",
                        format!("{path}.interrupt"),
                        format!("unknown interrupt policy `{s}`"),
                    );
                    Interrupt::Retarget
                }),
            };
            // No-op transition elimination.
            if from != "*" {
                if let (Some(a), Some(b)) = (states.get(&from), states.get(&to)) {
                    if from != to && b.iter().all(|(k, v)| a.get(k) == Some(v)) && !b.is_empty() {
                        ctx.d.warning(
                            "W_NOOP_TRANSITION",
                            path.clone(),
                            format!("`{from}` → `{to}` changes nothing and was removed"),
                        );
                        stats.removed_noop_transitions += 1;
                        continue;
                    }
                }
            }
            transitions.push(CompiledTransition {
                from,
                to,
                event,
                spec,
                property_specs,
                delays,
                guard: t.get("guard").and_then(Value::as_str).map(str::to_string),
                interrupt,
            });
        }
    }

    let mut relations = Vec::new();
    if let Some(rs) = c.get("relations").and_then(Value::as_array) {
        for (i, rv) in rs.iter().enumerate() {
            match serde_json::from_value::<Relation>(rv.clone()) {
                Ok(r) => relations.push(r),
                Err(e) => ctx.d.error(
                    "E_RELATION",
                    format!("{base}.relations[{i}]"),
                    e.to_string(),
                ),
            }
        }
    }

    let mut gestures = Vec::new();
    if let Some(gs) = obj(c.get("gestures")) {
        for (kind, gv) in gs {
            let path = format!("{base}.gestures.{kind}");
            if kind != "drag" {
                ctx.d.error(
                    "E_GESTURE",
                    path,
                    format!("unsupported gesture `{kind}` (supported: drag)"),
                );
                continue;
            }
            let Some(prop) = gv.get("property").and_then(Value::as_str) else {
                ctx.d.error(
                    "E_GESTURE",
                    format!("{path}.property"),
                    "`property` is required",
                );
                continue;
            };
            if !properties.contains_key(prop) {
                ctx.d.error(
                    "E_UNKNOWN_PROPERTY",
                    format!("{path}.property"),
                    format!("property `{prop}` is not declared"),
                );
                continue;
            }
            let bounds = gv.get("bounds").and_then(Value::as_array);
            let b = |i: usize| bounds.and_then(|a| a.get(i)).and_then(Value::as_f64);
            let mut snap_points = Vec::new();
            let mut snap_states = Vec::new();
            if let Some(sn) = gv.get("snapTo").and_then(Value::as_array) {
                for (i, s) in sn.iter().enumerate() {
                    match s {
                        Value::Number(n) => snap_points.push(n.as_f64().unwrap_or(0.0)),
                        Value::String(st) => match states.get(st).and_then(|g| g.get(prop)) {
                            Some(v) => {
                                snap_points.push(*v);
                                snap_states.push(st.clone());
                            }
                            None => ctx.d.error(
                                "E_GESTURE",
                                format!("{path}.snapTo[{i}]"),
                                format!("state `{st}` does not define `{prop}`"),
                            ),
                        },
                        _ => ctx.d.error(
                            "E_GESTURE",
                            format!("{path}.snapTo[{i}]"),
                            "snap targets must be numbers or state names",
                        ),
                    }
                }
            }
            gestures.push(CompiledGesture {
                kind: kind.clone(),
                property: prop.to_string(),
                axis: gv
                    .get("axis")
                    .and_then(Value::as_str)
                    .unwrap_or("x")
                    .to_string(),
                min: b(0),
                max: b(1),
                rubber_band: gv
                    .get("rubberBand")
                    .and_then(Value::as_f64)
                    .unwrap_or(ctx.profile.elasticity),
                snap_points,
                snap_states,
                fling_threshold: gv
                    .get("flingThreshold")
                    .and_then(Value::as_f64)
                    .unwrap_or(500.0),
            });
        }
    }

    // Relation folding: a relation whose source is never animated is a constant.
    let animated: BTreeSet<&String> = states
        .values()
        .flat_map(|g| g.keys())
        .chain(gestures.iter().map(|g| &g.property))
        .collect();
    let relation_targets: BTreeSet<String> = relations.iter().map(|r| r.target.clone()).collect();
    let mut kept = Vec::new();
    for r in relations {
        if !animated.contains(&r.source) && !relation_targets.contains(&r.source) {
            if let Some(src) = properties.get(&r.source).cloned() {
                let v = r.map(src.initial);
                if let Some(t) = properties.get_mut(&r.target) {
                    t.initial = v;
                }
                ctx.d.info(
                    "I_FOLDED_RELATION",
                    format!("{base}.relations"),
                    format!(
                        "`{}` never changes; `{}` folded to constant {v}",
                        r.source, r.target
                    ),
                );
                stats.folded_relations += 1;
                continue;
            }
        }
        kept.push(r);
    }

    let effects = c
        .get("effects")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let comp = CompiledComponent {
        role,
        priority,
        properties,
        units,
        states,
        initial,
        default_spec,
        transitions,
        relations: kept,
        gestures,
        effects,
    };

    // Graph-level validation (references, cycles, ownership, reachability).
    let tmp = ExecutionPlan {
        plan_version: PLAN_VERSION,
        name: None,
        profile: String::new(),
        specs: ctx
            .pool
            .specs
            .iter()
            .map(|s| CompiledSpec {
                spec: s.clone(),
                compositor: None,
            })
            .collect(),
        components: BTreeMap::from([(name.to_string(), comp.clone())]),
        timelines: BTreeMap::new(),
        effects: BTreeMap::new(),
        performance: PerformancePlan::default(),
        accessibility: AccessibilityPlan::default(),
        stats: PlanStats::default(),
    };
    if let Some(gd) = tmp.graph_def(name) {
        let diags = GraphDef::validate(&gd);
        // Translate graph paths (states.x / transitions[i]) under the component.
        ctx.d.extend_prefixed(&base, diags);
    }
    stats.states += comp.states.len();
    stats.transitions += comp.transitions.len();
    Some(comp)
}

fn compile_timeline(
    ctx: &mut Ctx,
    name: &str,
    tv: &Value,
    components: &BTreeMap<String, CompiledComponent>,
) -> Option<CompiledTimeline> {
    let base = format!("timelines.{name}");
    let Some(tracks) = tv.get("tracks").and_then(Value::as_array) else {
        ctx.d.error(
            "E_TIMELINE",
            format!("{base}.tracks"),
            "timeline needs a `tracks` array",
        );
        return None;
    };
    let mut tl = Timeline::new();
    let mut labels = BTreeMap::new();
    if let Some(ls) = obj(tv.get("labels")) {
        for (l, v) in ls {
            if let Some(ms) = v.as_f64() {
                let _ = tl.add_label(l, Position::At(ms / 1000.0));
                labels.insert(l.clone(), ms / 1000.0);
            }
        }
    }
    let mut entries = Vec::new();
    for (i, t) in tracks.iter().enumerate() {
        let path = format!("{base}.tracks[{i}]");
        let target = t.get("target").and_then(Value::as_str).unwrap_or("");
        let Some((comp, prop)) = target.split_once('.') else {
            ctx.d.error(
                "E_TIMELINE",
                format!("{path}.target"),
                "target must be `component.property`",
            );
            continue;
        };
        match components.get(comp) {
            Some(c) if c.properties.contains_key(prop) => {}
            Some(_) => {
                ctx.d.error(
                    "E_UNKNOWN_PROPERTY",
                    format!("{path}.target"),
                    format!("`{comp}` has no property `{prop}`"),
                );
                continue;
            }
            None => {
                ctx.d.error(
                    "E_UNKNOWN_COMPONENT",
                    format!("{path}.target"),
                    format!("unknown component `{comp}`"),
                );
                continue;
            }
        }
        let Some(to) = t.get("to").and_then(Value::as_f64) else {
            ctx.d
                .error("E_TIMELINE", format!("{path}.to"), "`to` must be a number");
            continue;
        };
        let from = t.get("from").and_then(Value::as_f64);
        let spec_v = t
            .get("transition")
            .cloned()
            .unwrap_or_else(|| Value::String("$spring.standard".into()));
        let Some(spec) = ctx.spec(&spec_v, &format!("{path}.transition")) else {
            continue;
        };
        let position = match t.get("at") {
            None => Position::AfterPrevious(0.0),
            Some(Value::Number(n)) => Position::At(n.as_f64().unwrap_or(0.0) / 1000.0),
            Some(Value::String(s)) => parse_position(s),
            Some(_) => {
                ctx.d.error(
                    "E_TIMELINE",
                    format!("{path}.at"),
                    "`at` must be a number (ms) or a position string",
                );
                continue;
            }
        };
        let track = format!("{comp}.{prop}");
        if from.is_none() {
            if let Some(c) = components.get(comp) {
                if !tl.tracks().contains(&track) {
                    tl.set_initial(&track, c.properties[prop].initial);
                }
            }
        }
        match tl.add(&track, from, to, &spec, position) {
            Ok(start) => {
                let duration = tl.entries().last().map_or(0.0, |e| e.generator.duration());
                let idx = ctx.pool.intern(spec);
                entries.push(TimelineEntry {
                    component: comp.into(),
                    property: prop.into(),
                    start,
                    duration,
                    spec: idx,
                    from,
                    to,
                });
            }
            Err(e) => ctx.d.error("E_TIMELINE", path, e.to_string()),
        }
    }
    Some(CompiledTimeline {
        duration: tl.duration(),
        entries,
        labels,
    })
}

/// `"+=100"` after previous, `"-=50"` overlap, `"<"` / `"<+=40"` with previous,
/// `"label"` / `"label+=100"`.
fn parse_position(s: &str) -> Position {
    let ms = |x: &str| x.trim().parse::<f64>().unwrap_or(0.0) / 1000.0;
    if let Some(r) = s.strip_prefix("+=") {
        Position::AfterPrevious(ms(r))
    } else if let Some(r) = s.strip_prefix("-=") {
        Position::AfterPrevious(-ms(r))
    } else if let Some(r) = s.strip_prefix('<') {
        Position::WithPrevious(r.strip_prefix("+=").map_or(0.0, ms))
    } else if let Some((l, r)) = s.split_once("+=") {
        Position::Label(l.to_string(), ms(r))
    } else if let Some((l, r)) = s.split_once("-=") {
        Position::Label(l.to_string(), -ms(r))
    } else {
        Position::Label(s.to_string(), 0.0)
    }
}
