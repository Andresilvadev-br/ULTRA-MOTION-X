import { Emitter } from '../core/emitter.js';
import { VelocityTracker } from '../physics/inertia.js';

/**
 * IntentPredictor — "interações inteligentes".
 * Projeta a trajetória do ponteiro ~120 ms à frente; se ela aponta para um
 * controle interativo, prepara o elemento (camada de composição, realce sutil
 * via classe umx-intent) e emite "intent" para que transições capturem
 * geometria antes do clique. Só prepara o visual: nunca executa ação.
 */
export class IntentPredictor extends Emitter {
  constructor({ scheduler, budget = null, selector = '[data-umx-press],[data-umx-intent]', lookahead = 0.12, minSpeed = 280 } = {}) {
    super();
    this.scheduler = scheduler;
    this.budget = budget;
    this.selector = selector;
    this.lookahead = lookahead;
    this.minSpeed = minSpeed;
    this.tracker = new VelocityTracker(90);
    this.current = null;
    this._clearTimer = null;
    this._pending = false;
  }

  bind(root = document) {
    const onMove = (e) => {
      if (this.budget && !this.budget.profile.intent) return;
      this.tracker.add(e.timeStamp, e.clientX, e.clientY);
      if (this._pending) return;
      this._pending = true;
      this.scheduler.read(() => {
        this._pending = false;
        this._predict(root);
      });
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      root.removeEventListener('pointermove', onMove);
      this._set(null);
    };
  }

  _predict(root) {
    const last = this.tracker.samples[this.tracker.samples.length - 1];
    if (!last) return;
    const v = this.tracker.velocity(last.t);
    const speed = Math.hypot(v.x, v.y);
    if (speed < this.minSpeed) return;
    const px = last.x + v.x * this.lookahead;
    const py = last.y + v.y * this.lookahead;
    const doc = root.ownerDocument ?? root;
    const hit = doc.elementFromPoint?.(px, py)?.closest?.(this.selector) ?? null;
    if (hit && hit !== this.current) this._set(hit);
  }

  _set(el) {
    if (this._clearTimer != null) clearTimeout(this._clearTimer);
    if (this.current && this.current !== el) this.current.classList.remove('umx-intent');
    this.current = el;
    if (!el) return;
    el.classList.add('umx-intent');
    this.emit('intent', { element: el });
    this._clearTimer = setTimeout(() => this._set(null), 450);
  }
}
