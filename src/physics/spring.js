// SpringDynamics — física de mola com solução analítica exata.
//
// Em vez de integrar numericamente (instável com dt grande ou monitores de
// alta taxa), calculamos a posição e a velocidade da mola amortecida em
// qualquer instante t. Isso permite:
//   • mesma trajetória em 60, 144 ou 240 Hz (independente do frame rate);
//   • interromper/inverter a qualquer momento preservando posição e velocidade;
//   • "assar" a trajetória em keyframes executados no compositor (GPU).

/**
 * Perfis físicos por intenção (Plano 5.0 §6.2). response = período natural
 * em segundos (quanto menor, mais rápido); damping = razão de amortecimento
 * (1 = sem overshoot, < 1 = com balanço).
 */
export const SPRINGS = Object.freeze({
  snappy: { response: 0.2, damping: 0.78 },      // clique, botões
  responsive: { response: 0.28, damping: 0.86 }, // alternâncias, abas
  gentle: { response: 0.42, damping: 0.92 },     // cartões, listas
  expressive: { response: 0.55, damping: 0.6 },  // personagem (Chico)
  critical: { response: 0.3, damping: 1 },       // estados críticos, sem oscilar
  page: { response: 0.38, damping: 0.95 },       // navegação / morphing de tela
  capsule: { response: 0.34, damping: 0.8 },     // Dynamic Island
  wobble: { response: 0.26, damping: 0.32 },     // sacudida de erro
});

/** Normaliza nome de perfil, {response, damping} ou {stiffness, damping, mass}. */
export function resolveSpring(spec = 'responsive') {
  if (typeof spec === 'string') {
    const preset = SPRINGS[spec];
    if (!preset) throw new Error(`Perfil de mola desconhecido: ${spec}`);
    return { response: preset.response, damping: preset.damping, mass: 1 };
  }
  if (spec && typeof spec.stiffness === 'number') {
    const mass = spec.mass ?? 1;
    const w0 = Math.sqrt(spec.stiffness / mass);
    const c = spec.damping ?? 10;
    return { response: (2 * Math.PI) / w0, damping: c / (2 * Math.sqrt(spec.stiffness * mass)), mass };
  }
  const response = Math.max(0.02, spec?.response ?? 0.28);
  const damping = Math.max(0.01, spec?.damping ?? 0.86);
  return { response, damping, mass: spec?.mass ?? 1 };
}

export function springCoefficients(spec) {
  const { response, damping } = resolveSpring(spec);
  const w0 = (2 * Math.PI) / response;
  return { w0, zeta: damping };
}

/**
 * Estado da mola após t segundos.
 * d0 = deslocamento inicial em relação ao alvo, v0 = velocidade inicial.
 * Devolve { d, v } (deslocamento e velocidade no instante t).
 */
export function springAt(d0, v0, coef, t) {
  if (t <= 0) return { d: d0, v: v0 };
  const { w0, zeta } = coef;
  if (Math.abs(zeta - 1) < 1e-4) {
    const e = Math.exp(-w0 * t);
    const b = v0 + w0 * d0;
    return { d: e * (d0 + b * t), v: e * (b - w0 * (d0 + b * t)) };
  }
  if (zeta < 1) {
    const a = zeta * w0;
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const B = (v0 + a * d0) / wd;
    const e = Math.exp(-a * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return {
      d: e * (d0 * cos + B * sin),
      v: e * ((-a * d0 + B * wd) * cos + (-a * B - d0 * wd) * sin),
    };
  }
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  const c2 = (v0 - r1 * d0) / (r2 - r1);
  const c1 = d0 - c2;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return { d: c1 * e1 + c2 * e2, v: r1 * c1 * e1 + r2 * c2 * e2 };
}

/**
 * Tempo até a mola repousar (|d| < restDelta e |v| < restSpeed), em segundos.
 * Busca em passos de 1/240 s com limite máximo.
 */
export function settleTime(d0, v0, coef, restDelta = 0.01, restSpeed = restDelta * 20, maxTime = 4) {
  if (Math.abs(d0) < restDelta && Math.abs(v0) < restSpeed) return 0;
  const step = 1 / 240;
  let lastMoving = 0;
  // Varre até maxTime lembrando do último instante fora do repouso, para
  // não confundir uma passagem pelo alvo (com balanço) com repouso.
  for (let t = step; t <= maxTime; t += step) {
    const { d, v } = springAt(d0, v0, coef, t);
    if (Math.abs(d) >= restDelta || Math.abs(v) >= restSpeed) lastMoving = t;
    else if (t - lastMoving > 0.12) return lastMoving + step;
  }
  return maxTime;
}

/** Amostra a trajetória para keyframes (usado pelo driver de compositor). */
export function sampleSpring(from, to, v0, coef, { fps = 90, duration } = {}) {
  const d0 = from - to;
  const total = duration ?? settleTime(d0, v0, coef);
  const frames = Math.max(2, Math.min(240, Math.ceil(total * fps) + 1));
  const values = new Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = (i / (frames - 1)) * total;
    values[i] = to + springAt(d0, v0, coef, t).d;
  }
  values[frames - 1] = to;
  return { values, duration: total };
}
