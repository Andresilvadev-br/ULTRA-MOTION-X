// ULTRA MOTION X — motor universal de movimento.
// JavaScript puro (ES modules), sem dependências, pronto para WebView2.

import { MotionScheduler } from './core/scheduler.js';
import { Emitter } from './core/emitter.js';
import { createLocalStorage, hasDocument } from './core/env.js';
import { MotionBudget } from './budget/budget.js';
import { Animator } from './animate/animator.js';
import { MotionValue } from './animate/motion-value.js';
import { MotionDirector } from './director/director.js';
import { ThemeMotionBridge } from './theme/theme-bridge.js';
import { TransitionCoordinator } from './transitions/coordinator.js';
import { flip, measure } from './transitions/flip.js';
import { MicroInteractions } from './interactions/micro.js';
import { IntentPredictor } from './interactions/intent.js';
import { draggable } from './interactions/drag.js';
import { CharacterStateMachine } from './character/character-state.js';
import { SvgCharacterRenderer } from './character/svg-renderer.js';
import { EffectsLayer } from './effects/effects-layer.js';
import { CapsuleMorph } from './capsule/capsule.js';
import { HostBridge } from './bridge/host-bridge.js';
import { MotionIntentBridge } from './ai/intent-bridge.js';

export const VERSION = '1.0.0';

/**
 * Cria uma instância completa do motor.
 *
 *   const umx = createUltraMotionX({
 *     root: document, storage, accent: '#2f8cff', mode: 'dark',
 *     bridge: true,           // conecta ao WebView2 (window.chrome.webview)
 *   });
 *   await umx.ready;          // perfil salvo carregado
 */
export function createUltraMotionX(options = {}) {
  const {
    root = hasDocument ? document : null,
    storage = createLocalStorage(),
    profile,
    accent = '#2f8cff',
    mode = 'dark',
    surface,
    bridge = true,
    intent = true,
    effects = true,
    schedulerOptions = {},
  } = options;

  const events = new Emitter();
  const scheduler = new MotionScheduler(schedulerOptions);
  const budget = new MotionBudget({ scheduler, storage, profile, key: options.profileKey ?? 'umx.profile' });
  const animator = new Animator({ scheduler, budget });
  const director = new MotionDirector({ animator, budget });
  const theme = new ThemeMotionBridge({
    root: root?.documentElement ?? null, scheduler, budget, accent, mode, surface,
  });
  const transitions = new TransitionCoordinator({ animator, budget, scheduler });
  const micro = new MicroInteractions({ animator, scheduler, budget });
  const fx = effects && hasDocument ? new EffectsLayer({ scheduler, budget }) : null;
  const host = bridge ? (bridge instanceof HostBridge ? bridge : new HostBridge(typeof bridge === 'object' ? bridge : {})) : null;
  const predictor = intent ? new IntentPredictor({ scheduler, budget }) : null;

  const disposers = [];
  let character = null;
  const ai = new MotionIntentBridge({ animator, director, budget, effects: fx });

  if (host) disposers.push(host.on('event', (e) => director.dispatch(e)));
  if (predictor) {
    disposers.push(predictor.on('intent', ({ element }) => {
      const screen = element.closest?.('[data-umx-screen]');
      if (screen) transitions.prewarm(screen);
      events.emit('intent', { element });
    }));
  }
  disposers.push(budget.on('suggestion', (s) => events.emit('suggestion', s)));

  const api = {
    VERSION,
    scheduler, budget, animator, director, theme, transitions, micro, effects: fx, bridge: host, ai,
    events,
    ready: budget.load().then(() => theme.refresh()),

    /** Liga microinterações e previsão de intenção a uma raiz (padrão: document). */
    bind(target = root) {
      const offs = [micro.bind(target)];
      if (predictor) offs.push(predictor.bind(target));
      const off = () => offs.forEach((f) => f());
      disposers.push(off);
      return off;
    },

    animate: (el, props, opts) => animator.animate(el, props, opts),
    set: (el, values) => animator.set(el, values),
    value: (initial, opts) => new MotionValue(initial, { scheduler, budget, ...opts }),
    flip: (el, first, opts) => flip(animator, el, first, opts),
    measure,
    number: (el, value, opts) => micro.number(el, value, opts),
    draggable: (el, opts) => draggable(animator, el, opts),
    capsule: (el, opts) => new CapsuleMorph(el, { animator, scheduler, budget, ...opts }),

    /** Personagem (ex.: Chico). renderer padrão: SVG procedural sobre a arte existente. */
    character(element, { states, initial, gestures, eyeOpen, renderer } = {}) {
      character?.destroy();
      character = new CharacterStateMachine({ states, initial });
      const r = renderer ?? (element ? new SvgCharacterRenderer({ root: element, animator, scheduler, budget, gestures, eyeOpen }) : null);
      if (r) character.setRenderer(r);
      director.character = character;
      ai.character = character;
      return character;
    },

    /** Elemento por nome lógico (data-umx-target). */
    target(name) {
      if (!root?.querySelector) return null;
      return root.querySelector(`[data-umx-target="${cssEscape(name)}"]`);
    },

    /** Indicadores internos de QA (não é painel para o usuário final). */
    metrics() {
      return {
        frames: scheduler.stats.summary(),
        inputToFrame: {
          samples: micro.latency.count,
          p50: Math.round(micro.latency.percentile(50) * 10) / 10,
          p95: Math.round(micro.latency.percentile(95) * 10) / 10,
        },
        paused: scheduler.pauseReasons,
        adaptive: budget.adaptive,
      };
    },

    describe: () => ai.describe({ metrics: api.metrics() }),

    destroy() {
      for (const off of disposers.splice(0)) off();
      director.destroy();
      character?.destroy();
      fx?.destroy();
      micro.destroy();
      theme.destroy();
      budget.destroy();
      host?.destroy();
      scheduler.destroy();
      events.removeAllListeners();
    },
  };
  return api;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

export { MotionScheduler } from './core/scheduler.js';
export { Emitter } from './core/emitter.js';
export { FrameStats, SampleStats } from './core/frame-stats.js';
export { SPRINGS, resolveSpring, springAt, settleTime, sampleSpring } from './physics/spring.js';
export { VelocityTracker, projectDecay, decayAt, rubberband } from './physics/inertia.js';
export { Animator, MotionHandle } from './animate/animator.js';
export { MotionValue } from './animate/motion-value.js';
export { MotionBudget } from './budget/budget.js';
export { PROFILES, PROFILE_ORDER, DEFAULT_PROFILE } from './budget/profiles.js';
export { MotionDirector, normalizeEvent } from './director/director.js';
export { ThemeMotionBridge, themeTokens, FUNCTIONAL } from './theme/theme-bridge.js';
export * as color from './theme/color.js';
export { TransitionCoordinator } from './transitions/coordinator.js';
export { flip, measure, layoutRect } from './transitions/flip.js';
export { MicroInteractions } from './interactions/micro.js';
export { IntentPredictor } from './interactions/intent.js';
export { draggable } from './interactions/drag.js';
export { CharacterStateMachine } from './character/character-state.js';
export { SvgCharacterRenderer, gestures } from './character/svg-renderer.js';
export { RiveCharacterRenderer } from './character/rive-adapter.js';
export { EffectsLayer } from './effects/effects-layer.js';
export { CapsuleMorph } from './capsule/capsule.js';
export { HostBridge } from './bridge/host-bridge.js';
export { MotionIntentBridge, validateIntent, INTENTS } from './ai/intent-bridge.js';
export { createGsapAdapter } from './adapters/gsap.js';
