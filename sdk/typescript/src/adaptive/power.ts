/**
 * Thermal & power awareness. Only platform-reported signals are used; when an API is not
 * available the signal stays `undefined` and imposes no restriction. Temperatures and
 * power draw are never fabricated — browsers do not expose them.
 */
import type { FidelityLevel } from "../core/fidelity.ts";

export type Pressure = "nominal" | "fair" | "serious" | "critical";

export interface PowerSignals {
  visible?: boolean;
  focused?: boolean;
  batteryLevel?: number;
  charging?: boolean;
  saveData?: boolean;
  pressure?: Pressure;
}

export interface PowerPolicy {
  suspend: boolean;
  pauseDecorative: boolean;
  maxFidelity: FidelityLevel;
  decorativeHz: number | null;
  reasons: string[];
}

export function powerPolicy(s: PowerSignals): PowerPolicy {
  const p: PowerPolicy = { suspend: false, pauseDecorative: false, maxFidelity: 4, decorativeHz: null, reasons: [] };
  if (s.visible === false) {
    p.suspend = true;
    p.pauseDecorative = true;
    p.reasons.push("not visible");
  }
  const lowBattery = s.batteryLevel !== undefined && s.charging === false && s.batteryLevel < 0.2;
  if (s.saveData === true || lowBattery) {
    p.maxFidelity = 2;
    p.decorativeHz = 30;
    p.reasons.push(lowBattery ? "low battery" : "data saver");
  }
  if (s.pressure === "serious") {
    p.maxFidelity = Math.min(p.maxFidelity, 1) as FidelityLevel;
    p.decorativeHz = 30;
    p.reasons.push("serious compute pressure");
  } else if (s.pressure === "critical") {
    p.maxFidelity = 0;
    p.pauseDecorative = true;
    p.reasons.push("critical compute pressure");
  }
  return p;
}

type BatteryLike = EventTarget & { level: number; charging: boolean };

/** Observes the signals the current platform actually provides. */
export class PowerMonitor {
  signals: PowerSignals = {};
  private listeners = new Set<(p: PowerPolicy) => void>();
  private cleanups: Array<() => void> = [];

  start(): void {
    if (typeof document !== "undefined") {
      const vis = () => this.update({ visible: document.visibilityState !== "hidden" });
      document.addEventListener("visibilitychange", vis);
      this.cleanups.push(() => document.removeEventListener("visibilitychange", vis));
      vis();
    }
    const nav = (typeof navigator !== "undefined" ? navigator : undefined) as
      | (Navigator & { getBattery?: () => Promise<BatteryLike>; connection?: { saveData?: boolean } })
      | undefined;
    if (nav?.connection && typeof nav.connection.saveData === "boolean")
      this.update({ saveData: nav.connection.saveData });
    if (nav?.getBattery) {
      nav
        .getBattery()
        .then((b) => {
          const upd = () => this.update({ batteryLevel: b.level, charging: b.charging });
          b.addEventListener("levelchange", upd);
          b.addEventListener("chargingchange", upd);
          this.cleanups.push(() => {
            b.removeEventListener("levelchange", upd);
            b.removeEventListener("chargingchange", upd);
          });
          upd();
        })
        .catch(() => undefined);
    }
    const PO = (
      globalThis as unknown as {
        PressureObserver?: new (
          cb: (r: Array<{ state: Pressure }>) => void,
        ) => { observe(s: string): Promise<void>; disconnect(): void };
      }
    ).PressureObserver;
    if (PO) {
      try {
        const obs = new PO((records) => {
          const last = records[records.length - 1];
          if (last) this.update({ pressure: last.state });
        });
        obs.observe("cpu").catch(() => undefined);
        this.cleanups.push(() => obs.disconnect());
      } catch {
        /* Compute Pressure API present but unusable (permissions policy) — ignore. */
      }
    }
  }

  update(partial: PowerSignals): void {
    this.signals = { ...this.signals, ...partial };
    const p = this.policy;
    for (const l of this.listeners) l(p);
  }

  get policy(): PowerPolicy {
    return powerPolicy(this.signals);
  }

  onChange(cb: (p: PowerPolicy) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  stop(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.listeners.clear();
  }
}
