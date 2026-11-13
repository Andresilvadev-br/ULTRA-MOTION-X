import { reportError } from '../core/env.js';

/**
 * SvgCharacterRenderer — dá vida a um personagem SVG/HTML existente sem trocar a arte.
 *
 * Contrato de partes (atributo data-part, configurável):
 *   root      → elemento que recebe gestos de corpo inteiro (pulo, giro...)
 *   breath    → grupo que "respira" (laço leve no compositor)
 *   eye       → olhos (piscadas; podem ser vários)
 *   pupil     → pupilas (seguem o cursor no perfil Ultra)
 *   + quaisquer outras partes usadas pelos gestos (ear, tail, shell...)
 *
 * Laços ociosos rodam só se o personagem estiver visível, o app em primeiro
 * plano, sem jogo ativo e o perfil permitir. Nada de loop invisível.
 */
export class SvgCharacterRenderer {
  constructor({ root, animator, scheduler, budget = null, gestures = {}, partAttr = 'data-part', eyeOpen = {} } = {}) {
    if (!root) throw new Error('SvgCharacterRenderer: root obrigatório');
    this.root = root;
    this.animator = animator;
    this.scheduler = scheduler;
    this.budget = budget;
    this.gestures = gestures;
    this.partAttr = partAttr;
    this.eyeOpen = eyeOpen;
    this.state = null;
    this._parts = new Map();
    this._token = 0;
    this._visible = true;
    this._breath = null;
    this._blinkTimer = null;
    this._gazeOff = null;
    this._collectParts();

    this._offProfile = budget?.on('profile', () => this._updateIdle());
    this._offGame = budget?.on('game', () => this._updateIdle());
    if (typeof IntersectionObserver === 'function') {
      this._io = new IntersectionObserver((entries) => {
        this._visible = entries[entries.length - 1].isIntersecting;
        this._updateIdle();
      });
      this._io.observe(root);
    }
    if (typeof document !== 'undefined') {
      this._onVis = () => this._updateIdle();
      document.addEventListener('visibilitychange', this._onVis);
    }
    this._updateIdle();
  }

  _collectParts() {
    this._parts.clear();
    for (const el of this.root.querySelectorAll(`[${this.partAttr}]`)) {
      const name = el.getAttribute(this.partAttr);
      if (!this._parts.has(name)) this._parts.set(name, []);
      this._parts.get(name).push(el);
    }
    if (!this._parts.has('root')) this._parts.set('root', [this.root]);
  }

  part(name) { return this._parts.get(name) ?? []; }

  get idleMode() {
    if (!this.budget) return 'full';
    if (this.budget.gameActive) return 'static';
    return this.budget.profile.characterIdle;
  }

  show(state, prev) {
    this.state = state;
    this.root.setAttribute('data-character-state', state);
    const token = ++this._token;
    const api = this._api(token);
    this._setEyes(this.eyeOpen[state] ?? 1);
    const gesture = this.gestures[state];
    if (gesture) {
      Promise.resolve()
        .then(() => gesture(api, { state, prev }))
        .catch((err) => reportError(err, `gesture ${state}`));
    } else {
      // Sem gesto: volta suavemente à pose neutra.
      for (const el of this.part('root')) api.animate(el, { x: 0, y: 0, rotate: 0, scale: 1 }, { spring: 'gentle' });
    }
  }

