//! Smart Frame Scheduler.
//!
//! Hosts call [`FrameScheduler::run_frame`] once per presented frame. Tasks are executed in
//! priority order; tasks scheduled with the same key replace each other (obsolete work is
//! dropped before it runs); decorative and idle work is deferred when the frame budget is
//! exhausted, with a starvation guard. When no task is pending,
//! [`FrameScheduler::needs_frame`] is `false` and the host should stop requesting frames.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskPriority {
    /// Input handling and direct-manipulation feedback. Never deferred.
    Input = 0,
    /// Animation updates for interactive elements. Never deferred.
    Interaction = 1,
    /// Regular animation updates.
    Animation = 2,
    /// Ordinary work that can tolerate a frame of delay.
    Normal = 3,
    /// Decorative effects (particles, ambient motion). First to be deferred.
    Decorative = 4,
    /// Opportunistic work.
    Idle = 5,
}

impl TaskPriority {
    fn deferrable(self) -> bool {
        self >= TaskPriority::Normal
    }
}

/// Work item. The closure receives the frame budget remaining (ms) and returns `true` to be
/// re-scheduled for the next frame (continuous work like an animation).
pub type TaskFn<C> = Box<dyn FnMut(&mut C, f64) -> bool>;

struct Task<C> {
    id: u64,
    key: Option<String>,
    priority: TaskPriority,
    deferrals: u32,
    run: TaskFn<C>,
}

/// Per-frame outcome.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameReport {
    pub executed: u32,
    pub deferred: u32,
    pub budget_ms: f64,
    pub used_ms: f64,
    pub over_budget: bool,
}

/// Monotonic clock abstraction so the scheduler is testable and portable.
pub trait Clock {
    fn now_ms(&self) -> f64;
}

pub struct FrameScheduler<C> {
    tasks: Vec<Task<C>>,
    next_id: u64,
    /// Fraction of the frame interval the engine may use.
    pub budget_fraction: f64,
    /// Time already consumed this frame by the rest of the application (reported by host).
    pub external_work_ms: f64,
    /// Maximum consecutive deferrals before a task is forced to run.
    pub max_deferrals: u32,
    dropped_obsolete: u64,
    total_deferred: u64,
}

impl<C> core::fmt::Debug for FrameScheduler<C> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("FrameScheduler")
            .field("tasks", &self.tasks.len())
            .field("budget_fraction", &self.budget_fraction)
            .finish()
    }
}

impl<C> Default for FrameScheduler<C> {
    fn default() -> Self {
        Self::new()
    }
}

impl<C> FrameScheduler<C> {
    pub fn new() -> Self {
        Self {
            tasks: Vec::new(),
            next_id: 1,
            budget_fraction: 0.5,
            external_work_ms: 0.0,
            max_deferrals: 8,
            dropped_obsolete: 0,
            total_deferred: 0,
        }
    }

    /// Schedules a task. With a `key`, any pending task with the same key is dropped first.
    pub fn schedule(&mut self, priority: TaskPriority, key: Option<&str>, run: TaskFn<C>) -> u64 {
        if let Some(k) = key {
            let before = self.tasks.len();
            self.tasks.retain(|t| t.key.as_deref() != Some(k));
            self.dropped_obsolete += (before - self.tasks.len()) as u64;
        }
        let id = self.next_id;
        self.next_id += 1;
        self.tasks.push(Task {
            id,
            key: key.map(str::to_string),
            priority,
            deferrals: 0,
            run,
        });
        id
    }

    pub fn cancel(&mut self, id: u64) -> bool {
        let before = self.tasks.len();
        self.tasks.retain(|t| t.id != id);
        before != self.tasks.len()
    }

    pub fn cancel_key(&mut self, key: &str) -> usize {
        let before = self.tasks.len();
        self.tasks.retain(|t| t.key.as_deref() != Some(key));
        before - self.tasks.len()
    }

    pub fn pending(&self) -> usize {
        self.tasks.len()
    }

    /// `false` when there is nothing to do: hosts should stop their frame loop.
    pub fn needs_frame(&self) -> bool {
        !self.tasks.is_empty()
    }

    pub fn dropped_obsolete(&self) -> u64 {
        self.dropped_obsolete
    }
    pub fn total_deferred(&self) -> u64 {
        self.total_deferred
    }

    pub fn pending_by_priority(&self) -> BTreeMap<TaskPriority, usize> {
        let mut m = BTreeMap::new();
        for t in &self.tasks {
            *m.entry(t.priority).or_insert(0) += 1;
        }
        m
    }

