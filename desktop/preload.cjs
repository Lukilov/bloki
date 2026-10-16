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
  /** Available offline: keep this page's HTML on this computer, or forget it. */
  offline: {
    set: (id, on, data) => ipcRenderer.invoke('bloki:offline-set', String(id), !!on, on ? { title: String(data?.title ?? ''), icon: String(data?.icon ?? ''), html: String(data?.html ?? ''), base: Number(data?.base) || 0 } : null),
    // Offline editing: the reader stores edits; the Bloki page sends them and marks them sent.
    edit: (id, html) => ipcRenderer.invoke('bloki:offline-edit', String(id), String(html)),
    pending: () => ipcRenderer.invoke('bloki:offline-pending'),
    sent: id => ipcRenderer.invoke('bloki:offline-sent', String(id)),
    has: id => ipcRenderer.invoke('bloki:offline-has', String(id)),
    // Only the offline reader (a local file) gets answers to these two.
    list: () => ipcRenderer.invoke('bloki:offline-list'),
    get: id => ipcRenderer.invoke('bloki:offline-get', String(id)),
    retry: url => ipcRenderer.send('bloki:retry', String(url)),
  },
  /** Workspace name and sidebar state, so the tab bar can show the switcher over the sidebar, as Notion does. */
  chrome: info => ipcRenderer.send('bloki:chrome', {
    workspace: String(info?.workspace ?? '').slice(0, 100), icon: String(info?.icon ?? '').slice(0, 8),
    width: Math.max(0, Math.min(600, Number(info?.width) || 0)), collapsed: !!info?.collapsed,
  }),
})

// Menu commands (Settings…, a fresh Command Search) reach the page as plain DOM events.
const commands = ['settings', 'quick-search', 'workspace-menu', 'toggle-sidebar']
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
