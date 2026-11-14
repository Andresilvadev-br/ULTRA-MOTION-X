import { Emitter } from '../core/emitter.js';
import { FrameStats } from '../core/frame-stats.js';

export const TIERS = ['ultra', 'balanced', 'performance'];

/**
 * Pontuação inicial a partir de indicadores confiáveis do hardware:
 * núcleos, memória, GPU (nome informado pelo sistema ou pelo WebGL) e
 * renderização por software. Devolve 'ultra' | 'balanced' | 'performance'.
 */
export function hardwareTier({ cores = 4, memoryGB = 4, gpu = '', software = false } = {}) {
  if (software) return 'performance';
  const dedicated = /RTX|GTX|Radeon\s*RX|\bRX\s?\d{3,4}|Arc\s*A\d|Quadro|Titan/i.test(gpu);
  let score = 0;
  score += cores >= 8 ? 2 : cores >= 6 ? 1 : cores <= 2 ? -2 : 0;
  score += memoryGB >= 8 ? 1 : memoryGB <= 2 ? -2 : memoryGB < 4 ? -1 : 0;
  score += dedicated ? 2 : /Intel.*(HD|UHD) Graphics\s*[2-5]\d{2}\b|GMA|Basic Render/i.test(gpu) ? -1 : 0;
  return score >= 3 ? 'ultra' : score >= 0 ? 'balanced' : 'performance';
}

/** Nome da GPU via WebGL (contexto temporário, descartado em seguida). */
export function probeGpu(doc = globalThis.document) {
  try {
    const c = doc.createElement('canvas');
    const gl = c.getContext('webgl', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { gpu: '', software: true };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { gpu, software: /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu) };
  } catch {
    return { gpu: '', software: false };
  }
}

/**
 * PerformanceGovernor — escolhe Ultra / Balanced / Performance(Efficiency) sozinho:
 *  • começa pelo hardware (hardwareTier);
 *  • enquanto há animação, mede o ritmo real de quadros em janelas de ~1,5 s;
 *  • 3 janelas seguidas ruins → desce um nível; 8 boas → sobe um (sem passar do teto
 *    do hardware), com intervalo mínimo entre trocas para não oscilar.
 * Só decide no modo automático; a escolha manual do usuário nunca é alterada.
 */
export class PerformanceGovernor extends Emitter {
  constructor({ scheduler, ceiling = 'ultra', window = 90, cooldownMs = 20000, now = () => globalThis.performance.now() } = {}) {
    super();
    Object.assign(this, { scheduler, window, cooldownMs, now });
    this.ceiling = TIERS.includes(ceiling) ? ceiling : 'ultra';
    this.tier = this.ceiling;
    this.stats = new FrameStats(window);
    this._bad = 0; this._good = 0; this._lastChange = -Infinity;
    // intervalo do monitor: o menor ritmo estável já visto (uma janela lenta não pode "virar" o normal)
    this.baseInterval = 1000 / 60;
    this._baseSeen = false;
    this.history = [];
    this._off = scheduler?.onFrame((t, dt, interval) => this.sample(interval));
  }

  setCeiling(tier) {
    this.ceiling = TIERS.includes(tier) ? tier : this.ceiling;
    if (TIERS.indexOf(this.tier) < TIERS.indexOf(this.ceiling)) this._set(this.ceiling, 'hardware');
  }

  sample(interval) {
    if (interval == null) return;
    this.stats.push(interval);
    if (this.stats.count < this.window) return;
    const s = this.stats.summary();
    const p25 = this.stats.percentile(25);
    if (!this._baseSeen || (p25 > 0 && p25 < this.baseInterval)) { if (p25 > 0 && p25 <= 1000 / 30) { this.baseInterval = this._baseSeen ? Math.min(this.baseInterval, p25) : p25; this._baseSeen = true; } }
    const budget = this.baseInterval;
    const sorted = this.stats.sorted();
    const over = sorted.filter(v => v > budget * 1.5).length;
    this.stats.reset();
    const janky = s.p95 > budget * 2.2 || over > sorted.length * 0.25;
    if (janky) { this._bad++; this._good = 0; } else { this._good++; this._bad = 0; }
    const i = TIERS.indexOf(this.tier);
    if (this.now() - this._lastChange < this.cooldownMs) return;
    if (this._bad >= 3 && i < TIERS.length - 1) this._set(TIERS[i + 1], 'jank', s);
    else if (this._good >= 8 && i > TIERS.indexOf(this.ceiling)) this._set(TIERS[i - 1], 'recovered', s);
  }

  _set(tier, reason, stats) {
    if (tier === this.tier) return;
    const from = this.tier;
    this.tier = tier;
    this._bad = this._good = 0;
    this._lastChange = this.now();
    this.history.push({ from, to: tier, reason, at: Math.round(this._lastChange) });
    if (this.history.length > 20) this.history.shift();
    this.emit('tier', { from, to: tier, reason, stats });
  }

  destroy() { this._off?.(); this.removeAllListeners(); }
}
