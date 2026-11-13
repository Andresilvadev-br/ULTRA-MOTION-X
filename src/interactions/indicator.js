import { MotionValue } from '../animate/motion-value.js';

/**
 * LiquidIndicator — indicador de seleção (menu, abas, segmentos) que viaja
 * com mola e "estica" na direção do movimento proporcionalmente à velocidade,
 * como uma gota. Interromper no meio continua do ponto e da velocidade atuais.
 */
export class LiquidIndicator {
  constructor(el, { scheduler, budget = null, axis = 'y', spring = 'responsive', stretch = 0.035, maxStretch = 22, cross } = {}) {
    Object.assign(this, { el, scheduler, budget, axis, stretch, maxStretch });
    this.pos = new MotionValue(0, { scheduler, budget, spring, rest: 0.05 });
    this.size = new MotionValue(0, { scheduler, budget, spring, rest: 0.05 });
    this.cross = cross;
    this._dirty = false;
    const mark = () => {
      if (this._dirty) return;
      this._dirty = true;
      scheduler.write(() => { this._dirty = false; this._write(); });
    };
    this.pos.on('change', mark);
    this.size.on('change', mark);
    this.placed = false;
  }

  /** Tamanho exibido: base + esticamento pela velocidade (liquidez). */
  displayed() {
    const v = Math.abs(this.pos.getVelocity());
    const extra = this.budget && !this.budget.allowDecor() ? 0 : Math.min(v * this.stretch, this.maxStretch);
    return { pos: this.pos.get() - (this.pos.getVelocity() < 0 ? extra : 0), size: this.size.get() + extra };
  }

  _write() {
    const d = this.displayed();
    const s = this.el.style;
    if (this.axis === 'y') { s.transform = `translate3d(0,${d.pos.toFixed(2)}px,0)`; s.height = `${d.size.toFixed(2)}px`; }
    else { s.transform = `translate3d(${d.pos.toFixed(2)}px,0,0)`; s.width = `${d.size.toFixed(2)}px`; }
  }

  moveTo(pos, size, { instant = false } = {}) {
    if (instant || !this.placed) {
      this.placed = true;
      this.pos.jump(pos);
      this.size.jump(size);
      this._write();
      return Promise.resolve(true);
    }
    return Promise.all([this.pos.set(pos), this.size.set(size)]).then((r) => r.every(Boolean));
  }

  destroy() { this.pos.destroy(); this.size.destroy(); }
}
