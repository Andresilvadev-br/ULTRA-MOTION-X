import { Emitter } from '../core/emitter.js';
import { createTimers, reportError } from '../core/env.js';

/**
 * MotionDirector — a única autoridade que decide o que anima (Plano 5.0 §6.0/§6.6).
 *
 * Coreografias são declarativas e ligadas a EVENTOS REAIS do backend:
 *
 *   director.define('clip.save', {
 *     on: 'clip.save.requested',
 *     channel: 'clips', concurrency: 'parallel',
 *     steps: [
 *       { run: (ctx) => ctx.animate(btn, { scale: 0.96 }) },          // feedback de interação
 *       { await: 'clip.save.validated', fail: 'clip.save.failed' },   // confirmação real
 *       { announce: 'success', run: (ctx) => ... },                   // só depois do await
 *     ],
 *     onError: [ { announce: 'error', run: (ctx) => ... } ],
 *   });
 *
 * Garantias:
 *  • Passos com `announce` (sucesso/erro/estado) só são aceitos DEPOIS de um `await`:
 *    o fim de uma animação nunca vira "salvo", "ativado" ou "concluído".
 *  • Eventos são idempotentes (type+id+seq) e as execuções são canceláveis.
 *  • concurrency: 'replace' (padrão: a mais nova assume o canal), 'parallel' (por id)
 *    ou 'drop' (ignora enquanto houver uma ativa).
 *  • Uma execução substituída nunca roda mais passos nem anuncia estado velho.
 */
export class MotionDirector extends Emitter {
  constructor({ animator = null, budget = null, timers, character = null, historySize = 120 } = {}) {
    super();
    this.animator = animator;
    this.budget = budget;
    this.character = character;
    this.timers = createTimers(timers);
    this._defs = new Map();
    this._runs = new Set();
    this._seen = new Set();
    this._seenOrder = [];
    this._confirmed = new Map();
    this._history = [];
    this._historySize = historySize;
    this._runSeq = 0;
  }

  define(name, def) {
    if (this._defs.has(name)) throw new Error(`Coreografia duplicada: ${name}`);
    validateSteps(def.steps ?? [], `${name}.steps`, false);
    validateSteps(def.onError ?? [], `${name}.onError`, true);
    const on = def.on == null ? [] : Array.isArray(def.on) ? def.on : [def.on];
    this._defs.set(name, {
      name, on,
      channel: def.channel ?? name,
      priority: def.priority ?? 50,
      concurrency: def.concurrency ?? 'replace',
      steps: def.steps ?? [],
      onError: def.onError ?? [],
      onCancel: def.onCancel,
    });
    return () => this._defs.delete(name);
  }

  /** Recebe um evento (do backend Go, da UI ou de simulação explícita). */
  dispatch(raw) {
    const event = normalizeEvent(raw);
    if (!event) return { accepted: false, reason: 'invalid' };
    const key = `${event.type}|${event.id ?? ''}|${event.seq ?? ''}`;
    if (event.seq != null || event.id != null) {
      if (this._seen.has(key)) return { accepted: false, reason: 'duplicate' };
      this._remember(key);
    }
    this._log('event', { type: event.type, id: event.id, simulated: event.simulated });
    this.emit('event', event);

    // 1) Entrega aos passos que aguardam confirmação.
    for (const run of [...this._runs]) run._deliver(event);

    // 2) Dispara coreografias registradas para este tipo.
    const started = [];
    for (const def of this._defs.values()) {
      if (def.on.some((pattern) => matches(pattern, event.type))) {
        const run = this._start(def, event);
        if (run) started.push(run);
      }
    }
    return { accepted: true, started: started.map((r) => r.def.name) };
  }

  /** Executa uma coreografia diretamente (ex.: clique local) sem evento de backend. */
  play(name, payload = {}, { id } = {}) {
    const def = this._defs.get(name);
    if (!def) throw new Error(`Coreografia desconhecida: ${name}`);
    return this._start(def, normalizeEvent({ type: `play:${name}`, id, payload }));
  }

  /** O evento (type,id) foi confirmado pelo backend durante esta sessão? */
  wasConfirmed(type, id) { return this._confirmed.has(`${type}|${id ?? ''}`); }

  cancelChannel(channel, reason = 'cancelled') {
    for (const run of [...this._runs]) if (run.def.channel === channel) run.cancel(reason);
  }

  cancelAll(reason = 'cancelled') { for (const run of [...this._runs]) run.cancel(reason); }

  get activeRuns() {
    return [...this._runs].map((r) => ({ name: r.def.name, id: r.id, channel: r.def.channel, step: r.stepIndex, state: r.state }));
  }

