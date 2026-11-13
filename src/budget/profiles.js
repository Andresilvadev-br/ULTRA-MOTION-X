import { resolveSpring } from '../physics/spring.js';

/**
 * Perfis de movimento (Plano 5.0 §6.10). Ultra é o padrão.
 * Nenhum perfil reduz a velocidade do feedback de clique: só o custo
 * decorativo (partículas, brilho, laços ociosos) muda.
 */
export const PROFILES = Object.freeze({
  ultra: Object.freeze({
    id: 'ultra', label: 'Ultra',
    decor: 1, particles: 1, glow: 1, cursorLight: true, intent: true,
    characterIdle: 'full', stagger: 28, maxDecor: 24, compositor: true, bakeFps: 120,
  }),
  balanced: Object.freeze({
    id: 'balanced', label: 'Balanced',
    decor: 0.6, particles: 0.4, glow: 0.6, cursorLight: true, intent: true,
    characterIdle: 'calm', stagger: 18, maxDecor: 12, compositor: true, bakeFps: 90,
  }),
  performance: Object.freeze({
    id: 'performance', label: 'Performance',
    decor: 0, particles: 0, glow: 0, cursorLight: false, intent: false,
    characterIdle: 'static', stagger: 0, maxDecor: 4, compositor: true, bakeFps: 60,
  }),
});

export const PROFILE_ORDER = ['ultra', 'balanced', 'performance'];
export const DEFAULT_PROFILE = 'ultra';

export function isProfile(id) { return Object.prototype.hasOwnProperty.call(PROFILES, id); }

/**
 * Ajusta a mola ao perfil: Balanced limita o balanço; Performance fica
 * mais rápido e sem overshoot (resposta imediata, sem efeito).
 */
export function adjustSpringForProfile(spec, profileId) {
  const s = resolveSpring(spec);
  if (profileId === 'performance') return { response: Math.min(s.response * 0.7, 0.24), damping: Math.max(s.damping, 1) };
  if (profileId === 'balanced') return { response: s.response, damping: Math.max(s.damping, 0.82) };
  return s;
}
