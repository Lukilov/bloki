// Bloki desktop: a window onto your Bloki server, like Notion's desktop app.
// Each window is a tab bar (shell.html) with one sandboxed web view per tab underneath.
const { app, BrowserWindow, WebContentsView, Menu, ipcMain, nativeTheme, net, shell, session, dialog, clipboard, ClipboardItem, globalShortcut, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { load, save, normalizeServer, isAllowedServer, deepLinkTarget } = require('./config.cjs')
const tabs = require('./tabs.cjs')
const { openOffline } = require('./offline.cjs')

const isMac = process.platform === 'darwin'
const TAB_BAR = 36
const COMMAND_SEARCH = 'Shift+CommandOrControl+K'
// A separate profile folder (for testing, or several servers side by side).
if (process.env.BLOKI_DESKTOP_DATA) app.setPath('userData', process.env.BLOKI_DESKTOP_DATA)
const userData = app.getPath('userData')
let config = load(userData)
let pendingLink = null

if (!app.requestSingleInstanceLock()) app.quit()
if (process.defaultApp) app.setAsDefaultProtocolClient('bloki', process.execPath, [path.resolve(process.argv[1])])
else app.setAsDefaultProtocolClient('bloki')

const sameOrigin = url => { try { return !!config.server && new URL(url).origin === config.server } catch { return false } }
const connectPage = (wc, query = {}) => wc.loadFile(path.join(__dirname, 'connect.html'), { query })
// "Available offline" pages, opened lazily so a broken file never stops the app from starting.
let offlineStore = null
const offline = () => (offlineStore ??= openOffline(path.join(userData, 'offline.db')))
const isLocalPage = wc => wc.getURL().startsWith('file://')
const secure = preload => ({ preload: path.join(__dirname, preload), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true })

function openExternal(url) {
  // Only web and mail links leave the app; nothing else is handed to the OS.
  if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url)
}

// ---- Theme: follow the page (its own light/dark/system setting), remembered for the next launch.
let theme = config.themeMode === 'light' || config.themeMode === 'dark' ? config.themeMode : nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
const pageColor = () => (theme === 'dark' ? '#191919' : '#ffffff')
const barOverlay = () => ({ height: TAB_BAR, color: theme === 'dark' ? '#202020' : '#f9f8f7', symbolColor: theme === 'dark' ? '#adaaa3' : '#8e8b86' })
const snapshotFile = t => path.join(userData, `snapshot-${t}.png`)

function setTheme(next, mode) {
  config.themeMode = mode
  if (next === theme) return save(userData, config)
  theme = next
  save(userData, config)
  for (const w of windows.values()) {
    w.win.setBackgroundColor(pageColor())
    if (!isMac) w.win.setTitleBarOverlay(barOverlay())
    for (const t of w.state.tabs) views.get(t.id)?.setBackgroundColor(pageColor())
    sendState(w)
  }
}

// ---- Windows and tabs
const windows = new Map() // BrowserWindow id → { win, state: { tabs, active } }
const views = new Map() // tab id → WebContentsView
const closedTabs = [] // most recent last, for ⌘⇧T
let nextTabId = 1
let lastFocused = null
let quitting = false
let keepSession = true

const current = () => windows.get(BrowserWindow.getFocusedWindow()?.id) ?? (lastFocused && windows.has(lastFocused.win.id) ? lastFocused : windows.values().next().value)
const activeView = w => w && views.get(w.state.active)
const tabOf = wc => {
  for (const w of windows.values()) for (const t of w.state.tabs) if (views.get(t.id)?.webContents === wc) return { w, t }
  return null
}

/** What each tab's page last reported about its sidebar (not saved with the session). */
const chromeOf = new Map()

function sendState(w, extra = {}) {
  if (w.win.isDestroyed()) return
  const v = activeView(w)
  const t = w.state.tabs.find(x => x.id === w.state.active)
  w.win.webContents.send('bloki:state', {
    platform: process.platform, theme, fullscreen: w.win.isFullScreen(),
    tabs: w.state.tabs.map(x => ({ id: x.id, title: x.title, pinned: x.pinned, loading: x.loading })),
    active: w.state.active, ready: !!t?.ready,
    canBack: !!v?.webContents.navigationHistory.canGoBack(), canForward: !!v?.webContents.navigationHistory.canGoForward(),
    chrome: chromeOf.get(w.state.active) ?? null,
    ...extra,
  })
  w.win.setTitle(t?.title ?? 'Bloki')
  saveSessionSoon()
}

