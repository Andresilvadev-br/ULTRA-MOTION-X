import assert from "node:assert/strict";
import { test } from "node:test";
import { createEngine, ManualDriver } from "@ultra-motion-x/web";
import { CHANNEL_DISPLAY_CHANGED, CHANNEL_REFRESH, motionWindowOptions, registerDisplayBridge } from "../src/index.ts";
import { connectDisplay } from "../src/renderer.ts";

test("display bridge reports the window's monitor and notifies on change", async () => {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const sent: unknown[][] = [];
  let hz = 144;
  const screenListeners: Array<() => void> = [];
  const winListeners: Record<string, () => void> = {};
  const display = () => ({ id: 1, displayFrequency: hz, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } });
  const dispose = registerDisplayBridge(
    {
      ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
      screen: {
        getDisplayMatching: display,
        getPrimaryDisplay: display,
        on: (_e, cb) => screenListeners.push(cb as () => void),
        removeListener: () => undefined,
      },
    },
    {
      getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }),
      on: (e, cb) => (winListeners[e] = cb),
      webContents: { send: (...a) => sent.push(a) },
      isDestroyed: () => false,
    },
  );
  assert.equal(handlers.get(CHANNEL_REFRESH)?.(), 144);
  hz = 60;
  winListeners.moved?.();
  assert.deepEqual(sent, [[CHANNEL_DISPLAY_CHANGED, 60]]);
  dispose();
  assert.equal(handlers.size, 0);
  assert.equal(motionWindowOptions({ animateInBackground: true }).webPreferences.backgroundThrottling, false);
});

test("renderer seeds the engine refresh estimate", async () => {
  const engine = createEngine({ driver: new ManualDriver(), powerAware: false });
  let change: (hz: number) => void = () => undefined;
  await connectDisplay(engine, { refreshRate: async () => 165, onChange: (cb) => ((change = cb), () => undefined) });
  assert.equal(engine.refresh.hz, 165);
  change(240);
  assert.equal(engine.refresh.hz, 240);
});
