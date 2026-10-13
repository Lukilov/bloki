// The tab strip of one window, kept apart from Electron so it can be tested: { tabs: [{ id, pinned, … }], active }.
// Pinned tabs always come first, as in Notion.

const pinnedCount = s => s.tabs.filter(t => t.pinned).length
const indexOf = (s, id) => s.tabs.findIndex(t => t.id === id)

/** Insert a tab after `after` (or at the end); an unpinned tab never lands among the pinned ones. */
function add(s, tab, { after, activate = true } = {}) {
  const i = after != null && indexOf(s, after) >= 0 ? indexOf(s, after) + 1 : s.tabs.length
  s.tabs.splice(tab.pinned ? Math.min(i, pinnedCount(s)) : Math.max(i, pinnedCount(s)), 0, tab)
  if (activate || s.active == null) s.active = tab.id
}

/** Take a tab out; the one to its right (else left) becomes active, as in Notion and browsers. */
function remove(s, id) {
  const i = indexOf(s, id)
  if (i < 0) return null
  const [tab] = s.tabs.splice(i, 1)
  if (s.active === id) s.active = (s.tabs[i] ?? s.tabs[i - 1])?.id ?? null
  return { tab, index: i }
}

/** Move a tab to index `to` (counted after it is taken out), staying inside its pinned/unpinned group. */
function move(s, id, to) {
  const i = indexOf(s, id)
  if (i < 0) return
  const [tab] = s.tabs.splice(i, 1)
  const p = pinnedCount(s)
  s.tabs.splice(tab.pinned ? Math.min(Math.max(to, 0), p) : Math.min(Math.max(to, p), s.tabs.length), 0, tab)
}

/** Pinning moves the tab to the end of the pinned group; unpinning to the start of the rest. */
function setPinned(s, id, pinned) {
  const tab = s.tabs[indexOf(s, id)]
  if (!tab) return
  tab.pinned = pinned
  move(s, id, pinned ? Infinity : 0)
}

/** Ids closed by "Close Other Tabs" / "… to the Left" / "… to the Right". Pinned tabs stay. */
function closable(s, id, which) {
  const i = indexOf(s, id)
  if (i < 0) return []
  return s.tabs.filter((t, j) => !t.pinned && j !== i && (which === 'others' || (which === 'left' ? j < i : j > i))).map(t => t.id)
}

/** ⌘1…⌘8 pick that tab, ⌘9 the last one. */
const nth = (s, n) => (n === 9 ? s.tabs.at(-1) : s.tabs[n - 1])?.id ?? null

/** Ctrl+Tab / Ctrl+Shift+Tab, wrapping around. */
function step(s, dir) {
  if (!s.tabs.length) return null
  const i = indexOf(s, s.active)
  return s.tabs[(i + dir + s.tabs.length) % s.tabs.length].id
}

/** Saved windows to reopen at launch: only pages on this server, never empty windows. */
function restorable(session, server) {
  if (!server || !Array.isArray(session?.windows)) return []
  const ours = url => typeof url === 'string' && (url === server || url.startsWith(server + '/'))
  return session.windows.map(w => {
    const tabs = (Array.isArray(w?.tabs) ? w.tabs : []).filter(t => ours(t?.url)).map(t => ({ url: t.url, pinned: !!t.pinned }))
    return { bounds: w.bounds, tabs, active: Math.min(Math.max(0, Number(w.active) || 0), Math.max(0, tabs.length - 1)) }
  }).filter(w => w.tabs.length)
}

module.exports = { add, remove, move, setPinned, closable, nth, step, restorable }