/** Show the active tab's view (once it has drawn) under the tab bar; hide the others. */
function layout(w) {
  if (w.win.isDestroyed()) return
  const [width, height] = w.win.getContentSize()
  for (const t of w.state.tabs) {
    const v = views.get(t.id)
    if (t.id === w.state.active && t.ready) {
      if (!w.win.contentView.children.includes(v)) w.win.contentView.addChildView(v)
      v.setBounds({ x: 0, y: TAB_BAR, width, height: Math.max(0, height - TAB_BAR) })
    } else if (w.win.contentView.children.includes(v)) w.win.contentView.removeChildView(v)
  }
  sendState(w)
}

function activate(w, id) {
  if (!w.state.tabs.some(t => t.id === id)) return
  w.state.active = id
  layout(w)
  if (w.win.isFocused()) views.get(id).webContents.focus()
}

function markReady(t) {
  if (t.ready) return
  t.ready = true
  const found = [...windows.values()].find(w => w.state.tabs.includes(t))
  if (found) { layout(found); if (found.state.active === t.id && found.win.isFocused()) views.get(t.id).webContents.focus() }
}

/** A new tab: either a fresh view loading `url`, or an existing view moved here (`view`). */
function openTab(w, { url, pinned = false, view, title = 'Bloki', ready = false } = {}, opts) {
  const id = String(nextTabId++)
  const t = { id, title, pinned, ready, loading: false }
  if (!view) {
    view = new WebContentsView({ webPreferences: secure('preload.cjs') })
    view.setBackgroundColor(pageColor())
    wireTab(view.webContents)
    if (url) view.webContents.loadURL(url)
    else if (config.server) view.webContents.loadURL(config.server)
    else connectPage(view.webContents)
    // If the page never says it's ready (old server, error page), show it anyway.
    setTimeout(() => markReady(t), 4000)
  }
  views.set(id, view)
  tabs.add(w.state, t, opts)
  layout(w)
  if (w.state.active === id && w.win.isFocused() && t.ready) view.webContents.focus()
  return t
}

function closeTab(w, id, { remember = true } = {}) {
  const v = views.get(id)
  const removed = tabs.remove(w.state, id)
  if (!removed) return
  chromeOf.delete(id)
  const url = v.webContents.getURL()
  if (remember && sameOrigin(url)) { closedTabs.push({ url, pinned: removed.tab.pinned, win: w, index: removed.index }); if (closedTabs.length > 25) closedTabs.shift() }
  if (w.win.contentView.children.includes(v)) w.win.contentView.removeChildView(v)
  views.delete(id)
  v.webContents.close()
  if (!w.state.tabs.length) { saveSession(); w.win.close() }
  else activate(w, w.state.active)
}

function reopenClosedTab() {
  const last = closedTabs.pop()
  if (!last) return
  // Back where it was, if its window is still open.
  const w = windows.has(last.win.win.id) ? last.win : current()
  const tab = { url: last.url, pinned: last.pinned }
  if (!w) createWindow({ tabs: [tab] })
  else {
    const t = openTab(w, tab)
    if (w === last.win) { tabs.move(w.state, t.id, last.index); layout(w) }
  }
}

function moveTabToNewWindow(w, id) {
  if (w.state.tabs.length < 2) return
  const v = views.get(id)
  const { tab } = tabs.remove(w.state, id)
  views.delete(id)
  if (w.win.contentView.children.includes(v)) w.win.contentView.removeChildView(v)
  activate(w, w.state.active)
  const [x, y] = w.win.getPosition()
  const [width, height] = w.win.getSize()
  createWindow({ bounds: { x: x + 30, y: y + 30, width, height }, tabs: [{ view: v, title: tab.title, pinned: tab.pinned, ready: true }] })
}

function closeTabs(w, id, which) {
  for (const other of tabs.closable(w.state, id, which)) closeTab(w, other)
}

