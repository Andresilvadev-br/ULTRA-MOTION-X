import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionScheduler } from '../src/core/scheduler.js';
import { fakeFrameClock } from './helpers.js';

test('sem trabalho não há requestAnimationFrame (nenhum laço residente)', () => {
  const clock = fakeFrameClock();
  const s = new MotionScheduler({ ...clock, autoVisibility: false });
  assert.equal(clock.pending, 0);
  s.add({ update: () => false });
  assert.equal(clock.pending, 1);
  clock.frame();
  assert.equal(clock.pending, 0);
});

test('fases read → update → render → write → after em ordem', () => {
  const clock = fakeFrameClock();
  const s = new MotionScheduler({ ...clock, autoVisibility: false });
  const order = [];
  s.write(() => order.push('write'));
  s.read(() => order.push('read'));
  s.after(() => order.push('after'));
  s.add({ update: () => { order.push('update'); return false; }, render: () => order.push('render') });
  clock.frame();
  assert.deepEqual(order, ['read', 'update', 'render', 'write', 'after']);
});

test('delta-time real com limite após engasgos', () => {
  const clock = fakeFrameClock();
  const s = new MotionScheduler({ ...clock, autoVisibility: false });
  const dts = [];
  s.add({ update: (dt) => { dts.push(dt); return dts.length < 3; } });
  clock.frame(1000 / 144);
  clock.frame(1000 / 144);
  clock.frame(500);
  assert.ok(Math.abs(dts[1] - 1 / 144) < 1e-9);
  assert.equal(dts[2], 1 / 20);
});

test('pausa por motivo: só volta quando todos os motivos saem', () => {
  const clock = fakeFrameClock();
  const s = new MotionScheduler({ ...clock, autoVisibility: false });
  let n = 0;
  s.add({ update: () => { n++; return true; } });
  s.pause('game');
  s.pause('hidden');
  assert.equal(clock.pending, 0);
  s.resume('hidden');
  assert.equal(clock.pending, 0);
  s.resume('game');
  clock.frame();
  assert.equal(n, 1);
});

test('estima taxa do monitor (144 Hz) pelos intervalos', () => {
  const clock = fakeFrameClock();
  const s = new MotionScheduler({ ...clock, autoVisibility: false });
  s.add({ update: () => true });
  clock.run(60, 1000 / 144);
  assert.equal(s.stats.summary().refreshHz, 144);
});

test('erro em tarefa não derruba o laço', () => {
  const clock = fakeFrameClock();
  const errors = [];
  const s = new MotionScheduler({ ...clock, autoVisibility: false, onError: (e) => errors.push(e) });
  let ok = 0;
  s.add({ update: () => { throw new Error('x'); } });
  s.add({ update: () => { ok++; return ok < 2; } });
  clock.frame(); clock.frame();
  assert.equal(errors.length, 1);
  assert.equal(ok, 2);
});

test('trabalho agendado durante um frame não duplica o próximo rAF', () => {
  const clock = fakeFrameClock();
  const s = new MotionScheduler({ ...clock, autoVisibility: false });
  let frames = 0;
  s.add({ update: () => { frames++; s.write(() => {}); return frames < 3; } });
  clock.frame();
  assert.equal(clock.pending, 1);
  clock.frame();
  assert.equal(clock.pending, 1);
});
