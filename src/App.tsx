import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ChevronsRight, Clock, Globe, LayoutTemplate, Lock, Menu as MenuIcon, Star, Users } from 'lucide-react'
import { api, setPublicRoot, type Me } from './api'
import { iconOf, label, parseHash, StoreProvider, useStore } from './store'
import { applyTemplate, importCSV, importHTML, importMarkdown, importNotion, Sidebar } from './Sidebar'
import { SearchDialog } from './Search'
import { AcceptInvite, AuthScreen, ClipScreen, personName, ResetScreen, SettingsDialog } from './Access'
import { Avatar } from './Comments'
// The page view brings the editor, databases and comments: it downloads in parallel with the app shell.
const PageView = lazy(() => import('./PageView').then(m => ({ default: m.PageView })))
import { TEMPLATES } from './templates'
import { isTemplate } from './db/model'
import { alt, coverStyle, mod, shift, timeAgo, Toast, Tooltips } from './ui'
import './styles.css'
// A shared form (#/form/…) opens without the rest of the app.
const FormPage = lazy(() => import('./db/Form').then(m => ({ default: m.FormPage })))

const desktop = (window as { blokiDesktop?: { ready: () => void; openPage: (id: string, newTab: boolean) => void; closeCommandSearch: () => void; offline?: { pending: () => Promise<{ id: string; html: string; base: number }[]>; sent: (id: string) => Promise<void> }; chrome?: (info: { workspace: string; icon: string; width: number; collapsed: boolean }) => void } }).blokiDesktop

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