  _api(token) {
    const renderer = this;
    return {
      get alive() { return renderer._token === token; },
      part: (name) => this.part(name),
      animate: (target, props, opts = {}) => {
        const els = typeof target === 'string' ? this.part(target) : [target];
        const handles = els.map((el) => this.animator.animate(el, props, { spring: 'expressive', ...opts }));
        return Promise.all(handles.map((h) => h.finished)).then((r) => r.every(Boolean));
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms * (this.budget?.profile.decor ? 1 : 0.4))),
      decor: () => !this.budget || this.budget.allowDecor(),
    };
  }

  _setEyes(level) {
    for (const el of this.part('eye')) this.animator.animate(el, { scaleY: level }, { spring: 'responsive' });
  }

  _updateIdle() {
    const active = this._visible && !(typeof document !== 'undefined' && document.hidden);
    const mode = active ? this.idleMode : 'static';
    this._setBreathing(mode !== 'static');
    this._setBlinking(mode !== 'static');
    this._setGaze(mode === 'full');
  }

  _setBreathing(on) {
    const el = this.part('breath')[0];
    if (!el || typeof el.animate !== 'function') return;
    if (on && !this._breath) {
      this._breath = el.animate(
        [{ scale: '1 1' }, { scale: '1.012 1.03' }],
        { duration: 1900, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' },
      );
    } else if (!on && this._breath) {
      this._breath.cancel();
      this._breath = null;
    }
  }

  _setBlinking(on) {
    if (!on) {
      if (this._blinkTimer != null) clearTimeout(this._blinkTimer);
      this._blinkTimer = null;
      return;
    }
    if (this._blinkTimer != null || !this.part('eye').length) return;
    const loop = () => {
      this._blinkTimer = setTimeout(async () => {
        const eyes = this.part('eye');
        const open = this.eyeOpen[this.state] ?? 1;
        await Promise.all(eyes.map((el) => this.animator.animate(el, { scaleY: 0.08 }, { spring: { response: 0.09, damping: 1 } }).finished));
        for (const el of eyes) this.animator.animate(el, { scaleY: open }, { spring: { response: 0.16, damping: 0.9 } });
        if (this._blinkTimer != null) loop();
      }, 2600 + Math.random() * 3800);
    };
    loop();
  }

  _setGaze(on) {
    if (on && !this._gazeOff && typeof window !== 'undefined') {
      let pending = null;
      const onMove = (e) => {
        if (pending) { pending.x = e.clientX; pending.y = e.clientY; return; }
        pending = { x: e.clientX, y: e.clientY };
        this.scheduler.read(() => {
          const p = pending; pending = null;
          const rect = this.root.getBoundingClientRect();
          const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
          const dx = p.x - cx, dy = p.y - cy;
          const dist = Math.hypot(dx, dy) || 1;
          const reach = Math.min(1, dist / 400) * 2.4;
          for (const el of this.part('pupil')) {
            this.animator.animate(el, { x: (dx / dist) * reach, y: (dy / dist) * reach }, { spring: 'responsive', driver: 'frame' });
          }
        });
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      this._gazeOff = () => window.removeEventListener('pointermove', onMove);
    } else if (!on && this._gazeOff) {
      this._gazeOff();
      this._gazeOff = null;
      for (const el of this.part('pupil')) this.animator.animate(el, { x: 0, y: 0 }, { spring: 'gentle' });
    }
  }

  destroy() {
    this._token++;
    this._setBreathing(false);
    this._setBlinking(false);
    this._setGaze(false);
    this._io?.disconnect();
    this._offProfile?.();
    this._offGame?.();
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
    for (const els of this._parts.values()) for (const el of els) this.animator.release(el);
  }
}

/** Gestos genéricos reutilizáveis (compostos pela configuração de cada personagem). */
export const gestures = {
  async hop(api, { part = 'root', height = 10, squash = true } = {}) {
    if (squash) await api.animate(part, { scaleY: 0.92, scaleX: 1.05 }, { spring: 'snappy' });
    if (!api.alive) return;
    await api.animate(part, { y: -height, scaleY: 1.04, scaleX: 0.97 }, { spring: { response: 0.22, damping: 0.9 } });
    if (!api.alive) return;
    await api.animate(part, { y: 0, scaleY: 1, scaleX: 1 }, { spring: 'expressive' });
  },
  async tilt(api, { part = 'root', deg = -8 } = {}) {
    await api.animate(part, { rotate: deg }, { spring: 'gentle' });
  },
  async roll(api, { part = 'root', scale = 0.9 } = {}) {
    await api.animate(part, { scale, rotate: 0 }, { spring: 'responsive' });
  },
  async shake(api, { part = 'root', velocity = 380 } = {}) {
    await api.animate(part, { x: 0 }, { spring: 'wobble', velocity: { x: velocity } });
  },
  async settle(api, { part = 'root' } = {}) {
    await api.animate(part, { x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1 }, { spring: 'gentle' });
  },
};
