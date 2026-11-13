import { flip, measure } from './flip.js';

/**
 * Layout Transitions — FLIP por chave: o que permanece desliza até o novo
 * lugar (herdando a velocidade se já estava em movimento) e o que entra surge
 * em cascata. Funciona com re-renderização por innerHTML: a chave liga o
 * elemento velho ao novo.
 *
 *   layoutTransition(animator, lista, () => lista.innerHTML = html, { key: 'data-k' })
 */
export function layoutTransition(animator, root, mutate, { key = 'data-k', spring = 'gentle', enter = true, stagger = 22, maxEnter = 14, enterFrom = { opacity: 0, scale: 0.95, y: 10 } } = {}) {
  if (!root) { mutate(); return []; }
  const sel = `[${key}]`;
  const before = new Map();
  for (const el of root.querySelectorAll(sel)) {
    const r = measure(el);
    if (r.width || r.height) before.set(el.getAttribute(key), r);
  }
  mutate();
  const handles = [];
  let n = 0;
  for (const el of root.querySelectorAll(sel)) {
    const first = before.get(el.getAttribute(key));
    if (first) {
      const last = measure(el);
      if (Math.abs(first.left - last.left) + Math.abs(first.top - last.top) + Math.abs(first.width - last.width) + Math.abs(first.height - last.height) > 1) {
        handles.push(flip(animator, el, first, { spring }));
      }
    } else if (enter && n < maxEnter) {
      handles.push(animator.animate(el, { opacity: 1, scale: 1, y: 0 }, { spring, from: enterFrom, delay: n++ * stagger }));
    }
  }
  return handles;
}
