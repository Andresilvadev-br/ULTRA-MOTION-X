import test from 'node:test';
import assert from 'node:assert/strict';
import { hardwareTier, PerformanceGovernor } from '../src/budget/governor.js';

test('hardwareTier: indicadores do PC definem o teto inicial', () => {
  assert.equal(hardwareTier({ cores: 16, memoryGB: 32, gpu: 'NVIDIA GeForce RTX 4070' }), 'ultra');
  assert.equal(hardwareTier({ cores: 4, memoryGB: 8, gpu: 'Intel(R) UHD Graphics 620' }), 'balanced');
  assert.equal(hardwareTier({ cores: 2, memoryGB: 2, gpu: 'Intel(R) HD Graphics 4000' }), 'performance');
  assert.equal(hardwareTier({ cores: 32, memoryGB: 64, gpu: 'Google SwiftShader', software: true }), 'performance');
});

test('governor: desce com engasgo persistente, sobe ao recuperar, sem oscilar', () => {
  let t = 0;
  const g = new PerformanceGovernor({ window: 30, cooldownMs: 1000, now: () => t });
  const seen = [];
  g.on('tier', e => seen.push(`${e.from}->${e.to}:${e.reason}`));
  const feed = (ms, n) => { for (let i = 0; i < n; i++) { t += ms; g.sample(ms); } };
  feed(1000 / 60, 120); // bom: continua ultra
  assert.equal(g.tier, 'ultra');
  feed(50, 30 * 3); // 3 janelas ruins
  assert.equal(g.tier, 'balanced');
  feed(50, 30 * 3); // ainda em cooldown? t avançou 4,5 s > 1 s → desce de novo
  assert.equal(g.tier, 'performance');
  feed(1000 / 60, 30 * 8);
  assert.equal(g.tier, 'balanced');
  assert.deepEqual(seen, ['ultra->balanced:jank', 'balanced->performance:jank', 'performance->balanced:recovered']);
});

test('governor nunca sobe acima do teto do hardware', () => {
  let t = 0;
  const g = new PerformanceGovernor({ window: 30, cooldownMs: 0, now: () => t, ceiling: 'balanced' });
  for (let i = 0; i < 30 * 20; i++) { t += 16.7; g.sample(16.7); }
  assert.equal(g.tier, 'balanced');
});
