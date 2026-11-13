import { projectDecay, rubberband, VelocityTracker } from '../physics/inertia.js';

/**
 * Arraste com física: segue o dedo/cursor 1:1, resistência elástica nos
 * limites e, ao soltar, projeta a inércia e escolhe o ponto de encaixe,
 * herdando a velocidade do gesto.
 *
 *   draggable(animator, el, { axis: 'x', bounds: { left: 0, right: 200 },
 *     snap: [0, 200], onRelease: ({ x, y }) => ... })
 */
export function draggable(animator, el, { axis = 'both', bounds, snap, spring = 'responsive', onMove, onRelease } = {}) {
  const tracker = new VelocityTracker();
  let start = null;

  const getBounds = () => (typeof bounds === 'function' ? bounds() : bounds) ?? {};
  const constrain = (value, lo, hi, size) => {
    if (lo != null && value < lo) return lo + rubberband(value - lo, size);
    if (hi != null && value > hi) return hi + rubberband(value - hi, size);
    return value;
  };
  const nearest = (value, points) => {
    if (!points) return value;
    const list = typeof points === 'function' ? points(value) : points;
    if (!Array.isArray(list)) return list;
    return list.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), list[0]);
  };

  const onDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    el.setPointerCapture?.(e.pointerId);
    start = { px: e.clientX, py: e.clientY, x: animator.value(el, 'x'), y: animator.value(el, 'y'), id: e.pointerId };
    animator.stop(el, ['x', 'y']);
    tracker.reset();
    tracker.add(e.timeStamp, e.clientX, e.clientY);
  };

  const onMoveEvt = (e) => {
    if (!start || e.pointerId !== start.id) return;
    tracker.add(e.timeStamp, e.clientX, e.clientY);
    const b = getBounds();
    const rect = { w: el.offsetWidth || 200, h: el.offsetHeight || 200 };
    const x = axis === 'y' ? start.x : constrain(start.x + e.clientX - start.px, b.left, b.right, rect.w);
    const y = axis === 'x' ? start.y : constrain(start.y + e.clientY - start.py, b.top, b.bottom, rect.h);
    animator.set(el, { x, y });
    onMove?.({ x, y });
  };

  const onUp = (e) => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    const v = tracker.velocity(e.timeStamp);
    const b = getBounds();
    const clampTo = (value, lo, hi) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, value));
    const x0 = animator.value(el, 'x'), y0 = animator.value(el, 'y');
    const target = {};
    const velocity = {};
    if (axis !== 'y') {
      target.x = clampTo(nearest(projectDecay(x0, v.x), snap?.x ?? snap), b.left, b.right);
      velocity.x = v.x;
    }
    if (axis !== 'x') {
      target.y = clampTo(nearest(projectDecay(y0, v.y), snap?.y ?? snap), b.top, b.bottom);
      velocity.y = v.y;
    }
    const handle = animator.animate(el, target, { spring, velocity, driver: 'frame' });
    onRelease?.({ ...target, velocity: v, handle });
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMoveEvt);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  if (el.style) el.style.touchAction = axis === 'x' ? 'pan-y' : axis === 'y' ? 'pan-x' : 'none';

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMoveEvt);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };
}
