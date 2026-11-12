/**
 * Smart Frame Scheduler (web). Work is split into phases executed in order every frame:
 * `input → update → read → write → post`. Reads are batched before writes to avoid layout
 * thrashing; keyed tasks replace pending tasks with the same key (obsolete work is dropped);
 * deferrable tasks are postponed when the frame budget is exhausted (with a starvation guard).
 */

export type Phase = "input" | "update" | "read" | "write" | "post";
export type TaskPriority = "input" | "interaction" | "animation" | "normal" | "decorative" | "idle";

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  input: 0,
  interaction: 1,
  animation: 2,
  normal: 3,
  decorative: 4,
  idle: 5,
};
const PHASES: Phase[] = ["input", "update", "read", "write", "post"];

interface Task {
  fn: (budgetLeftMs: number) => void;
  priority: TaskPriority;
  key: string | undefined;
  deferrals: number;
  cancelled: boolean;
}

export interface ScheduleOptions {
  priority?: TaskPriority;
  /** Tasks with the same key replace each other until executed. */
  key?: string;
}

export class FrameScheduler {
  private queues: Record<Phase, Task[]> = { input: [], update: [], read: [], write: [], post: [] };
  private keyed = new Map<string, Task>();
  maxDeferrals = 8;
  droppedObsolete = 0;
  deferred = 0;
  /** Called when work is scheduled (the engine uses it to request a frame). */
  onSchedule: (() => void) | null = null;

  schedule(phase: Phase, fn: (budgetLeftMs: number) => void, opts: ScheduleOptions = {}): () => void {
    const task: Task = { fn, priority: opts.priority ?? "normal", key: opts.key, deferrals: 0, cancelled: false };
    if (opts.key !== undefined) {
      const prev = this.keyed.get(opts.key);
      if (prev && !prev.cancelled) {
        prev.cancelled = true;
        this.droppedObsolete++;
      }
      this.keyed.set(opts.key, task);
    }
    this.queues[phase].push(task);
    this.onSchedule?.();
    return () => {
      task.cancelled = true;
    };
  }

  get pending(): number {
    let n = 0;
    for (const p of PHASES) n += this.queues[p].filter((t) => !t.cancelled).length;
    return n;
  }

  /** Runs one phase. `remaining()` returns the frame budget left in ms. */
  run(phase: Phase, remaining: () => number): { executed: number; deferred: number } {
    const tasks = this.queues[phase];
    if (!tasks.length) return { executed: 0, deferred: 0 };
    this.queues[phase] = [];
    tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    let executed = 0;
    let deferred = 0;
    for (const t of tasks) {
      if (t.cancelled) continue;
      const left = remaining();
      const deferrable = PRIORITY_ORDER[t.priority] >= PRIORITY_ORDER.normal && phase !== "write";
      if (deferrable && left <= 0 && t.deferrals < this.maxDeferrals) {
        t.deferrals++;
        deferred++;
        this.deferred++;
        this.queues[phase].push(t);
        continue;
      }
      if (t.key !== undefined && this.keyed.get(t.key) === t) this.keyed.delete(t.key);
      try {
        t.fn(left);
      } catch (err) {
        reportError(err);
      }
      executed++;
    }
    return { executed, deferred };
  }

  clear(): void {
    this.queues = { input: [], update: [], read: [], write: [], post: [] };
    this.keyed.clear();
  }
}

/** Errors in user callbacks must never stop the frame loop. */
export function reportError(err: unknown): void {
  const g = globalThis as { reportError?: (e: unknown) => void };
  if (typeof g.reportError === "function") g.reportError(err);
  else console.error("[ultra-motion-x]", err);
}
