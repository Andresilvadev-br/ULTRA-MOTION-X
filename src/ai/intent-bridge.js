import { createTimers } from '../core/env.js';

/**
 * MotionIntentBridge — integração nativa com IA (ex.: Chico IA).
 *
 * A IA não escreve código de animação: ela pede INTENÇÕES declarativas em JSON,
 * validadas por esquema, com limite de taxa e sujeitas ao perfil do usuário:
 *
 *   { "intent": "guide", "target": "optimize.button", "strength": 0.6,
 *     "message": "Este ajuste pode ajudar na inicialização." }
 *
 * Regras de honestidade:
 *  • Intenções só chamam atenção/explicam; nenhuma anuncia sucesso.
 *  • "celebrate" exige `confirmedBy` apontando para um evento que o
 *    MotionDirector recebeu do backend nesta sessão.
 *  • Alvos são nomes registrados (data-umx-target), nunca seletores arbitrários.
 *
 * describe() devolve um retrato legível por máquina do estado de movimento,
 * para a IA explicar o que está acontecendo sem inventar.
 */
export const INTENTS = Object.freeze(['attention', 'highlight', 'guide', 'explain', 'celebrate', 'calm']);
const TARGET_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function validateIntent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not-an-object' };
  const allowed = new Set(['intent', 'target', 'strength', 'message', 'confirmedBy']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) return { ok: false, reason: `unknown-field:${key}` };
  if (!INTENTS.includes(raw.intent)) return { ok: false, reason: 'unknown-intent' };
  if (raw.target != null && (typeof raw.target !== 'string' || !TARGET_RE.test(raw.target))) return { ok: false, reason: 'invalid-target' };
  if (raw.strength != null && !(typeof raw.strength === 'number' && raw.strength >= 0 && raw.strength <= 1)) return { ok: false, reason: 'invalid-strength' };
  if (raw.message != null && (typeof raw.message !== 'string' || raw.message.length > 240)) return { ok: false, reason: 'invalid-message' };
  if (raw.intent === 'celebrate') {
    const c = raw.confirmedBy;
    if (!c || typeof c.type !== 'string') return { ok: false, reason: 'celebrate-needs-confirmation' };
  }
  if (['highlight', 'guide', 'attention'].includes(raw.intent) && !raw.target) return { ok: false, reason: 'target-required' };
  return {
    ok: true,
    value: {
      intent: raw.intent,
      target: raw.target ?? null,
      strength: raw.strength ?? 0.6,
      message: raw.message ?? null,
      confirmedBy: raw.confirmedBy ?? null,
    },
  };
}

export class MotionIntentBridge {
  constructor({ animator, director, character = null, budget = null, effects = null, resolveTarget, timers, limits = {} } = {}) {
    this.animator = animator;
    this.director = director;
    this.character = character;
    this.budget = budget;
    this.effects = effects;
    this.resolveTarget = resolveTarget ?? ((name) => (typeof document !== 'undefined'
      ? document.querySelector(`[data-umx-target="${name}"]`) : null));
    this.timers = createTimers(timers);
    this.limits = { perTargetMs: limits.perTargetMs ?? 2000, windowMs: limits.windowMs ?? 10000, maxPerWindow: limits.maxPerWindow ?? 4 };
    this._recent = [];
    this._perTarget = new Map();
    this.onMessage = null;
  }

  perform(raw) {
    const check = validateIntent(raw);
    if (!check.ok) return check;
    const intent = check.value;
    const now = this.timers.now();

    this._recent = this._recent.filter((t) => now - t < this.limits.windowMs);
    if (this._recent.length >= this.limits.maxPerWindow) return { ok: false, reason: 'rate-limited' };
    const key = intent.target ?? `_${intent.intent}`;
    if (now - (this._perTarget.get(key) ?? -Infinity) < this.limits.perTargetMs) return { ok: false, reason: 'rate-limited-target' };

    if (intent.intent === 'celebrate' && !this.director?.wasConfirmed(intent.confirmedBy.type, intent.confirmedBy.id)) {
      return { ok: false, reason: 'not-confirmed-by-backend' };
    }

    const el = intent.target ? this.resolveTarget(intent.target) : null;
    if (intent.target && !el) return { ok: false, reason: 'target-not-found' };

    this._recent.push(now);
    this._perTarget.set(key, now);
    this._run(intent, el);
    return { ok: true, intent: intent.intent };
  }

  _run(intent, el) {
    const s = intent.strength;
    const decor = this.budget ? this.budget.allowDecor() : true;
    switch (intent.intent) {
      case 'highlight':
        this._ring(el, 1600);
        if (decor) this.animator.animate(el, { scale: 1 }, { spring: 'expressive', velocity: { scale: 0.9 * s } });
        break;
      case 'attention':
        this.animator.animate(el, { x: 0 }, { spring: 'wobble', velocity: { x: 260 * s } });
        this._ring(el, 900);
        break;
      case 'guide':
        this.character?.react('found');
        this._ring(el, 2200);
        if (decor) this.animator.animate(el, { y: 0 }, { spring: 'expressive', velocity: { y: -160 * s } });
        break;
      case 'explain':
        this.character?.react('found', { hold: 1600 });
        break;
      case 'celebrate': {
        this.character?.react('success');
        if (el && this.effects && decor && typeof el.getBoundingClientRect === 'function') {
          const r = el.getBoundingClientRect();
          this.effects.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: Math.round(18 * s) });
        }
        break;
      }
      case 'calm':
        this.character?.clearReaction();
        break;
      default:
        break;
    }
    if (intent.message) this.onMessage?.({ message: intent.message, intent: intent.intent, target: intent.target });
  }

  _ring(el, ms) {
    if (!el?.classList) return;
    el.classList.add('umx-ai-highlight');
    this.timers.setTimeout(() => el.classList.remove('umx-ai-highlight'), ms);
  }

  /** Retrato do estado de movimento para a IA/QA (somente leitura). */
  describe(extra = {}) {
    return {
      profile: this.budget?.profileId ?? null,
      gameActive: this.budget?.gameActive ?? false,
      character: this.character?.state ?? null,
      characterActivities: this.character?.activities ?? [],
      activeChoreographies: this.director?.activeRuns ?? [],
      recent: (this.director?.history() ?? []).slice(-12),
      ...extra,
    };
  }
}
