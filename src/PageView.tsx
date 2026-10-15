import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight, Clock, Copy, CornerUpRight, Download, History as HistoryIcon, Image as ImageIcon, Link2, Lock, LockOpen, MessageSquare, MoreHorizontal,
  PanelTop, Redo2, Smile, Star, Trash2, Undo2, Upload, X,
} from 'lucide-react'
import { api, can, LEVEL_NAMES, type Comment, type Page } from './api'
import { ancestors, iconOf, label, useStore } from './store'
import { PageEditor, toHTML, toMarkdown } from './Editor'
import { coverStyle, Database, RowProperties } from './Database'
import { personName, ShareMenu } from './Access'
import { CommentsPanel, PageDiscussions } from './Comments'
import { CoverPicker, GRADIENTS, IconPicker, randomEmoji } from './IconPicker'
import { copyText, Menu, mod, Popover, shift, timeAgo, type Item } from './ui'
import { duplicate, MoveTo, pageUrl, trash } from './pageActions'
import { importMarkdown } from './Sidebar'

export function download(name: string, text: string, type = 'text/markdown') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name.replace(/[\\/:*?"<>|]/g, '-')
  a.click()
  URL.revokeObjectURL(a.href)
}

const wordCount = (content: unknown[] = []) => {
  const text = JSON.stringify(content).match(/"text":"((?:[^"\\]|\\.)*)"/g)?.map(t => t.slice(8, -1)).join(' ') ?? ''
  return text.split(/\s+/).filter(Boolean).length
}

type Layout = { backlinks?: 'expanded' | 'popover' | 'off'; discussions?: 'expanded' | 'minimal' | 'off' }

