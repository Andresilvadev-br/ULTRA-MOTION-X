/** Frame drivers abstract the platform's frame callback so the engine can run in browsers,
 * workers, Node (SSR/tests) and deterministic replays. */

export interface FrameDriver {
  /** Monotonic time in milliseconds. */
  now(): number;
  request(cb: (timestamp: number) => void): unknown;
  cancel(handle: unknown): void;
  readonly kind: string;
}

/** requestAnimationFrame-based driver (browsers). Falls back to timers elsewhere. */
export function createDefaultDriver(): FrameDriver {
  const g = globalThis as typeof globalThis & { requestAnimationFrame?: typeof requestAnimationFrame };
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  if (typeof g.requestAnimationFrame === "function") {
    return {
      kind: "raf",
      now,
      request: (cb) => g.requestAnimationFrame((t) => cb(t)),
      cancel: (h) => cancelAnimationFrame(h as number),
    };
  }
  return {
    kind: "timer",
    now,
    request: (cb) => setTimeout(() => cb(now()), 16),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

/** Deterministic driver: frames only happen when `step()` is called. */
export class ManualDriver implements FrameDriver {
  readonly kind = "manual";
  time = 0;
  private pending: Array<(t: number) => void> = [];
  private nextId = 1;
  private handles = new Map<number, (t: number) => void>();

  now(): number {
    return this.time;
  }
  request(cb: (t: number) => void): number {
    const id = this.nextId++;
    this.handles.set(id, cb);
    this.pending.push(cb);
    return id;
  }
  cancel(h: unknown): void {
    const cb = this.handles.get(h as number);
    if (cb) this.pending = this.pending.filter((c) => c !== cb);
    this.handles.delete(h as number);
  }
  get hasPendingFrame(): boolean {
    return this.pending.length > 0;
  }
  /** Advances time by `ms` and runs the pending frame callbacks. */
  step(ms = 1000 / 60): void {
    this.time += ms;
    const cbs = this.pending;
    this.pending = [];
    this.handles.clear();
    for (const cb of cbs) cb(this.time);
  }
  /** Steps until idle or `maxFrames`. Returns frames executed. */
  run(ms = 1000 / 60, maxFrames = 10_000): number {
    let n = 0;
    while (this.pending.length && n < maxFrames) {
      this.step(ms);
      n++;
    }
    return n;
  }
}
