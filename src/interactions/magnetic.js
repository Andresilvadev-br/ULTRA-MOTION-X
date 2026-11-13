import { clamp } from '../core/env.js';

/** Deslocamento magnético (px) de um elemento em direção ao cursor, com limite. */
export function magnetOffset(rect, px, py, strength = 0.18, max = 6) {
  const dx = px - (rect.left + rect.width / 2);
  const dy = py - (rect.top + rect.height / 2);
  return { x: clamp(dx * strength, -max, max), y: clamp(dy * strength, -max, max) };
}

/**
 * MagneticField — atração sutil ao cursor com resistência e inércia.
 * Um único listener delegado; uma leitura de layout por quadro, só do elemento
 * sob o cursor. Ao sair, o elemento volta com a velocidade que tinha.
 * data-umx-magnet="0.3" ajusta a força por elemento; "0" desliga.
 */
export class MagneticField {
  constructor({ animator, scheduler, budget = null, selector = '[data-umx-magnet]', strength = 0.18, max = 6, spring = 'responsive' } = {}) {
    Object.assign(this, { animator, scheduler, budget, selector, strength, max, spring });
    this.current = null;
    this._pending = null;
  }

  get enabled() { return !this.budget || (this.budget.profile.cursorLight && !this.budget.gameActive); }

  bind(root = document) {
    const onMove = (e) => {
      const first = !this._pending;
      this._pending = { x: e.clientX, y: e.clientY, target: e.target };
      if (first) this.scheduler.read(() => this._frame());
    };
    const onLeave = () => this._release();
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave, { passive: true });
    root.addEventListener('pointerdown', onLeave, { passive: true, capture: true });
    return () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('pointerdown', onLeave, { capture: true });
      this._release();
    };
  }

  _frame() {
    const p = this._pending;
    this._pending = null;
    if (!p) return;
    const el = this.enabled ? p.target?.closest?.(this.selector) ?? null : null;
    if (el !== this.current) this._release();
    if (!el) return;
    const k = el.dataset?.umxMagnet != null ? Number(el.dataset.umxMagnet) : this.strength;
    if (!(k > 0)) return;
    this.current = el;
    const off = magnetOffset(el.getBoundingClientRect(), p.x, p.y, k, this.max);
    // O retângulo medido inclui o deslocamento atual: compensa para não "fugir" do cursor.
    const cx = this.animator.value(el, 'x'), cy = this.animator.value(el, 'y');
    const fix = magnetOffset({ left: -cx, top: -cy, width: 0, height: 0 }, 0, 0, k, Infinity);
    this.animator.animate(el, { x: clamp(off.x + fix.x, -this.max, this.max), y: clamp(off.y + fix.y, -this.max, this.max) }, { spring: this.spring, driver: 'frame' });
  }

  _release() {
    const el = this.current;
    this.current = null;
    if (el) this.animator.animate(el, { x: 0, y: 0 }, { spring: 'gentle', driver: 'frame' });
  }
}
