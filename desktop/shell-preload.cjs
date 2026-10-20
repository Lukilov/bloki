// Bridge for the window's own tab bar (shell.html): it can only report clicks and receive the tab list.
const { contextBridge, ipcRenderer } = require('electron')

// Only plain values cross: a number (index), a short string (group name) or a screen point.
const clean = a => (Number.isFinite(a) ? a : typeof a === 'string' ? a.slice(0, 100) : Array.isArray(a) && a.length === 2 && a.every(Number.isFinite) ? [a[0], a[1]] : null)
contextBridge.exposeInMainWorld('blokiShell', {
  send: (cmd, id, arg) => ipcRenderer.send('bloki:shell', String(cmd), id == null ? null : String(id), clean(arg)),
  onState: fn => ipcRenderer.on('bloki:state', (_e, state) => fn(state)),
})
