import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionDirector } from '../src/director/director.js';
import { fakeTimers, flush } from './helpers.js';

const make = () => { const timers = fakeTimers(); return { timers, d: new MotionDirector({ timers }) }; };

test('anúncio sem confirmação prévia é rejeitado na definição', () => {
  const { d } = make();
  assert.throws(() => d.define('x', { on: 'a', steps: [{ announce: 'success', run() {} }] }), /exige um passo "await"/);
  assert.throws(() => d.define('y', { on: 'a', steps: [{ parallel: [{ announce: 'success', run() {} }] }] }));
  assert.doesNotThrow(() => d.define('z', { on: 'a', steps: [{ await: 'ok' }, { announce: 'success', run() {} }] }));
});

test('sucesso só depois do evento real do backend', async () => {
  const { d } = make();
  const log = [];
  d.define('clip', {
    on: 'clip.requested', concurrency: 'parallel',
    steps: [
      { run: () => log.push('feedback') },
      { await: 'clip.validated', fail: 'clip.failed' },
      { announce: 'success', run: (ctx) => log.push(`saved:${ctx.confirmed.payload.file}`) },
    ],
    onError: [{ announce: 'error', run: (ctx) => log.push(`error:${ctx.reason}`) }],
  });
  d.dispatch({ type: 'clip.requested', id: 'c1' });
  await flush();
  assert.deepEqual(log, ['feedback']);
  d.dispatch({ type: 'clip.validated', id: 'other' }); // outro id não confirma
  await flush();
  assert.deepEqual(log, ['feedback']);
  d.dispatch({ type: 'clip.validated', id: 'c1', payload: { file: 'a.mp4' } });
  await flush();
  assert.deepEqual(log, ['feedback', 'saved:a.mp4']);
  assert.equal(d.wasConfirmed('clip.validated', 'c1'), true);
});

test('falha do backend segue o caminho de erro', async () => {
  const { d } = make();
  const log = [];
  d.define('opt', {
    on: 'opt.req',
    steps: [{ await: 'opt.ok', fail: 'opt.failed' }, { announce: 'success', run: () => log.push('ok') }],
    onError: [{ announce: 'error', run: (ctx) => log.push(`${ctx.reason}:${ctx.failure.payload.code}`) }],
  });
  d.dispatch({ type: 'opt.req', id: 1 });
  d.dispatch({ type: 'opt.failed', id: 1, payload: { code: 'UAC' } });
  await flush();
  assert.deepEqual(log, ['failed:UAC']);
});

test('timeout não é tratado como sucesso', async () => {
  const { d, timers } = make();
  const log = [];
  d.define('g', {
    on: 'game.detected',
    steps: [{ await: 'game.activated', timeout: 5000 }, { announce: 'success', run: () => log.push('on') }],
    onError: [{ announce: 'unknown', run: (ctx) => log.push(ctx.reason) }],
  });
  d.dispatch({ type: 'game.detected', id: 'g' });
  timers.advance(5001);
  await flush();
  assert.deepEqual(log, ['timeout']);
});

test('eventos duplicados (type+id+seq) são ignorados', () => {
  const { d } = make();
  let n = 0;
  d.define('n', { on: 'notify', concurrency: 'parallel', steps: [{ run: () => { n++; } }] });
  d.dispatch({ type: 'notify', id: 'a', seq: 1 });
  assert.equal(d.dispatch({ type: 'notify', id: 'a', seq: 1 }).reason, 'duplicate');
  d.dispatch({ type: 'notify', id: 'a', seq: 2 });
  assert.equal(n, 2);
});

test('replace: a execução antiga é cancelada e nunca anuncia estado velho', async () => {
  const { d } = make();
  const log = [];
  let disposed = 0;
  d.define('game.on', {
    on: 'game.detected', channel: 'game',
    steps: [{ run: (ctx) => ctx.onDispose(() => disposed++) }, { await: 'game.activated' }, { announce: 'success', run: () => log.push('activated') }],
  });
  d.define('game.off', {
    on: 'game.ended', channel: 'game',
    steps: [{ await: 'game.restored' }, { announce: 'success', run: () => log.push('restored') }],
  });
  d.dispatch({ type: 'game.detected', id: 'lol' });
  d.dispatch({ type: 'game.ended', id: 'lol' });
  d.dispatch({ type: 'game.activated', id: 'lol' }); // chega atrasado
  d.dispatch({ type: 'game.restored', id: 'lol' });
  await flush();
  assert.deepEqual(log, ['restored']);
  assert.equal(disposed, 1);
});

test('drop: ignora novo pedido enquanto um está ativo', () => {
  const { d } = make();
  d.define('o', { on: 'opt', concurrency: 'drop', steps: [{ await: 'done' }] });
  assert.deepEqual(d.dispatch({ type: 'opt', id: 1 }).started, ['o']);
  assert.deepEqual(d.dispatch({ type: 'opt', id: 2 }).started, []);
});

test('progresso real é entregue sem encerrar a espera', async () => {
  const { d } = make();
  const seen = [];
  d.define('o', {
    on: 'opt',
    steps: [
      { await: 'opt.confirmed', progress: 'opt.progress', onProgress: (ctx, e) => seen.push(e.payload.value) },
      { announce: 'success', run: () => seen.push('done') },
    ],
  });
  d.dispatch({ type: 'opt', id: 'x' });
  d.dispatch({ type: 'opt.progress', id: 'x', seq: 1, payload: { value: 0.3 } });
  d.dispatch({ type: 'opt.progress', id: 'x', seq: 2, payload: { value: 0.8 } });
  d.dispatch({ type: 'opt.confirmed', id: 'x' });
  await flush();
  assert.deepEqual(seen, [0.3, 0.8, 'done']);
});

test('curinga em "on" e eventos simulados marcados', async () => {
  const { d } = make();
  const got = [];
  d.define('any', { on: 'notify.*', steps: [{ run: (ctx) => got.push([ctx.event.type, ctx.simulated]) }] });
  d.dispatch({ type: 'notify.info', simulated: true });
  await flush();
  assert.deepEqual(got, [['notify.info', true]]);
});