function tabMenu(w, id) {
  const t = w.state.tabs.find(x => x.id === id)
  if (!t) return
  const i = w.state.tabs.indexOf(t)
  Menu.buildFromTemplate([
    { label: 'Refresh Tab', click: () => views.get(id).webContents.reload() },
    { label: 'Duplicate Tab', click: () => openTab(w, { url: views.get(id).webContents.getURL(), pinned: t.pinned }, { after: id }) },
    { label: t.pinned ? 'Unpin Tab' : 'Pin Tab', click: () => { tabs.setPinned(w.state, id, !t.pinned); layout(w) } },
    { label: 'Move Tab to New Window', enabled: w.state.tabs.length > 1, click: () => moveTabToNewWindow(w, id) },
    { type: 'separator' },
    { label: 'Close Tab', click: () => closeTab(w, id) },
    { label: 'Close Other Tabs', enabled: tabs.closable(w.state, id, 'others').length > 0, click: () => closeTabs(w, id, 'others') },
    { label: 'Close Tabs to the Left', enabled: i > 0 && tabs.closable(w.state, id, 'left').length > 0, click: () => closeTabs(w, id, 'left') },
    { label: 'Close Tabs to the Right', enabled: tabs.closable(w.state, id, 'right').length > 0, click: () => closeTabs(w, id, 'right') },
    { type: 'separator' },
    { label: 'Reopen Last Closed Tab', enabled: closedTabs.length > 0, click: reopenClosedTab },
  ]).popup({ window: w.win })
}

