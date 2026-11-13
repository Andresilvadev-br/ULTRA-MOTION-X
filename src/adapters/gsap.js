/**
 * Adaptador opcional para GSAP (empacotado localmente pelo app, sem CDN).
 *
 * O MotionDirector continua sendo a autoridade: tweens/timelines criados por
 * aqui ficam registrados e são mortos no cancelamento da coreografia, e o
 * adaptador "trava" os grupos de propriedades no Animator para que GSAP e o
 * motor nativo nunca animem a mesma propriedade ao mesmo tempo.
 *
 * Observação: GSAP escreve em `transform`; o motor nativo em translate/scale/rotate.
 * As travas evitam disputa durante a animação; os valores finais se compõem.
 */
const GROUP_OF = {
  x: 'translate', y: 'translate', xPercent: 'translate', yPercent: 'translate',
  scale: 'scale', scaleX: 'scale', scaleY: 'scale',
  rotation: 'rotate', rotate: 'rotate', opacity: 'opacity', autoAlpha: 'opacity',
};

export function createGsapAdapter(gsap, { animator } = {}) {
  if (!gsap || typeof gsap.to !== 'function') throw new Error('createGsapAdapter: instância GSAP inválida');

  const lock = (targets, vars, tween) => {
    if (!animator) return;
    const list = Array.isArray(targets) ? targets : [targets];
    const groups = new Set(Object.keys(vars).map((k) => GROUP_OF[k]).filter(Boolean));
    for (const el of list) {
      if (!el || typeof el !== 'object') continue;
      for (const g of groups) animator.claim(el, g, 'gsap', () => tween.kill());
    }
    const release = () => {
      for (const el of list) for (const g of groups) animator.unclaim(el, g, 'gsap');
    };
    const prev = tween.eventCallback?.('onComplete');
    tween.eventCallback?.('onComplete', (...args) => { release(); prev?.(...args); });
  };

  return {
    gsap,
    to(targets, vars, ctx) {
      const tween = gsap.to(targets, vars);
      lock(targets, vars, tween);
      ctx?.onDispose(() => tween.kill());
      return { finished: tween.then ? tween.then(() => true) : Promise.resolve(true), cancel: () => tween.kill(), tween };
    },
    fromTo(targets, fromVars, toVars, ctx) {
      const tween = gsap.fromTo(targets, fromVars, toVars);
      lock(targets, toVars, tween);
      ctx?.onDispose(() => tween.kill());
      return { finished: tween.then ? tween.then(() => true) : Promise.resolve(true), cancel: () => tween.kill(), tween };
    },
    timeline(vars, ctx) {
      const tl = gsap.timeline(vars);
      ctx?.onDispose(() => tl.kill());
      return tl;
    },
  };
}
