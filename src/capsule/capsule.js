import { MotionValue } from '../animate/motion-value.js';

/**
 * CapsuleMorph — "objeto físico único" para a Dynamic Island (Plano 5.0 §6.17.3).
 *
 * Largura, altura e arredondamento são molas independentes que preservam a
 * velocidade: expandir/recolher repetidamente nunca salta. A silhueta nunca
 * some entre atividades; o conteúdo troca por crossfade curto. O modo split
 * separa uma "bolha" lateral para a segunda atividade.
 *
 * Estrutura esperada:
 *   <div class="island">                       ← el (forma)
 *     <div data-umx-capsule-content>...</div>  ← conteúdo atual
 *   </div>
 *   <div data-umx-capsule-bubble>...</div>     ← opcional (split)
 */
export class CapsuleMorph {
  constructor(el, { animator, scheduler, budget = null, spring = 'capsule', bubble = null, width, height, radius } = {}) {
    this.el = el;
    this.animator = animator;
    this.scheduler = scheduler;
    this.budget = budget;
    this.spring = spring;
    this.bubble = bubble;
    const opts = { scheduler, budget, spring, rest: 0.1 };
    const w = width ?? (el.offsetWidth || 120);
    const h = height ?? (el.offsetHeight || 36);
    this.width = new MotionValue(w, opts);
    this.height = new MotionValue(h, opts);
    this.radius = new MotionValue(radius ?? h / 2, opts);
    this._dirty = false;
    const mark = () => {
      if (this._dirty) return;
      this._dirty = true;
      scheduler.write(() => { this._dirty = false; this._write(); });
    };
    this.width.on('change', mark);
    this.height.on('change', mark);
    this.radius.on('change', mark);
    this._write();
    this._pulse = null;
    this.split = false;
  }

  _write() {
    const s = this.el.style;
    s.width = `${this.width.get().toFixed(2)}px`;
    s.height = `${this.height.get().toFixed(2)}px`;
    s.borderRadius = `${this.radius.get().toFixed(2)}px`;
  }

  /** Morph para uma nova forma; resolve true quando assenta. */
  morphTo({ width, height, radius } = {}) {
    const jobs = [];
    if (width != null) jobs.push(this.width.set(width));
    if (height != null) jobs.push(this.height.set(height));
    const r = radius ?? (height != null ? Math.min(height / 2, 28) : null);
    if (r != null) jobs.push(this.radius.set(r));
    this.el.dataset.umxCapsule = width > 200 || height > 48 ? 'expanded' : 'compact';
    return Promise.all(jobs).then((all) => all.every(Boolean));
  }

  /** Troca o conteúdo com crossfade curto, mantendo a silhueta. */
  async swap(next) {
    const current = this.el.querySelector('[data-umx-capsule-content]:not([data-umx-leaving])');
    if (current === next) return true;
    if (next && !next.isConnected) this.el.appendChild(next);
    next?.setAttribute('data-umx-capsule-content', '');
    if (current) {
      current.setAttribute('data-umx-leaving', '');
      current.style.position = 'absolute';
      this.animator.animate(current, { opacity: 0, scale: 0.96 }, { spring: 'critical' }).finished.then(() => {
        if (current.hasAttribute('data-umx-leaving')) current.remove();
      });
    }
    if (!next) return true;
    return this.animator.animate(next, { opacity: 1, scale: 1 }, { spring: 'capsule', from: { opacity: 0, scale: 0.94 } }).finished;
  }

  /** Separa/reagrupa a bolha lateral preservando direção e velocidade. */
  setSplit(on, { gap = 10 } = {}) {
    this.split = !!on;
    if (!this.bubble) return Promise.resolve(false);
    if (!on && this.bubble.hidden) return Promise.resolve(true);
    const wasHidden = this.bubble.hidden;
    this.bubble.hidden = false;
    const collapsed = { x: -this.bubble.offsetWidth * 0.6, opacity: 0, scale: 0.6 };
    // Nasce "de dentro" da cápsula, nunca aparece pronta.
    if (on && wasHidden) this.animator.set(this.bubble, collapsed);
    const props = on ? { x: gap, opacity: 1, scale: 1 } : collapsed;
    const h = this.animator.animate(this.bubble, props, { spring: 'capsule' });
    if (!on) h.finished.then((ok) => { if (ok && !this.split) this.bubble.hidden = true; });
    return h.finished;
  }

  /**
   * Pulso discreto de gravação (taxa limitada, só no compositor).
   * Pare com setRecording(false); pausado automaticamente com a janela oculta.
   */
  setRecording(on, indicator) {
    if (on && !this._pulse && indicator?.animate) {
      const decor = this.budget ? this.budget.decorScale : 1;
      this._pulse = indicator.animate(
        [{ opacity: 1 }, { opacity: decor > 0 ? 0.45 : 1 }],
        { duration: 1100, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' },
      );
    } else if (!on && this._pulse) {
      this._pulse.cancel();
      this._pulse = null;
    }
  }

  destroy() {
    this.setRecording(false);
    this.width.destroy();
    this.height.destroy();
    this.radius.destroy();
  }
}
