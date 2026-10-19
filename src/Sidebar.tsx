import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Library as LibraryIcon, Archive, CheckCheck, ChevronDown, ChevronRight, ChevronsLeft, CircleHelp, FileText, Home, Inbox as InboxIcon, Keyboard, LayoutTemplate,
  MessageSquare, MoreHorizontal, Plus, RotateCcw, Search, Settings, SquarePen, Trash2, Upload, UserPlus, Users,
} from 'lucide-react'
import { api, can, uid, type Notice, type Page, type Team } from './api'
import { TeamBrowser, TeamDialog, TeamIcon } from './Teams'
import { parseCSV } from './db/model'
import { ancestors, iconOf, label, useStore } from './store'
import { WorkspaceMenu } from './Access'
import { Menu, mod, Popover, timeAgo, usePopover } from './ui'
import { MoveTo, pageMenuItems, Rename } from './pageActions'
import { TEMPLATES, type Template } from './templates'

type Store = ReturnType<typeof useStore>

function readSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
}
function useStoredSet(key: string) {
  const [set, setSet] = useState(() => readSet(key))
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify([...set])) } catch { /* private mode */ } }, [key, set])
  const toggle = useCallback((id: string, on?: boolean) => setSet(s => {
    if (on !== undefined && s.has(id) === on) return s
    const n = new Set(s)
    if (on ?? !n.has(id)) n.add(id); else n.delete(id)
    return n
  }), [])
  return [set, toggle] as const
}

function PageItem({ page, depth, expanded, toggle }: { page: Page; depth: number; expanded: Set<string>; toggle: (id: string, on?: boolean) => void }) {
  const store = useStore()
  const [over, setOver] = useState(false)
  const [menu, openMenu, closeMenu] = usePopover()
  const [pop, setPop] = useState<'rename' | 'move' | null>(null)
  const row = useRef<HTMLDivElement>(null)
  // Database rows live inside their database view, not in the tree.
  const kids = page.kind === 'db' ? [] : store.children(page.id)
  const open = expanded.has(page.id)
  const addable = page.kind === 'page' && can(page, 'edit')

  return (
    <>
      <div ref={row} className={'item' + (store.current === page.id ? ' active' : '') + (over ? ' over' : '') + (menu ? ' menu-open' : '')}
        style={{ paddingLeft: 8 + depth * 12 }}
        draggable={can(page, 'full')} onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('text/page', page.id) }}
        onDragOver={e => { if (!e.dataTransfer.types.includes('text/page')) return; e.preventDefault(); e.stopPropagation(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation(); setOver(false)
          const id = e.dataTransfer.getData('text/page')
          if (!id || ancestors(store.byId, page.id).some(a => a.id === id)) return
          if (can(page, page.kind === 'db' ? 'edit_content' : 'edit')) { store.patch(id, { parent_id: page.id }); toggle(page.id, true) }
        }}
        onClick={e => { if (e.metaKey || e.ctrlKey) window.open(`#/${page.id}`, '_blank'); else store.go(page.id) }}
        onContextMenu={e => { e.preventDefault(); openMenu(row.current!) }}>
        <span className="item-icon">
          <span className="item-emoji">{iconOf(page)}</span>
          <button className="twisty" aria-label={open ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); toggle(page.id) }}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </span>
        <span className="item-label">{label(page)}</span>
        <span className="item-actions">
          {addable && <button title="Add a page inside" onClick={e => { e.stopPropagation(); toggle(page.id, true); store.create({ parent_id: page.id }) }}><Plus size={16} /></button>}
          <button title="Delete, duplicate, and more…" onClick={e => { e.stopPropagation(); openMenu(e.currentTarget) }}><MoreHorizontal size={16} /></button>
        </span>
      </div>
      <Popover anchor={menu} onClose={closeMenu} className="menu-pop" width={265}>
        <Menu filter onClose={closeMenu} items={pageMenuItems(store, page, { rename: () => setPop('rename'), move: () => setPop('move') })} />
      </Popover>
      {pop === 'rename' && <Popover anchor={row.current} onClose={() => setPop(null)} className="menu-pop" width={300}><Rename page={page} close={() => setPop(null)} /></Popover>}
      {pop === 'move' && <Popover anchor={row.current} side="right" onClose={() => setPop(null)} className="menu-pop" width={320}><MoveTo page={page} close={() => setPop(null)} /></Popover>}
      {open && kids.map(k => <PageItem key={k.id} page={k} depth={depth + 1} expanded={expanded} toggle={toggle} />)}
      {open && page.kind === 'page' && !kids.length && <div className="item empty-item" style={{ paddingLeft: 30 + depth * 12 }}>No pages inside</div>}
    </>
  )
}