function wireTab(wc) {
  const found = () => tabOf(wc)
  // Stay on the Bloki server; everything else opens in the default browser.
  wc.on('will-navigate', (e, target) => {
    if (sameOrigin(target) || target.startsWith('file://')) return
    e.preventDefault()
    openExternal(target)
  })
  // Links to Bloki pages that ask for a new window open as a tab, as in Notion.
  wc.setWindowOpenHandler(({ url: target, disposition }) => {
    const f = found()
    if (sameOrigin(target) && f) openTab(f.w, { url: target }, { after: f.t.id, activate: disposition !== 'background-tab' })
    else openExternal(target)
    return { action: 'deny' }
  })
  wc.on('did-fail-load', (_e, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || !sameOrigin(failedUrl) || code === -3) return
    // With pages kept offline, show those to read; otherwise ask about the server again.
    let saved = []
    try { saved = offline().list(config.server) } catch { /* no offline store */ }
    if (saved.length) wc.loadFile(path.join(__dirname, 'offline.html'), { query: { server: config.server, url: failedUrl } })
    else connectPage(wc, { error: `Can’t reach ${config.server} (${description}).`, server: config.server })
  })
  wc.on('did-finish-load', () => { if (wc.getURL().startsWith('file://')) { const f = found(); if (f) markReady(f.t) } })
  wc.on('page-title-updated', (_e, title) => { const f = found(); if (f) { f.t.title = title; sendState(f.w) } })
  wc.on('did-start-loading', () => { const f = found(); if (f) { f.t.loading = true; sendState(f.w) } })
  wc.on('did-stop-loading', () => { const f = found(); if (f) { f.t.loading = false; sendState(f.w) } })
  wc.on('did-navigate-in-page', () => { const f = found(); if (f) sendState(f.w) })
  wc.on('context-menu', (_e, params) => {
    const f = found()
    const items = [
      ...params.dictionarySuggestions.map(s => ({ label: s, click: () => wc.replaceMisspelling(s) })),
      ...(params.misspelledWord ? [{ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' }] : []),
      ...(params.linkURL && sameOrigin(params.linkURL) && f ? [{ label: 'Open in New Tab', click: () => openTab(f.w, { url: params.linkURL }, { after: f.t.id, activate: false }) }, { type: 'separator' }] : []),
      ...(params.linkURL && !sameOrigin(params.linkURL) ? [{ label: 'Open link in browser', click: () => openExternal(params.linkURL) }, { type: 'separator' }] : []),
      { role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste }, { role: 'selectAll' },
    ]
    Menu.buildFromTemplate(items).popup({ window: f?.w.win })
  })
}

function createWindow({ bounds, tabs: list = [{}], active = 0, snapshot } = {}) {
  const win = new BrowserWindow({
    ...(bounds ?? config.bounds ?? { width: 1280, height: 820 }),
    minWidth: 600,
    minHeight: 400,
    show: false,
    title: 'Bloki',
    backgroundColor: pageColor(),
    // Notion's window: no title bar; traffic lights (or Windows controls) sit in the tab bar.
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 } } : { titleBarStyle: 'hidden', titleBarOverlay: barOverlay(), autoHideMenuBar: true }),
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: secure('shell-preload.cjs'),
  })
  const w = { win, state: { tabs: [], active: null } }
  windows.set(win.id, w)
  lastFocused = w

  const shellWc = win.webContents
  shellWc.on('will-navigate', e => e.preventDefault())
  shellWc.setWindowOpenHandler(() => ({ action: 'deny' }))
  shellWc.once('did-finish-load', () => sendState(w, snapshot ? { snapshot } : {}))
  win.loadFile(path.join(__dirname, 'shell.html'))
  win.once('ready-to-show', () => win.show())

  for (const [i, item] of list.entries()) openTab(w, item, { activate: i === active })
  for (const ev of ['resize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, () => layout(w))
  win.on('focus', () => { lastFocused = w; activeView(w)?.webContents.focus() })
  // Back/forward mouse buttons and swipes, as in Notion.
  const go = dir => { const h = activeView(w)?.webContents.navigationHistory; if (h) dir < 0 ? h.goBack() : h.goForward() }
  win.on('app-command', (_e, cmd) => { if (cmd === 'browser-backward') go(-1); if (cmd === 'browser-forward') go(1) })
  win.on('swipe', (_e, dir) => { if (dir === 'right') go(-1); if (dir === 'left') go(1) })
  win.on('close', e => {
    // The last window remembers its size and leaves a picture of itself for the next launch.
    if (windows.size !== 1 || w.captured) return
    if (!win.isMaximized() && !win.isFullScreen()) { config.bounds = win.getBounds(); save(userData, config) }
    e.preventDefault()
    w.captured = true
    // Holding the close back cancels a quit, so quit again once the picture is saved.
    saveSnapshot(w).finally(() => (quitting ? app.quit() : win.close()))
  })
  win.on('closed', () => {
    for (const t of w.state.tabs) { views.get(t.id)?.webContents.close(); views.delete(t.id) }
    windows.delete(win.id)
    // Closing one of several windows forgets its tabs; the last one stays saved for next time.
    if (windows.size && !quitting) saveSessionSoon()
  })
  return w
}

async function saveSnapshot(w) {
  const t = w.state.tabs.find(x => x.id === w.state.active)
  const v = activeView(w)
  if (!t?.ready || !v || !sameOrigin(v.webContents.getURL())) return
  try { fs.writeFileSync(snapshotFile(theme), (await v.webContents.capturePage()).toPNG()) } catch { /* no picture next time */ }
}

// ---- Tabs survive a restart, as in Notion (unless you quit without saving them).
let sessionTimer = null
function saveSession() {
  clearTimeout(sessionTimer)
  if (!windows.size) return
  const order = [...windows.values()].sort((a, b) => (a === lastFocused ? -1 : b === lastFocused ? 1 : 0))
  config.session = keepSession ? {
    windows: order.map(w => ({
      bounds: w.win.getNormalBounds(),
      tabs: w.state.tabs.map(t => ({ url: views.get(t.id).webContents.getURL(), pinned: t.pinned })),
      active: w.state.tabs.findIndex(t => t.id === w.state.active),
    })),
  } : null
  save(userData, config)
}
const saveSessionSoon = () => { if (!quitting) { clearTimeout(sessionTimer); sessionTimer = setTimeout(saveSession, 500) } }

function restoreSession() {
  const saved = tabs.restorable(config.session, config.server)
  if (!saved.length) return createWindow({ snapshot: launchSnapshot() })
  saved.forEach((w, i) => createWindow({ ...w, snapshot: i === 0 ? launchSnapshot() : undefined }))
}

function launchSnapshot() {
  try { return 'data:image/png;base64,' + fs.readFileSync(snapshotFile(theme)).toString('base64') } catch { return undefined }
}

// ---- Command Search: ⇧⌘K from anywhere opens a floating search over other apps, as in Notion.
let quick = null
function toggleCommandSearch() {
  if (!config.server) return
  if (quick && !quick.isDestroyed() && quick.isVisible()) { quick.hide(); return }
  if (!quick || quick.isDestroyed()) {
    quick = new BrowserWindow({
      width: 755, minWidth: 755, maxWidth: 755, height: 700, minHeight: 700,
      show: false, frame: false, resizable: true, maximizable: false, minimizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, hiddenInMissionControl: true, ...(isMac ? { type: 'panel' } : {}),
      title: 'Bloki – Command Search', backgroundColor: pageColor(),
      webPreferences: secure('preload.cjs'),
    })
    quick.webContents.on('will-navigate', (e, target) => { if (!sameOrigin(target)) { e.preventDefault(); openExternal(target) } })
    quick.webContents.setWindowOpenHandler(({ url: target }) => { if (!sameOrigin(target)) openExternal(target); return { action: 'deny' } })
    quick.on('blur', () => { if (!quick.webContents.isDevToolsOpened()) quick.hide() })
    quick.loadURL(`${config.server}/#/quick-search`)
  } else quick.webContents.send('bloki:command', 'quick-search')
  // Centre it on the screen with the pointer.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const [width, height] = quick.getSize()
  quick.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + (area.height - height) / 2))
  quick.show()
  quick.focus()
}

