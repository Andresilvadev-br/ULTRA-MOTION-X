// Inércia (decay) e rastreamento de velocidade do ponteiro.

/** Posição final projetada de um arremesso com decaimento exponencial. */
export function projectDecay(x0, v0, timeConstant = 0.325) {
  return x0 + v0 * timeConstant;
}

/** Posição/velocidade de um decaimento exponencial no instante t (s). */
export function decayAt(x0, v0, t, timeConstant = 0.325) {
  const e = Math.exp(-t / timeConstant);
  return { x: x0 + v0 * timeConstant * (1 - e), v: v0 * e };
}

/** Resistência elástica ao passar dos limites (estilo iOS). */
export function rubberband(overshoot, dimension = 300, constant = 0.55) {
  if (overshoot === 0) return 0;
  const sign = Math.sign(overshoot);
  const abs = Math.abs(overshoot);
  return sign * (1 - 1 / ((abs * constant) / dimension + 1)) * dimension;
}

/**
 * Velocidade por mínimos quadrados sobre a janela recente (px/s).
 * Robusto a eventos de ponteiro irregulares (WebView2 entrega em lotes).
 */
export class VelocityTracker {
  constructor(windowMs = 100, max = 20) {
    this.windowMs = windowMs;
    this.max = max;
    this.samples = [];
  }

  reset() { this.samples.length = 0; }

  add(time, x, y = 0) {
    this.samples.push({ t: time, x, y });
    if (this.samples.length > this.max) this.samples.shift();
  }

  velocity(now = this.samples[this.samples.length - 1]?.t ?? 0) {
    const recent = this.samples.filter((s) => now - s.t <= this.windowMs);
    if (recent.length < 2) return { x: 0, y: 0 };
    const t0 = recent[0].t;
    let st = 0, sx = 0, sy = 0, stt = 0, stx = 0, sty = 0;
    for (const s of recent) {
      const t = (s.t - t0) / 1000;
      st += t; sx += s.x; sy += s.y; stt += t * t; stx += t * s.x; sty += t * s.y;
    }
    const n = recent.length;
    const den = n * stt - st * st;
    if (Math.abs(den) < 1e-9) return { x: 0, y: 0 };
    return { x: (n * stx - st * sx) / den, y: (n * sty - st * sy) / den };
  }
}
