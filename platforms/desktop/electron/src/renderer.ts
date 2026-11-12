/**
 * Renderer-side bridge: seeds the engine's refresh estimator with the real display rate from
 * the main process (instead of waiting for frame-interval estimation) and follows monitor
 * changes. Without the preload bridge it does nothing.
 */
import type { Engine } from "@ultra-motion-x/web";

export interface UmxDisplayBridge {
  refreshRate(): Promise<number>;
  onChange(cb: (hz: number) => void): () => void;
}

export async function connectDisplay(
  engine: Engine,
  bridge: UmxDisplayBridge | undefined = (globalThis as { umxDisplay?: UmxDisplayBridge }).umxDisplay,
): Promise<() => void> {
  if (!bridge) return () => undefined;
  const apply = (hz: number) => {
    if (!(Number.isFinite(hz) && hz > 0)) return;
    engine.refresh.hint(hz);
    engine.telemetry.expectedInterval = 1000 / engine.refresh.hz;
  };
  apply(await bridge.refreshRate());
  return bridge.onChange(apply);
}
