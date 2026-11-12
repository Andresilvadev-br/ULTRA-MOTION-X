/**
 * Main-process helpers. Electron is used through structural types so this package has no
 * hard dependency on a specific Electron version.
 *
 *   import { app, BrowserWindow, ipcMain, nativeTheme, screen } from "electron";
 *   import { registerDisplayBridge, motionWindowOptions } from "@ultra-motion-x/electron";
 *   const win = new BrowserWindow({ ...motionWindowOptions(), webPreferences: { preload } });
 *   registerDisplayBridge({ ipcMain, screen, nativeTheme }, win);
 */

export const CHANNEL_REFRESH = "umx:display-refresh-rate";
export const CHANNEL_DISPLAY_CHANGED = "umx:display-changed";

export interface DisplayLike {
  id: number;
  displayFrequency: number;
  scaleFactor: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ScreenLike {
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): DisplayLike;
  getPrimaryDisplay(): DisplayLike;
  on(event: "display-metrics-changed" | "display-added" | "display-removed", cb: (...args: unknown[]) => void): unknown;
  removeListener(event: string, cb: (...args: unknown[]) => void): unknown;
}

export interface WindowLike {
  getBounds(): { x: number; y: number; width: number; height: number };
  on(event: "move" | "moved" | "closed", cb: () => void): unknown;
  webContents: { send(channel: string, ...args: unknown[]): void };
  isDestroyed(): boolean;
}

export interface IpcMainLike {
  handle(channel: string, fn: (...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

/**
 * Window options that keep animations smooth: `backgroundThrottling: false` only when the app
 * needs motion while unfocused (default false keeps Chromium's energy-saving behaviour).
 */
export function motionWindowOptions(opts: { animateInBackground?: boolean } = {}): {
  webPreferences: { backgroundThrottling: boolean };
} {
  return { webPreferences: { backgroundThrottling: !opts.animateInBackground } };
}

/** Refresh rate of the display that contains the window (Hz). */
export function windowRefreshRate(screen: ScreenLike, win: WindowLike): number {
  const d = screen.getDisplayMatching(win.getBounds());
  return d.displayFrequency > 0 ? d.displayFrequency : 60;
}

/**
 * Exposes the real display refresh rate to the renderer (invoke `umx:display-refresh-rate`)
 * and notifies it when the window moves to another monitor or display metrics change.
 * Returns a disposer.
 */
export function registerDisplayBridge(deps: { ipcMain: IpcMainLike; screen: ScreenLike }, win: WindowLike): () => void {
  const { ipcMain, screen } = deps;
  let last = windowRefreshRate(screen, win);
  ipcMain.handle(CHANNEL_REFRESH, () => windowRefreshRate(screen, win));
  const notify = () => {
    if (win.isDestroyed()) return;
    const hz = windowRefreshRate(screen, win);
    if (hz !== last) {
      last = hz;
      win.webContents.send(CHANNEL_DISPLAY_CHANGED, hz);
    }
  };
  win.on("moved", notify);
  screen.on("display-metrics-changed", notify);
  return () => {
    ipcMain.removeHandler(CHANNEL_REFRESH);
    screen.removeListener("display-metrics-changed", notify);
  };
}

/** Preload source: exposes `window.umxDisplay` via contextBridge (copy into your preload). */
export const PRELOAD_SNIPPET = `const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("umxDisplay", {
  refreshRate: () => ipcRenderer.invoke("${CHANNEL_REFRESH}"),
  onChange: (cb) => {
    const l = (_e, hz) => cb(hz);
    ipcRenderer.on("${CHANNEL_DISPLAY_CHANGED}", l);
    return () => ipcRenderer.removeListener("${CHANNEL_DISPLAY_CHANGED}", l);
  },
});`;
