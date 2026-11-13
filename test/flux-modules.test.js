import test from 'node:test';
import assert from 'node:assert/strict';
import { magnetOffset } from '../src/interactions/magnetic.js';
import { surfaceTargets } from '../src/interactions/surface.js';
import { LiquidIndicator } from '../src/interactions/indicator.js';
import { dnaTokens, springEasing } from '../src/theme/dna.js';
import { layoutTransition } from '../src/transitions/layout.js';
import { MotionScheduler } from '../src/core/scheduler.js';
import { Animator } from '../src/animate/animator.js';
import { fakeFrameClock } from './helpers.js';

test('magnetOffset puxa em direção ao cursor com limite', () => {
  const r = { left: 0, top: 0, width: 100, height: 40 };
  assert.deepEqual(magnetOffset(r, 60, 20, 0.2, 6), { x: 2, y: 0 });
  assert.deepEqual(magnetOffset(r, 500, -500, 0.2, 6), { x: 6, y: -6 });
});

test('surfaceTargets: centro = sem inclinação, cantos inclinam com sinal coerente', () => {
  const r = { left: 0, top: 0, width: 200, height: 100 };
  const c = surfaceTargets(r, 100, 50, 4);
  assert.equal(c.rx, 0); assert.equal(c.ry, 0);
  const tl = surfaceTargets(r, 0, 0, 4);
  assert.ok(tl.rx > 0 && tl.ry < 0);
  assert.equal(surfaceTargets(r, 999, 999).lx, 200);
});

test('LiquidIndicator estica com a velocidade e assenta no alvo', async () => {
  const clock = fakeFrameClock();
  const scheduler = new MotionScheduler({ ...clock, autoVisibility: false });
  const el = { style: {} };
  const ind = new LiquidIndicator(el, { scheduler });
  await ind.moveTo(0, 38);
  assert.equal(el.style.height, '38.00px');
  const done = ind.moveTo(300, 38);
  clock.run(6);
  assert.ok(parseFloat(el.style.height) > 38, `esticou: ${el.style.height}`);
  clock.run(200);
  assert.equal(await done, true);
  assert.equal(el.style.height, '38.00px');
  assert.equal(el.style.transform, 'translate3d(0,300.00px,0)');
});

test('Motion DNA publica molas como linear() que termina em 1', () => {
  const t = dnaTokens();
  assert.ok(t['--umx-ease-tap'].startsWith('linear(0.0000'));
  assert.ok(t['--umx-ease-page'].endsWith('1.0000)'));
  assert.match(t['--umx-dur-alert'], /^\d+ms$/);
  assert.ok(springEasing('wobble').ms > springEasing('critical').ms);
});

test('layoutTransition: mantém (FLIP) o que ficou e anima a entrada do novo', () => {
  const clock = fakeFrameClock();
  const scheduler = new MotionScheduler({ ...clock, autoVisibility: false });
  const animator = new Animator({ scheduler });
  const mk = (k, top) => ({ k, top, style: { setProperty(p, v) { this[p] = v; } }, getAttribute: () => k, getBoundingClientRect() { return { left: 0, top: this.top, width: 100, height: 20 }; } });
  let items = [mk('a', 0), mk('b', 20)];
  const root = { querySelectorAll: () => items };
  const hs = layoutTransition(animator, root, () => { items = [mk('c', 0), mk('b', 20), mk('a', 40)]; });
  assert.equal(hs.length, 2, 'a moveu (FLIP) e c entrou; b ficou parado');
  clock.frame();
  assert.match(items[2].style.translate, /^0px -3\d/, 'a parte do lugar antigo (40px acima)');
  assert.ok(Number(items[0].style.opacity) < 0.2, 'c entra a partir de opacidade ~0');
});
