import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterStateMachine } from '../src/character/character-state.js';
import { fakeTimers } from './helpers.js';

const STATES = {
  idle: { priority: 0 },
  analyzing: { priority: 50 },
  applying: { priority: 80 },
  found: { priority: 60, hold: 900 },
  success: { priority: 70, hold: 1200 },
  error: { priority: 90, hold: 3000 },
};

function make() {
  const timers = fakeTimers();
  const shown = [];
  const sm = new CharacterStateMachine({ states: STATES, timers, debounce: 80, minHold: 400, renderer: { show: (s) => shown.push(s) } });
  return { sm, timers, shown };
}

test('atividade sustentada de maior prioridade vence', () => {
  const { sm, timers } = make();
  sm.begin('scan', 'analyzing');
  sm.begin('opt', 'applying');
  timers.advance(100);
  assert.equal(sm.state, 'applying');
  sm.end('opt');
  timers.advance(500);
  assert.equal(sm.state, 'analyzing');
  sm.end('scan');
  timers.advance(500);
  assert.equal(sm.state, 'idle');
});

test('rajada de eventos é coalescida (sem troca caótica)', () => {
  const { sm, timers, shown } = make();
  sm.begin('a', 'analyzing');
  sm.end('a');
  sm.begin('b', 'analyzing');
  sm.end('b');
  sm.begin('c', 'analyzing');
  timers.advance(100);
  assert.deepEqual(shown, ['analyzing']);
});

test('tempo mínimo de exibição; prioridade maior fura a fila', () => {
  const { sm, timers } = make();
  sm.begin('a', 'analyzing');
  timers.advance(90);
  sm.end('a');
  timers.advance(90);
  assert.equal(sm.state, 'analyzing', 'segura o estado pelo minHold');
  timers.advance(400);
  assert.equal(sm.state, 'idle');
  sm.begin('a', 'analyzing');
  timers.advance(90);
  sm.react('error');
  timers.advance(90);
  assert.equal(sm.state, 'error', 'erro tem prioridade maior e aparece logo');
});

test('reação transitória volta ao estado sustentado', () => {
  const { sm, timers } = make();
  sm.begin('scan', 'analyzing');
  timers.advance(100);
  sm.react('found');
  timers.advance(100);
  assert.equal(sm.state, 'found');
  timers.advance(1000);
  assert.equal(sm.state, 'analyzing');
});

test('reação de menor prioridade não interrompe reação maior ativa', () => {
  const { sm, timers } = make();
  sm.react('error');
  timers.advance(100);
  assert.equal(sm.react('found'), false);
  assert.throws(() => sm.react('dançar'));
});
