/** Telemetry primitives (mirror of umx-telemetry). */

export type Provenance = "measured" | "estimated" | "unavailable";

export interface Metric {
  value: number;
  provenance: Provenance;
}

export const measured = (value: number): Metric => ({ value, provenance: "measured" });
export const estimated = (value: number): Metric => ({ value, provenance: "estimated" });
export const unavailable = (): Metric => ({ value: Number.NaN, provenance: "unavailable" });

export class Ring {
  private readonly data: Float64Array;
  private head = 0;
  private n = 0;
  constructor(capacity: number) {
    this.data = new Float64Array(Math.max(1, capacity));
  }
  push(v: number): void {
    if (!Number.isFinite(v)) return;
    this.data[this.head] = v;
    this.head = (this.head + 1) % this.data.length;
    this.n = Math.min(this.n + 1, this.data.length);
  }
  get length(): number {
    return this.n;
  }
  clear(): void {
    this.n = 0;
    this.head = 0;
  }
  values(): number[] {
    const cap = this.data.length;
    const start = (this.head + cap - this.n) % cap;
    const out = new Array<number>(this.n);
    for (let i = 0; i < this.n; i++) out[i] = this.data[(start + i) % cap]!;
    return out;
  }
  last(): number | undefined {
    return this.n ? this.data[(this.head + this.data.length - 1) % this.data.length] : undefined;
  }
}

export function percentile(values: readonly number[], q: number): number {
  const v = values
    .filter(Number.isFinite)
    .slice()
    .sort((a, b) => a - b);
  if (!v.length) return Number.NaN;
  const pos = Math.min(1, Math.max(0, q)) * (v.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

export interface Distribution {
  count: number;
  mean: number;
  min: number;
  max: number;
  stddev: number;
  p50: number;
  p95: number;
  p99: number;
}

export function distribution(values: readonly number[]): Distribution {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { count: 0, mean: 0, min: 0, max: 0, stddev: 0, p50: 0, p95: 0, p99: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length;
  return {
    count: v.length,
    mean,
    min: Math.min(...v),
    max: Math.max(...v),
    stddev: Math.sqrt(variance),
    p50: percentile(v, 0.5),
    p95: percentile(v, 0.95),
    p99: percentile(v, 0.99),
  };
}
