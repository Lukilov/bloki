import { useState } from 'react'
import { Check, Eye, EyeOff, GripVertical, Search, X } from 'lucide-react'
import { type Page, type RowLayout } from '../api'
import { label, useStore } from '../store'
import { typeIcon } from './Cells'

/** Notion's "Customize layout" for database rows: a preview of the page's sections on the left, page settings on
 *  the right, and Apply to all pages (the layout lives on the database, so every row uses it). */
export function LayoutEditor({ db, row, close }: { db: Page; row: Page; close: () => void }) {
  const store = useStore()
  const [draft, setDraft] = useState<RowLayout>(db.schema.layout ?? {})
  const [picked, setPicked] = useState<'page' | 'props'>('page')
  const [q, setQ] = useState('')
  const props = db.schema.props ?? []
  const hidden = new Set(draft.hidden ?? [])
  const on = (k: 'icons' | 'discussions') => draft[k] !== false
  const toggleProp = (id: string) => setDraft(d => ({ ...d, hidden: hidden.has(id) ? [...hidden].filter(x => x !== id) : [...hidden, id] }))
  const sw = (value: boolean, set: () => void, text: string) => (
    <button className="layout-option" onClick={set}><span>{text}</span><span className={'switch' + (value ? ' on' : '')} /></button>
  )
  const apply = () => { store.patch(db.id, { schema: { ...db.schema, layout: draft } }); close() }
  return (
    <div className="layout-editor" role="dialog" aria-label="Customize layout">
      <header className="layout-top">
        <div className="layout-title"><b>{label(db)}</b><span>Preview: {label(row)}</span></div>
        <button className="ghost" onClick={close}><X size={16} /> Cancel</button>
        <button className="primary" onClick={apply}><Check size={16} /> Apply to all pages</button>
      </header>
      <div className="layout-body">
        <div className="layout-canvas">
          <section className="layout-section"><div className="layout-section-head">Heading</div><div className="layout-heading">{label(row)}</div></section>
          <section className={'layout-section' + (picked === 'props' ? ' on' : '')} onClick={() => setPicked('props')}>
            <div className="layout-section-head"><GripVertical size={14} /> {draft.panel ? 'Property panel' : 'Property group'}</div>
            {props.filter(p => !hidden.has(p.id)).map(p => <div key={p.id} className="layout-prop">{on('icons') && typeIcon(p)} {p.name}</div>)}
            {props.every(p => hidden.has(p.id)) && <div className="layout-muted">All properties are hidden</div>}
          </section>
          {on('discussions') && <section className="layout-section"><div className="layout-section-head"><GripVertical size={14} /> Page discussions</div><div className="layout-muted">Comments</div></section>}
          <section className="layout-section"><div className="layout-section-head"><GripVertical size={14} /> Content</div><div className="layout-muted">The page's own blocks</div></section>
        </div>
        <aside className="layout-side">
          {picked === 'props' ? <>
            <div className="layout-side-head"><b>Property group</b><button className="ghost" onClick={() => setPicked('page')}>Page settings</button></div>
            <label className="layout-search"><Search size={14} /><input autoFocus placeholder="Search properties…" value={q} onChange={e => setQ(e.target.value)} /></label>
            {props.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).map(p => (
              <button key={p.id} className="layout-option" onClick={() => toggleProp(p.id)}>
                <span className="layout-prop-name">{typeIcon(p)} {p.name}</span>{hidden.has(p.id) ? <EyeOff size={16} className="muted" /> : <Eye size={16} />}
              </button>
            ))}
            <div className="menu-divider" />
            <button className="layout-option" onClick={() => setDraft(d => ({ ...d, panel: !d.panel }))}><span>{draft.panel ? '← Move back into the page' : 'Move to panel →'}</span></button>
          </> : <>
            <div className="layout-side-head"><b>Page settings</b></div>
            <div className="menu-heading">Structure</div>
            <div className="layout-structure">
              {(['simple', 'tabbed'] as const).map(k => (
                <button key={k} className={(draft.structure ?? 'simple') === k ? 'on' : ''} onClick={() => setDraft(d => ({ ...d, structure: k }))}>
                  <span className={'layout-thumb ' + k}><i /><i /></span>{k === 'simple' ? 'Simple' : 'Tabbed'}
                </button>
              ))}
            </div>
            <div className="menu-heading">Options</div>
            <button className="layout-option" onClick={() => setDraft(d => ({ ...d, inlineComments: d.inlineComments === 'minimal' ? 'default' : 'minimal' }))}>
              <span>Inline comments</span><span className="muted">{draft.inlineComments === 'minimal' ? 'Minimal' : 'Default'} ›</span>
            </button>
            {sw(on('discussions'), () => setDraft(d => ({ ...d, discussions: !on('discussions') })), 'Page discussions')}
            {sw(on('icons'), () => setDraft(d => ({ ...d, icons: !on('icons') })), 'Property icons')}
            {sw(!!draft.fullWidth, () => setDraft(d => ({ ...d, fullWidth: !d.fullWidth })), 'Full width')}
            <p className="layout-muted small">Click the property group on the left to choose which properties show.</p>
          </>}
        </aside>
      </div>
    </div>
  )
}
