import { clamp } from '../core/env.js';
import { MotionValue } from '../animate/motion-value.js';

/** Alvos de luz e inclinação para o ponto (px,py) sobre o retângulo. */
export function surfaceTargets(rect, px, py, tilt = 4) {
  const u = clamp((px - rect.left) / (rect.width || 1), 0, 1);
  const v = clamp((py - rect.top) / (rect.height || 1), 0, 1);
  return { lx: u * rect.width, ly: v * rect.height, rx: (0.5 - v) * tilt, ry: (u - 0.5) * tilt * 1.4, lo: 1 };
}

const KEYS = ['lx', 'ly', 'rx', 'ry', 'lo'];

/**
 * SurfaceMaterial — material reativo: luz especular e inclinação 2.5D que
 * seguem o cursor com mola (não "grudam" no mouse). Escreve variáveis CSS
 * (--umx-lx/--umx-ly em px, --umx-rx/--umx-ry em graus, --umx-lo 0..1)
 * só no elemento ativo e nos que estão relaxando; em repouso nada roda.
 */
export class SurfaceMaterial {
  constructor({ scheduler, budget = null, selector = '[data-umx-surface]', tilt = 4, spring = 'gentle', maxTiltSize = 560 } = {}) {
    // superfícies grandes só recebem luz: inclinar blocos enormes borra o texto e não acrescenta nada
    Object.assign(this, { scheduler, budget, selector, tilt, spring, maxTiltSize });
    this.current = null;
    this._states = new WeakMap();
    this._pending = null;
  }

  get enabled() { return !this.budget || (this.budget.profile.cursorLight && !this.budget.gameActive); }

  _state(el) {
    let st = this._states.get(el);
    if (st) return st;
    const r = el.getBoundingClientRect();
    st = { values: {}, dirty: false, tilt: r.width <= this.maxTiltSize && r.height <= this.maxTiltSize };
    const init = { lx: r.width / 2, ly: r.height / 2, rx: 0, ry: 0, lo: 0 };
    for (const k of KEYS) {
      const mv = new MotionValue(init[k], { scheduler: this.scheduler, spring: this.spring, rest: k === 'lo' ? 0.002 : 0.05 });
      mv.on('change', () => this._mark(el, st));
      st.values[k] = mv;
    }
    this._states.set(el, st);
    return st;
  }

  _mark(el, st) {
    if (st.dirty) return;
    st.dirty = true;
    this.scheduler.write(() => {
      st.dirty = false;
      const v = st.values, s = el.style;
      s.setProperty('--umx-lx', `${v.lx.get().toFixed(1)}px`);
      s.setProperty('--umx-ly', `${v.ly.get().toFixed(1)}px`);
      if (st.tilt) {
        s.setProperty('--umx-rx', `${v.rx.get().toFixed(3)}deg`);
        s.setProperty('--umx-ry', `${v.ry.get().toFixed(3)}deg`);
      }
      s.setProperty('--umx-lo', v.lo.get().toFixed(3));
    });
  }

  bind(root = document) {
    const onMove = (e) => {
      const first = !this._pending;
      this._pending = { x: e.clientX, y: e.clientY, target: e.target };
      if (first) this.scheduler.read(() => this._frame());
    };
    const onLeave = () => this._relax();
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave, { passive: true });
    return () => { root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerleave', onLeave); this._relax(); };
  }

  _frame() {
    const p = this._pending;
    this._pending = null;
    if (!p) return;
    const el = this.enabled ? p.target?.closest?.(this.selector) ?? null : null;
    if (el !== this.current) this._relax();
    if (!el) return;
    this.current = el;
    const t = surfaceTargets(el.getBoundingClientRect(), p.x, p.y, Number(el.dataset?.umxTilt ?? this.tilt));
    const st = this._state(el);
    for (const k of KEYS) st.values[k].set(t[k]);
  }

  _relax() {
    const el = this.current;
    this.current = null;
    if (!el) return;
    const st = this._states.get(el);
    if (!st) return;
    st.values.rx.set(0); st.values.ry.set(0); st.values.lo.set(0);
  }
}