function Section({ id, title, pages, drop, add, expanded, toggle, collapsed, toggleCollapsed }: {
  id: string; title: string; pages: Page[]; drop?: 'workspace' | 'private'; add?: () => void
  expanded: Set<string>; toggle: (id: string, on?: boolean) => void; collapsed: Set<string>; toggleCollapsed: (id: string) => void
}) {
  const store = useStore()
  const [over, setOver] = useState(false)
  const [more, openMore, closeMore] = usePopover()
  if (!pages.length && !add) return null
  const hidden = collapsed.has(id)
  // Dropping a page on a section moves it to the top level and sets who can see it, as in Notion.
  const onDrop = async (pid: string) => {
    const p = store.byId.get(pid)
    if (!p || !drop || !can(p, 'full')) return
    await api.update(pid, { parent_id: null })
    await api.setShare(pid, { workspace_access: drop === 'private' ? 'none' : 'full' })
    await store.reload()
  }
  return (
    <div className="side-section">
      <div className={'section' + (over ? ' over' : '')}
        onDragOver={e => { if (drop) { e.preventDefault(); setOver(true) } }} onDragLeave={() => setOver(false)}
        onDrop={e => { setOver(false); onDrop(e.dataTransfer.getData('text/page')).catch(err => store.setError(err.message)) }}>
        <button className="section-title" onClick={() => toggleCollapsed(id)}>{title}</button>
        <span className="section-actions">
          <button title="More" onClick={e => openMore(e.currentTarget)}><MoreHorizontal size={14} /></button>
          {add && <button title="Add a page" onClick={add}><Plus size={14} /></button>}
        </span>
      </div>
      <Popover anchor={more} onClose={closeMore} className="menu-pop" width={220}>
        <Menu onClose={closeMore} items={[
          { label: hidden ? 'Show section' : 'Hide section', onClick: () => toggleCollapsed(id) },
          { label: 'Collapse all', onClick: () => pages.forEach(p => toggle(p.id, false)) },
        ]} />
      </Popover>
      {!hidden && pages.map(p => <PageItem key={p.id} page={p} depth={0} expanded={expanded} toggle={toggle} />)}
      {!hidden && !pages.length && add && <button className="item empty-item add-first" onClick={add}><Plus size={14} /> Add a page</button>}
    </div>
  )
}