function openFromCommandSearch(e, id, newTab) {
  if (!quick || e.sender !== quick.webContents || !/^[\w-]+$/.test(String(id))) return
  quick.hide()
  const url = `${config.server}/#/${id}`
  let w = current()
  if (!w) w = createWindow({ tabs: [{ url }] })
  else if (newTab) openTab(w, { url })
  else activeView(w).webContents.loadURL(url)
  if (w.win.isMinimized()) w.win.restore()
  w.win.show()
  w.win.focus()
  if (isMac) app.focus({ steal: true })
}

function applyCommandSearch() {
  globalShortcut.unregister(COMMAND_SEARCH)
  if (config.commandSearch !== false && !globalShortcut.register(COMMAND_SEARCH, toggleCommandSearch)) console.warn('Command Search shortcut is taken by another app')
}

// ---- Deep links and server setup
function openDeepLink(link) {
  const target = deepLinkTarget(link, config.server)
  if (!target) return
  const w = current()
  if (!w) { createWindow({ tabs: [{ url: target }] }); return }
  if (w.win.isMinimized()) w.win.restore()
  w.win.focus()
  activeView(w).webContents.loadURL(target)
}

/** Check that the address really is a Bloki server before saving it. */
async function connect(e, input) {
  if (!e.sender.getURL().startsWith('file://')) return { error: 'Not allowed.' }
  const origin = normalizeServer(input)
  if (!origin) return { error: 'Enter a server address, like bloki.example.com.' }
  if (!isAllowedServer(origin)) return { error: 'Use https:// for servers on the network. Plain http only works for this computer.' }
  try {
    const res = await net.fetch(`${origin}/api/auth/status`, { headers: { accept: 'application/json' } })
    const data = await res.json()
    if (!res.ok || typeof data.hasUsers !== 'boolean') throw new Error('not bloki')
  } catch {
    return { error: `No Bloki server answered at ${origin}.` }
  }
  config.server = origin
  save(userData, config)
  buildMenu()
  e.sender.loadURL(origin)
  return { ok: true }
}

function changeServer() {
  const v = activeView(current())
  if (v) connectPage(v.webContents, { server: config.server ?? '' })
}

function copyLink(withTitle) {
  const w = current()
  const v = activeView(w)
  if (!v || !sameOrigin(v.webContents.getURL())) return
  const url = v.webContents.getURL()
  const title = w.state.tabs.find(t => t.id === w.state.active)?.title ?? url
  const esc = s => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
  // With the title, rich editors paste a titled link; plain text fields still get the address.
  clipboard.write([new ClipboardItem(withTitle ? { 'text/plain': url, 'text/html': `<a href="${esc(url)}">${esc(title)}</a>` } : { 'text/plain': url })])
}