/** Notion's Library: every page you can reach in one table, with Recents, Favorites, Shared and Private tabs. */
function Library() {
  const store = useStore()
  const [tab, setTab] = useState<'recents' | 'favorites' | 'shared' | 'private'>('recents')
  const seen = new Map(visited().map(v => [v.id, v.at]))
  const rootOf = (id: string) => { let p = store.byId.get(id); while (p?.parent_id && store.byId.get(p.parent_id)) p = store.byId.get(p.parent_id); return p }
  const live = store.pages.filter(p => !p.trashed && !isTemplate(p))
  const rows = (tab === 'recents' ? live.filter(p => seen.has(p.id)).sort((a, b) => seen.get(b.id)! - seen.get(a.id)!)
    : tab === 'favorites' ? live.filter(p => p.favorite)
    : live.filter(p => rootOf(p.id)?.section === tab).sort((a, b) => b.updated - a.updated)).slice(0, 200)
  const source = (p: (typeof live)[number]) => {
    const parent = p.parent_id ? store.byId.get(p.parent_id) : undefined
    if (parent) return <>{iconOf(parent, 16)} {label(parent)}</>
    const sec = rootOf(p.id)?.section
    return sec === 'private' ? <><Lock size={14} /> Private</> : sec === 'shared' ? <><Users size={14} /> Shared</> : <><Globe size={14} /> Workspace</>
  }
  const tabs = [['recents', <Clock size={16} />, 'Recents'], ['favorites', <Star size={16} />, 'Favorites'], ['shared', <Users size={16} />, 'Shared'], ['private', <Lock size={16} />, 'Private']] as const
  return (
    <div className="page"><div className="page-body library">
      <div className="library-head">
        <h1>Library</h1>
        {store.me?.role !== 'guest' && store.me?.workspaceId && <button className="primary" onClick={() => store.create({ section: 'private' })}>New page</button>}
      </div>
      <div className="db-tabs library-tabs">
        {tabs.map(([k, icon, name]) => <button key={k} className={'view-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{icon}<span>{name}</span></button>)}
      </div>
      <div className="library-table">
        <div className="library-row head"><span>Page name</span><span>Created by</span><span>Source</span><span>Last edited time</span><span>Last visited time</span></div>
        {rows.map(p => (
          <button key={p.id} className="library-row" onClick={() => store.go(p.id)}>
            <span className="library-name">{iconOf(p, 16)} <b>{label(p)}</b></span>
            <span className="library-person">{p.created_by ? <><Avatar name={personName(store.people, p.created_by)} size={20} /> {personName(store.people, p.created_by)}</> : null}</span>
            <span className="library-source">{source(p)}</span>
            <span>{timeAgo(p.updated)}</span>
            <span>{seen.has(p.id) ? timeAgo(seen.get(p.id)!) : ''}</span>
          </button>
        ))}
        {!rows.length && <div className="muted library-empty">No pages here yet</div>}
      </div>
    </div></div>
  )
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
  [`${mod}${alt}0`, 'Text'], [`${mod}${alt}1–3`, 'Heading 1–3'], [`${mod}${alt}4`, 'To-do'], [`${mod}${alt}5`, 'Bulleted list'], [`${mod}${alt}6`, 'Numbered list'], [`${mod}${alt}7`, 'Toggle list'], [`${mod}${alt}8`, 'Code'], [`${mod}${alt}9`, 'Page'],
  ['/', 'Insert a block'], ['@', 'Mention a person or page'], ['[[', 'Link to a page'], ['---', 'Divider'], ['# / ## / ### / ####', 'Headings'], ['[]', 'To-do'], ['>', 'Toggle'], ['"', 'Quote'],
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
  // Narrow windows (phones) start with the sidebar closed, as Notion's mobile layout does.
  const narrowScreen = () => matchMedia('(max-width: 760px)').matches
  const [collapsed, setCollapsed] = useState(() => narrowScreen() || readNumber('sidebarCollapsed', 0) === 1)
  const [peek, setPeek] = useState(false)
  const [library, setLibrary] = useState(() => !!parseHash().library)
  useEffect(() => { const on = () => setLibrary(!!parseHash().library); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on) }, [])
  const [width, setWidth] = useState(() => readNumber('sidebarWidth', 248))
  // Settings → Import; here rather than in the sidebar, which isn't mounted while it's collapsed.
  useEffect(() => {
    const on: [string, () => void][] = [['bloki:import', () => importMarkdown(store)], ['bloki:import-csv', () => importCSV(store)], ['bloki:import-html', () => importHTML(store)], ['bloki:import-notion', () => importNotion(store)]]
    for (const [e, f] of on) addEventListener(e, f)
    return () => { for (const [e, f] of on) removeEventListener(e, f) }
  }, [store])

  useEffect(() => save('sidebarWidth', String(width)), [width])
  useEffect(() => { if (!narrowScreen()) save('sidebarCollapsed', collapsed ? '1' : '0') }, [collapsed])
  // Desktop: edits made in the offline reader are sent once Bloki loads again. If the page changed on the server
  // meanwhile, the offline version is added as a "Changes made offline" toggle instead of replacing anything.
  useEffect(() => {
    if (!store.me || !desktop?.offline) return
    desktop.offline.pending().then(async list => {
      if (!list.length) return
      const { htmlToBlocks } = await import('./Editor')
      let n = 0
      for (const p of list) {
        try {
          const page = await api.get(p.id)
          // The saved copy starts with the page title and may hold placeholder paragraphs; neither belongs in the content.
          const text = (b: unknown) => ((b as { content?: { text?: string }[] }).content ?? []).map(c => c.text ?? '').join('').replace(/\uFFFC/g, '').trim()
          let blocks = (await htmlToBlocks(p.html)).filter(b => (b as { type: string }).type !== 'paragraph' || text(b))
          if ((blocks[0] as { type?: string })?.type === 'heading' && text(blocks[0]) === (page.title || '').trim()) blocks = blocks.slice(1)
          const content = page.updated <= p.base ? blocks
            : [...(page.content ?? []), { type: 'toggleListItem', content: [{ type: 'text', text: 'Changes made offline', styles: { bold: true } }], children: blocks }]
          await api.update(p.id, { content } as never)
          await desktop.offline!.sent(p.id)
          n++
        } catch { /* try again next time */ }
      }
      if (n) { store.toast(`Sent ${n} offline edit${n === 1 ? '' : 's'}`); store.reload().catch(() => {}) }
    }).catch(() => {})
  }, [store.me?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // In the desktop app the workspace switcher and sidebar button live in the tab bar, as in Notion's.
  const ws = store.me?.workspaces.find(w => w.id === store.me?.workspaceId)
  useEffect(() => { desktop?.chrome?.({ workspace: ws?.name ?? '', icon: ws?.icon ?? '', width, collapsed }) }, [ws?.name, ws?.icon, width, collapsed])
  useEffect(() => {
    const toggle = () => { setCollapsed(c => !c); setPeek(false) }
    addEventListener('bloki:toggle-sidebar', toggle)
    return () => removeEventListener('bloki:toggle-sidebar', toggle)
  }, [])
  useEffect(() => { if (store.current) recordVisit(store.current) }, [store.current])
  // Picking a page on a phone closes the floating sidebar.
  useEffect(() => { if (narrowScreen()) setCollapsed(true) }, [store.current]) // eslint-disable-line react-hooks/exhaustive-deps
  // Open on the last visited page unless the person prefers Home.
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (started || !store.pages.length) return
    setStarted(true)
    const last = visited()[0]
    if (!store.current && !parseHash().library && store.me?.prefs?.startPage !== 'home' && last && store.byId.get(last.id) && !store.byId.get(last.id)!.trashed) store.go(last.id)
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
    // As in Notion, a side panel or peek that would squeeze the page below 480px hides the sidebar.
    const narrow = (e: Event) => { if (innerWidth - width - (e as CustomEvent<number>).detail < 480) { setCollapsed(true); setPeek(false) } }
    addEventListener('bloki:narrow', narrow)
    addEventListener('keydown', on)
    addEventListener('bloki:shortcuts', shortcuts)
    addEventListener('bloki:settings', settings)
    return () => { removeEventListener('keydown', on); removeEventListener('bloki:shortcuts', shortcuts); removeEventListener('bloki:settings', settings); removeEventListener('bloki:narrow', narrow) }
  }, [store, dark, width])

  const current = store.current ? store.byId.get(store.current) : undefined
  useEffect(() => { document.title = current ? `${current.icon && !current.icon.startsWith('icon:') && !current.icon.includes('/') ? current.icon + ' ' : ''}${label(current)}` : 'Bloki' }, [current])

  if (store.published) {
    return <div className="app"><main><Suspense fallback={null}>{store.current ? <PageView id={store.current} dark={dark} /> : null}</Suspense></main></div>
  }

  const sidebar = <Sidebar width={width} setWidth={setWidth} collapse={() => { setCollapsed(true); setPeek(false) }}
    openSearch={() => setDialog({ kind: 'search' })} openSettings={tab => setDialog({ kind: 'settings', tab })} />

  return (
    <div className="app">
      {!collapsed && sidebar}
      {/* On a phone the open sidebar floats over the page: tapping beside it closes it. */}
      {!collapsed && narrowScreen() && <div className="sidebar-backdrop" onClick={() => setCollapsed(true)} />}
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
        <Suspense fallback={null}>{store.current ? <PageView id={store.current} dark={dark} sidebarCollapsed={collapsed} /> : library ? <Library /> : <Home />}</Suspense>
      </main>
      {dialog?.kind === 'search' && <SearchDialog close={() => setDialog(null)} />}
      {dialog?.kind === 'settings' && <SettingsDialog initialTab={dialog.tab} close={() => setDialog(null)} />}
      {dialog?.kind === 'shortcuts' && <Shortcuts close={() => setDialog(null)} />}
      {store.error && <div className="toast error" onClick={() => store.setError(null)}>{store.error} <b>✕</b></div>}
      <Tooltips />
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
  const [formLogin, setFormLogin] = useState(false)
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
  if (route.form) return me === null && formLogin
    ? <AuthScreen onDone={() => { setFormLogin(false); refresh() }} />
    : <Suspense fallback={null}><FormPage dbId={route.form.db} viewId={route.form.view} who={me?.user.name} login={() => setFormLogin(true)} key={me?.user.id ?? 'anon'} /></Suspense>
  if (route.reset) return <ResetScreen token={route.reset} onDone={refresh} />
  if (me === null) return <AuthScreen invite={route.invite} onDone={refresh} />
  if (route.invite) return <AcceptInvite token={route.invite} onDone={refresh} />
  if (route.quickSearch) return <StoreProvider me={me}><CommandSearch /></StoreProvider>
  if (route.clip) return <StoreProvider me={me}><ClipScreen clip={route.clip} /></StoreProvider>
  return <StoreProvider key={session + (me.workspaceId ?? '')} me={me}><Shell dark={dark} /></StoreProvider>
}
