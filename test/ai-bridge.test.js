import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionIntentBridge, validateIntent } from '../src/ai/intent-bridge.js';
import { MotionDirector } from '../src/director/director.js';
import { HostBridge } from '../src/bridge/host-bridge.js';
import { fakeTimers, fakeElement } from './helpers.js';

function make() {
  const timers = fakeTimers();
  const director = new MotionDirector({ timers });
  const reactions = [];
  const character = { react: (s) => reactions.push(s), clearReaction() {}, state: 'idle', activities: [] };
  const el = fakeElement();
  el.classList = { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } };
  const animator = { animate: () => ({ finished: Promise.resolve(true) }) };
  const ai = new MotionIntentBridge({ animator, director, character, timers, resolveTarget: (n) => (n === 'optimize.button' ? el : null) });
  return { ai, director, timers, reactions, el };
}

test('esquema: rejeita campos, intenções e alvos inválidos', () => {
  assert.equal(validateIntent({ intent: 'hack' }).reason, 'unknown-intent');
  assert.equal(validateIntent({ intent: 'guide', target: 'a b' }).reason, 'invalid-target');
  assert.equal(validateIntent({ intent: 'guide', target: '#x' }).reason, 'invalid-target');
  assert.equal(validateIntent({ intent: 'guide', target: 'ok', eval: '1' }).reason, 'unknown-field:eval');
  assert.equal(validateIntent({ intent: 'highlight' }).reason, 'target-required');
  assert.equal(validateIntent({ intent: 'explain' }).ok, true);
});

test('celebrar exige confirmação real do backend', () => {
  const { ai, director } = make();
  const req = { intent: 'celebrate', confirmedBy: { type: 'optimize.confirmed', id: 'o1' } };
  assert.equal(ai.perform(req).reason, 'not-confirmed-by-backend');
  director.define('o', { on: 'optimize.requested', steps: [{ await: 'optimize.confirmed' }] });
  director.dispatch({ type: 'optimize.requested', id: 'o1' });
  director.dispatch({ type: 'optimize.confirmed', id: 'o1' });
  assert.equal(ai.perform(req).ok, true);
});

test('guiar: realça o alvo, Chico reage e há limite de taxa', () => {
  const { ai, reactions, el, timers } = make();
  assert.equal(ai.perform({ intent: 'guide', target: 'optimize.button' }).ok, true);
  assert.deepEqual(reactions, ['found']);
  assert.ok(el.classList.set.has('umx-ai-highlight'));
  assert.equal(ai.perform({ intent: 'guide', target: 'optimize.button' }).reason, 'rate-limited-target');
  assert.equal(ai.perform({ intent: 'guide', target: 'nada' }).reason, 'target-not-found');
  timers.advance(2500);
  assert.equal(el.classList.set.has('umx-ai-highlight'), false);
});

test('describe() expõe estado sem inventar', () => {
  const { ai } = make();
  const d = ai.describe();
  assert.equal(d.character, 'idle');
  assert.deepEqual(d.activeChoreographies, []);
});

test('HostBridge: aceita JSON do WebView2, filtra canal e marca simulação', () => {
  const listeners = {};
  const posted = [];
  const webview = { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {}, postMessage: (m) => posted.push(m) };
  const target = {};
  const bridge = new HostBridge({ webview, target });
  const got = [];
  bridge.on('event', (e) => got.push(e));
  listeners.message({ data: { channel: 'umx', type: 'clip.save.validated', id: 'c1' } });
  listeners.message({ data: JSON.stringify({ channel: 'umx', type: 'game.activated', id: 'g' }) });
  listeners.message({ data: { channel: 'outro', type: 'x' } });
  target.__umx.receive('{"type":"optimize.started","id":"o"}');
  bridge.receive('não é json');
  bridge.simulate({ type: 'notify', payload: {} });
  assert.deepEqual(got.map((e) => [e.type, e.simulated]), [
    ['clip.save.validated', false], ['game.activated', false], ['optimize.started', false], ['notify', true],
  ]);
  bridge.receive({ type: 'x', simulated: true });
  assert.equal(got.at(-1).simulated, false, 'backend não pode se passar por simulação');
  bridge.send('clip.save.request', { source: 'ui' }, { id: 'c2' });
  assert.deepEqual(posted, [{ channel: 'umx', type: 'clip.save.request', id: 'c2', payload: { source: 'ui' } }]);
});
