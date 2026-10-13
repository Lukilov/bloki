// The only bridge between web pages and the app: no Node access, just these calls.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('blokiDesktop', {
  platform: process.platform,
  connect: url => ipcRenderer.invoke('bloki:connect', String(url)),
  server: () => ipcRenderer.invoke('bloki:server'),
  changeServer: () => ipcRenderer.send('bloki:change-server'),
  /** The page has drawn itself; the window can swap its placeholder for it. */
  ready: () => ipcRenderer.send('bloki:ready'),
  /** Command Search: open a page in the main window, or just close. */
  openPage: (id, newTab) => ipcRenderer.send('bloki:open-page', String(id), !!newTab),
  closeCommandSearch: () => ipcRenderer.send('bloki:close-command-search'),
})

// Menu commands (Settings…, a fresh Command Search) reach the page as plain DOM events.
const commands = ['settings', 'quick-search']
ipcRenderer.on('bloki:command', (_e, name) => { if (commands.includes(name)) window.dispatchEvent(new Event('bloki:' + name)) })

// Tell the window which theme the page shows, so the tab bar and launch picture match it.
function reportTheme() {
  const theme = document.documentElement.dataset.theme
  let mode = 'system'
  try { mode = localStorage.getItem('theme') || 'system' } catch { /* storage off */ }
  if (theme) ipcRenderer.send('bloki:theme', theme, mode)
}
window.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(reportTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  reportTheme()
})
// Choosing "System" may not change the colours, so also listen for the setting itself.
window.addEventListener('bloki:theme', () => setTimeout(reportTheme))
