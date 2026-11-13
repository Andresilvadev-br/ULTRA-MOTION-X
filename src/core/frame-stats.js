// Estatísticas de intervalos (frames, latência de entrada). Buffer circular
// de tamanho fixo: nenhuma alocação por frame.

const KNOWN_RATES = [60, 75, 90, 100, 120, 144, 165, 180, 200, 240, 280, 360];

export class SampleStats {
  constructor(size = 240) {
    this.size = size;
    this.buf = new Float64Array(size);
    this.count = 0;
    this.index = 0;
    this.total = 0;
  }

  push(value) {
    if (!Number.isFinite(value) || value < 0) return;
    this.buf[this.index] = value;
    this.index = (this.index + 1) % this.size;
    if (this.count < this.size) this.count++;
    this.total++;
  }

  sorted() {
    const out = Array.from(this.buf.subarray(0, this.count));
    return out.sort((a, b) => a - b);
  }

  percentile(p, sorted = this.sorted()) {
    if (!sorted.length) return 0;
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[rank];
  }

  reset() { this.count = 0; this.index = 0; }
}

export class FrameStats extends SampleStats {
  /**
   * Intervalo de refresh estimado em ms. Usa o percentil 25 (quadros perdidos
   * só aumentam intervalos) e aproxima a taxas comuns de monitores.
   */
  refreshInterval() {
    if (this.count < 8) return 1000 / 60;
    const p25 = this.percentile(25);
    if (p25 <= 0) return 1000 / 60;
    const hz = 1000 / p25;
    let best = KNOWN_RATES[0];
    for (const rate of KNOWN_RATES) if (Math.abs(rate - hz) < Math.abs(best - hz)) best = rate;
    // Só aproxima quando está perto; senão devolve a medida bruta.
    return Math.abs(best - hz) / best < 0.06 ? 1000 / best : p25;
  }

  summary() {
    const sorted = this.sorted();
    const interval = this.refreshInterval();
    let over = 0;
    for (const v of sorted) if (v > interval * 1.5) over++;
    return {
      samples: sorted.length,
      refreshHz: Math.round(1000 / interval),
      p50: round(this.percentile(50, sorted)),
      p95: round(this.percentile(95, sorted)),
      p99: round(this.percentile(99, sorted)),
      worst: round(sorted[sorted.length - 1] ?? 0),
      overBudget: over,
    };
  }
}

const round = (v) => Math.round(v * 100) / 100;
