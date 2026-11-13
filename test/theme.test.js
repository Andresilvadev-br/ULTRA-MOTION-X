import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, ensureContrast, hexToOklab, oklabToHex, mix, parseHex } from '../src/theme/color.js';
import { themeTokens } from '../src/theme/theme-bridge.js';
import { PROFILES } from '../src/budget/profiles.js';

test('ida e volta sRGB ↔ OKLab', () => {
  for (const hex of ['#2f8cff', '#00c853', '#ff3b30', '#ffffff', '#000000', '#7a42f4']) {
    assert.equal(oklabToHex(hexToOklab(hex)), hex);
  }
});

test('contraste WCAG conhecido', () => {
  assert.ok(Math.abs(contrast('#ffffff', '#000000') - 21) < 1e-9);
  assert.equal(contrast('#777777', '#777777'), 1);
});

test('ensureContrast ajusta só a luminosidade até o mínimo', () => {
  const fixed = ensureContrast('#1a237e', '#11141b', 4.5);
  assert.ok(contrast(fixed, '#11141b') >= 4.5);
  const keep = ensureContrast('#ffd54f', '#11141b', 4.5);
  assert.equal(keep, '#ffd54f');
});

test('mix interpola extremos', () => {
  assert.equal(mix('#ff0000', '#0000ff', 0), '#ff0000');
  assert.equal(mix('#ff0000', '#0000ff', 1), '#0000ff');
});

test('tokens derivam da cor do usuário e respeitam o perfil', () => {
  const ultra = themeTokens('#2f8cff', { mode: 'dark', profile: PROFILES.ultra });
  const perf = themeTokens('#2f8cff', { mode: 'dark', profile: PROFILES.performance });
  assert.equal(ultra['--umx-accent'], '#2f8cff');
  assert.equal(ultra['--umx-accent-rgb'], '47 140 255');
  assert.ok(contrast(ultra['--umx-accent-text'], '#11141b') >= 4.5);
  assert.equal(perf['--umx-glow-size'], '0px');
  assert.ok(parseHex(ultra['--umx-rec']).r > 200, 'gravação continua vermelha');
  const light = themeTokens('#ffd54f', { mode: 'light' });
  assert.ok(contrast(light['--umx-accent-text'], '#f4f6fa') >= 4.5);
  assert.throws(() => themeTokens('azul'));
});