// ---- Menus: every tab command has the same shortcut as in Notion.
function buildMenu() {
  const onTab = fn => () => { const w = current(); if (w && w.state.active) fn(w, w.state.active) }
  const nav = dir => onTab(w => { const h = activeView(w).webContents.navigationHistory; dir < 0 ? h.goBack() : h.goForward() })
  const pick = n => onTab(w => { const id = tabs.nth(w.state, n); if (id) activate(w, id) })
  const step = dir => onTab(w => { const id = tabs.step(w.state, dir); if (id) activate(w, id) })
  const command = name => onTab(w => activeView(w).webContents.send('bloki:command', name))
  const loginItems = app.isPackaged ? app.getLoginItemSettings() : null
  const appItems = [
    { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: command('settings') },
    { label: 'Open at Login', type: 'checkbox', enabled: !!loginItems, checked: !!loginItems?.openAtLogin, click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); buildMenu() } },
    { label: 'Command Search Shortcut (⇧⌘K)', type: 'checkbox', checked: config.commandSearch !== false, click: item => { config.commandSearch = item.checked; save(userData, config); applyCommandSearch() } },
    { type: 'separator' },
    { label: 'Change Server…', click: changeServer },
  ]
  const quitWithoutSaving = { label: isMac ? 'Quit Without Saving Tabs' : 'Exit Without Saving Tabs', click: () => { keepSession = false; saveSession(); app.quit() } }
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, ...appItems, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, quitWithoutSaving, { role: 'quit' }],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => { const w = current(); w ? openTab(w) : createWindow() } },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: 'Reopen Last Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: reopenClosedTab },
        { label: 'Command Search', accelerator: COMMAND_SEARCH, registerAccelerator: false, enabled: !!config.server, click: toggleCommandSearch },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => { const w = current(); if (w?.win.isFocused()) closeTab(w, w.state.active); else BrowserWindow.getFocusedWindow()?.close() } },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => BrowserWindow.getFocusedWindow()?.close() },
        ...(isMac ? [] : [{ type: 'separator' }, ...appItems, { type: 'separator' }, quitWithoutSaving, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' },
        { label: 'Copy Link to Current Page', accelerator: 'CmdOrCtrl+L', click: () => copyLink(false) },
        { label: 'Copy Link to Current Page with Title', accelerator: 'CmdOrCtrl+Alt+L', click: () => copyLink(true) },
        { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: onTab(w => activeView(w).webContents.reload()) },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: onTab(w => activeView(w).webContents.reloadIgnoringCache()) },
        { label: 'Toggle Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: onTab(w => activeView(w).webContents.toggleDevTools()) },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: onTab(w => activeView(w).webContents.setZoomLevel(0)) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: onTab(w => { const wc = activeView(w).webContents; wc.setZoomLevel(wc.getZoomLevel() + 0.5) }) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: onTab(w => { const wc = activeView(w).webContents; wc.setZoomLevel(wc.getZoomLevel() - 0.5) }) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [{ label: 'Back', accelerator: 'CmdOrCtrl+[', click: nav(-1) }, { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: nav(1) }],
    },
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
        { label: 'Show Next Tab', accelerator: 'Ctrl+Tab', click: step(1) },
        { label: 'Show Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: step(-1) },
        { label: 'Show Next Tab', accelerator: 'CmdOrCtrl+Shift+]', click: step(1), visible: false, acceleratorWorksWhenHidden: true },
        { label: 'Show Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', click: step(-1), visible: false, acceleratorWorksWhenHidden: true },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ label: `Select Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, click: pick(n), visible: false, acceleratorWorksWhenHidden: true })),
        { label: 'Select Last Tab', accelerator: 'CmdOrCtrl+9', click: pick(9), visible: false, acceleratorWorksWhenHidden: true },
        { label: 'Move Tab to New Window', click: onTab(moveTabToNewWindow) },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : []),
      ],
    },
    { role: 'help', submenu: [{ label: 'Server: ' + (config.server ?? 'not set'), enabled: false }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- IPC: the tab bar, the pages and Command Search each get only their own calls.
function onShell(e, cmd, id, arg) {
  const w = windows.get(BrowserWindow.fromWebContents(e.sender)?.id)
  if (!w || w.win.webContents !== e.sender) return
  const h = activeView(w)?.webContents.navigationHistory
  if (cmd === 'activate') activate(w, id)
  else if (cmd === 'close') closeTab(w, id)
  else if (cmd === 'new') openTab(w)
  else if (cmd === 'move' && arg != null) { tabs.move(w.state, id, arg); layout(w) }
  else if (cmd === 'menu') tabMenu(w, id)
  else if (cmd === 'back') h?.goBack()
  else if (cmd === 'forward') h?.goForward()
  else if (cmd === 'workspace') activeView(w)?.webContents.send('bloki:command', 'workspace-menu')
  else if (cmd === 'sidebar') activeView(w)?.webContents.send('bloki:command', 'toggle-sidebar')
  else if (cmd === 'zoom' && isMac) w.win.isMaximized() ? w.win.unmaximize() : w.win.maximize()
}

app.on('second-instance', (_e, argv) => {
  const link = argv.find(a => a.startsWith('bloki://'))
  if (link) openDeepLink(link)
  else { const w = current(); if (w) { if (w.win.isMinimized()) w.win.restore(); w.win.focus() } }
})
app.on('open-url', (e, link) => {
  e.preventDefault()
  if (app.isReady()) openDeepLink(link)
  else pendingLink = link
})

app.whenReady().then(() => {
  ipcMain.handle('bloki:connect', connect)
  ipcMain.handle('bloki:server', () => config.server ?? null)
  ipcMain.on('bloki:change-server', changeServer)
  ipcMain.on('bloki:shell', onShell)
  ipcMain.on('bloki:ready', e => { const f = tabOf(e.sender); if (f) markReady(f.t) })
  // Available offline: the Bloki page saves or forgets itself; the offline reader (a local file) lists and opens them.
  ipcMain.handle('bloki:offline-set', (e, id, on, data) => {
    if (!sameOrigin(e.sender.getURL()) || !/^[\w-]{1,64}$/.test(String(id))) return false
    if (!on) { offline().remove(config.server, id); return false }
    const html = String(data?.html ?? '')
    if (html.length > 5_000_000) return false
    offline().save(config.server, id, { title: data?.title ?? '', icon: data?.icon ?? '', html, base: Number(data?.base) || 0 })
    return true
  })
  // Offline editing: the reader saves edits locally; the Bloki page picks them up once it loads again.
  ipcMain.handle('bloki:offline-edit', (e, id, html) => isLocalPage(e.sender) && config.server && /^[\w-]{1,64}$/.test(String(id)) && String(html).length <= 5_000_000 ? offline().edit(config.server, String(id), String(html)) : false)
  ipcMain.handle('bloki:offline-pending', e => (sameOrigin(e.sender.getURL()) ? offline().pending(config.server) : []))
  ipcMain.handle('bloki:offline-sent', (e, id) => { if (sameOrigin(e.sender.getURL())) offline().sent(config.server, String(id)) })
  ipcMain.handle('bloki:offline-has', (e, id) => sameOrigin(e.sender.getURL()) && offline().has(config.server, String(id)))
  ipcMain.handle('bloki:offline-list', e => (isLocalPage(e.sender) && config.server ? offline().list(config.server) : []))
  ipcMain.handle('bloki:offline-get', (e, id) => (isLocalPage(e.sender) && config.server ? offline().get(config.server, String(id)) : null))
  ipcMain.on('bloki:retry', (e, url) => { if (isLocalPage(e.sender) && sameOrigin(String(url))) e.sender.loadURL(String(url)) })
  ipcMain.on('bloki:chrome', (e, info) => {
    const f = tabOf(e.sender)
    if (!f || typeof info !== 'object' || !info) return
    chromeOf.set(f.t.id, { workspace: String(info.workspace ?? '').slice(0, 100), icon: String(info.icon ?? '').slice(0, 8), width: Math.max(0, Math.min(600, Number(info.width) || 0)), collapsed: !!info.collapsed })
    if (f.t.id === f.w.state.active) sendState(f.w)
  })
  ipcMain.on('bloki:theme', (e, next, mode) => {
    if ((tabOf(e.sender) || e.sender === quick?.webContents) && ['light', 'dark'].includes(next)) setTheme(next, ['light', 'dark'].includes(mode) ? mode : 'system')
  })
  ipcMain.on('bloki:open-page', openFromCommandSearch)
  ipcMain.on('bloki:close-command-search', e => { if (quick && e.sender === quick.webContents) quick.hide() })
  // Pages may write to the clipboard, go full screen and show notifications; nothing else (camera, location…) is granted.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(sameOrigin(wc.getURL()) && ['clipboard-sanitized-write', 'fullscreen', 'notifications'].includes(permission)))
  buildMenu()
  applyCommandSearch()
  restoreSession()
  const link = pendingLink ?? process.argv.find(a => a.startsWith('bloki://'))
  if (link) openDeepLink(link)
  app.on('activate', () => { if (!windows.size) restoreSession() })
}).catch(err => dialog.showErrorBox('Bloki', String(err)))

app.on('before-quit', () => { if (!quitting) saveSession(); quitting = true })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => { if (!isMac) app.quit() })
