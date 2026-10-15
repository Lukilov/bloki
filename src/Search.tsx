import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, CornerDownLeft, FileText, Search as SearchIcon, User } from 'lucide-react'
import { api, type Page } from './api'
import { ancestors, iconOf, label, useStore } from './store'
import { coverStyle, mod, shift } from './ui'

const desktop = typeof window !== 'undefined' && 'blokiDesktop' in window

type Hit = Pick<Page, 'id' | 'parent_id' | 'kind' | 'title' | 'icon' | 'updated'> & { snippet?: string }

function group(t: number) {
  const days = (Date.now() - t) / 864e5
  return days < 1 ? 'Today' : days < 2 ? 'Yesterday' : days < 7 ? 'Past week' : days < 30 ? 'Past 30 days' : 'Older'
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export function SearchDialog({ close, onPick }: { close: () => void; onPick?: (id: string, newTab: boolean) => void }) {
  const store = useStore()
  const [q, setQ] = useState('')
  const [titleOnly, setTitleOnly] = useState(false)
  const [mine, setMine] = useState(false)
  const [sort, setSort] = useState<'best' | 'edited'>('best')
  const [hits, setHits] = useState<Hit[]>([])
  const [sel, setSel] = useState(0)
  const ws = store.me?.workspaces.find(w => w.id === store.me?.workspaceId)

  useEffect(() => {
    if (!q) {
      setHits([...store.pages].filter(p => !p.trashed && (!mine || p.updated_by === store.me?.user.id)).sort((a, b) => b.updated - a.updated).slice(0, 12))
      return
    }
    const t = setTimeout(() => api.search(q, { title: titleOnly, mine }).then(setHits), 120)
    return () => clearTimeout(t)
  }, [q, titleOnly, mine, store.pages, store.me])

  const sorted = useMemo(() => (sort === 'edited' ? [...hits].sort((a, b) => b.updated - a.updated) : hits), [hits, sort])
  useEffect(() => setSel(0), [sorted])

  const pick = (h: Hit, newTab = false) => {
    if (onPick) onPick(h.id, newTab)
    else if (newTab) window.open(`#/${h.id}`, '_blank')
    else store.go(h.id)
    close()
  }

  let lastGroup = ''
  return (
    <div className="overlay search-overlay" onClick={close}>
      <div className="dialog search" onClick={e => e.stopPropagation()}>
        <div className="search-main">
        <div className="search-input">
          <SearchIcon size={18} />
          <input autoFocus placeholder={`Search ${ws?.name ?? 'your workspace'}…`} value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') close()
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, sorted.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
              if (e.key === 'Enter' && sorted[sel]) pick(sorted[sel], e.metaKey || e.ctrlKey)
            }} />
        </div>
        <div className="chips">
          <button className={'chip-btn' + (sort === 'edited' ? ' on' : '')} onClick={() => setSort(sort === 'best' ? 'edited' : 'best')}><ArrowDownUp size={13} /> {sort === 'best' ? 'Best matches' : 'Last edited'}</button>
          <button className={'chip-btn' + (titleOnly ? ' on' : '')} onClick={() => setTitleOnly(!titleOnly)}><FileText size={13} /> Title only</button>
          <button className={'chip-btn' + (mine ? ' on' : '')} onClick={() => setMine(!mine)}><User size={13} /> Edited by me</button>
        </div>
        <div className="search-results">
          {sorted.map((h, i) => {
            const g = q && sort === 'best' ? '' : group(h.updated)
            const head = g && g !== lastGroup ? g : ''
            lastGroup = g || lastGroup
            const path = ancestors(store.byId, h.parent_id).map(label).join(' / ')
            return (
              <div key={h.id}>
                {head && <div className="menu-heading">{head}</div>}
                {!q && i === 0 && !head && <div className="menu-heading">Recent</div>}
                <button className={'hit' + (i === sel ? ' sel' : '')} onMouseEnter={() => setSel(i)} onClick={e => pick(h, e.metaKey || e.ctrlKey)}>
                  <span className="hit-icon">{iconOf(h)}</span>
                  <span className="hit-text">
                    <span className="hit-title"><Highlight text={label(h)} q={q} />{path && <span className="hit-path"> — {path}</span>}</span>
                    {h.snippet && <span className="hit-snippet"><Highlight text={h.snippet} q={q} /></span>}
                  </span>
                  {i === sel && <CornerDownLeft size={14} className="hit-enter" />}
                </button>
              </div>
            )
          })}
          {q && !sorted.length && (
            <div className="search-empty">
              <div>No results</div>
              {store.me?.role !== 'guest' && <button className="menu-item" onClick={async () => { const page = await store.create({ title: q, section: 'private' }, !onPick); if (onPick) onPick(page.id, false); else close() }}>
                <span className="menu-icon">＋</span><span className="menu-label">New “{q}” page</span>
              </button>}
            </div>
          )}
        </div>
        <div className="search-foot muted small">
          <span>↑↓ Select</span><span>↵ Open</span><span>{mod}↵ Open in new tab</span>{desktop && <span>{shift}{mod}K Command Search</span>}
        </div>
        </div>
        {/* Notion previews the highlighted page beside the results when the window is wide enough. */}
        {sorted[sel] && <Preview page={store.byId.get(sorted[sel].id) ?? sorted[sel]} />}
      </div>
    </div>
  )
}

function Preview({ page }: { page: Hit & { cover?: string; cover_y?: number } }) {
  return (
    <div className="search-preview" aria-hidden>
      <div className="preview-card">
        <div className="preview-cover" style={page.cover ? coverStyle(page.cover, page.cover_y) : undefined} />
        {page.icon && <span className="preview-icon">{iconOf(page, 48)}</span>}
        <div className={'preview-title' + (page.title ? '' : ' untitled')}>{label(page)}</div>
      </div>
    </div>
  )
}