/** Teamspaces the person belongs to, each with its own pages, as in Notion's sidebar. */
function TeamsSection({ roots, expanded, toggle, collapsed, toggleCollapsed }: {
  roots: Page[]; expanded: Set<string>; toggle: (id: string, on?: boolean) => void; collapsed: Set<string>; toggleCollapsed: (id: string) => void
}) {
  const store = useStore()
  const [dialog, setDialog] = useState<{ kind: 'new' | 'browse' } | { kind: 'edit'; team: Team } | null>(null)
  const [menu, setMenu] = useState<{ el: HTMLElement; team: Team } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const joined = store.teams.filter(t => t.role)
  const member = store.me?.role === 'owner' || store.me?.role === 'member'
  if (!member && !joined.length) return null
  const hidden = collapsed.has('teams')
  // Dropping a page on a teamspace moves it to the teamspace's top level.
  const drop = async (team: string, pid: string) => {
    const p = store.byId.get(pid)
    if (!p || !can(p, 'full')) return
    await api.update(pid, { parent_id: null, team_id: team })
    await store.reload()
  }
  return (
    <div className="side-section">
      <div className="section">
        <button className="section-title" onClick={() => toggleCollapsed('teams')}>Teamspaces</button>
        <span className="section-actions">
          <button title="Browse teamspaces" onClick={() => setDialog({ kind: 'browse' })}><MoreHorizontal size={14} /></button>
          {member && <button title="Create a teamspace" onClick={() => setDialog({ kind: 'new' })}><Plus size={14} /></button>}
        </span>
      </div>
      {!hidden && joined.map(t => {
        const pages = roots.filter(p => p.section === 'team' && p.team_id === t.id)
        const open = !expanded.has('team-closed:' + t.id)
        return (
          <div key={t.id}>
            <div className={'item team-item' + (over === t.id ? ' over' : '')} style={{ paddingLeft: 8 }} onClick={() => toggle('team-closed:' + t.id, open)}
              onDragOver={e => { if (!e.dataTransfer.types.includes('text/page')) return; e.preventDefault(); setOver(t.id) }} onDragLeave={() => setOver(null)}
              onDrop={e => { e.preventDefault(); setOver(null); drop(t.id, e.dataTransfer.getData('text/page')).catch(err => store.setError(err.message)) }}>
              <span className="item-icon"><TeamIcon team={t} size={20} /></span>
              <span className="item-label">{t.name}</span>
              <span className="item-actions">
                <button title="Teamspace settings and more" onClick={e => { e.stopPropagation(); setMenu({ el: e.currentTarget, team: t }) }}><MoreHorizontal size={16} /></button>
                <button title="Add a page" onClick={e => { e.stopPropagation(); store.create({ team_id: t.id }) }}><Plus size={16} /></button>
              </span>
            </div>
            {open && pages.map(p => <PageItem key={p.id} page={p} depth={1} expanded={expanded} toggle={toggle} />)}
            {open && !pages.length && <button className="item empty-item add-first" style={{ paddingLeft: 20 }} onClick={() => store.create({ team_id: t.id })}><Plus size={14} /> Add a page</button>}
          </div>
        )
      })}
      {!hidden && member && !joined.length && <button className="item empty-item add-first" onClick={() => setDialog({ kind: store.teams.length ? 'browse' : 'new' })}><Plus size={14} /> {store.teams.length ? 'Browse teamspaces' : 'Create a teamspace'}</button>}
      <Popover anchor={menu?.el ?? null} onClose={() => setMenu(null)} className="menu-pop" width={240}>
        {menu && <Menu onClose={() => setMenu(null)} items={[
          { label: 'Teamspace settings', onClick: () => setDialog({ kind: 'edit', team: menu.team }) },
          { label: 'Add a page', onClick: () => store.create({ team_id: menu.team.id }) },
          { label: 'Browse teamspaces', onClick: () => setDialog({ kind: 'browse' }) },
          { label: 'Leave teamspace', danger: true, onClick: () => api.setTeamMember(menu.team.id, store.me!.user.id, null).then(() => store.reload()).catch(e => store.setError(e.message)) },
        ]} />}
      </Popover>
      {dialog?.kind === 'new' && <TeamDialog close={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <TeamDialog team={dialog.team} close={() => setDialog(null)} />}
      {dialog?.kind === 'browse' && <TeamBrowser close={() => setDialog(null)} open={team => setDialog({ kind: 'edit', team })} />}
    </div>
  )
}

function NavRow({ icon, label: text, onClick, hint, badge, active }: { icon: ReactNode; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; hint?: string; badge?: number; active?: boolean }) {
  return (
    <button className={'nav' + (active ? ' active' : '')} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{text}</span>
      {!!badge && <span className="nav-badge">{badge}</span>}
      {hint && <kbd>{hint}</kbd>}
    </button>
  )
}

export function Sidebar({ width, setWidth, collapse, openSearch, openSettings }: {
  width: number; setWidth: (w: number) => void; collapse: () => void; openSearch: () => void; openSettings: (tab?: string) => void
}) {
  const store = useStore()
  const [expanded, toggle] = useStoredSet('expanded')
  const [collapsed, toggleCollapsed] = useStoredSet('collapsedSections')
  const [panel, setPanel] = useState<{ kind: 'trash' | 'help'; el: HTMLElement } | null>(null)
  // Notion's sidebar tabs: Home shows the page tree, Inbox shows notifications in the sidebar itself.
  const [tab, setTab] = useState<'home' | 'inbox'>('home')
  const [templates, setTemplates] = useState(false)
  const [unread, setUnread] = useState(0)
  const member = store.me?.role === 'owner' || store.me?.role === 'member'

  // Keep the Inbox badge fresh; polling is enough for one server.
  useEffect(() => {
    if (!store.me?.workspaceId) return
    const load = () => api.inbox().then(r => setUnread(r.unread)).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [store.me?.workspaceId])

  // Expand the ancestors of the open page so it is visible in the tree.
  useEffect(() => {
    if (store.current) for (const a of ancestors(store.byId, store.current).slice(0, -1)) toggle(a.id, true)
  }, [store.current, store.byId, toggle])

  useEffect(() => {
    const on = () => setTemplates(true)
    addEventListener('bloki:templates', on)
    return () => removeEventListener('bloki:templates', on)
  }, [store])

  const favorites = store.pages.filter(p => p.favorite && !p.trashed)
  const roots = store.children(null)
  const newPage = () => store.create({ section: 'private' })

  const resize = (e: React.MouseEvent) => {
    e.preventDefault()
    const move = (m: MouseEvent) => setWidth(Math.max(200, Math.min(480, m.clientX)))
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); document.body.classList.remove('resizing') }
    document.body.classList.add('resizing')
    addEventListener('mousemove', move)
    addEventListener('mouseup', up)
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="side-top">
        <div className="ws-row">
          {store.me && <WorkspaceMenu openSettings={openSettings} />}
          <button className="side-icon-btn hover-only" title={`Close sidebar (${mod}\\)`} onClick={collapse}><ChevronsLeft size={18} /></button>
          {member && <button className="side-icon-btn" title="Create a new page" onClick={newPage}><SquarePen size={17} /></button>}
        </div>
        <div className="side-tabs" role="tablist" aria-label="Sidebar navigation">
          {/* Clicking Home again opens the Home page, so it stays one click away. */}
          <button role="tab" aria-selected={tab === 'home'} className={'side-tab' + (tab === 'home' ? ' on' : '')} title="Home" onClick={() => (tab === 'home' ? store.go(null) : setTab('home'))}><Home size={22} /></button>
          <button role="tab" aria-selected={tab === 'inbox'} className={'side-tab' + (tab === 'inbox' ? ' on' : '')} title="Inbox" onClick={() => setTab('inbox')}>
            <InboxIcon size={22} />{!!unread && <span className="side-tab-dot" aria-label={`${unread} unread`} />}
          </button>
          <button className="side-tab side-search" title={`Search (${mod}K)`} onClick={openSearch}><Search size={22} /></button>
        </div>
      </div>

      {tab === 'inbox' ? <div className="side-inbox"><InboxPanel setUnread={setUnread} close={() => setTab('home')} /></div> : <div className="tree">
        {favorites.length > 0 && <Section id="favorites" title="Favorites" pages={favorites} expanded={expanded} toggle={toggle} collapsed={collapsed} toggleCollapsed={toggleCollapsed} />}
        <TeamsSection roots={roots} expanded={expanded} toggle={toggle} collapsed={collapsed} toggleCollapsed={toggleCollapsed} />
        <Section id="workspace" title="Workspace" pages={roots.filter(p => p.section === 'workspace')} drop={member ? 'workspace' : undefined}
          add={member ? () => store.create({ section: 'workspace' }) : undefined} expanded={expanded} toggle={toggle} collapsed={collapsed} toggleCollapsed={toggleCollapsed} />
        <Section id="shared" title="Shared" pages={roots.filter(p => p.section === 'shared')} expanded={expanded} toggle={toggle} collapsed={collapsed} toggleCollapsed={toggleCollapsed} />
        <Section id="private" title="Private" pages={roots.filter(p => p.section === 'private')} drop={member ? 'private' : undefined}
          add={member ? newPage : undefined} expanded={expanded} toggle={toggle} collapsed={collapsed} toggleCollapsed={toggleCollapsed} />
        {!member && !roots.length && <div className="muted small pad">Pages shared with you appear here.</div>}

        <div className="side-section">
          <NavRow icon={<Settings size={17} />} label="Settings" onClick={() => openSettings()} />
          {member && <NavRow icon={<LayoutTemplate size={17} />} label="Templates" onClick={() => setTemplates(true)} />}
          <NavRow icon={<LibraryIcon size={17} />} label="Library" active={location.hash === '#/library'} onClick={() => { location.hash = '#/library' }} />
          {/* Notion keeps Help as a sidebar row above Trash. */}
          <NavRow icon={<CircleHelp size={17} />} label="Help" active={panel?.kind === 'help'} onClick={e => setPanel(panel?.kind === 'help' ? null : { kind: 'help', el: e.currentTarget })} />
          <NavRow icon={<Trash2 size={17} />} label="Trash" active={panel?.kind === 'trash'} onClick={e => setPanel(panel?.kind === 'trash' ? null : { kind: 'trash', el: e.currentTarget })} />
        </div>
      </div>}

      <div className="side-foot">
        {store.me?.role === 'owner' ? <NavRow icon={<UserPlus size={17} />} label="Invite members" onClick={() => openSettings('people')} /> : <span />}
      </div>

      <div className="side-resizer" onMouseDown={resize} onDoubleClick={() => setWidth(248)} title="Drag to resize" />

      {panel?.kind === 'trash' && <Popover anchor={panel.el} side="right" onClose={() => setPanel(null)} className="side-panel" width={414}><TrashPanel close={() => setPanel(null)} /></Popover>}
      {panel?.kind === 'help' && (
        <Popover anchor={panel.el} onClose={() => setPanel(null)} className="menu-pop" width={260}>
          <Menu onClose={() => setPanel(null)} items={[
            { icon: <FileText size={16} />, label: 'Documentation', onClick: () => window.open('https://github.com/Lukilov/bloki#readme', '_blank', 'noopener') },
            { icon: <Keyboard size={16} />, label: 'Keyboard shortcuts', hint: `${mod}/`, onClick: () => dispatchEvent(new CustomEvent('bloki:shortcuts')) },
            ...(member ? [{ icon: <Upload size={16} />, label: 'Import', onClick: () => importMarkdown(store) }] : []),
            { divider: true },
            { note: 'Bloki · self-hosted' },
          ]} />
        </Popover>
      )}
      {templates && <TemplatePicker close={() => setTemplates(false)} />}
    </aside>
  )
}

