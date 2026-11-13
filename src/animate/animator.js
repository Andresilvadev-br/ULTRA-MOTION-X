import { channelDef, COMPOSITOR_GROUPS, formatGroup, groupChannels } from './channels.js';
import { createTrack, sampleTrack, trackEnd } from './track.js';
import { reportError } from '../core/env.js';

const CSS_PROP = { translate: 'translate', scale: 'scale', rotate: 'rotate', opacity: 'opacity' };

/** Resultado de uma chamada animate(): finished resolve true (repousou) ou false (interrompida). */
export class MotionHandle {
  constructor(animator, el) {
    this._animator = animator;
    this._el = el;
    this._pending = new Set();
    this._ok = true;
    this.finished = new Promise((resolve) => { this._resolve = resolve; });
  }

  get active() { return this._pending.size > 0; }

  /** Para onde estiver (sem salto) — o valor visual atual vira o novo repouso. */
  cancel() { if (this.active) this._animator.stop(this._el, [...this._pending]); }

  _add(channel) { this._pending.add(channel); }

  _settle(channel, ok) {
    if (!this._pending.delete(channel)) return;
    if (!ok) this._ok = false;
    if (this._pending.size === 0) this._resolve(this._ok);
  }

  _done() { if (this._pending.size === 0) this._resolve(this._ok); }
}

/**
 * Animator — aplica molas a elementos DOM com dois drivers:
 *  • compositor: a trajetória da mola é "assada" em keyframes Web Animations
 *    (roda na GPU/compositor, imune a travadas da thread principal);
 *  • frame: escrita por frame via MotionScheduler (gestos, variáveis CSS).
 * Os dois compartilham o mesmo modelo analítico; por isso qualquer animação
 * pode ser interrompida, invertida ou trocar de driver sem salto visual.
 */
export class Animator {
  constructor({ scheduler, budget = null, compositor = true } = {}) {
    this.scheduler = scheduler;
    this.budget = budget;
    this.compositor = compositor;
    this._states = new WeakMap();
    this._frameEls = new Set();
    this._taskActive = false;
    this._task = {
      update: (dt, now) => this._update(now),
      render: (now) => this._render(now),
    };
  }

  _state(el) {
    let st = this._states.get(el);
    if (!st) {
      st = { base: {}, tracks: new Map(), groups: new Map(), units: {}, locks: new Map(), frameDirty: new Set() };
      this._states.set(el, st);
    }
    return st;
  }

  /** Valor atual (visual) de um canal. */
  value(el, channel, now = this.scheduler.now()) {
    const st = this._states.get(el);
    const def = channelDef(channel, st?.units);
    if (!st) return def.initial;
    const track = st.tracks.get(channel);
    if (track) return sampleTrack(track.data, now).value;
    return st.base[channel] ?? def.initial;
  }

  velocity(el, channel, now = this.scheduler.now()) {
    const track = this._states.get(el)?.tracks.get(channel);
    return track ? sampleTrack(track.data, now).velocity : 0;
  }

  isAnimating(el) { return (this._states.get(el)?.tracks.size ?? 0) > 0; }

  /**
   * animate(el, { x: 10, opacity: 1 }, {
   *   spring: 'snappy' | {response, damping},
   *   from: { x: 0 }, velocity: { x: 300 }, delay: ms,
   *   driver: 'auto' | 'frame' | 'compositor', decorative: boolean, units: { '--v': 'px' }
   * })
   */
  animate(el, props, opts = {}) {
    const handle = new MotionHandle(this, el);
    if (!el || !props) { handle._done(); return handle; }
    const keys = Object.keys(props);
    if (!keys.length) { handle._done(); return handle; }

    const st = this._state(el);
    if (opts.units) Object.assign(st.units, opts.units);

    if (opts.decorative && this.budget && !this.budget.allowDecor()) {
      this.set(el, props);
      handle._done();
      return handle;
    }

    const now = this.scheduler.now();
    const spring = this.budget ? this.budget.adjustSpring(opts.spring ?? 'responsive') : (opts.spring ?? 'responsive');
    const groups = new Set();

    for (const key of keys) {
      const def = channelDef(key, st.units);
      const target = Number(props[key]);
      if (!Number.isFinite(target)) throw new Error(`Valor inválido para ${key}: ${props[key]}`);
      const hasFrom = opts.from && key in opts.from;
      const from = hasFrom ? Number(opts.from[key]) : this.value(el, key, now);
      const velocity = opts.velocity && key in opts.velocity
        ? Number(opts.velocity[key])
        : hasFrom ? 0 : this.velocity(el, key, now);

      const previous = st.tracks.get(key);
      if (previous) previous.handle._settle(key, false);

      this._stealLock(st, def.group);
      const data = createTrack({ from, to: target, velocity, spring, rest: def.rest, now, delay: opts.delay ?? 0 });
      st.tracks.set(key, { data, handle, forceFrame: opts.driver === 'frame' || !!def.custom });
      handle._add(key);
      groups.add(def.group);
    }

    for (const group of groups) this._drive(el, st, group, now, opts.driver);
    return handle;
  }