  history() { return this._history.slice(); }

  _start(def, event) {
    const id = event.id ?? null;
    const sameChannel = [...this._runs].filter((r) => r.def.channel === def.channel);
    if (def.concurrency === 'drop' && sameChannel.length) {
      this._log('dropped', { name: def.name, id });
      return null;
    }
    for (const other of sameChannel) {
      if (def.concurrency === 'parallel' && other.id !== id) continue;
      if (other.def.priority > def.priority) {
        this._log('dropped', { name: def.name, id, reason: 'lower-priority' });
        return null;
      }
      other.cancel('superseded');
    }
    const run = new Run(this, def, event, ++this._runSeq);
    this._runs.add(run);
    this._log('start', { name: def.name, id });
    this.emit('start', { name: def.name, id });
    run._execute().finally(() => {
      this._runs.delete(run);
      this._log('end', { name: def.name, id, state: run.state });
      this.emit('end', { name: def.name, id, state: run.state });
    });
    return run;
  }

  _markConfirmed(event) {
    this._confirmed.set(`${event.type}|${event.id ?? ''}`, true);
    if (this._confirmed.size > 500) this._confirmed.delete(this._confirmed.keys().next().value);
  }

  _remember(key) {
    this._seen.add(key);
    this._seenOrder.push(key);
    if (this._seenOrder.length > 512) this._seen.delete(this._seenOrder.shift());
  }

  _log(kind, data) {
    const entry = { t: this.timers.now(), kind, ...data };
    this._history.push(entry);
    if (this._history.length > this._historySize) this._history.shift();
  }

  destroy() {
    this.cancelAll('destroyed');
    this._defs.clear();
    this.removeAllListeners();
  }
}

class Run {
  constructor(director, def, event, seq) {
    this.director = director;
    this.def = def;
    this.event = event;
    this.id = event.id ?? null;
    this.seq = seq;
    this.state = 'running';
    this.stepIndex = 0;
    this._disposers = [];
    this._waiter = null;
    this.ctx = createContext(this);
  }

  get alive() { return this.state === 'running' || this.state === 'error-path'; }

  cancel(reason = 'cancelled') {
    if (!this.alive) return;
    this.state = reason === 'superseded' ? 'superseded' : 'cancelled';
    this._dispose();
    if (this._waiter) { const w = this._waiter; this._waiter = null; w.reject(new Cancelled(reason)); }
    try { this.def.onCancel?.(this.ctx, reason); } catch (err) { reportError(err, `${this.def.name}.onCancel`); }
  }

  _dispose() {
    const list = this._disposers.splice(0, this._disposers.length);
    for (const fn of list.reverse()) {
      try { fn(); } catch (err) { reportError(err, `${this.def.name} dispose`); }
    }
  }

  _deliver(event) {
    const w = this._waiter;
    if (!w) return;
    if (this.id != null && event.id != null && event.id !== this.id) return;
    if (w.progress && matches(w.progress, event.type)) {
      try { w.onProgress?.(this.ctx, event); } catch (err) { reportError(err, `${this.def.name}.onProgress`); }
      return;
    }
    if (w.types.some((t) => matches(t, event.type))) {
      this._waiter = null;
      this.director._markConfirmed(event);
      w.resolve(event);
    } else if (w.fail.some((t) => matches(t, event.type))) {
      this._waiter = null;
      w.reject(new Failed(event));
    }
  }

  async _execute() {
    try {
      await this._runSteps(this.def.steps);
      if (this.alive) this.state = 'done';
    } catch (err) {
      if (err instanceof Cancelled) return;
      if (!this.alive) return;
      this.state = 'error-path';
      this.ctx.reason = err instanceof Failed ? 'failed' : err instanceof TimedOut ? 'timeout' : 'exception';
      this.ctx.failure = err instanceof Failed ? err.event : null;
      if (!(err instanceof Failed) && !(err instanceof TimedOut)) reportError(err, this.def.name);
      this.director._log('error', { name: this.def.name, id: this.id, reason: this.ctx.reason });
      try {
        await this._runSteps(this.def.onError);
      } catch (inner) {
        if (!(inner instanceof Cancelled)) reportError(inner, `${this.def.name}.onError`);
      }
      if (this.alive) this.state = 'failed';
    } finally {
      if (this.state === 'done' || this.state === 'failed') this._disposers.length = 0;
    }
  }

  async _runSteps(steps) {
    for (let i = 0; i < steps.length; i++) {
      if (!this.alive) throw new Cancelled('stale');
      this.stepIndex = i;
      await this._runStep(steps[i]);
    }
  }

