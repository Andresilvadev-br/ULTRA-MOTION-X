// Canais animáveis. Usamos as propriedades CSS individuais de transformação
// (translate/scale/rotate): compõem com o "transform" já usado pelo CSS do app
// em vez de sobrescrevê-lo, e são aceleradas pelo compositor no WebView2.

export const CHANNELS = Object.freeze({
  x: { group: 'translate', rest: 0.05, initial: 0 },
  y: { group: 'translate', rest: 0.05, initial: 0 },
  scale: { group: 'scale', rest: 0.0005, initial: 1 },
  scaleX: { group: 'scale', rest: 0.0005, initial: 1 },
  scaleY: { group: 'scale', rest: 0.0005, initial: 1 },
  rotate: { group: 'rotate', rest: 0.05, initial: 0 },
  opacity: { group: 'opacity', rest: 0.002, initial: 1 },
});

export const GROUP_CHANNELS = Object.freeze({
  translate: ['x', 'y'],
  scale: ['scale', 'scaleX', 'scaleY'],
  rotate: ['rotate'],
  opacity: ['opacity'],
});

/** Grupos que podem rodar no compositor (fora da thread principal). */
export const COMPOSITOR_GROUPS = new Set(['translate', 'scale', 'rotate', 'opacity']);

/** Definição de canal; nomes "--var" viram propriedades CSS numéricas. */
export function channelDef(name, units) {
  const def = CHANNELS[name];
  if (def) return def;
  if (name.startsWith('--')) {
    return { group: name, rest: 0.01, initial: 0, unit: units?.[name] ?? '', custom: true };
  }
  throw new Error(`Canal não animável: ${name} (use x, y, scale, scaleX, scaleY, rotate, opacity ou --variavel)`);
}

export function groupChannels(group) {
  return GROUP_CHANNELS[group] ?? [group];
}

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Converte valores de canais no texto da propriedade CSS do grupo. */
export function formatGroup(group, get, unit = '') {
  switch (group) {
    case 'translate': return `${r4(get('x'))}px ${r4(get('y'))}px`;
    case 'scale': {
      const s = get('scale');
      return `${r4(s * get('scaleX'))} ${r4(s * get('scaleY'))}`;
    }
    case 'rotate': return `${r4(get('rotate'))}deg`;
    case 'opacity': return String(r4(Math.min(1, Math.max(0, get('opacity')))));
    default: return `${r4(get(group))}${unit}`;
  }
}
