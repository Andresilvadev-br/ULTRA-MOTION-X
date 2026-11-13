import { Emitter } from '../core/emitter.js';
import { createTrack, sampleTrack } from './track.js';

/**
 * MotionValue — número animado por mola, independente do DOM.
 * Usado para contadores, cores de tema, dimensões da cápsula, gestos etc.
 * set() durante uma animação preserva posição e velocidade (sem saltos).
 */
export class MotionValue extends Emitter {
  constructor(initial = 0, { scheduler, budget = null, spring = 'responsive', rest = 0.01 } = {}) {
    super();
    this.scheduler = scheduler;
    this.budget = budget;
    this.spring = spring;
    this.rest = rest;
    this._value = initial;
    this._velocity = 0;
    this._track = null;
    this._waiters = [];
    this._scheduled = false;
    this._task = { update: (dt, now) => this._update(now) };
  }

  get() { return this._track ? sampleTrack(this._track, this.scheduler.now()).value : this._value; }
  getVelocity() { return this._track ? sampleTrack(this._track, this.scheduler.now()).velocity : 0; }
  get target() { return this._track ? this._track.to : this._value; }
  get animating() { return !!this._track; }

  /** Anima até target. Resolve true ao repousar, false se for substituída. */
  set(target, { spring, velocity, from } = {}) {
    const now = this.scheduler.now();
    const current = from ?? this.get();
    const v = velocity ?? (from != null ? 0 : this.getVelocity());
    const springSpec = this.budget ? this.budget.adjustSpring(spring ?? this.spring) : (spring ?? this.spring);
    this._settleWaiters(false);
    this._track = createTrack({ from: current, to: target, velocity: v, spring: springSpec, rest: this.rest, now });
    if (this._track.duration === 0) return this.jump(target), Promise.resolve(true);
    if (!this._scheduled) { this._scheduled = true; this.scheduler.add(this._task); }
    return new Promise((resolve) => this._waiters.push(resolve));
  }

  /** Salta para o valor (sem animação). */
  jump(value) {
    this._settleWaiters(false);
    this._track = null;
    this._value = value;
    this.emit('change', value);
  }

  stop() {
    if (!this._track) return;
    this._value = this.get();
    this._track = null;
    this._settleWaiters(false);
  }

  _update(now) {
    if (!this._track) { this._scheduled = false; return false; }
    const s = sampleTrack(this._track, now);
    this.emit('change', s.value);
    if (s.done) {
      this._value = this._track.to;
      this._track = null;
      this._scheduled = false;
      this._settleWaiters(true);
      return false;
    }
    return true;
  }

  _settleWaiters(ok) {
    const list = this._waiters.splice(0, this._waiters.length);
    for (const resolve of list) resolve(ok);
  }

  destroy() {
    this.stop();
    this.scheduler.remove(this._task);
    this._scheduled = false;
    this.removeAllListeners();
  }
}
