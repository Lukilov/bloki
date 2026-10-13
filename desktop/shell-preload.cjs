// Bridge for the window's own tab bar (shell.html): it can only report clicks and receive the tab list.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('blokiShell', {
  send: (cmd, id, arg) => ipcRenderer.send('bloki:shell', String(cmd), id == null ? null : String(id), Number.isFinite(arg) ? arg : null),
  onState: fn => ipcRenderer.on('bloki:state', (_e, state) => fn(state)),
})
