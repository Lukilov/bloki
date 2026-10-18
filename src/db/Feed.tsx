import { useEffect, useState } from 'react'
import { api, type View } from '../api'
import { iconOf, label, useStore } from '../store'
import { timeAgo } from '../ui'
import { Avatar } from '../Comments'
import { CellView, ctxOf } from './Cells'
import { applyView, isTemplate, value } from './model'
import type { ViewProps } from './Views'

type Block = { type: string; props?: { level?: number }; content?: unknown; children?: Block[] }
export const blockText = (b: Block): string => (Array.isArray(b.content) ? (b.content as { text?: string; content?: { text?: string }[] }[]).map(c => c.text ?? c.content?.map(x => x.text ?? '').join('') ?? '').join('') : '')

/** Feed view: each page as a post with its properties and the start of its content, newest layout first as sorted. */
export function FeedView({ db, rows, props, openRow }: ViewProps) {
  const store = useStore()
  const [shown, setShown] = useState(10)
  const [bodies, setBodies] = useState<Record<string, { at: number; blocks: Block[] }>>({})
  const visible = rows.slice(0, shown)
  // Pages in the list don't carry their blocks; fetch the ones on screen, again whenever a page changes.
  useEffect(() => {
    for (const r of visible) if (bodies[r.id]?.at !== r.updated) api.get(r.id).then(p => setBodies(b => ({ ...b, [r.id]: { at: r.updated, blocks: (p.content ?? []) as Block[] } }))).catch(() => {})
  }, [visible.map(r => r.id + r.updated).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const ctx = ctxOf(store)
  return (
    <div className="feed">
      {visible.map(r => {
        const blocks = (bodies[r.id]?.blocks ?? []).filter(b => blockText(b).trim()).slice(0, 6)
        const author = r.created_by ? store.people.get(r.created_by)?.name : undefined
        const meta = props.filter(p => { const v = value(r, p, db.schema, ctx); return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) })
        return (
          <article key={r.id} className="feed-post" onClick={() => openRow(r)}>
            {/* As Notion's feed: who posted it and when, above the title. */}
            <div className="feed-by"><Avatar name={author ?? '?'} size={20} /><b>{author ?? 'Someone'}</b><span>{timeAgo(r.created)}</span></div>
            <h3>{r.icon && <span className="feed-icon">{iconOf(r, 20)}</span>}{label(r)}</h3>
            {meta.length > 0 && <div className="feed-meta">{meta.map(p => <span key={p.id}><CellView prop={p} row={r} schema={db.schema} /></span>)}</div>}
            <div className="feed-body">
              {!bodies[r.id] ? <p className="muted">…</p> : !blocks.length ? <p className="muted">Empty page</p> : blocks.map((b, i) => {
                const t = blockText(b)
                return b.type === 'heading' ? <h4 key={i}>{t}</h4> : b.type === 'bulletListItem' || b.type === 'checkListItem' ? <p key={i}>• {t}</p> : b.type === 'numberedListItem' ? <p key={i}>{t}</p> : <p key={i}>{t}</p>
              })}
            </div>
          </article>
        )
      })}
      {rows.length > shown && <button className="ghost feed-more" onClick={() => setShown(s => s + 10)}>Load more</button>}
    </div>
  )
}

/** Dashboard view: other views of this database side by side, each a widget with its own layout, filters and sorts. */
export function DashboardView(p: ViewProps) {
  const store = useStore()
  const { db, view, setView, perm } = p
  const others = (db.schema.views ?? []).filter(v => v.id !== view.id && v.type !== 'dashboard' && v.type !== 'form')
  const ids = view.widgets ?? others.slice(0, 4).map(v => v.id)
  const widgets = ids.map(id => others.find(v => v.id === id)).filter((v): v is View => !!v)
  const all = store.children(db.id).filter(x => !isTemplate(x))
  return (
    <div className="dashboard">
      {perm.structure && (
        <div className="dashboard-pick">{others.map(v => (
          <label key={v.id}><input type="checkbox" checked={ids.includes(v.id)} onChange={e => setView({ widgets: e.target.checked ? [...ids, v.id] : ids.filter(x => x !== v.id) })} /> {v.name}</label>
        ))}{!others.length && <span className="muted">Add other views (a chart, a board…) to show them here.</span>}</div>
      )}
      <div className="dashboard-grid">{widgets.map(v => {
        const Body = WIDGETS[v.type]
        return (
          <section key={v.id} className={'widget widget-' + v.type}>
            <header>{v.name}</header>
            <div className="widget-body">
              {Body && <Body {...p} view={v} rows={applyView(all, db.schema, v, ctxOf(store), store.me?.user.id)} setView={() => {}} perm={{ ...perm, structure: false }} />}
            </div>
          </section>
        )
      })}</div>
    </div>
  )
}

// Filled in by Views.tsx, which owns the view components (this keeps the import one-way).
export const WIDGETS: Partial<Record<View['type'], (p: ViewProps) => React.ReactNode>> = {}
