import { hasDocument } from '../core/env.js';

/**
 * EffectsLayer — camada de efeitos especiais acelerada (canvas 2D, rasterizado
 * pela GPU no Chromium/WebView2). Criada sob demanda e DESTRUÍDA quando o
 * último efeito termina (sem canvas, contexto ou listener residente).
 *
 * Densidade escala com o perfil e com a adaptação de orçamento; no perfil
 * Performance ou com jogo ativo nada é desenhado.
 *
 * Um renderizador alternativo (ex.: PixiJS empacotado pelo app) pode ser
 * injetado com `renderer` desde que implemente { mount(canvasParent), draw(particles, ctx), unmount() }.
 */
export class EffectsLayer {
  constructor({ scheduler, budget = null, container = hasDocument ? document.body : null, maxDpr = 2, idleTeardown = 1500 } = {}) {
    this.scheduler = scheduler;
    this.budget = budget;
    this.container = container;
    this.maxDpr = maxDpr;
    this.idleTeardown = idleTeardown;
    this._particles = [];
    this._effects = new Set();
    this._canvas = null;
    this._ctx = null;
    this._teardownTimer = null;
    this._task = { update: (dt) => this._update(dt), render: () => this._draw() };
    this._running = false;
  }

  get active() { return this._effects.size > 0; }

  _accent() {
    if (!hasDocument) return '#2f8cff';
    return getComputedStyle(document.documentElement).getPropertyValue('--umx-accent').trim() || '#2f8cff';
  }

  _count(base) {
    const scale = this.budget ? this.budget.particleScale : 1;
    return Math.round(base * scale);
  }

  _mount() {
    if (this._teardownTimer != null) { clearTimeout(this._teardownTimer); this._teardownTimer = null; }
    if (this._canvas || !this.container) return !!this._canvas;
    const canvas = document.createElement('canvas');
    canvas.className = 'umx-effects';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '2147483000' });
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    this._canvas = canvas;
    this._ctx = ctx;
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this.container.appendChild(canvas);
    return true;
  }

  _resize() {
    const balanced = this.budget?.profileId === 'balanced';
    const dpr = Math.min(window.devicePixelRatio || 1, balanced ? 1.25 : this.maxDpr);
    this._dpr = dpr;
    this._canvas.width = Math.round(window.innerWidth * dpr);
    this._canvas.height = Math.round(window.innerHeight * dpr);
  }

  _unmount() {
    if (!this._canvas) return;
    window.removeEventListener('resize', this._onResize);
    this._canvas.width = this._canvas.height = 0; // libera a memória da textura
    this._canvas.remove();
    this._canvas = null;
    this._ctx = null;
  }

  _start(particles, opts = {}) {
    const token = this.budget ? this.budget.requestDecor(1) : { release() {} };
    if (!token || !particles.length || !this._mount()) {
      token?.release();
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const effect = { particles: new Set(particles), resolve, token, composite: opts.composite ?? 'lighter' };
      for (const p of particles) { p.effect = effect; this._particles.push(p); }
      this._effects.add(effect);
      if (!this._running) { this._running = true; this.scheduler.add(this._task); }
    });
  }

  /** Explosão de partículas a partir de um ponto (ex.: conclusão confirmada). */
  burst({ x, y, count = 26, color = this._accent(), speed = 260, life = 0.9, size = 2.4 } = {}) {
    const n = this._count(count);
    const particles = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      particles.push({ kind: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 3.2, gravity: 140, life: life * (0.6 + Math.random() * 0.4), age: 0, size: size * (0.6 + Math.random() * 0.8), color });
    }
    return this._start(particles);
  }

  /** Rastros de luz que convergem para um ponto (abertura do Chico). */
  converge({ x, y, count = 14, color = this._accent(), radius = 340, duration = 0.75 } = {}) {
    const n = this._count(count);
    const particles = [];
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.4;
      const r = radius * (0.7 + Math.random() * 0.5);
      particles.push({ kind: 'trail', sx: x + Math.cos(a) * r, sy: y + Math.sin(a) * r, tx: x, ty: y, life: duration * (0.8 + Math.random() * 0.3), age: 0, color, width: 1.6 + Math.random() * 1.6 });
    }
    return this._start(particles);
  }

  /** Onda de energia (anel que expande e some). */
  wave({ x, y, color = this._accent(), radius = 160, life = 0.65, width = 3 } = {}) {
    if (this._count(1) < 1 && (this.budget?.particleScale ?? 1) <= 0.05) return Promise.resolve(false);
    return this._start([{ kind: 'ring', x, y, radius, life, age: 0, color, width }]);
  }

  _update(dt) {
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.age += dt;
      if (p.kind === 'dot') {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy = p.vy * k + p.gravity * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      if (p.age >= p.life) {
        this._particles.splice(i, 1);
        const effect = p.effect;
        effect.particles.delete(p);
        if (effect.particles.size === 0) {
          this._effects.delete(effect);
          effect.token.release();
          effect.resolve(true);
        }
      }
    }
    if (this._particles.length === 0) {
      this._running = false;
      this._clear();
      this._scheduleTeardown();
      return false;
    }
    return true;
  }

  _clear() {
    if (this._ctx) this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
  }

  _draw() {
    const ctx = this._ctx;
    if (!ctx || !this._particles.length) return;
    const dpr = this._dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this._particles) {
      const t = Math.min(1, p.age / p.life);
      ctx.globalAlpha = 1 - t;
      if (p.kind === 'dot') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'trail') {
        const e = 1 - (1 - t) ** 3;
        const hx = p.sx + (p.tx - p.sx) * e, hy = p.sy + (p.ty - p.sy) * e;
        const tail = Math.max(0, e - 0.22);
        const qx = p.sx + (p.tx - p.sx) * tail, qy = p.sy + (p.ty - p.sy) * tail;
        ctx.globalAlpha = t < 0.85 ? 0.9 : (1 - t) / 0.15 * 0.9;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(qx, qy);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      } else if (p.kind === 'ring') {
        const e = 1 - (1 - t) ** 2;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width * (1 - t);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * e, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  _scheduleTeardown() {
    if (this._teardownTimer != null) clearTimeout(this._teardownTimer);
    this._teardownTimer = setTimeout(() => {
      this._teardownTimer = null;
      if (!this._particles.length) this._unmount();
    }, this.idleTeardown);
  }

  /** Cancela tudo imediatamente (ex.: usuário pulou a abertura). */
  clear() {
    for (const effect of this._effects) { effect.token.release(); effect.resolve(false); }
    this._effects.clear();
    this._particles.length = 0;
    this.scheduler.remove(this._task);
    this._running = false;
    this._clear();
    this._unmount();
  }

  destroy() { this.clear(); if (this._teardownTimer != null) clearTimeout(this._teardownTimer); }
}