export function importMarkdown(store: Store, parent_id: string | null = null) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.md,.markdown,.txt', multiple: true })
  input.onchange = async () => {
    // The editor (and its Markdown parser) loads on demand, so it stays out of the first download.
    const { fromMarkdown } = await import('./Editor')
    let last: Page | undefined
    for (const f of Array.from(input.files ?? [])) {
      const text = await f.text()
      const heading = text.match(/^#\s+(.+)\n/)
      const title = heading?.[1] ?? f.name.replace(/\.(md|markdown|txt)$/, '')
      last = await store.create({ title, parent_id, content: fromMarkdown(heading ? text.slice(heading[0].length) : text), section: parent_id ? undefined : 'private' }, false)
    }
    if (last) store.go(last.id)
  }
  input.click()
}

/** Import a CSV file as a new database: the first column becomes the page name, the others text properties. */
export function importCSV(store: Store) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv,text/csv' })
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    const [head = [], ...rows] = parseCSV(await f.text())
    if (!head.length) return
    const props = head.slice(1).map(name => ({ id: uid(), name: name || 'Column', type: 'text' as const }))
    const db = await store.create({ kind: 'db', title: f.name.replace(/\.csv$/i, ''), section: 'private', schema: { titleName: head[0] || 'Name', props, views: [{ id: uid(), name: 'Table', type: 'table' }] } }, false)
    for (const r of rows.slice(0, 5000)) await api.create({ parent_id: db.id, title: r[0] ?? '', props: Object.fromEntries(props.map((p, i) => [p.id, r[i + 1] ?? ''])) })
    await store.reload()
    store.go(db.id)
  }
  input.click()
}