    /// Runs one frame. `interval_ms` is the current refresh interval.
    pub fn run_frame(&mut self, ctx: &mut C, clock: &dyn Clock, interval_ms: f64) -> FrameReport {
        let start = clock.now_ms();
        let budget =
            (interval_ms * self.budget_fraction - self.external_work_ms).max(interval_ms * 0.1);
        let mut tasks = std::mem::take(&mut self.tasks);
        // Stable sort keeps FIFO order within a priority.
        tasks.sort_by_key(|t| t.priority);
        let mut keep = Vec::with_capacity(tasks.len());
        let mut report = FrameReport {
            budget_ms: budget,
            ..FrameReport::default()
        };
        for mut task in tasks {
            let used = clock.now_ms() - start;
            if task.priority.deferrable() && used >= budget && task.deferrals < self.max_deferrals {
                task.deferrals += 1;
                report.deferred += 1;
                self.total_deferred += 1;
                keep.push(task);
                continue;
            }
            let again = (task.run)(ctx, (budget - used).max(0.0));
            report.executed += 1;
            if again {
                task.deferrals = 0;
                keep.push(task);
            }
        }
        // Tasks scheduled from inside callbacks were pushed to `self.tasks`.
        keep.append(&mut self.tasks);
        self.tasks = keep;
        report.used_ms = clock.now_ms() - start;
        report.over_budget = report.used_ms > budget;
        report
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    struct FakeClock(Cell<f64>);
    impl Clock for FakeClock {
        fn now_ms(&self) -> f64 {
            self.0.get()
        }
    }

    #[test]
    fn runs_in_priority_order() {
        let mut s: FrameScheduler<Vec<&'static str>> = FrameScheduler::new();
        s.schedule(
            TaskPriority::Decorative,
            None,
            Box::new(|c, _| {
                c.push("deco");
                false
            }),
        );
        s.schedule(
            TaskPriority::Input,
            None,
            Box::new(|c, _| {
                c.push("input");
                false
            }),
        );
        s.schedule(
            TaskPriority::Animation,
            None,
            Box::new(|c, _| {
                c.push("anim");
                false
            }),
        );
        let mut log = Vec::new();
        let clock = FakeClock(Cell::new(0.0));
        s.run_frame(&mut log, &clock, 16.67);
        assert_eq!(log, vec!["input", "anim", "deco"]);
        assert!(!s.needs_frame());
    }

    #[test]
    fn obsolete_tasks_are_dropped() {
        let mut s: FrameScheduler<u32> = FrameScheduler::new();
        for _ in 0..5 {
            s.schedule(
                TaskPriority::Normal,
                Some("layout:panel"),
                Box::new(|c, _| {
                    *c += 1;
                    false
                }),
            );
        }
        let mut n = 0;
        s.run_frame(&mut n, &FakeClock(Cell::new(0.0)), 16.67);
        assert_eq!(n, 1);
        assert_eq!(s.dropped_obsolete(), 4);
    }

    #[test]
    fn decorative_work_is_deferred_over_budget() {
        let clock = std::rc::Rc::new(FakeClock(Cell::new(0.0)));
        let mut s: FrameScheduler<Vec<&'static str>> = FrameScheduler::new();
        let c2 = clock.clone();
        s.schedule(
            TaskPriority::Interaction,
            None,
            Box::new(move |c, _| {
                c2.0.set(c2.0.get() + 20.0);
                c.push("heavy");
                false
            }),
        );
        s.schedule(
            TaskPriority::Decorative,
            None,
            Box::new(|c, _| {
                c.push("deco");
                false
            }),
        );
        let mut log = Vec::new();
        let r = s.run_frame(&mut log, &*clock, 16.67);
        assert_eq!(log, vec!["heavy"]);
        assert_eq!(r.deferred, 1);
        assert!(r.over_budget);
        s.run_frame(&mut log, &*clock, 16.67);
        assert_eq!(log, vec!["heavy", "deco"]);
    }

    #[test]
    fn starvation_guard() {
        let clock = std::rc::Rc::new(FakeClock(Cell::new(0.0)));
        let mut s: FrameScheduler<u32> = FrameScheduler::new();
        s.max_deferrals = 2;
        let c2 = clock.clone();
        s.schedule(
            TaskPriority::Input,
            None,
            Box::new(move |_, _| {
                c2.0.set(c2.0.get() + 50.0);
                true
            }),
        );
        s.schedule(
            TaskPriority::Idle,
            None,
            Box::new(|c, _| {
                *c += 1;
                false
            }),
        );
        let mut ran = 0;
        for _ in 0..3 {
            s.run_frame(&mut ran, &*clock, 16.67);
        }
        assert_eq!(ran, 1, "idle task must run after max deferrals");
    }

    #[test]
    fn continuous_tasks_persist() {
        let mut s: FrameScheduler<u32> = FrameScheduler::new();
        s.schedule(
            TaskPriority::Animation,
            None,
            Box::new(|c, _| {
                *c += 1;
                *c < 3
            }),
        );
        let mut n = 0;
        let clock = FakeClock(Cell::new(0.0));
        while s.needs_frame() {
            s.run_frame(&mut n, &clock, 8.33);
        }
        assert_eq!(n, 3);
    }
}