  /** Define valores instantaneamente (gestos, perfil Performance). */
  set(el, values) {
    if (!el) return;
    const st = this._state(el);
    const now = this.scheduler.now();
    const groups = new Set();
    for (const [key, raw] of Object.entries(values)) {
      const def = channelDef(key, st.units);
      const track = st.tracks.get(key);
      if (track) { st.tracks.delete(key); track.handle._settle(key, false); }
      this._stealLock(st, def.group);
      st.base[key] = Number(raw);
      groups.add(def.group);
    }
    for (const group of groups) this._regroup(el, st, group, now);
  }

  /** Congela canais no valor visual atual. */
  stop(el, channels) {
    const st = this._states.get(el);
    if (!st) return;
    const now = this.scheduler.now();
    const list = channels ?? [...st.tracks.keys()];
    const groups = new Set();
    for (const key of list) {
      const track = st.tracks.get(key);
      if (!track) continue;
      st.base[key] = sampleTrack(track.data, now).value;
      st.tracks.delete(key);
      track.handle._settle(key, false);
      groups.add(channelDef(key, st.units).group);
    }
    for (const group of groups) this._regroup(el, st, group, now);
  }

  /** Libera tudo de um elemento (descarte de tela). */
  release(el) {
    this.stop(el);
    const st = this._states.get(el);
    if (!st) return;
    for (const record of st.groups.values()) record.anim?.cancel();
    st.groups.clear();
    this._frameEls.delete(el);
  }

  /**
   * Trava de propriedade: evita dois motores (ex.: GSAP e o Animator)
   * controlando o mesmo grupo. Quem anima por último vence; o anterior é avisado.
   */
  claim(el, group, owner, onSteal) {
    const st = this._state(el);
    const current = st.locks.get(group);
    if (current && current.owner !== owner) current.onSteal?.();
    // O Animator cede: congela suas trilhas desse grupo.
    const own = groupChannels(group).filter((c) => st.tracks.has(c));
    if (own.length) this.stop(el, own);
    st.locks.set(group, { owner, onSteal });
  }

  unclaim(el, group, owner) {
    const st = this._states.get(el);
    if (st?.locks.get(group)?.owner === owner) st.locks.delete(group);
  }

  _stealLock(st, group) {
    const lock = st.locks.get(group);
    if (!lock) return;
    st.locks.delete(group);
    try { lock.onSteal?.(); } catch (err) { reportError(err, 'lock steal'); }
  }

  _groupTracks(st, group) {
    const out = [];
    for (const ch of groupChannels(group)) {
      const t = st.tracks.get(ch);
      if (t) out.push([ch, t]);
    }
    return out;
  }

  _getter(st, now) {
    return (ch) => {
      const t = st.tracks.get(ch);
      if (t) return sampleTrack(t.data, now).value;
      return st.base[ch] ?? channelDef(ch, st.units).initial;
    };
  }

  _targetGetter(st) {
    return (ch) => {
      const t = st.tracks.get(ch);
      if (t) return t.data.to;
      return st.base[ch] ?? channelDef(ch, st.units).initial;
    };
  }

  _canComposite(el, st, group, driver) {
    if (driver === 'frame' || !COMPOSITOR_GROUPS.has(group)) return false;
    if (!this.compositor || typeof el.animate !== 'function') return false;
    if (this.budget && this.budget.profile.compositor === false && driver !== 'compositor') return false;
    for (const [, t] of this._groupTracks(st, group)) if (t.forceFrame) return false;
    return true;
  }

