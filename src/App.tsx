import { useCallback, useEffect, useState } from 'react'
import { ChevronsRight, Clock, LayoutTemplate, Menu as MenuIcon } from 'lucide-react'
import { api, setPublicRoot, type Me } from './api'
import { iconOf, label, parseHash, StoreProvider, useStore } from './store'
import { applyTemplate, Sidebar } from './Sidebar'
import { SearchDialog } from './Search'
import { PageView } from './PageView'
import { AcceptInvite, AuthScreen, SettingsDialog } from './Access'
import { coverStyle } from './Database'
import { TEMPLATES } from './templates'
import { alt, mod, shift, timeAgo, Toast } from './ui'
import './styles.css'

const desktop = (window as { blokiDesktop?: { ready: () => void; openPage: (id: string, newTab: boolean) => void; closeCommandSearch: () => void } }).blokiDesktop

export type Theme = 'light' | 'dark' | 'system'
const readTheme = (): Theme => { try { return (localStorage.getItem('theme') as Theme) || 'system' } catch { return 'system' } }
const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches
export const setTheme = (t: Theme) => { try { localStorage.setItem('theme', t) } catch { /* private mode */ } dispatchEvent(new CustomEvent('bloki:theme')) }

function readNumber(key: string, fallback: number) {
  try { const v = Number(localStorage.getItem(key)); return v || fallback } catch { return fallback }
}
function save(key: string, v: string) { try { localStorage.setItem(key, v) } catch { /* private mode */ } }

/** Recently visited pages, newest first, like Notion's Home. */
function visited(): { id: string; at: number }[] {
  try { return JSON.parse(localStorage.getItem('visited') || '[]') } catch { return [] }
}
function recordVisit(id: string) {
  save('visited', JSON.stringify([{ id, at: Date.now() }, ...visited().filter(v => v.id !== id)].slice(0, 30)))
}

function Home() {
  const store = useStore()
  const h = new Date().getHours()
  const member = store.me?.role !== 'guest'
  const recent = visited().map(v => ({ page: store.byId.get(v.id), at: v.at })).filter(v => v.page && !v.page.trashed).slice(0, 12)
  const fallback = recent.length ? [] : [...store.pages].filter(p => !p.trashed).sort((a, b) => b.updated - a.updated).slice(0, 8).map(page => ({ page, at: page.updated }))
  return (
    <div className="page"><div className="page-body home">
      <h1 className="home-title">Good {h < 5 ? 'evening' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}{store.me ? `, ${store.me.user.name}` : ''}</h1>
      {!store.me?.workspaceId && <p className="muted">You’re not in a workspace yet. Create one from the menu at the top left, or open an invite link.</p>}
      <div className="home-head"><Clock size={14} /> Recently visited</div>
      <div className="home-row">
        {[...recent, ...fallback].map(({ page, at }) => (
          <button key={page!.id} className="home-card" onClick={() => store.go(page!.id)}>
            <div className="home-card-cover" style={coverStyle(page!.cover)} />
            <div className="home-card-icon">{iconOf(page)}</div>
            <div className="home-card-title">{label(page)}</div>
            <div className="home-card-meta muted small">{timeAgo(at)}</div>
          </button>
        ))}
        {member && store.me?.workspaceId && <button className="home-card new" onClick={() => store.create({ section: 'private' })}><span>+</span><div>New page</div></button>}
      </div>
      {member && store.me?.workspaceId && <>
        <div className="home-head"><LayoutTemplate size={14} /> Featured templates</div>
        <div className="home-row">
          {TEMPLATES.slice(0, 6).map(t => (
            <button key={t.id} className="home-card template" onClick={() => applyTemplate(store, t).catch(e => store.setError(e.message))}>
              <div className="home-card-cover tpl">{t.icon}</div>
              <div className="home-card-title">{t.name}</div>
              <div className="home-card-meta muted small">{t.description}</div>
            </button>
          ))}
        </div>
      </>}
    </div></div>
  )
}

