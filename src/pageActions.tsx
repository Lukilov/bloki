import { useState } from 'react'
import { ArrowUpRight, Copy, CornerUpRight, Link2, PenLine, Star, StarOff, Trash2 } from 'lucide-react'
import { api, can, type Page } from './api'
import { ancestors, iconOf, label, useStore } from './store'
import { copyText, mod, shift, timeAgo, type Item } from './ui'
import { personName } from './Access'

type Store = ReturnType<typeof useStore>

export const pageUrl = (id: string) => `${location.origin}${location.pathname}#/${id}`

export async function duplicate(store: Store, page: Page) {
  try {
    const c = await api.duplicate(page.id)
    await store.reload()
    store.go(c.id)
  } catch (e) { store.setError((e as Error).message) }
}

export function trash(store: Store, page: Page) {
  store.patch(page.id, { trashed: true })
  if (store.current && ancestors(store.byId, store.current).some(a => a.id === page.id)) store.go(page.parent_id)
  store.toast(`Moved “${label(page)}” to Trash`)
}

/** The page "⋯" menu shared by the sidebar and the page's top bar. */
export function pageMenuItems(store: Store, page: Page, open: { rename?: () => void; move: () => void }): Item[] {
  const edit = can(page, 'edit')
  return [
    page.favorite
      ? { icon: <StarOff size={16} />, label: 'Remove from Favorites', onClick: () => store.patch(page.id, { favorite: false }) }
      : { icon: <Star size={16} />, label: 'Add to Favorites', onClick: () => store.patch(page.id, { favorite: true }) },
    { divider: true },
    { icon: <Link2 size={16} />, label: 'Copy link', hint: `${mod}L`, onClick: () => { copyText(pageUrl(page.id)); store.toast('Copied link to clipboard') } },
    { icon: <Copy size={16} />, label: 'Duplicate', hint: `${mod}D`, onClick: () => duplicate(store, page) },
    ...(open.rename && edit ? [{ icon: <PenLine size={16} />, label: 'Rename', hint: `${mod}${shift}R`, onClick: open.rename }] : []),
    ...(can(page, 'full') ? [{ icon: <CornerUpRight size={16} />, label: 'Move to', hint: `${mod}${shift}P`, onClick: open.move }] : []),
    ...(edit ? [{ icon: <Trash2 size={16} />, label: 'Move to Trash', hint: 'Del', onClick: () => trash(store, page) }] : []),
    { divider: true },
    { icon: <ArrowUpRight size={16} />, label: 'Open in new tab', hint: `${mod}${shift}↵`, onClick: () => open_(pageUrl(page.id)) },
    { divider: true },
    { note: <>Last edited by {personName(store.people, page.updated_by) || 'you'}<br />{timeAgo(page.updated)}</> },
  ]
}
const open_ = (url: string) => window.open(url, '_blank', 'noopener')

/** "Move to" picker: search pages, pick a new parent or a sidebar section. */
export function MoveTo({ page, close }: { page: Page; close: () => void }) {
  const store = useStore()
  const [q, setQ] = useState('')
  // A page can't move into itself or its own subtree, and only into pages the user may add to.
  const blocked = (p: Page) => ancestors(store.byId, p.id).some(a => a.id === page.id) || !can(p, p.kind === 'db' ? 'edit_content' : 'edit') || p.trashed
  const targets = store.pages.filter(p => !blocked(p) && label(p).toLowerCase().includes(q.toLowerCase())).slice(0, 40)
  const member = store.me?.role !== 'guest'
  const move = async (parent_id: string | null, section?: 'workspace' | 'private') => {
    try {
      await api.update(page.id, { parent_id })
      if (section) await api.setShare(page.id, { workspace_access: section === 'private' ? 'none' : 'full' })
      await store.reload()
      store.toast(`Moved to ${parent_id ? label(store.byId.get(parent_id)) : section === 'private' ? 'Private' : 'Workspace'}`)
    } catch (e) { store.setError((e as Error).message) }
    close()
  }
  return (
    <div className="move-to">
      <input autoFocus className="menu-filter" placeholder="Move page to…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="menu-heading">Suggested</div>
      {member && !q && <>
        <button className="menu-item" onClick={() => move(null, 'workspace')}><span className="menu-icon">🏢</span><span className="menu-label">Workspace</span></button>
        <button className="menu-item" onClick={() => move(null, 'private')}><span className="menu-icon">🔒</span><span className="menu-label">Private pages</span></button>
      </>}
      {targets.map(p => {
        const path = ancestors(store.byId, p.id).slice(0, -1).map(label).join(' / ')
        return (
          <button key={p.id} className="menu-item" onClick={() => move(p.id)}>
            <span className="menu-icon">{iconOf(p)}</span>
            <span className="menu-label">{label(p)}{path && <span className="menu-sub">{path}</span>}</span>
          </button>
        )
      })}
      {!targets.length && <div className="menu-note">No results</div>}
    </div>
  )
}

/** Inline rename box (icon + title), as in Notion's sidebar. */
export function Rename({ page, close }: { page: Page; close: () => void }) {
  const store = useStore()
  const [title, setTitle] = useState(page.title)
  const save = () => { if (title !== page.title) store.patch(page.id, { title }); close() }
  return (
    <div className="rename">
      <span className="rename-icon">{iconOf(page)}</span>
      <input autoFocus value={title} placeholder="Untitled" onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save() }} onBlur={save} />
    </div>
  )
}
