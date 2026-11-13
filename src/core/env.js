// Ambiente e utilitários compartilhados. Nenhuma dependência externa.

export const hasDocument = typeof document !== 'undefined';
export const hasWindow = typeof window !== 'undefined';

/**
 * Relógio injetável (útil em testes): now(), raf(cb), caf(id).
 * No WebView2 usa requestAnimationFrame/performance.now; fora do navegador
 * cai para setTimeout, sem limitar a taxa a 60 Hz quando há rAF real.
 */
export function createClock({ now, raf, caf } = {}) {
  const perf = globalThis.performance;
  const nowFn = now ?? (() => perf.now());
  const rafFn = raf ?? (typeof globalThis.requestAnimationFrame === 'function'
    ? (cb) => globalThis.requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(nowFn()), 16));
  const cafFn = caf ?? (typeof globalThis.cancelAnimationFrame === 'function'
    ? (id) => globalThis.cancelAnimationFrame(id)
    : (id) => clearTimeout(id));
  return { now: nowFn, raf: rafFn, caf: cafFn };
}

/** Temporizadores injetáveis (setTimeout/clearTimeout/now). */
export function createTimers({ setTimeout: st, clearTimeout: ct, now } = {}) {
  return {
    setTimeout: st ?? ((fn, ms) => globalThis.setTimeout(fn, ms)),
    clearTimeout: ct ?? ((id) => globalThis.clearTimeout(id)),
    now: now ?? (() => globalThis.performance.now()),
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Lê um valor do armazenamento sem lançar (localStorage pode faltar). */
export function createLocalStorage(prefix = '') {
  return {
    get(key) {
      try { return globalThis.localStorage?.getItem(prefix + key) ?? null; } catch { return null; }
    },
    set(key, value) {
      try { globalThis.localStorage?.setItem(prefix + key, String(value)); } catch { /* sem armazenamento */ }
    },
  };
}

export function reportError(err, where) {
  // Falhas de animação nunca podem derrubar a interface.
  if (typeof console !== 'undefined') console.error(`[ULTRA MOTION X] ${where}:`, err);
}
