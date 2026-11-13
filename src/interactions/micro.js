import { SampleStats } from '../core/frame-stats.js';
import { MotionValue } from '../animate/motion-value.js';

/**
 * Hyper Microinteractions (Plano 5.0 §6.4 / §6.12.1) por delegação de eventos:
 * um único conjunto de listeners na raiz → sem vazamento por elemento.
 *
 *   data-umx-press[="0.95"]  botões/ícones: compressão no 1º frame + retorno de mola
 *   data-umx-hover            cartões: realce leve sob o cursor
 *   data-umx-light            luz que segue o cursor (só Ultra/Balanced)
 *   data-umx-toggle           alternância; o polegar ([data-umx-thumb]) segue
 *                             aria-checked — o ESTADO REAL definido pelo app.
 *                             aria-busy="true" = aguardando confirmação.
 *   data-umx-error            quando presente, sacode o elemento (erro distinto)
 *
 * O feedback é só de interação: nunca espera o backend e nunca afirma sucesso.
 */
export class MicroInteractions {
  constructor({ animator, scheduler, budget = null, selectors = {}, pressScale = 0.96 } = {}) {
    this.animator = animator;
    this.scheduler = scheduler;
    this.budget = budget;
    this.pressScale = pressScale;
    /** Seletores configuráveis: apps existentes podem usar suas próprias classes (ex.: ".btn"). */
    this.sel = {
      press: selectors.press ?? '[data-umx-press]',
      hover: selectors.hover ?? '[data-umx-hover]',
      light: selectors.light ?? '[data-umx-light]',
    };
    /** Latência entrada → primeiro frame com feedback (ms), para QA interno. */
    this.latency = new SampleStats(200);
    this._roots = new Map();
    this._pressed = new Set();
    this._numbers = new WeakMap();
  }

  bind(root = document) {
    if (this._roots.has(root)) return this._roots.get(root).off;
    const listeners = [];
    const on = (type, fn, opts) => { root.addEventListener(type, fn, opts); listeners.push([type, fn, opts]); };

    on('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const el = e.target.closest?.(this.sel.press);
      if (el && !el.matches(':disabled,[aria-disabled="true"]')) this.press(el, e.timeStamp);
    }, { passive: true });
    const release = () => { for (const el of [...this._pressed]) this.release(el); };
    on('pointerup', release, { passive: true });
    on('pointercancel', release, { passive: true });
    on('dragstart', release, { passive: true });
    on('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        const el = e.target.closest?.(this.sel.press);
        if (el && !el.matches(':disabled,[aria-disabled="true"]')) this.press(el, e.timeStamp);
      }
    });
    on('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') release(); });

    on('pointerover', (e) => {
      const el = e.target.closest?.(this.sel.hover);
      if (el && !el.contains(e.relatedTarget)) this.hover(el, true);
    }, { passive: true });
    on('pointerout', (e) => {
      const el = e.target.closest?.(this.sel.hover);
      if (el && !el.contains(e.relatedTarget)) this.hover(el, false);
      const pressed = e.target.closest?.(this.sel.press);
      if (pressed && this._pressed.has(pressed) && !pressed.contains(e.relatedTarget)) this.release(pressed);
    }, { passive: true });

    let lightEl = null, lightPos = null;
    on('pointermove', (e) => {
      if (this.budget && !this.budget.profile.cursorLight) return;
      const el = e.target.closest?.(this.sel.light);
      if (!el) return;
      const first = !lightPos;
      lightEl = el; lightPos = { x: e.clientX, y: e.clientY };
      if (!first) return;
      this.scheduler.read(() => {
        const target = lightEl, pos = lightPos;
        lightPos = null;
        if (!target) return;
        const r = target.getBoundingClientRect();
        this.scheduler.write(() => {
          target.style.setProperty('--umx-lx', `${Math.round(pos.x - r.left)}px`);
          target.style.setProperty('--umx-ly', `${Math.round(pos.y - r.top)}px`);
          target.style.setProperty('--umx-lo', '1');
        });
      });
    }, { passive: true });
    on('pointerleave', (e) => {
      const el = e.target?.closest?.(this.sel.light);
      if (el) el.style.setProperty('--umx-lo', '0');
    }, { passive: true, capture: true });

    let observer = null;
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver((records) => {
        for (const rec of records) {
          const el = rec.target;
          if (rec.attributeName === 'data-umx-error' && el.hasAttribute('data-umx-error')) this.shake(el);
          else if (el.hasAttribute?.('data-umx-toggle')) this.syncToggle(el);
        }
      });
      observer.observe(root.documentElement ?? root, {
        subtree: true, attributes: true, attributeFilter: ['aria-checked', 'aria-busy', 'data-umx-error'],
      });
    }
    for (const el of (root.querySelectorAll?.('[data-umx-toggle]') ?? [])) this.syncToggle(el, { instant: true });

    const off = () => {
      for (const [type, fn, opts] of listeners) root.removeEventListener(type, fn, opts);
      observer?.disconnect();
      this._roots.delete(root);
    };
    this._roots.set(root, { off });
    return off;
  }

  press(el, inputTime) {
    this._pressed.add(el);
    const amount = parseFloat(el.getAttribute('data-umx-press')) || this.pressScale;
    this.animator.animate(el, { scale: amount }, { spring: 'snappy' });
    if (inputTime != null) {
      this.scheduler.after(() => this.latency.push(this.scheduler.now() - inputTime));
    }
  }

  release(el) {
    if (!this._pressed.delete(el)) return;
    this.animator.animate(el, { scale: 1 }, { spring: 'snappy' });
  }

  hover(el, on) {
    const lift = (this.budget?.decorScale ?? 1) > 0 ? -2 : 0;
    this.animator.animate(el, { y: on ? lift : 0 }, { spring: 'gentle' });
  }

  /** Sacudida curta de erro (estado visual distinto, sem drama). */
  shake(el, strength = 1) {
    return this.animator.animate(el, { x: 0 }, { spring: 'wobble', velocity: { x: 420 * strength } });
  }

  /** Move o polegar conforme o estado REAL (aria-checked) definido pelo app. */
  syncToggle(el, { instant = false } = {}) {
    const thumb = el.querySelector('[data-umx-thumb]');
    if (!thumb) return;
    const on = el.getAttribute('aria-checked') === 'true';
    const busy = el.getAttribute('aria-busy') === 'true';
    this.scheduler.read(() => {
      const travel = Math.max(0, el.clientWidth - thumb.offsetWidth - 2 * thumb.offsetLeft);
      const props = { x: on ? travel : 0, scale: busy ? 0.86 : 1 };
      if (instant) this.animator.set(thumb, props);
      else this.animator.animate(thumb, props, { spring: 'responsive' });
    });
  }

  /** Interpola números quando o dado muda (gráficos/métricas). */
  number(el, value, { format = (v) => Math.round(v).toString(), spring = 'gentle' } = {}) {
    let mv = this._numbers.get(el);
    if (!mv) {
      const initial = parseFloat(el.textContent) || 0;
      mv = new MotionValue(initial, { scheduler: this.scheduler, budget: this.budget, spring, rest: 0.01 });
      mv.on('change', (v) => { el.textContent = format(v); });
      this._numbers.set(el, mv);
    }
    if (mv.target === value) return Promise.resolve(true);
    if (this.budget && !this.budget.allowDecor()) { mv.jump(value); return Promise.resolve(true); }
    return mv.set(value);
  }

  destroy() {
    for (const { off } of [...this._roots.values()]) off();
  }
}
