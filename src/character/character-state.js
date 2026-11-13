import { Emitter } from '../core/emitter.js';
import { createTimers, reportError } from '../core/env.js';

/**
 * CharacterStateMachine — estado central do mascote (Chico Alive, Plano 5.0 §6.5).
 *
 *  • Estados "sustentados" vêm de atividades reais em andamento (begin/end):
 *    ex.: analisando, aplicando otimização, jogo ativo. Vence a maior prioridade.
 *  • Reações "transitórias" (react) duram um tempo e voltam ao estado sustentado:
 *    ex.: encontrou melhoria, concluiu, erro.
 *  • Debounce + tempo mínimo de exibição: vários eventos simultâneos não fazem
 *    o personagem trocar de expressão caoticamente. Só uma prioridade maior fura a fila.
 */
export class CharacterStateMachine extends Emitter {
  constructor({ states, initial = 'idle', debounce = 90, minHold = 450, timers, renderer = null } = {}) {
    super();
    if (!states || !states[initial]) throw new Error('CharacterStateMachine: estados/initial inválidos');
    this.states = states;
    this.initial = initial;
    this.debounce = debounce;
    this.minHold = minHold;
    this.timers = createTimers(timers);
    this.renderer = renderer;
    this._activities = new Map();
    this._transient = null;
    this._transientTimer = null;
    this._shown = initial;
    this._shownAt = -Infinity;
    this._commitTimer = null;
  }

  get state() { return this._shown; }
  get activities() { return [...this._activities.entries()].map(([id, state]) => ({ id, state })); }

  setRenderer(renderer) {
    this.renderer = renderer;
    this._render(this._shown, null);
  }

  /** Atividade real começou (sustentado até end). */
  begin(activityId, state) {
    this._check(state);
    this._activities.set(String(activityId), state);
    this._schedule();
  }

  end(activityId) {
    if (this._activities.delete(String(activityId))) this._schedule();
  }

  /** Reação breve a um resultado já confirmado. */
  react(state, { hold } = {}) {
    this._check(state);
    const def = this.states[state];
    const duration = hold ?? def.hold ?? 1200;
    if (this._transient && this._prio(this._transient.state) > def.priority && this._transient.until > this.timers.now()) {
      return false;
    }
    if (this._transientTimer != null) this.timers.clearTimeout(this._transientTimer);
    this._transient = { state, until: this.timers.now() + duration };
    this._transientTimer = this.timers.setTimeout(() => {
      this._transientTimer = null;
      this._transient = null;
      this._schedule();
    }, duration);
    this._schedule();
    return true;
  }

  clearReaction() {
    if (this._transientTimer != null) this.timers.clearTimeout(this._transientTimer);
    this._transientTimer = null;
    this._transient = null;
    this._schedule();
  }

  /** Estado desejado agora (sem debounce). */
  desired() {
    let base = this.initial;
    for (const state of this._activities.values()) if (this._prio(state) > this._prio(base)) base = state;
    if (this._transient && this._prio(this._transient.state) >= this._prio(base)) return this._transient.state;
    return base;
  }

  _prio(state) { return this.states[state]?.priority ?? 0; }

  _check(state) {
    if (!this.states[state]) throw new Error(`Estado de personagem desconhecido: ${state}`);
  }

  _schedule(delay = this.debounce) {
    if (this._commitTimer != null) this.timers.clearTimeout(this._commitTimer);
    this._commitTimer = this.timers.setTimeout(() => {
      this._commitTimer = null;
      this._commit();
    }, delay);
  }

  _commit() {
    const next = this.desired();
    if (next === this._shown) return;
    const held = this.timers.now() - this._shownAt;
    if (held < this.minHold && this._prio(next) <= this._prio(this._shown)) {
      this._schedule(this.minHold - held);
      return;
    }
    const prev = this._shown;
    this._shown = next;
    this._shownAt = this.timers.now();
    this._render(next, prev);
    this.emit('change', { state: next, prev });
  }

  _render(state, prev) {
    if (!this.renderer) return;
    try { this.renderer.show(state, prev, this.states[state]); } catch (err) { reportError(err, 'character renderer'); }
  }

  destroy() {
    if (this._commitTimer != null) this.timers.clearTimeout(this._commitTimer);
    if (this._transientTimer != null) this.timers.clearTimeout(this._transientTimer);
    this.renderer?.destroy?.();
    this.removeAllListeners();
  }
}