  _drive(el, st, group, now, driver) {
    if (this._canComposite(el, st, group, driver)) this._bake(el, st, group, now);
    else this._toFrame(el, st, group, now);
  }

  /** Recalcula um grupo depois de set/stop. */
  _regroup(el, st, group, now) {
    const record = st.groups.get(group);
    const tracks = this._groupTracks(st, group);
    if (!tracks.length) {
      this._writeGroup(el, st, group, now);
      record?.anim?.cancel();
      st.groups.delete(group);
      st.frameDirty.delete(group);
      return;
    }
    if (record?.driver === 'compositor') this._bake(el, st, group, now);
    else this._writeGroup(el, st, group, now);
  }

  _writeGroup(el, st, group, now) {
    const prop = CSS_PROP[group] ?? group;
    const text = formatGroup(group, this._getter(st, now), st.units[group]);
    if (el.style?.setProperty) el.style.setProperty(prop, text);
  }

  _bake(el, st, group, now) {
    const tracks = this._groupTracks(st, group);
    let end = now;
    for (const [, t] of tracks) end = Math.max(end, trackEnd(t.data));
    const duration = end - now;
    const prop = CSS_PROP[group];
    const previous = st.groups.get(group);

    if (duration <= 1) {
      previous?.anim?.cancel();
      st.groups.delete(group);
      this._finalizeGroup(el, st, group, end + 1);
      return;
    }

    const fps = this.budget?.profile.bakeFps ?? 90;
    const frames = Math.max(2, Math.min(180, Math.ceil((duration / 1000) * fps) + 1));
    const keyframes = new Array(frames);
    for (let i = 0; i < frames; i++) {
      const t = now + (i / (frames - 1)) * duration;
      keyframes[i] = { [prop]: formatGroup(group, this._getter(st, t)) };
    }

    // Valor final fica no estilo inline: se a animação for cancelada ou
    // terminar, não há "piscada" de volta ao estado anterior.
    el.style.setProperty(prop, formatGroup(group, this._targetGetter(st)));
    previous?.anim?.cancel();
    this._frameEls.has(el) && st.frameDirty.delete(group);

    let anim;
    try {
      anim = el.animate(keyframes, { duration, easing: 'linear', fill: 'none' });
    } catch (err) {
      reportError(err, 'compositor bake');
      this._toFrame(el, st, group, now);
      return;
    }
    const record = { driver: 'compositor', anim };
    st.groups.set(group, record);
    anim.onfinish = () => {
      if (st.groups.get(group) !== record) return;
      st.groups.delete(group);
      this._finalizeGroup(el, st, group, this.scheduler.now() + 1e6);
    };
  }

  _toFrame(el, st, group, now) {
    const record = st.groups.get(group);
    if (record?.driver === 'compositor') {
      // Troca de driver sem salto: escreve o valor atual antes de cancelar.
      this._writeGroup(el, st, group, now);
      record.anim.cancel();
    }
    st.groups.set(group, { driver: 'frame' });
    st.frameDirty.add(group);
    this._frameEls.add(el);
    if (!this._taskActive) {
      this._taskActive = true;
      this.scheduler.add(this._task);
    }
  }

  _finalizeGroup(el, st, group, now) {
    for (const [ch, t] of this._groupTracks(st, group)) {
      if (now >= trackEnd(t.data)) {
        st.base[ch] = t.data.to;
        st.tracks.delete(ch);
        t.handle._settle(ch, true);
      }
    }
  }

  _update() {
    if (this._frameEls.size === 0) { this._taskActive = false; return false; }
    return true;
  }

  _render(now) {
    for (const el of [...this._frameEls]) {
      const st = this._states.get(el);
      if (!st) { this._frameEls.delete(el); continue; }
      for (const group of [...st.frameDirty]) {
        this._writeGroup(el, st, group, now);
        this._finalizeGroup(el, st, group, now);
        if (!this._groupTracks(st, group).length) {
          st.frameDirty.delete(group);
          if (st.groups.get(group)?.driver === 'frame') st.groups.delete(group);
        }
      }
      if (st.frameDirty.size === 0) this._frameEls.delete(el);
    }
  }
}