/** Import HTML files as pages (through the editor's HTML reader). */
export function importHTML(store: Store) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.html,.htm,text/html', multiple: true })
  input.onchange = async () => {
    const { htmlToBlocks } = await import('./Editor')
    let last: Page | undefined
    for (const f of Array.from(input.files ?? [])) {
      const html = await f.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const title = doc.title || doc.querySelector('h1')?.textContent || f.name.replace(/\.html?$/i, '')
      last = await store.create({ title, content: await htmlToBlocks(doc.body.innerHTML) as never, section: 'private' }, false)
    }
    if (last) store.go(last.id)
  }
  input.click()
}

/** Import a Notion export (Markdown & CSV .zip): the page tree, databases with their rows, images, and links between pages. */
export function importNotion(store: Store) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.zip,application/zip' })
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    try {
      store.toast('Importing from Notion…')
      const [{ unzip, planNotion, resolve, inferColumn }, { fromMarkdown }] = await Promise.all([import('./notionZip'), import('./Editor')])
      const files = await unzip(await f.arrayBuffer())
      const plan = planNotion(files)
      if (!plan.length) throw new Error('No Notion pages in this file. Export from Notion as "Markdown & CSV".')
      type N = (typeof plan)[number]
      // Pass 1: every page and database, so links can point at them. ponytail: one request per page; batch if imports get big.
      const ids = new Map<string, string>(), made: [N, string][] = []
      const make = async (n: N, parent_id: string | null, conv?: [string, (v: string) => unknown][]) => {
        const base = { title: n.title, ...(parent_id ? { parent_id } : { section: 'private' as const }) }
        // Each column's type comes from its values (numbers, dates, Yes/No, links, repeated values become selects).
        const cols = n.kind === 'db' ? (n.head ?? []).slice(1).map((_, i) => inferColumn(n.children.map(r => r.cells?.[i] ?? ''), uid)) : []
        const props = n.head?.slice(1).map((name, i) => ({ id: uid(), name: name || 'Column', type: cols[i].type, ...(cols[i].options ? { options: cols[i].options } : {}) })) ?? []
        const page = n.kind === 'db'
          ? await api.create({ ...base, kind: 'db', schema: { titleName: n.head?.[0] || 'Name', props, views: [{ id: uid(), name: 'Table', type: 'table' }] } })
          : await api.create({ ...base, ...(conv ? { props: Object.fromEntries(conv.map(([id, f], i) => [id, f(n.cells?.[i] ?? '')])) } : {}) })
        ids.set(n.path, page.id)
        if (n.kind === 'db') ids.set(n.path.replace(/(_all)?\.csv$/, '_all.csv'), page.id).set(n.path.replace(/_all\.csv$/, '.csv'), page.id)
        made.push([n, page.id])
        for (const c of n.children) await make(c, page.id, n.kind === 'db' ? props.map((p, i) => [p.id, cols[i].convert] as [string, (v: string) => unknown]) : undefined)
        return page.id
      }
      const first = await make(plan[0], null)
      for (const n of plan.slice(1)) await make(n, null)
      // Pass 2: text, with uploaded images and Notion links turned into Bloki page links.
      const uploaded = new Map<string, string>()
      type B = { type: string; props?: Record<string, unknown>; content?: unknown; children?: B[] }
      const local = (u: unknown): u is string => typeof u === 'string' && !!u && !/^[a-z]+:/i.test(u)
      const fix = async (blocks: B[], from: string): Promise<B[]> => Promise.all(blocks.map(async b => {
        if (['image', 'file', 'video', 'audio'].includes(b.type) && local(b.props?.url)) {
          const path = resolve(from, b.props.url as string), data = files.get(path)
          if (data) {
            if (!uploaded.has(path)) uploaded.set(path, await api.upload(new File([data.slice()], path.split('/').at(-1)!)))
            b = { ...b, props: { ...b.props, url: uploaded.get(path) } }
          }
        }
        const items = Array.isArray(b.content) ? b.content as { type: string; href?: string }[] : []
        const target = (i: { type: string; href?: string }) => i.type === 'link' && local(i.href) ? ids.get(resolve(from, i.href!)) : undefined
        // A paragraph that is only a link to a page is how Notion writes a sub-page block.
        if (b.type === 'paragraph' && items.length === 1 && target(items[0])) return { type: 'page', props: { pageId: target(items[0]) } }
        if (items.some(target)) b = { ...b, content: items.map(i => target(i) ? { type: 'mention', props: { pageId: target(i) } } : i) }
        return b.children?.length ? { ...b, children: await fix(b.children, from) } : b
      }))
      for (const [n, id] of made) if (n.md) await api.update(id, { content: await fix(await fromMarkdown(n.md) as unknown as B[], n.path) })
      await store.reload()
      store.toast(`Imported ${made.length} page${made.length === 1 ? '' : 's'} from Notion`)
      store.go(first)
    } catch (e) { store.setError((e as Error).message) }
  }
  input.click()
}