const SHORTCUTS: [string, string][] = [
  [`${mod}K`, 'Search'], [`${mod}P`, 'Search'], [`${mod}\\`, 'Toggle sidebar'], [`${mod}${shift}L`, 'Toggle dark mode'],
  [`${mod}[`, 'Go back'], [`${mod}]`, 'Go forward'], [`${mod}${shift}N`, 'New page'],
  [`${mod}B`, 'Bold'], [`${mod}I`, 'Italic'], [`${mod}U`, 'Underline'], [`${mod}${shift}S`, 'Strikethrough'], [`${mod}E`, 'Inline code'], [`${mod}K (in text)`, 'Add link'],
  [`${mod}${alt}0`, 'Text'], [`${mod}${alt}1–3`, 'Heading 1–3'], [`${mod}${alt}4`, 'To-do'], [`${mod}${alt}5`, 'Bulleted list'], [`${mod}${alt}6`, 'Numbered list'], [`${mod}${alt}7`, 'Toggle list'], [`${mod}${alt}8`, 'Code'],
  ['/', 'Insert a block'], ['@', 'Mention a person or page'], ['[[', 'Link to a page'], ['---', 'Divider'], ['# / ## / ###', 'Headings'], ['[]', 'To-do'], ['>', 'Toggle'], ['"', 'Quote'],
  ['Tab / Shift+Tab', 'Indent / outdent'], [`${mod}Z`, 'Undo'], [`${mod}${shift}Z`, 'Redo'], ['Esc', 'Select block'],
]

function Shortcuts({ close }: { close: () => void }) {
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog shortcuts" onClick={e => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <div className="shortcut-grid">
          {SHORTCUTS.map(([k, d]) => <div key={k + d} className="shortcut"><span>{d}</span><kbd>{k}</kbd></div>)}
        </div>
      </div>
    </div>
  )
}

function Shell({ dark }: { dark: boolean }) {
  const store = useStore()
  const [dialog, setDialog] = useState<{ kind: 'search' | 'settings' | 'shortcuts'; tab?: string } | null>(null)
  const [collapsed, setCollapsed] = useState(() => readNumber('sidebarCollapsed', 0) === 1)
  const [peek, setPeek] = useState(false)
  const [width, setWidth] = useState(() => readNumber('sidebarWidth', 248))

  useEffect(() => save('sidebarWidth', String(width)), [width])
  useEffect(() => save('sidebarCollapsed', collapsed ? '1' : '0'), [collapsed])
  useEffect(() => { if (store.current) recordVisit(store.current) }, [store.current])
  // Open on the last visited page unless the person prefers Home.
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (started || !store.pages.length) return
    setStarted(true)
    const last = visited()[0]
    if (!store.current && store.me?.prefs?.startPage !== 'home' && last && store.byId.get(last.id) && !store.byId.get(last.id)!.trashed) store.go(last.id)
  }, [store, started])

  useEffect(() => {
    if (store.published) return
    const on = (e: KeyboardEvent) => {
      const m = e.metaKey || e.ctrlKey
      if (m && !e.shiftKey && (e.key === 'k' || e.key === 'p') && !(e.target as HTMLElement).closest?.('.bn-editor')) { e.preventDefault(); setDialog(d => (d?.kind === 'search' ? null : { kind: 'search' })) }
      if (m && e.key === '\\') { e.preventDefault(); setCollapsed(c => !c); setPeek(false) }
      if (m && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setTheme(dark ? 'light' : 'dark') }
      if (m && e.shiftKey && e.key.toLowerCase() === 'n' && store.me?.role !== 'guest') { e.preventDefault(); store.create({ section: 'private' }) }
      if (m && e.key === '[') { e.preventDefault(); history.back() }
      if (m && e.key === ']') { e.preventDefault(); history.forward() }
      if (m && e.key === '/' && !(e.target as HTMLElement).closest?.('.bn-editor')) { e.preventDefault(); setDialog({ kind: 'shortcuts' }) }
    }
    const shortcuts = () => setDialog({ kind: 'shortcuts' })
    const settings = () => setDialog({ kind: 'settings' })
    addEventListener('keydown', on)
    addEventListener('bloki:shortcuts', shortcuts)
    addEventListener('bloki:settings', settings)
    return () => { removeEventListener('keydown', on); removeEventListener('bloki:shortcuts', shortcuts); removeEventListener('bloki:settings', settings) }
  }, [store, dark])

  const current = store.current ? store.byId.get(store.current) : undefined
  useEffect(() => { document.title = current ? `${current.icon && !current.icon.startsWith('icon:') && !current.icon.includes('/') ? current.icon + ' ' : ''}${label(current)}` : 'Bloki' }, [current])

  if (store.published) {
    return <div className="app"><main>{store.current ? <PageView id={store.current} dark={dark} /> : null}</main></div>
  }

  const sidebar = <Sidebar width={width} setWidth={setWidth} collapse={() => { setCollapsed(true); setPeek(false) }}
    openSearch={() => setDialog({ kind: 'search' })} openSettings={tab => setDialog({ kind: 'settings', tab })} />

  return (
    <div className="app">
      {!collapsed && sidebar}
      {collapsed && (
        // Hovering the left edge peeks the sidebar, as in Notion.
        <div className={'sidebar-peek' + (peek ? ' open' : '')} onMouseLeave={() => setPeek(false)}>{peek && sidebar}</div>
      )}
      <main>
        {collapsed && (
          <button className="sidebar-toggle ghost" title={`Open sidebar (${mod}\\)`} onMouseEnter={() => setPeek(true)} onClick={() => { setCollapsed(false); setPeek(false) }}>
            {peek ? <ChevronsRight size={18} /> : <MenuIcon size={18} />}
          </button>
        )}
        {store.current ? <PageView id={store.current} dark={dark} sidebarCollapsed={collapsed} /> : <Home />}
      </main>
      {dialog?.kind === 'search' && <SearchDialog close={() => setDialog(null)} />}
      {dialog?.kind === 'settings' && <SettingsDialog initialTab={dialog.tab} close={() => setDialog(null)} />}
      {dialog?.kind === 'shortcuts' && <Shortcuts close={() => setDialog(null)} />}
      {store.error && <div className="toast error" onClick={() => store.setError(null)}>{store.error} <b>✕</b></div>}
      {store.toastText && <Toast text={store.toastText} onDone={() => store.toast('')} />}
    </div>
  )
}

