// Exposes window.umxDisplay (real display refresh rate) to the renderer — see @ultra-motion-x/electron.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("umxDisplay", {
  refreshRate: () => ipcRenderer.invoke("umx:display-refresh-rate"),
  onChange: (cb) => {
    const l = (_e, hz) => cb(hz);
    ipcRenderer.on("umx:display-changed", l);
    return () => ipcRenderer.removeListener("umx:display-changed", l);
  },
});
