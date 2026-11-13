// Fluid Morphing (FLIP + elemento compartilhado) com física contínua.

/** Retângulo visual atual (já inclui transformações em andamento). */
export function measure(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Retângulo de layout (sem as transformações do Animator), calculado a partir
 * do retângulo visual e dos valores atuais de translate/scale (origem no centro).
 */
export function layoutRect(animator, el, visual = measure(el)) {
  const x = animator.value(el, 'x'), y = animator.value(el, 'y');
  const s = animator.value(el, 'scale');
  const sx = s * animator.value(el, 'scaleX'), sy = s * animator.value(el, 'scaleY');
  const width = visual.width / (sx || 1), height = visual.height / (sy || 1);
  const cx = visual.left + visual.width / 2 - x, cy = visual.top + visual.height / 2 - y;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

/**
 * Anima `el` (já na posição final de layout) a partir de `first` (retângulo visual de origem).
 * Preserva a velocidade se o elemento já estava em movimento: interromper uma
 * transição no meio continua a partir de onde o olho estava.
 */
export function flip(animator, el, first, { spring = 'page', last, opacity, velocity } = {}) {
  const target = last ?? layoutRect(animator, el);
  if (!target.width || !target.height || !first.width || !first.height) {
    return animator.animate(el, { opacity: 1 }, { spring: 'critical', from: { opacity: 0 } });
  }
  const fcx = first.left + first.width / 2, fcy = first.top + first.height / 2;
  const lcx = target.left + target.width / 2, lcy = target.top + target.height / 2;
  const from = {
    x: fcx - lcx,
    y: fcy - lcy,
    scale: 1,
    scaleX: first.width / target.width,
    scaleY: first.height / target.height,
  };
  const to = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1 };
  if (opacity) { from.opacity = opacity[0]; to.opacity = opacity[1]; }
  const v = velocity ?? {
    x: animator.velocity(el, 'x'),
    y: animator.velocity(el, 'y'),
  };
  return animator.animate(el, to, { spring, from, velocity: { ...v, scale: 0, scaleX: 0, scaleY: 0 } });
}