/** The desktop app's Command Search window: only the search, opening pages in the main window. */
function CommandSearch() {
  const [round, setRound] = useState(0)
  useEffect(() => {
    document.documentElement.dataset.commandSearch = ''
    const again = () => setRound(r => r + 1)
    addEventListener('bloki:quick-search', again)
    return () => removeEventListener('bloki:quick-search', again)
  }, [])
  return <SearchDialog key={round} close={() => desktop?.closeCommandSearch()} onPick={(id, newTab) => desktop?.openPage(id, newTab)} />
}

export default function App() {
  const [theme, setThemeState] = useState(readTheme)
  const [sysDark, setSysDark] = useState(systemDark)
  const [route, setRoute] = useState(parseHash)
  // undefined = loading, null = logged out
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [session, setSession] = useState(0)
  const dark = theme === 'dark' || (theme === 'system' && sysDark)

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onSys = () => setSysDark(mq.matches)
    const onTheme = () => setThemeState(readTheme())
    mq.addEventListener('change', onSys)
    addEventListener('bloki:theme', onTheme)
    return () => { mq.removeEventListener('change', onSys); removeEventListener('bloki:theme', onTheme) }
  }, [])

  useEffect(() => {
    const on = () => setRoute(parseHash())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  const refresh = useCallback(() => {
    api.me().then(setMe).catch(() => setMe(null))
    setSession(s => s + 1)
  }, [])
  useEffect(() => { if (!route.public) refresh() }, [route.public, refresh])
  // Let the desktop app swap its launch placeholder for the page once there is something to show.
  useEffect(() => { if (me !== undefined || route.public) requestAnimationFrame(() => desktop?.ready()) }, [me, route.public])

  if (route.public) {
    setPublicRoot(route.public)
    return <StoreProvider me={null}><Shell dark={dark} /></StoreProvider>
  }
  setPublicRoot(null)
  if (me === undefined) return null
  if (me === null) return <AuthScreen invite={route.invite} onDone={refresh} />
  if (route.invite) return <AcceptInvite token={route.invite} onDone={refresh} />
  if (route.quickSearch) return <StoreProvider me={me}><CommandSearch /></StoreProvider>
  return <StoreProvider key={session + (me.workspaceId ?? '')} me={me}><Shell dark={dark} /></StoreProvider>
}
