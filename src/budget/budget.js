import { Emitter } from '../core/emitter.js';
import { clamp, createLocalStorage } from '../core/env.js';
import { adjustSpringForProfile, DEFAULT_PROFILE, isProfile, PROFILE_ORDER, PROFILES } from './profiles.js';
import { FrameStats } from '../core/frame-stats.js';

/**
 * MotionBudget — perfis, custo decorativo e renderização adaptativa.
 *
 * Regras (Plano 5.0 §6.10–6.12):
 *  • A preferência salva do usuário NUNCA é trocada automaticamente.
 *  • Sem preferência salva (inclusive migração da 4.9.x) → Ultra.
 *  • Engasgos persistentes geram apenas uma *sugestão* de perfil.
 *  • A adaptação automática só reduz custo decorativo secundário
 *    (partículas/brilho) dentro do perfil escolhido — nunca o feedback.
 *  • Jogo em primeiro plano: decoração suspensa, independentemente do perfil.
 */
export class MotionBudget extends Emitter {
  constructor({ scheduler, storage, key = 'umx.profile', profile, monitor = true } = {}) {
    super();
    this.scheduler = scheduler;
    this.storage = storage ?? createLocalStorage();
    this.key = key;
    this._profileId = isProfile(profile) ? profile : DEFAULT_PROFILE;
    this._explicit = isProfile(profile);
    this.adaptive = 1;
    this.gameActive = false;
    this._activeDecor = 0;
    this._jankWindows = 0;
    this._goodWindows = 0;
    this._suggested = false;
    this._window = new FrameStats(120);
    if (monitor && scheduler) this._offFrame = scheduler.onFrame((now, dt, interval) => this._sample(interval));
  }

  get profile() { return PROFILES[this._profileId]; }
  get profileId() { return this._profileId; }
  /** true se o usuário escolheu um perfil (não é o padrão implícito). */
  get explicit() { return this._explicit; }

  /** Carrega a preferência salva. Aceita armazenamento síncrono ou assíncrono. */
  async load() {
    let saved = null;
    try { saved = await this.storage.get(this.key); } catch { saved = null; }
    if (isProfile(saved)) {
      this._profileId = saved;
      this._explicit = true;
    } else if (!this._explicit) {
      this._profileId = DEFAULT_PROFILE;
    }
    this.emit('profile', { profile: this.profile, source: 'load' });
    return this._profileId;
  }

  async setProfile(id, { persist = true, source = 'user' } = {}) {
    if (!isProfile(id)) throw new Error(`Perfil desconhecido: ${id}`);
    this._profileId = id;
    this._explicit = true;
    this.adaptive = 1;
    this._jankWindows = this._goodWindows = 0;
    if (persist) {
      try { await this.storage.set(this.key, id); } catch { /* armazenamento indisponível */ }
    }
    this.emit('profile', { profile: this.profile, source });
  }

  adjustSpring(spec) { return adjustSpringForProfile(spec, this._profileId); }

  /** Fator 0..1 para efeitos decorativos (já considera adaptação e jogo). */
  get decorScale() {
    if (this.gameActive) return 0;
    return this.profile.decor * this.adaptive;
  }

  get particleScale() {
    if (this.gameActive) return 0;
    return this.profile.particles * this.adaptive;
  }

  allowDecor() { return this.decorScale > 0.05; }

  /** Reserva espaço para um efeito decorativo; null se o orçamento acabou. */
  requestDecor(cost = 1) {
    if (!this.allowDecor()) return null;
    const limit = Math.max(1, Math.round(this.profile.maxDecor * this.adaptive));
    if (this._activeDecor + cost > limit) return null;
    this._activeDecor += cost;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this._activeDecor = Math.max(0, this._activeDecor - cost);
      },
    };
  }

  setGameActive(active) {
    const next = !!active;
    if (next === this.gameActive) return;
    this.gameActive = next;
    this.emit('game', { active: next });
  }

  /** A cada ~1 s de animação, avalia o ritmo dos frames. */
  _sample(interval) {
    if (interval == null) return;
    this._window.push(interval);
    if (this._window.count < 90) return;
    const s = this._window.summary();
    this._window.reset();
    if (s.samples < 30) return;
    const budget = 1000 / s.refreshHz;
    const janky = s.p95 > budget * 2.2 || s.overBudget > s.samples * 0.25;
    if (janky) {
      this._goodWindows = 0;
      this._jankWindows++;
      this.adaptive = clamp(this.adaptive * 0.7, 0.25, 1);
      this.emit('adaptive', { scale: this.adaptive, stats: s });
      const next = PROFILE_ORDER[PROFILE_ORDER.indexOf(this._profileId) + 1];
      if (this._jankWindows >= 3 && next && !this._suggested) {
        this._suggested = true;
        this.emit('suggestion', { current: this._profileId, suggested: next, stats: s });
      }
    } else {
      this._jankWindows = 0;
      if (++this._goodWindows >= 2 && this.adaptive < 1) {
        this.adaptive = clamp(this.adaptive + 0.15, 0.25, 1);
        this.emit('adaptive', { scale: this.adaptive, stats: s });
      }
    }
  }

  destroy() {
    this._offFrame?.();
    this.removeAllListeners();
  }
}