/** Imports from Trello (board JSON), Asana (CSV), Evernote (.enex) and Confluence (HTML export .zip). */
export function importFrom(store: Store, kind: 'trello' | 'asana' | 'evernote' | 'confluence') {
  const accept = { trello: '.json,application/json', asana: '.csv,text/csv', evernote: '.enex', confluence: '.zip,application/zip' }[kind]
  const input = Object.assign(document.createElement('input'), { type: 'file', accept })
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    try {
      store.toast('Importing…')
      const im = await import('./importers')
      const { fromMarkdown, htmlToBlocks } = await import('./Editor')
      const parse = (src: string, type: DOMParserSupportedType) => new DOMParser().parseFromString(src, type)
      let first: string | undefined, count = 0
      const makeDb = async (plan: Awaited<ReturnType<typeof im.planTrello>>) => {
        const db = await api.create({ kind: 'db', title: plan.title, section: 'private', schema: { titleName: 'Name', props: plan.props as never, views: [{ id: uid(), name: 'Table', type: 'table' }] } })
        first = db.id
        for (const r of plan.rows) { await api.create({ parent_id: db.id, title: r.title, props: r.props, ...(r.md.trim() ? { content: await fromMarkdown(r.md) as never } : {}) }); count++ }
      }
      const makePages = async (plans: Awaited<ReturnType<typeof im.planEvernote>>, parent_id: string | null) => {
        for (const p of plans) {
          const page = await api.create({ title: p.title, ...(parent_id ? { parent_id } : { section: 'private' as const }), content: await htmlToBlocks(p.html) as never })
          first ??= page.id; count++
          await makePages(p.children, page.id)
        }
      }
      if (kind === 'trello') await makeDb(im.planTrello(JSON.parse(await f.text()), uid))
      if (kind === 'asana') await makeDb(im.planAsana(await f.text(), f.name.replace(/\.csv$/i, ''), uid))
      if (kind === 'evernote') {
        // Several notes go under one page named after the notebook file.
        const notes = im.planEvernote(await f.text(), parse)
        if (notes.length > 1) await makePages([{ title: f.name.replace(/\.enex$/i, ''), html: '', children: notes }], null)
        else await makePages(notes, null)
      }
      if (kind === 'confluence') {
        const { unzip } = await import('./notionZip')
        const tree = im.planConfluence(await unzip(await f.arrayBuffer()), parse)
        if (!tree.length) throw new Error('No Confluence pages in this file. Export the space as HTML.')
        await makePages(tree, null)
      }
      await store.reload()
      store.toast(`Imported ${count} page${count === 1 ? '' : 's'}`)
      if (first) store.go(first)
    } catch (e) { store.setError((e as Error).message) }
  }
  input.click()
}

