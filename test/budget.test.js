import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionBudget } from '../src/budget/budget.js';
import { MotionScheduler } from '../src/core/scheduler.js';
import { adjustSpringForProfile } from '../src/budget/profiles.js';
import { fakeFrameClock, memoryStorage } from './helpers.js';

test('sem preferência salva → Ultra (inclusive migração)', async () => {
  const b = new MotionBudget({ storage: memoryStorage(), monitor: false });
  assert.equal(await b.load(), 'ultra');
  assert.equal(b.explicit, false);
});

test('preferência salva é respeitada e persistida', async () => {
  const storage = memoryStorage({ 'umx.profile': 'balanced' });
  const b = new MotionBudget({ storage, monitor: false });
  assert.equal(await b.load(), 'balanced');
  await b.setProfile('performance');
  assert.equal(storage.data['umx.profile'], 'performance');
  await assert.rejects(b.setProfile('turbo'));
});

test('armazenamento assíncrono (ponte Go) funciona', async () => {
  const b = new MotionBudget({ storage: { get: async () => 'performance', set: async () => {} }, monitor: false });
  assert.equal(await b.load(), 'performance');
});

test('jogo ativo zera decoração em qualquer perfil', () => {
  const b = new MotionBudget({ storage: memoryStorage(), monitor: false });
  assert.ok(b.allowDecor());
  b.setGameActive(true);
  assert.equal(b.decorScale, 0);
  assert.equal(b.requestDecor(), null);
});

test('orçamento decorativo limita efeitos simultâneos', () => {
  const b = new MotionBudget({ storage: memoryStorage(), monitor: false, profile: 'performance' });
  assert.equal(b.requestDecor(), null, 'performance não tem decoração');
  const u = new MotionBudget({ storage: memoryStorage(), monitor: false });
  const tokens = [];
  for (let i = 0; i < 30; i++) { const t = u.requestDecor(); if (t) tokens.push(t); }
  assert.equal(tokens.length, 24);
  tokens[0].release(); tokens[0].release();
  assert.ok(u.requestDecor());
  assert.equal(u.requestDecor(), null);
});

test('engasgo persistente gera SUGESTÃO, nunca troca o perfil sozinho', () => {
  const clock = fakeFrameClock();
  const scheduler = new MotionScheduler({ ...clock, autoVisibility: false });
  const b = new MotionBudget({ scheduler, storage: memoryStorage() });
  const suggestions = [];
  b.on('suggestion', (s) => suggestions.push(s));
  scheduler.add({ update: () => true });
  // 60 Hz com muitos frames de 50 ms
  for (let i = 0; i < 90 * 4; i++) clock.frame(i % 2 ? 50 : 1000 / 60);
  assert.equal(b.profileId, 'ultra');
  assert.ok(b.adaptive < 1, 'reduz só o custo decorativo');
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].suggested, 'balanced');
});

test('perfis ajustam molas: Performance sem overshoot e mais rápido', () => {
  const p = adjustSpringForProfile('expressive', 'performance');
  assert.ok(p.damping >= 1 && p.response <= 0.24);
  const b = adjustSpringForProfile('wobble', 'balanced');
  assert.ok(b.damping >= 0.82);
  assert.deepEqual(adjustSpringForProfile('snappy', 'ultra'), { response: 0.2, damping: 0.78, mass: 1 });
});