export function PageView({ id, dark, sidebarCollapsed, peek }: { id: string; dark: boolean; sidebarCollapsed?: boolean; peek?: boolean }) {
  const store = useStore()
  const meta = store.byId.get(id)
  const [page, setPage] = useState<Page | null>(null)
  const [version, setVersion] = useState(0)
  const [missing, setMissing] = useState(false)
  const [backlinks, setBacklinks] = useState<Pick<Page, 'id' | 'title' | 'icon'>[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [panel, setPanel] = useState<'comments' | 'updates' | null>(null)
  useEffect(() => { if (panel) dispatchEvent(new CustomEvent('bloki:narrow', { detail: 380 })) }, [panel])
  const [draft, setDraft] = useState<{ blockId: string; quote: string; id: string } | null>(null)
  const [composing, setComposing] = useState(false)
  const [modal, setModal] = useState<'history' | 'export' | null>(null)
  const [pop, setPop] = useState<{ kind: 'share' | 'more' | 'icon' | 'cover' | 'move' | 'backlinks'; el: HTMLElement } | null>(null)
  const iconBtn = useRef<HTMLButtonElement>(null)
  const [pickIcon, setPickIcon] = useState(false)
  const [reposition, setReposition] = useState(false)
  const [showBacklinks, setShowBacklinks] = useState(false)
  const closePop = useCallback(() => setPop(null), [])
  // The shared doc was replaced (restore, move, import): reload the page's content.
  const resetEditor = useCallback(() => setVersion(v => v + 1), [])

  useEffect(() => {
    let live = true
    setPage(null); setMissing(false); setPop(null); setComposing(false); setDraft(null)
    api.get(id).then(p => live && setPage(p)).catch(() => live && setMissing(true))
    api.backlinks(id).then(b => live && setBacklinks(b)).catch(() => {})
    api.comments(id).then(c => live && setComments(c)).catch(() => {})
    return () => { live = false }
  }, [id, version])

  // Page shortcuts that Notion binds while a page is open.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const m = e.metaKey || e.ctrlKey
      if (!meta || store.published) return
      if (m && !e.shiftKey && e.key.toLowerCase() === 'l' && !(e.target as HTMLElement).closest?.('input,textarea')) { e.preventDefault(); copyText(pageUrl(id)); store.toast('Copied link to clipboard') }
      if (m && e.shiftKey && e.key.toLowerCase() === 'p' && can(meta, 'full')) { e.preventDefault(); setPop({ kind: 'move', el: document.querySelector('.topbar .more-btn') as HTMLElement }) }
      if (m && e.shiftKey && e.key.toLowerCase() === 'm' && can(meta, 'comment')) { e.preventDefault(); setComposing(true) }
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [id, meta, store])

  // Once the new icon is on the page, open the picker on it.
  useEffect(() => { if (pickIcon && meta?.icon && iconBtn.current) { setPop({ kind: 'icon', el: iconBtn.current }); setPickIcon(false) } }, [pickIcon, meta?.icon])

  if (missing || (store.pages.length && !meta)) return <NoAccess />
  if (!meta || !page) return <div className="empty" />

  const edit = can(meta, 'edit') && !store.published
  const full = can(meta, 'full') && !store.published
  const crumbs = ancestors(store.byId, id)
  const parent = meta.parent_id ? store.byId.get(meta.parent_id) : undefined
  const row = parent?.kind === 'db' ? parent : undefined
  const isPrivate = crumbs[0]?.section === 'private'
  const layout = ((meta.props as { _layout?: Layout })?._layout ?? {}) as Layout
  const setLayout = (l: Layout) => store.patch(id, { props: { ...meta.props, _layout: { ...layout, ...l } } })
  const set = (p: Partial<Page>) => store.patch(id, p)
  const openPop = (kind: NonNullable<typeof pop>['kind']) => (e: React.MouseEvent<HTMLElement>) => setPop(pop?.kind === kind ? null : { kind, el: e.currentTarget })
  const shownCrumbs = crumbs.length > 4 ? [crumbs[0], null, ...crumbs.slice(-2)] : crumbs

  const moreItems: Item[] = [
    { note: (
      <div className="font-picker">
        {(['default', 'serif', 'mono'] as const).map(f => (
          <button key={f} disabled={!edit} className={meta.font === f ? 'on' : ''} onClick={() => set({ font: f })}>
            <span className={'ag font-' + f}>Ag</span><span>{f[0].toUpperCase() + f.slice(1)}</span>
          </button>
        ))}
      </div>
    ) },
    { icon: <Link2 size={16} />, label: 'Copy link', hint: `${mod}L`, onClick: () => { copyText(pageUrl(id)); store.toast('Copied link to clipboard') } },
    { icon: <Copy size={16} />, label: 'Duplicate', hint: `${mod}D`, onClick: () => duplicate(store, meta) },
    ...(full ? [{ icon: <CornerUpRight size={16} />, label: 'Move to', hint: `${mod}${shift}P`, onClick: () => setPop(p => ({ kind: 'move', el: p!.el })) }] : []),
    ...(edit ? [{ icon: <Trash2 size={16} />, label: 'Move to Trash', onClick: () => trash(store, meta) }] : []),
    { divider: true },
    ...(edit ? [
      { icon: <span className="menu-toggle-icon">Aa</span>, label: 'Small text', checked: meta.small_text, onClick: () => set({ small_text: !meta.small_text }) },
      { icon: <ArrowLeftRight size={16} />, label: 'Full width', hint: `${mod}${shift}\\`, checked: meta.full_width, onClick: () => set({ full_width: !meta.full_width }) },
      { icon: meta.locked ? <LockOpen size={16} /> : <Lock size={16} />, label: meta.locked ? 'Unlock page' : 'Lock page', checked: meta.locked, onClick: () => { set({ locked: !meta.locked }); setVersion(v => v + 1) } },
      { icon: <PanelTop size={16} />, label: 'Customize page', submenu: () => (
        <div className="menu-list customize">
          <div className="menu-heading">Backlinks</div>
          {(['expanded', 'popover', 'off'] as const).map(v => <button key={v} className="menu-item" onClick={() => setLayout({ backlinks: v })}><span className="menu-label">{{ expanded: 'Expanded', popover: 'Show in popover', off: 'Off' }[v]}</span>{(layout.backlinks ?? 'popover') === v && <span className="menu-check">✓</span>}</button>)}
          <div className="menu-heading">Page discussions</div>
          {(['expanded', 'minimal', 'off'] as const).map(v => <button key={v} className="menu-item" onClick={() => setLayout({ discussions: v })}><span className="menu-label">{{ expanded: 'Expanded', minimal: 'Minimal', off: 'Off' }[v]}</span>{(layout.discussions ?? 'expanded') === v && <span className="menu-check">✓</span>}</button>)}
        </div>
      ) },
      { divider: true },
      { icon: <Undo2 size={16} />, label: 'Undo', hint: `${mod}Z`, onClick: () => dispatchEvent(new CustomEvent('bloki:undo')) },
      { icon: <Redo2 size={16} />, label: 'Redo', hint: `${mod}${shift}Z`, onClick: () => dispatchEvent(new CustomEvent('bloki:redo')) },
    ] as Item[] : []),
    { icon: <HistoryIcon size={16} />, label: 'Version history', onClick: () => setModal('history') },
    { icon: <Trash2 size={16} />, label: 'Show deleted pages', onClick: () => document.querySelectorAll<HTMLElement>('.sidebar .nav').forEach(b => b.textContent?.includes('Trash') && b.click()) },
    { divider: true },
    ...(edit && meta.kind === 'page' ? [{ icon: <Upload size={16} />, label: 'Import', onClick: () => importMarkdown(store, id) }] : []),
    { icon: <Download size={16} />, label: 'Export', onClick: () => setModal('export') },
    { divider: true },
    { note: <>Word count: {wordCount(page.content)} words<br />Last edited by {personName(store.people, meta.updated_by) || 'you'}<br />{new Date(meta.updated).toLocaleString()}</> },
  ]

  const dragCover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!reposition) return
    const startY = e.clientY, start = meta.cover_y ?? 50, el = e.currentTarget
    const move = (m: MouseEvent) => { el.style.backgroundPosition = `center ${Math.max(0, Math.min(100, start - (m.clientY - startY) / 3))}%` }
    const up = (m: MouseEvent) => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up)
      set({ cover_y: Math.max(0, Math.min(100, start - (m.clientY - startY) / 3)) })
    }
    addEventListener('mousemove', move); addEventListener('mouseup', up)
  }

  const openComments = comments.filter(c => !c.thread_id && !c.resolved).length

  return (
    <div className={`page-wrap${panel ? ' with-panel' : ''}${peek ? ' peek-page' : ''}`}>
      <div className={`page font-${meta.font ?? 'default'}${meta.full_width || meta.kind === 'db' ? ' full' : ''}${meta.kind === 'db' ? ' db-page' : ''}${meta.small_text ? ' small-text' : ''}`}>
        <header className={'topbar' + (sidebarCollapsed ? ' collapsed' : '') + (peek ? ' in-peek' : '')}>
          <nav className="crumbs">{!peek && <>
            {shownCrumbs.map((c, i) => (
              <span key={c?.id ?? 'more'} className="crumb-wrap">
                {i > 0 && <span className="sep">/</span>}
                {c ? <button className="crumb" onClick={() => store.go(c.id)}><span className="crumb-icon">{iconOf(c, 16)}</span><span className="crumb-label">{label(c)}</span></button>
                  : <span className="crumb muted">…</span>}
              </span>
            ))}
            {isPrivate && !store.published && <span className="badge-private"><Lock size={11} /> Private</span>}
            </>}
            {meta.locked && <button className="badge-locked" disabled={!edit} title={edit ? 'Unlock this page' : 'This page is locked'} onClick={() => { set({ locked: false }); setVersion(v => v + 1) }}><Lock size={11} /> Locked</button>}
          </nav>
          <div className="actions">
            {!store.published && <>
              <span className="edited muted small">Edited {timeAgo(meta.updated)}</span>
              {!edit && <span className="badge">{LEVEL_NAMES[meta.access]}</span>}
              <button className="top-btn" onClick={openPop('share')}>Share</button>
              <button className={'icon-btn' + (panel === 'comments' ? ' on' : '')} title="View all comments" onClick={() => setPanel(panel === 'comments' ? null : 'comments')}>
                <MessageSquare size={18} />{openComments > 0 && <span className="dot-count">{openComments}</span>}
              </button>
              <button className={'icon-btn' + (panel === 'updates' ? ' on' : '')} title="View all updates" onClick={() => setPanel(panel === 'updates' ? null : 'updates')}><Clock size={18} /></button>
              <button className="icon-btn" title={meta.favorite ? 'Remove from Favorites' : 'Add to Favorites'} onClick={() => set({ favorite: !meta.favorite })}>
                <Star size={18} fill={meta.favorite ? '#f5c518' : 'none'} color={meta.favorite ? '#f5c518' : 'currentColor'} />
              </button>
              <button className="icon-btn more-btn" title="Style, export, and more…" onClick={openPop('more')}><MoreHorizontal size={18} /></button>
            </>}
            {store.published && <span className="badge">Published with Bloki</span>}
          </div>
        </header>
        <Popover anchor={pop?.kind === 'share' ? pop.el : null} onClose={closePop} align="end" className="share-pop" width={456}><ShareMenu page={meta} close={closePop} /></Popover>
        <Popover anchor={pop?.kind === 'more' ? pop.el : null} onClose={closePop} align="end" className="menu-pop" width={256}><Menu filter onClose={() => setPop(p => (p?.kind === 'more' ? null : p))} items={moreItems} /></Popover>
        <Popover anchor={pop?.kind === 'move' ? pop.el : null} onClose={closePop} align="end" className="menu-pop" width={320}><MoveTo page={meta} close={closePop} /></Popover>

        {meta.trashed && (
          <div className="banner">This page is in Trash.
            {edit && <button onClick={() => set({ trashed: false })}>Restore page</button>}
            {full && <button onClick={async () => { if (confirm('Delete this page permanently?')) { await api.remove(id); await store.reload(); store.go(null) } }}>Delete permanently</button>}
          </div>
        )}

        {meta.cover && (
          <div className={'cover' + (reposition ? ' repositioning' : '')} style={coverStyle(meta.cover, meta.cover_y)} onMouseDown={dragCover}>
            {edit && (reposition
              ? <div className="cover-actions show"><span className="cover-hint">Drag image to reposition</span><button onClick={() => setReposition(false)}>Save position</button><button onClick={() => { setReposition(false); setVersion(v => v + 1) }}>Cancel</button></div>
              : <div className="cover-actions">
                  <button onClick={openPop('cover')}>Change cover</button>
                  {/^(\/files\/|https?:)/.test(meta.cover) && <button onClick={() => setReposition(true)}>Reposition</button>}
                </div>)}
          </div>
        )}
        <Popover anchor={pop?.kind === 'cover' ? pop.el : null} onClose={closePop} align="end" className="menu-pop" width={540}>
          <CoverPicker onPick={c => { set({ cover: c, cover_y: 50 }); closePop() }} onRemove={() => { set({ cover: '' }); closePop() }} />
        </Popover>

        <div className={'page-body' + (meta.cover ? ' has-cover' : '') + (meta.icon ? ' has-icon' : '')}>
          <div className="page-head">
            {meta.icon && <button ref={iconBtn} className="page-icon" disabled={!edit} onClick={openPop('icon')}>{iconOf(meta, 78)}</button>}
            {edit && (
              <div className="head-actions">
                {/* As in Notion: a random emoji goes on at once, with the picker open on it to change it. */}
                {!meta.icon && <button onClick={async () => { set({ icon: await randomEmoji() }); setPickIcon(true) }}><Smile size={15} /> Add icon</button>}
                {!meta.cover && <button onClick={() => set({ cover: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)] })}><ImageIcon size={15} /> Add cover</button>}
                {can(meta, 'comment') && <button onClick={() => setComposing(true)}><MessageSquare size={15} /> Add comment</button>}
              </div>
            )}
            {!edit && can(meta, 'comment') && !store.published && <div className="head-actions"><button onClick={() => setComposing(true)}><MessageSquare size={15} /> Add comment</button></div>}
            <Popover anchor={pop?.kind === 'icon' ? pop.el : null} onClose={closePop} className="menu-pop" width={408}>
              <IconPicker onPick={v => { set({ icon: v }); closePop() }} onRemove={meta.icon ? () => { set({ icon: '' }); closePop() } : undefined} />
            </Popover>
            <textarea className="title-input" rows={1} placeholder={meta.kind === 'db' ? 'Untitled' : 'New page'} defaultValue={meta.title} key={meta.id + version} readOnly={meta.locked || !edit}
              ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
              onChange={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
              onBlur={e => e.target.value !== meta.title && set({ title: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); (document.querySelector('.bn-editor') as HTMLElement | null)?.focus() }
              }} />
          </div>

          {row && <RowProperties db={row} row={meta} readOnly={!edit} />}

          {(layout.backlinks ?? 'popover') !== 'off' && backlinks.length > 0 && (
            (layout.backlinks ?? 'popover') === 'expanded' || showBacklinks
              ? <div className="backlinks open">{backlinks.map(b => <button key={b.id} className="backlink" onClick={() => store.go(b.id)}>↗ {iconOf(b as Page, 14)} {label(b)}</button>)}</div>
              : <button className="backlinks-toggle" onClick={() => setShowBacklinks(true)}>↗ {backlinks.length} backlink{backlinks.length > 1 ? 's' : ''}</button>
          )}

          {(layout.discussions ?? 'expanded') !== 'off' && !store.published && (
            <PageDiscussions page={meta} all={comments} setAll={setComments} composing={composing} setComposing={setComposing} />
          )}

          {meta.kind === 'db'
            ? <Database id={id} />
            : <PageEditor key={id + version + meta.locked + meta.access} page={page} dark={dark} editable={edit && !meta.locked}
                collab={!store.published} onReset={resetEditor}
                onComment={can(meta, 'comment') && !store.published ? (blockId, quote, cid) => { setDraft({ blockId, quote, id: cid }); setPanel('comments') } : undefined}
                comments={comments} openComments={() => setPanel('comments')} />}
        </div>
      </div>

      {panel === 'comments' && <CommentsPanel page={meta} all={comments} setAll={setComments} close={() => setPanel(null)} draft={draft} clearDraft={() => setDraft(null)} />}
      {panel === 'updates' && <UpdatesPanel page={meta} comments={comments} close={() => setPanel(null)} openHistory={() => setModal('history')} />}
      {modal === 'history' && <VersionHistory page={page} dark={dark} canRestore={edit} close={() => setModal(null)} restored={() => { setModal(null); setVersion(v => v + 1) }} />}
      {modal === 'export' && <ExportDialog page={page} close={() => setModal(null)} />}
    </div>
  )
}