function InboxPanel({ setUnread, close }: { setUnread: (n: number) => void; close: () => void }) {
  const store = useStore()
  const [items, setItems] = useState<Notice[] | null>(null)
  const [tab, setTab] = useState<'inbox' | 'archived'>('inbox')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [filter, openFilter, closeFilter] = usePopover()
  const apply = useCallback((r: { items: Notice[]; unread: number }) => { setItems(r.items); setUnread(r.unread) }, [setUnread])
  useEffect(() => { api.inbox().then(apply) }, [apply])

  const shown = (items ?? []).filter(n => (tab === 'archived' ? n.archived : !n.archived) && (!unreadOnly || !n.read))
  const verb = (n: Notice) => n.kind === 'mention' ? 'mentioned you in' : n.kind === 'comment' ? 'commented in' : n.kind === 'automation' ? `triggered “${n.text}” in` : n.kind === 'reminder' ? `Reminder (${n.text}):` : `invited you to`

  return (
    <div className="inbox">
      <div className="panel-head">
        <b>{tab === 'inbox' ? 'Inbox' : 'Archived'}</b>
        <span className="panel-tools">
          <button className="ghost" title="Filter" onClick={e => openFilter(e.currentTarget)}><MoreHorizontal size={16} /></button>
          <button className="ghost" title="Mark all as read" onClick={() => api.updateInbox({ all: true, read: true }).then(apply)}><CheckCheck size={16} /></button>
        </span>
      </div>
      <Popover anchor={filter} onClose={closeFilter} className="menu-pop" width={230} align="end">
        <Menu onClose={closeFilter} items={[
          { label: 'Inbox', checked: tab === 'inbox', onClick: () => setTab('inbox') },
          { label: 'Archived', checked: tab === 'archived', onClick: () => setTab('archived') },
          { divider: true },
          { label: 'Unread only', checked: unreadOnly, onClick: () => setUnreadOnly(!unreadOnly) },
          { label: 'Mark all as read', onClick: () => api.updateInbox({ all: true, read: true }).then(apply) },
          { label: 'Archive all read', onClick: () => api.updateInbox({ ids: (items ?? []).filter(n => n.read).map(n => n.id), archived: true }).then(apply) },
        ]} />
      </Popover>
      {items === null ? <div className="muted pad">…</div> : !shown.length ? (
        <div className="inbox-empty"><InboxIcon size={32} strokeWidth={1.4} /><div>{tab === 'inbox' ? 'You’re all caught up' : 'No archived notifications'}</div></div>
      ) : shown.map(n => (
        <div key={n.id} className={'notice' + (n.read ? '' : ' unread')} onClick={() => {
          if (!n.read) api.updateInbox({ ids: [n.id], read: true }).then(apply)
          if (n.page_id) store.go(n.page_id)
          close()
        }}>
          <span className="avatar">{(n.actor ?? '?')[0]}</span>
          <div className="notice-body">
            <div><b>{n.actor ?? 'Someone'}</b> {verb(n)} <b>{n.page_icon || (n.page_kind === 'db' ? '🗂️' : '📄')} {n.page_title || 'Untitled'}</b></div>
            {n.kind === 'comment' && <div className="notice-quote"><MessageSquare size={12} /> {n.text}</div>}
            {n.kind === 'share' && <div className="muted small">{n.text}</div>}
            <div className="muted small">{timeAgo(n.created)}</div>
          </div>
          <button className="ghost notice-archive" title={n.archived ? 'Unarchive' : 'Archive'} onClick={e => { e.stopPropagation(); api.updateInbox({ ids: [n.id], archived: !n.archived }).then(apply) }}><Archive size={15} /></button>
        </div>
      ))}
    </div>
  )
}

