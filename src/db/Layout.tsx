import { useState } from 'react'
import { Check, Eye, EyeOff, GripVertical, Plus, Search, X } from 'lucide-react'
import { type Page, type Prop, type PropType, type RowLayout } from '../api'
import { Popover, usePopover } from '../ui'
import { TYPE_NAMES } from './model'
import { label, useStore } from '../store'
import { newProp, PROP_TYPES, TYPE_ICONS, typeIcon } from './Cells'

// Notion offers these five first when adding a new property to the page.
const FIRST: PropType[] = ['files', 'number', 'text', 'person', 'select']
const NEW_TYPES = [...FIRST, ...PROP_TYPES.filter(t => !FIRST.includes(t))]

/** Notion's "Customize layout" for database rows: a preview of the page's sections on the left, page settings on
 *  the right, and Apply to all pages (the layout lives on the database, so every row uses it). */
export function LayoutEditor({ db, row, close }: { db: Page; row: Page; close: () => void }) {
  const store = useStore()
  const [draft, setDraft] = useState<RowLayout>(db.schema.layout ?? {})
  const [picked, setPicked] = useState<'page' | 'props'>('page')
  const [q, setQ] = useState('')
  const [props, setProps] = useState<Prop[]>(db.schema.props ?? [])
  const [addAt, openAdd, closeAdd] = usePopover()
  const [addQ, setAddQ] = useState('')
  const [allTypes, setAllTypes] = useState(false)
  const pinnedIds = draft.pinned ?? []
  const pinned = pinnedIds.map(id => props.find(p => p.id === id)).filter((p): p is Prop => !!p)
  const pin = (p: Prop) => { setDraft(d => ({ ...d, pinned: [...(d.pinned ?? []), p.id] })); setAddQ(''); closeAdd() }
  const unpin = (id: string) => setDraft(d => ({ ...d, pinned: (d.pinned ?? []).filter(x => x !== id) }))
  const match = (t: string) => t.toLowerCase().includes(addQ.toLowerCase())
  const hidden = new Set(draft.hidden ?? [])
  const on = (k: 'icons' | 'discussions') => draft[k] !== false
  const toggleProp = (id: string) => setDraft(d => ({ ...d, hidden: hidden.has(id) ? [...hidden].filter(x => x !== id) : [...hidden, id] }))
  const sw = (value: boolean, set: () => void, text: string) => (
    <button className="layout-option" onClick={set}><span>{text}</span><span className={'switch' + (value ? ' on' : '')} /></button>
  )
  const apply = () => { store.patch(db.id, { schema: { ...db.schema, props, layout: draft } }); close() }
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
            {props.filter(p => !hidden.has(p.id) && !pinnedIds.includes(p.id)).map(p => <div key={p.id} className="layout-prop">{on('icons') && typeIcon(p)} {p.name}</div>)}
            {props.every(p => hidden.has(p.id)) && <div className="layout-muted">All properties are hidden</div>}
          </section>
          {pinned.map(p => (
            <section key={p.id} className="layout-section">
              <div className="layout-section-head"><GripVertical size={14} /> {p.name}<button className="ghost layout-unpin" title="Remove from page" onClick={() => unpin(p.id)}><X size={14} /></button></div>
              <div className="layout-prop">{on('icons') && typeIcon(p)} <span className="layout-muted-inline">Empty</span></div>
            </section>
          ))}
          <button className="layout-add" title="Add to page" onClick={e => openAdd(e.currentTarget)}><Plus size={18} /></button>
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
      <Popover anchor={addAt} onClose={closeAdd} className="menu-pop" width={290}>
        <div className="menu-list">
          <div className="menu-heading">Add to page</div>
          <input className="menu-filter" autoFocus placeholder="Search…" value={addQ} onChange={e => setAddQ(e.target.value)} />
          {props.some(p => !pinnedIds.includes(p.id) && match(p.name)) && <div className="menu-heading">Use an existing property</div>}
          {props.filter(p => !pinnedIds.includes(p.id) && match(p.name)).map(p => (
            <button key={p.id} className="menu-item tall" onClick={() => pin(p)}>
              <span className="menu-icon boxed">{typeIcon(p)}</span><span className="menu-label">{p.name}<small>{TYPE_NAMES[p.type]}</small></span>
            </button>
          ))}
          <div className="menu-heading">Create new property</div>
          {NEW_TYPES.filter(t => match(TYPE_NAMES[t])).slice(0, allTypes || addQ ? undefined : 5).map(t => (
            <button key={t} className="menu-item tall" onClick={() => { const p = newProp(t); setProps(ps => [...ps, p]); pin(p) }}>
              <span className="menu-icon boxed">{TYPE_ICONS[t]}</span><span className="menu-label">{TYPE_NAMES[t]}</span>
            </button>
          ))}
          {!allTypes && !addQ && <button className="menu-item muted" onClick={() => setAllTypes(true)}><span className="menu-label">More</span></button>}
        </div>
      </Popover>
    </div>
  )
}
