import { SPRINGS, sampleSpring, settleTime, springCoefficients } from '../physics/spring.js';

/**
 * Motion DNA — a identidade de movimento como tokens: cada intenção (tocar,
 * alternar, superfície, página...) aponta para uma mola. writeDNA() publica
 * essas molas como variáveis CSS (--umx-ease-<nome> em linear() e
 * --umx-dur-<nome>), para que transições CSS e o motor JS se movam igual.
 */
export const MOTION_DNA = Object.freeze({
  tap: 'snappy', toggle: 'responsive', surface: 'gentle', page: 'page',
  character: 'expressive', island: 'capsule', alert: 'wobble', calm: 'critical',
});

export function springEasing(spec, steps = 40) {
  const coef = springCoefficients(spec);
  const T = Math.max(0.12, settleTime(-1, 0, coef, 0.001, 0.01, 3));
  const { values } = sampleSpring(0, 1, 0, coef, { fps: 120, duration: T });
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(values[Math.round((i / steps) * (values.length - 1))].toFixed(4));
  return { css: `linear(${pts.join(', ')})`, ms: Math.round(T * 1000) };
}

export function dnaTokens(dna = MOTION_DNA, springs = SPRINGS) {
  const out = {};
  for (const [name, preset] of Object.entries(dna)) {
    const { css, ms } = springEasing(springs[preset] ?? preset);
    out[`--umx-ease-${name}`] = css;
    out[`--umx-dur-${name}`] = `${ms}ms`;
  }
  return out;
}

export function writeDNA(root, dna = MOTION_DNA) {
  const tokens = dnaTokens(dna);
  if (root?.style) for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  return tokens;
}
