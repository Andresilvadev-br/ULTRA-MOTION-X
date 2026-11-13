import { reportError } from './env.js';

/** Emissor de eventos mínimo; on() devolve a função de cancelamento. */
export class Emitter {
  constructor() { this._handlers = new Map(); }

  on(type, fn) {
    let set = this._handlers.get(type);
    if (!set) this._handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (...args) => { off(); fn(...args); });
    return off;
  }

  off(type, fn) { this._handlers.get(type)?.delete(fn); }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { reportError(err, `listener "${type}"`); }
    }
  }

  removeAllListeners() { this._handlers.clear(); }
}
