import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionScheduler } from '../src/core/scheduler.js';
import { Animator } from '../src/animate/animator.js';
import { MotionValue } from '../src/animate/motion-value.js';
import { MotionBudget } from '../src/budget/budget.js';
import { fakeFrameClock, fakeElement, memoryStorage } from './helpers.js';

function setup({ budget = false } = {}) {
  const clock = fakeFrameClock();
  const scheduler = new MotionScheduler({ ...clock, autoVisibility: false });
  const b = budget ? new MotionBudget({ scheduler, storage: memoryStorage(), monitor: false }) : null;
  const animator = new Animator({ scheduler, budget: b });
  return { clock, scheduler, animator, budget: b };
}

test('driver de frame: chega ao alvo e escreve propriedades individuais', async () => {
  const { clock, animator } = setup();
  const el = fakeElement();
  const h = animator.animate(el, { x: 100, opacity: 0.5 }, { spring: 'critical' });
  clock.run(120);
  assert.equal(await h.finished, true);
  assert.equal(el.style.translate, '100px 0px');
  assert.equal(el.style.opacity, '0.5');
  assert.equal(animator.isAnimating(el), false);
});

test('interromper preserva posição e velocidade (sem salto)', async () => {
  const { clock, animator } = setup();
  const el = fakeElement();
  const first = animator.animate(el, { x: 200 }, { spring: 'responsive' });
  clock.run(8);
  const before = animator.value(el, 'x');
  const vBefore = animator.velocity(el, 'x');
  const second = animator.animate(el, { x: 0 }, { spring: 'responsive' });
  assert.ok(Math.abs(animator.value(el, 'x') - before) < 1e-9);
  assert.ok(Math.abs(animator.velocity(el, 'x') - vBefore) < 1e-6);
  assert.equal(await first.finished, false);
  clock.run(200);
  assert.equal(await second.finished, true);
  assert.equal(animator.value(el, 'x'), 0);
});

test('driver de compositor: keyframes partem do estado atual e o inline guarda o valor final', () => {
  const { clock, animator } = setup();
  const el = fakeElement({ animate: true });
  animator.animate(el, { scale: 1.2 }, { spring: 'snappy' });
  assert.equal(el.animations.length, 1);
  const anim = el.animations[0];
  assert.equal(anim.keyframes[0].scale, '1 1');
  assert.equal(anim.keyframes.at(-1).scale, '1.2 1.2');
  assert.equal(el.style.scale, '1.2 1.2');
  clock.advance(40);
  const mid = animator.value(el, 'scale');
  animator.animate(el, { scale: 1 }, { spring: 'snappy' });
  assert.equal(anim.cancelled, true, 'animação anterior cancelada no retarget');
  const next = el.animations[1];
  const first = Number(next.keyframes[0].scale.split(' ')[0]);
  assert.ok(Math.abs(first - mid) < 1e-3, `retarget contínuo (${first} vs ${mid})`);
});

test('fim do compositor resolve o handle', async () => {
  const { animator } = setup();
  const el = fakeElement({ animate: true });
  const h = animator.animate(el, { opacity: 0 }, { spring: 'critical' });
  el.animations[0].onfinish();
  assert.equal(await h.finished, true);
  assert.equal(animator.isAnimating(el), false);
});

test('set() salta e cancela a trilha; stop() congela no valor visual', async () => {
  const { clock, animator } = setup();
  const el = fakeElement();
  const h = animator.animate(el, { y: 50 });
  clock.run(5);
  animator.stop(el);
  const frozen = animator.value(el, 'y');
  assert.ok(frozen > 0 && frozen < 50);
  assert.equal(await h.finished, false);
  animator.set(el, { y: 10 });
  assert.equal(el.style.translate, '0px 10px');
});

test('travas: outro motor que anima o mesmo grupo é avisado', () => {
  const { animator } = setup();
  const el = fakeElement();
  let stolen = false;
  animator.claim(el, 'translate', 'gsap', () => { stolen = true; });
  animator.animate(el, { x: 5 });
  assert.equal(stolen, true);
});

test('perfil Performance: decoração vira salto imediato; feedback continua animado', async () => {
  const { animator, budget } = setup({ budget: true });
  await budget.setProfile('performance');
  const el = fakeElement();
  const h = animator.animate(el, { y: -4 }, { decorative: true });
  assert.equal(await h.finished, true);
  assert.equal(el.style.translate, '0px -4px');
  const press = animator.animate(el, { scale: 0.96 }, { spring: 'snappy' });
  assert.equal(press.active, true);
});

test('variáveis CSS (--var) usam driver de frame com unidade', async () => {
  const { clock, animator } = setup();
  const el = fakeElement({ animate: true });
  const h = animator.animate(el, { '--glow': 12 }, { units: { '--glow': 'px' }, spring: 'critical' });
  assert.equal(el.animations.length, 0);
  clock.run(120);
  assert.equal(await h.finished, true);
  assert.equal(el.style['--glow'], '12px');
});

test('MotionValue: set preserva velocidade e resolve false ao ser substituído', async () => {
  const clock = fakeFrameClock();
  const scheduler = new MotionScheduler({ ...clock, autoVisibility: false });
  const mv = new MotionValue(0, { scheduler, spring: 'responsive' });
  const seen = [];
  mv.on('change', (v) => seen.push(v));
  const p1 = mv.set(100);
  clock.run(6);
  const v = mv.getVelocity();
  assert.ok(v > 0);
  const p2 = mv.set(0);
  assert.ok(Math.abs(mv.getVelocity() - v) < 1e-6);
  clock.run(200);
  assert.equal(await p1, false);
  assert.equal(await p2, true);
  assert.equal(mv.get(), 0);
  assert.ok(seen.length > 5);
});