  async _runStep(step) {
    if (step.parallel) {
      await Promise.all(step.parallel.map((s) => this._runStep(s)));
      return;
    }
    if (step.await) {
      const event = await this._await(step);
      this.ctx.confirmed = event;
      this.director._log('confirmed', { name: this.def.name, id: this.id, type: event.type });
      if (step.then) await step.then(this.ctx, event);
      return;
    }
    if (step.delay) {
      await this.ctx.wait(step.delay);
      return;
    }
    if (step.run) {
      if (step.announce) this.director._log('announce', { name: this.def.name, id: this.id, announce: step.announce });
      const result = step.run(this.ctx);
      if (step.wait !== false && result && typeof result.then === 'function') await result;
      else if (step.wait !== false && result?.finished) await result.finished;
    }
  }

  _await(step) {
    return new Promise((resolve, reject) => {
      const types = Array.isArray(step.await) ? step.await : [step.await];
      const fail = step.fail ? (Array.isArray(step.fail) ? step.fail : [step.fail]) : [];
      const timeout = step.timeout ?? 60000;
      const timers = this.director.timers;
      const waiterId = Symbol('waiter');
      const timer = timeout > 0 ? timers.setTimeout(() => {
        if (this._waiter?.id !== waiterId) return;
        this._waiter = null;
        reject(new TimedOut(types));
      }, timeout) : null;
      const clear = () => timer != null && timers.clearTimeout(timer);
      this._waiter = {
        id: waiterId, types, fail, progress: step.progress, onProgress: step.onProgress,
        resolve: (e) => { clear(); resolve(e); },
        reject: (e) => { clear(); reject(e); },
      };
    });
  }
}

function createContext(run) {
  const director = run.director;
  const ctx = {
    get event() { return run.event; },
    get payload() { return run.event.payload; },
    get id() { return run.id; },
    get simulated() { return !!run.event.simulated; },
    confirmed: null,
    failure: null,
    reason: null,
    director,
    get budget() { return director.budget; },
    get character() { return director.character; },
    isCurrent: () => run.alive,
    onDispose(fn) { run._disposers.push(fn); },
    animate(el, props, opts) {
      if (!director.animator || !el) return { finished: Promise.resolve(true), cancel() {} };
      const handle = director.animator.animate(el, props, opts);
      run._disposers.push(() => handle.cancel());
      return handle;
    },
    /** Pausa cosmética: encurtada pelo perfil e cancelável. */
    wait(ms) {
      const scale = director.budget ? Math.max(0.25, director.budget.profile.decor || 0.25) : 1;
      return new Promise((resolve, reject) => {
        const id = director.timers.setTimeout(() => (run.alive ? resolve() : reject(new Cancelled('stale'))), ms * scale);
        run._disposers.push(() => director.timers.clearTimeout(id));
      });
    },
    emit(type, data) { director.emit(type, { ...data, run: run.def.name, id: run.id }); },
  };
  return ctx;
}

function validateSteps(steps, path, isErrorPath) {
  let confirmed = isErrorPath;
  const walk = (list, where) => {
    list.forEach((step, i) => {
      const at = `${where}[${i}]`;
      if (!step || typeof step !== 'object') throw new Error(`${at}: passo inválido`);
      if (step.parallel) { walk(step.parallel, `${at}.parallel`); return; }
      if (step.await) { confirmed = true; return; }
      if (step.announce && !confirmed) {
        throw new Error(`${at}: "announce: ${step.announce}" exige um passo "await" anterior (confirmação real do backend)`);
      }
      if (!step.run && !step.delay) throw new Error(`${at}: passo sem run/await/delay`);
    });
  };
  walk(steps, path);
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type;
  if (typeof type !== 'string' || !/^[\w.:*-]{1,96}$/.test(type)) return null;
  return {
    type,
    id: raw.id == null ? null : String(raw.id),
    seq: raw.seq == null ? null : Number(raw.seq),
    ts: raw.ts ?? Date.now(),
    status: raw.status ?? null,
    payload: raw.payload ?? {},
    simulated: !!raw.simulated,
  };
}

function matches(pattern, type) {
  if (pattern === type) return true;
  if (pattern.endsWith('*')) return type.startsWith(pattern.slice(0, -1));
  return false;
}

class Cancelled extends Error { constructor(reason) { super(`cancelled: ${reason}`); this.reason = reason; } }
class Failed extends Error { constructor(event) { super(`failed: ${event.type}`); this.event = event; } }
class TimedOut extends Error { constructor(types) { super(`timeout waiting ${types.join(', ')}`); } }
