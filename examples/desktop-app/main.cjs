// Electron entry for example 2. Run: npx electron examples/desktop-app/main.cjs
// (Electron is not a dependency of this repository; install it in your own project.)
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
  const { registerDisplayBridge, motionWindowOptions } = await import("../../platforms/desktop/electron/dist/index.js");
  const { startServer } = await import("../../scripts/static-server.mjs");
  const server = startServer({ index: "/examples/desktop-app/index.html", port: 0, label: "desktop example" });
  await new Promise((r) => server.once("listening", r));
  const opts = motionWindowOptions();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#090b10",
    webPreferences: { ...opts.webPreferences, preload: path.join(__dirname, "preload.cjs"), contextIsolation: true },
  });
  registerDisplayBridge({ ipcMain, screen }, win);
  win.loadURL(`http://127.0.0.1:${server.address().port}/examples/desktop-app/`);
  app.on("window-all-closed", () => {
    server.close();
    app.quit();
  });
});
