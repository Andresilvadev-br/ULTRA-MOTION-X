import { createClock, hasDocument, reportError } from './env.js';
import { FrameStats } from './frame-stats.js';

/**
 * MotionScheduler — um único laço de frames para todo o app.
 *
 * - Só existe requestAnimationFrame enquanto houver trabalho (sem laço residente).
 * - Delta-time real: nada é amarrado a 60 FPS; funciona igual em 60/120/144/165/240 Hz.
 * - Fases por frame: read → update → write → after (evita layout thrashing).
 * - Pausa por motivos nomeados ("hidden", "game", "minimized"...): basta um motivo
 *   ativo para suspender; o laço só volta quando todos forem liberados.
 */
export class MotionScheduler {
  constructor(options = {}) {
    this.clock = createClock(options);
    this.maxDt = options.maxDt ?? 1 / 20;
    this.stats = new FrameStats(options.statsSize ?? 240);
    this.onError = options.onError ?? reportError;

    this._tasks = new Set();
    this._read = [];
    this._write = [];
    this._after = [];
    this._frameListeners = new Set();
    this._pauses = new Set();
    this._frameId = null;
    this._last = null;
    this._tick = this._tick.bind(this);

    const doc = options.document ?? (hasDocument ? document : null);
    if (doc && options.autoVisibility !== false) {
      this._doc = doc;
      this._onVisibility = () => (doc.hidden ? this.pause('hidden') : this.resume('hidden'));
      doc.addEventListener('visibilitychange', this._onVisibility);
      if (doc.hidden) this._pauses.add('hidden');
    }
  }

  get paused() { return this._pauses.size > 0; }
  get pauseReasons() { return [...this._pauses]; }
  get running() { return this._frameId != null; }
  now() { return this.clock.now(); }

  /**
   * Tarefa contínua: { update(dt, now) -> boolean, render?(now) }.
   * update() devolve false para sair do laço. render() roda na fase de escrita.
   */
  add(task) {
    this._tasks.add(task);
    this._ensure();
    return () => this.remove(task);
  }

  remove(task) { this._tasks.delete(task); }

  /** Leitura de layout no próximo frame (antes de qualquer escrita). */
  read(fn) { this._read.push(fn); this._ensure(); }
  /** Escrita de estilo no próximo frame. */
  write(fn) { this._write.push(fn); this._ensure(); }
  /** Executa depois das escritas do próximo frame. */
  after(fn) { this._after.push(fn); this._ensure(); }

  /**
   * Observa cada frame executado: fn(now, dt, interval). interval é null no
   * primeiro frame após ociosidade (não é um intervalo real entre frames).
   */
  onFrame(fn) { this._frameListeners.add(fn); return () => this._frameListeners.delete(fn); }

  pause(reason = 'manual') {
    this._pauses.add(reason);
    if (this._frameId != null) {
      this.clock.caf(this._frameId);
      this._frameId = null;
    }
    this._last = null;
  }

  resume(reason = 'manual') {
    this._pauses.delete(reason);
    this._ensure();
  }

  _hasWork() {
    return this._tasks.size > 0 || this._read.length > 0 || this._write.length > 0 || this._after.length > 0;
  }

  _ensure() {
    if (this._frameId == null && !this.paused && this._hasWork()) {
      this._frameId = this.clock.raf(this._tick);
    }
  }

  _tick(timestamp) {
    this._frameId = null;
    const now = typeof timestamp === 'number' ? timestamp : this.clock.now();
    let dt;
    let interval = null;
    if (this._last == null) {
      // Primeiro frame após ociosidade: usa o intervalo estimado do monitor.
      dt = this.stats.refreshInterval() / 1000;
    } else {
      interval = now - this._last;
      this.stats.push(interval);
      dt = interval / 1000;
    }
    this._last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > this.maxDt) dt = this.maxDt;

    this._flush(this._read, 'read');

    const tasks = [...this._tasks];
    for (const task of tasks) {
      let keep = true;
      try { keep = task.update ? task.update(dt, now) !== false : true; } catch (err) {
        keep = false;
        this.onError(err, 'scheduler task update');
      }
      if (!keep) this._tasks.delete(task);
    }
    for (const task of tasks) {
      if (!task.render) continue;
      try { task.render(now); } catch (err) { this.onError(err, 'scheduler task render'); }
    }

    this._flush(this._write, 'write');
    this._flush(this._after, 'after');

    for (const fn of this._frameListeners) {
      try { fn(now, dt, interval); } catch (err) { this.onError(err, 'frame listener'); }
    }

    // Algo agendado durante este frame já pode ter pedido o próximo: nunca duplicar.
    if (!this.paused && this._hasWork()) {
      if (this._frameId == null) this._frameId = this.clock.raf(this._tick);
    } else {
      this._last = null;
    }
  }

  _flush(queue, phase) {
    if (!queue.length) return;
    const jobs = queue.splice(0, queue.length);
    for (const fn of jobs) {
      try { fn(); } catch (err) { this.onError(err, `scheduler ${phase}`); }
    }
  }

  destroy() {
    this.pause('destroyed');
    this._tasks.clear();
    this._read.length = this._write.length = this._after.length = 0;
    this._frameListeners.clear();
    if (this._doc) this._doc.removeEventListener('visibilitychange', this._onVisibility);
  }
}