function NoAccess() {
  const store = useStore()
  return (
    <div className="no-access">
      <Lock size={40} strokeWidth={1.2} />
      <h2>No access to this page</h2>
      <p className="muted">This page doesn’t exist, was deleted, or you don’t have access. Ask the page owner to share it with you.</p>
      <button onClick={() => store.go(null)}>Back to my content</button>
    </div>
  )
}

function UpdatesPanel({ page, comments, close, openHistory }: { page: Page; comments: Comment[]; close: () => void; openHistory: () => void }) {
  const store = useStore()
  const [hist, setHist] = useState<Awaited<ReturnType<typeof api.history>>>([])
  useEffect(() => { api.history(page.id).then(setHist).catch(() => {}) }, [page.id])
  const events: { at: number; who: string; what: string; quote?: string }[] = [
    { at: page.updated, who: personName(store.people, page.updated_by), what: 'edited this page' },
    ...hist.map(h => ({ at: h.at, who: h.name ?? 'Someone', what: 'edited this page' })),
    ...comments.map(c => ({ at: c.created, who: c.name, what: c.thread_id ? 'replied to a comment' : 'commented', quote: c.body })),
    { at: page.created, who: personName(store.people, page.created_by), what: 'created this page' },
  ].sort((a, b) => b.at - a.at)
  return (
    <aside className="right-panel">
      <div className="panel-head"><b>Updates</b><span className="panel-tools"><button className="ghost" onClick={close}><X size={16} /></button></span></div>
      {events.map((e, i) => (
        <div key={i} className="update">
          <span className="avatar">{(e.who || '?')[0]}</span>
          <div><b>{e.who || 'Someone'}</b> {e.what}<div className="muted small">{timeAgo(e.at)}</div>{e.quote && <div className="notice-quote">{e.quote}</div>}</div>
        </div>
      ))}
      <button className="ghost wide" onClick={openHistory}><HistoryIcon size={14} /> Version history</button>
    </aside>
  )
}

