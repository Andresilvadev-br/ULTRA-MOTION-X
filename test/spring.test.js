import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpring, springAt, springCoefficients, settleTime, sampleSpring, SPRINGS } from '../src/physics/spring.js';
import { VelocityTracker, rubberband, projectDecay } from '../src/physics/inertia.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

for (const [name, preset] of Object.entries(SPRINGS)) {
  test(`mola ${name}: estado inicial, convergência e derivada analítica`, () => {
    const coef = springCoefficients(preset);
    const s0 = springAt(100, 50, coef, 0);
    close(s0.d, 100); close(s0.v, 50);
    const end = springAt(100, 50, coef, 6);
    assert.ok(Math.abs(end.d) < 0.01, `não convergiu: ${end.d}`);
    // v é a derivada de d
    const t = 0.11, h = 1e-6;
    const num = (springAt(100, 50, coef, t + h).d - springAt(100, 50, coef, t - h).d) / (2 * h);
    close(springAt(100, 50, coef, t).v, num, 1e-3);
  });
}

test('independente do frame rate: 60 Hz e 240 Hz chegam ao mesmo estado', () => {
  const coef = springCoefficients('expressive');
  const run = (hz) => {
    let d = 80, v = -300;
    for (let i = 0; i < hz * 0.5; i++) ({ d, v } = springAt(d, v, coef, 1 / hz));
    return { d, v };
  };
  const a = run(60), b = run(240), exact = springAt(80, -300, coef, 0.5);
  close(a.d, exact.d, 1e-6); close(b.d, exact.d, 1e-6);
  close(a.v, exact.v, 1e-5); close(b.v, exact.v, 1e-5);
});

test('amortecimento crítico e superamortecido não ultrapassam o alvo', () => {
  for (const damping of [1, 1.6]) {
    const coef = springCoefficients({ response: 0.3, damping });
    for (let t = 0; t < 2; t += 0.01) assert.ok(springAt(100, 0, coef, t).d >= -1e-9);
  }
});

test('settleTime é finito e coerente', () => {
  const coef = springCoefficients('snappy');
  const t = settleTime(100, 0, coef, 0.05);
  assert.ok(t > 0.1 && t < 2, `t=${t}`);
  const after = springAt(100, 0, coef, t);
  assert.ok(Math.abs(after.d) < 0.05);
  assert.equal(settleTime(0, 0, coef), 0);
});

test('sampleSpring termina exatamente no alvo', () => {
  const { values } = sampleSpring(0, 1, 0, springCoefficients('gentle'));
  assert.equal(values[0], 0);
  assert.equal(values[values.length - 1], 1);
});

test('resolveSpring aceita preset, response/damping e stiffness/damping/mass', () => {
  assert.deepEqual(resolveSpring('critical'), { response: 0.3, damping: 1, mass: 1 });
  const s = resolveSpring({ stiffness: 400, damping: 40, mass: 1 });
  close(s.damping, 1, 1e-9);
  assert.throws(() => resolveSpring('inexistente'));
});

test('VelocityTracker estima velocidade linear', () => {
  const vt = new VelocityTracker();
  for (let i = 0; i <= 10; i++) vt.add(i * 8, i * 8 * 0.5, 0); // 0.5 px/ms = 500 px/s
  close(vt.velocity().x, 500, 1e-6);
});

test('rubberband amortece e preserva sinal; projectDecay avança na direção da velocidade', () => {
  assert.ok(rubberband(100) < 100 && rubberband(100) > 0);
  assert.ok(rubberband(-100) < 0);
  assert.ok(projectDecay(0, 1000) > 0);
});