function TrashPanel({ close }: { close: () => void }) {
  const store = useStore()
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(false)
  // Show only the top of each trashed subtree.
  const items = store.pages
    .filter(p => p.trashed && !(p.parent_id && store.byId.get(p.parent_id)?.trashed))
    .filter(p => label(p).toLowerCase().includes(q.toLowerCase()))
    .filter(p => !mine || p.updated_by === store.me?.user.id || p.created_by === store.me?.user.id)
    .sort((a, b) => (b.trashed_at ?? 0) - (a.trashed_at ?? 0))
  return (
    <div className="trash">
      <input autoFocus className="menu-filter" placeholder="Search pages in Trash" value={q} onChange={e => setQ(e.target.value)} />
      <div className="chips">
        <button className={'chip-btn' + (mine ? ' on' : '')} onClick={() => setMine(!mine)}><Users size={13} /> Last edited by me</button>
      </div>
      <div className="trash-list">
        {!items.length && <div className="inbox-empty"><Trash2 size={32} strokeWidth={1.2} /><div className="muted">No matches found.</div></div>}
        {items.map(p => {
          const path = p.parent_id ? ancestors(store.byId, p.parent_id).map(label).join(' / ') : ''
          return (
            <div key={p.id} className="trash-item" onClick={() => { store.go(p.id); close() }}>
              <span className="menu-icon">{iconOf(p)}</span>
              <span className="menu-label">{label(p)}{path && <span className="menu-sub">{path}</span>}</span>
              {can(p, 'edit') && <button className="ghost" title="Restore" onClick={e => { e.stopPropagation(); store.patch(p.id, { trashed: false }) }}><RotateCcw size={15} /></button>}
              {can(p, 'full') && <button className="ghost" title="Delete from Trash" onClick={async e => {
                e.stopPropagation()
                if (!confirm(`Are you sure you want to delete “${label(p)}” from Trash? This can’t be undone.`)) return
                await api.remove(p.id); await store.reload()
              }}><Trash2 size={15} /></button>}
            </div>
          )
        })}
      </div>
      <div className="trash-foot muted small">Pages in Trash for over 30 days will be automatically deleted.</div>
    </div>
  )
}

export async function applyTemplate(store: Store, t: Template, parent_id: string | null = null) {
  const page = await store.create({ ...t.page, parent_id, section: parent_id ? undefined : 'private' }, false)
  if (t.rows) for (const r of t.rows(t.page.schema?.props ?? [])) await api.create({ parent_id: page.id, title: r.title, icon: r.icon ?? '', props: r.props })
  await store.reload()
  store.go(page.id)
}

function TemplatePicker({ close }: { close: () => void }) {
  const store = useStore()
  const [cat, setCat] = useState<Template['category'] | 'All'>('All')
  const [sel, setSel] = useState<Template>(TEMPLATES[0])
  const cats = ['All', 'Personal', 'Work', 'Projects', 'School'] as const
  const use = (t: Template) => { applyTemplate(store, t).catch(e => store.setError(e.message)); close() }
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog templates" onClick={e => e.stopPropagation()}>
        <nav className="settings-tabs">
          <div className="menu-heading">Templates</div>
          {cats.map(c => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c}</button>)}
        </nav>
        <div className="template-list">
          {TEMPLATES.filter(t => cat === 'All' || t.category === cat).map(t => (
            <button key={t.id} className={'template-item' + (sel.id === t.id ? ' active' : '')} onClick={() => setSel(t)} onDoubleClick={() => use(t)}>
              <span>{t.icon}</span> {t.name}
            </button>
          ))}
        </div>
        <div className="template-preview">
          <div className="template-cover">{sel.icon}</div>
          <h2>{sel.name}</h2>
          <p className="muted">{sel.description}</p>
          <p className="muted small"><FileText size={12} /> {sel.page.kind === 'db' ? `Database with ${sel.page.schema?.views?.length} views` : 'Page'}</p>
          <button className="primary big" onClick={() => use(sel)}>Use this template</button>
        </div>
      </div>
    </div>
  )
}