function VersionHistory({ page, dark, canRestore, close, restored }: { page: Page; dark: boolean; canRestore: boolean; close: () => void; restored: () => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.history>> | null>(null)
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { api.history(page.id).then(setItems) }, [page.id])
  const list = [{ title: page.title, content: page.content ?? [], at: page.updated, name: 'Current version', user_id: null }, ...(items ?? [])]
  const cur = list[sel]
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog history-dialog" onClick={e => e.stopPropagation()}>
        <div className="history-preview" ref={ref}>
          <h1>{cur.title || 'Untitled'}</h1>
          <PageEditor key={sel} page={{ ...page, content: cur.content }} dark={dark} editable={false} />
        </div>
        <div className="history-list">
          <div className="panel-head"><b>Version history</b><button className="ghost" onClick={close}><X size={16} /></button></div>
          {items === null && <div className="muted pad">Loading…</div>}
          {list.map((h, i) => (
            <button key={h.at + '-' + i} className={'history-item' + (i === sel ? ' active' : '')} onClick={() => setSel(i)}>
              <b>{i === 0 ? 'Current version' : new Date(h.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
              <span className="muted small">{i === 0 ? timeAgo(h.at) : h.name ?? 'Someone'}</span>
            </button>
          ))}
          {items?.length === 0 && <div className="muted small pad">Versions are saved every 10 minutes while a page is edited.</div>}
          <div className="history-foot">
            <button className="primary wide" disabled={!canRestore || sel === 0} onClick={async () => {
              await api.update(page.id, { content: cur.content, title: cur.title, snapshot: true } as Partial<Page>)
              restored()
            }}>Restore version</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExportDialog({ page, close }: { page: Page; close: () => void }) {
  const store = useStore()
  const [format, setFormat] = useState<'md' | 'html' | 'pdf'>('md')
  const [subpages, setSubpages] = useState(false)
  const run = async () => {
    if (format === 'pdf') { close(); setTimeout(() => print(), 100); return }
    const pages = [page]
    if (subpages) {
      const walk = async (pid: string) => { for (const c of store.children(pid)) { pages.push(await api.get(c.id)); await walk(c.id) } }
      await walk(page.id)
    }
    const titleOf = (pid: string) => label(store.byId.get(pid))
    if (format === 'md') download(`${label(page)}.md`, pages.map(p => toMarkdown(p, titleOf)).join('\n\n---\n\n'))
    else download(`${label(page)}.html`, `<!doctype html><meta charset="utf-8"><title>${label(page).replace(/</g, '&lt;')}</title><body style="font-family:system-ui;max-width:720px;margin:40px auto">${pages.map(p => toHTML(p, titleOf)).join('<hr>')}</body>`, 'text/html')
    close()
  }
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog export" onClick={e => e.stopPropagation()}>
        <div className="export-row"><span>Export format</span>
          <select value={format} onChange={e => setFormat(e.target.value as 'md')}><option value="md">Markdown & CSV</option><option value="html">HTML</option><option value="pdf">PDF</option></select></div>
        {format !== 'pdf' && page.kind === 'page' && <div className="export-row"><span>Include subpages</span><input type="checkbox" checked={subpages} onChange={e => setSubpages(e.target.checked)} /></div>}
        <div className="export-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={run}>Export</button></div>
      </div>
    </div>
  )
}
