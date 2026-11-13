// Relógios e elementos falsos para testar o motor sem navegador.

export function fakeFrameClock(start = 0) {
  let t = start;
  let id = 0;
  const queue = new Map();
  return {
    now: () => t,
    raf: (cb) => { queue.set(++id, cb); return id; },
    caf: (i) => queue.delete(i),
    get pending() { return queue.size; },
    /** Avança um frame (ms) e executa os callbacks agendados. */
    frame(ms = 1000 / 60) {
      t += ms;
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(t);
    },
    advance(ms) { t += ms; },
    run(frames, ms) { for (let i = 0; i < frames; i++) this.frame(ms); },
  };
}

export function fakeTimers() {
  let t = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms = 0) => { const i = ++id; timers.set(i, { at: t + ms, fn }); return i; },
    clearTimeout: (i) => timers.delete(i),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [i, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [i, x];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
}

export function fakeElement({ animate = false } = {}) {
  const style = {
    setProperty(k, v) { this[k] = v; },
    getPropertyValue(k) { return this[k]; },
  };
  const el = { style, animations: [] };
  if (animate) {
    el.animate = (keyframes, opts) => {
      const anim = { keyframes, opts, cancelled: false, onfinish: null, cancel() { this.cancelled = true; } };
      el.animations.push(anim);
      return anim;
    };
  }
  return el;
}

export const flush = () => new Promise((r) => setImmediate(r));

export function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => { data[k] = String(v); } };
}
