import { resolveSpring, springAt, springCoefficients, settleTime } from '../physics/spring.js';

/** Trilha de mola analítica: valor e velocidade exatos em qualquer instante. */
export function createTrack({ from, to, velocity = 0, spring = 'responsive', rest = 0.01, now, delay = 0 }) {
  const resolved = resolveSpring(spring);
  const coef = springCoefficients(resolved);
  const duration = settleTime(from - to, velocity, coef, rest, rest * 20);
  return { from, to, v0: velocity, coef, spring: resolved, start: now + delay, duration, rest };
}

export function sampleTrack(track, now) {
  const t = (now - track.start) / 1000;
  if (t >= track.duration) return { value: track.to, velocity: 0, done: true };
  if (t <= 0) return { value: track.from, velocity: t < 0 ? 0 : track.v0, done: false };
  const { d, v } = springAt(track.from - track.to, track.v0, track.coef, t);
  return { value: track.to + d, velocity: v, done: false };
}

export function trackEnd(track) {
  return track.start + track.duration * 1000;
}
