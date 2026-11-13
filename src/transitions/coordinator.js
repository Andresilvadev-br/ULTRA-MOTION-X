import { Emitter } from '../core/emitter.js';
import { flip, measure } from './flip.js';

/**
 * TransitionCoordinator + registro de elementos compartilhados.
 *
 * navigate() troca de tela imediatamente (o conteúdo nunca espera a animação)
 * e, em seguida, faz o morphing dos elementos marcados com o mesmo
 * data-umx-shared="chave" nas duas telas. Navegar de novo no meio da
 * transição parte do estado visual atual — sem saltos, sem fila de cliques.
 */
export class TransitionCoordinator extends Emitter {
  constructor({ animator, budget = null, scheduler, sharedAttr = 'data-umx-shared', enterAttr = 'data-umx-enter' } = {}) {
    super();
    this.animator = animator;
    this.budget = budget;
    this.scheduler = scheduler;
    this.sharedAttr = sharedAttr;
    this.enterAttr = enterAttr;
    this._token = 0;
    this._registry = new Map();
    this._prewarm = null;
  }

  /** Registro manual (além do atributo data-umx-shared). */
  register(key, el) {
    if (!this._registry.has(key)) this._registry.set(key, new Set());
    this._registry.get(key).add(el);
    return () => this._registry.get(key)?.delete(el);
  }

  sharedIn(container) {
    const out = new Map();
    if (!container) return out;
    for (const el of container.querySelectorAll(`[${this.sharedAttr}]`)) {
      out.set(el.getAttribute(this.sharedAttr), el);
    }
    for (const [key, set] of this._registry) {
      for (const el of set) if (el.isConnected && container.contains(el)) out.set(key, el);
    }
    return out;
  }

  /** Captura antecipada dos retângulos (usada pela previsão de intenção). */
  prewarm(container) {
    const rects = new Map();
    for (const [key, el] of this.sharedIn(container)) rects.set(key, measure(el));
    this._prewarm = { container, rects, at: this.scheduler.now() };
  }

  /**
   * navigate({ from, to, swap, direction })
   *  - swap(): troca o DOM (padrão: alterna o atributo hidden). Síncrono.
   *  - Devolve { finished } — resolve true se terminou sem ser interrompida.
   */
  navigate({ from, to, swap, direction = 1 } = {}) {
    const token = ++this._token;
    const firstRects = new Map();
    for (const [key, el] of this.sharedIn(from)) {
      const rect = measure(el);
      if (rect.width && rect.height) firstRects.set(key, rect);
    }
    // Retângulos capturados antes do clique (previsão de intenção) cobrem
    // telas que o app já escondeu antes de chamar navigate().
    const pre = this._prewarm;
    if (pre && this.scheduler.now() - pre.at < 1200) {
      for (const [key, rect] of pre.rects) if (!firstRects.has(key) && rect.width) firstRects.set(key, rect);
    }
    this._prewarm = null;

    if (swap) swap();
    else {
      if (from) from.hidden = true;
      if (to) to.hidden = false;
    }

    const handles = [];
    const morphed = new Set();
    for (const [key, el] of this.sharedIn(to)) {
      const first = firstRects.get(key);
      if (!first) continue;
      morphed.add(el);
      handles.push(flip(this.animator, el, first, { spring: 'page' }));
    }

    // Conteúdo não compartilhado entra de forma leve e não bloqueante.
    const stagger = this.budget?.profile.stagger ?? 24;
    const items = to ? [...to.querySelectorAll(`[${this.enterAttr}]`)].filter((el) => !morphed.has(el)) : [];
    const targets = items.length ? items : (to && !morphed.has(to) ? [to] : []);
    const offset = (this.budget?.allowDecor() ?? true) ? 14 * direction : 0;
    targets.slice(0, 24).forEach((el, i) => {
      handles.push(this.animator.animate(el, { opacity: 1, y: 0 }, {
        spring: 'page', from: { opacity: 0, y: offset }, delay: Math.min(i, 10) * stagger,
      }));
    });

    this.emit('navigate', { from, to, shared: morphed.size });
    const finished = Promise.all(handles.map((h) => h.finished)).then((all) => token === this._token && all.every(Boolean));
    return { finished, shared: morphed.size };
  }

  /** Morphing pontual entre dois elementos (ex.: botão → painel). */
  morph(fromEl, toEl, opts = {}) {
    const first = measure(fromEl);
    if (opts.swap) opts.swap();
    return flip(this.animator, toEl, first, opts);
  }
}
