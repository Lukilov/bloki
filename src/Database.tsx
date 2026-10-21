import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownUp, ArrowUpRight, BarChart3, Calendar, Repeat, LayoutDashboard, Newspaper, ListTree, Waypoints, ClipboardPen, ChevronDown, ChevronsRight, Copy, Eye, EyeOff, Filter as FilterIcon, GanttChart, Group, Kanban, LayoutGrid, Link2, List,
  Check, Database as DbIcon, FileText, Lock, Palette, Zap, GripVertical, Maximize2, MoreHorizontal, PanelRight, Plus, Search, Settings2, SquareSplitHorizontal, Table, Trash2, X, PenLine, ChevronUp, CircleCheck, CircleDashed, CircleDot, ListOrdered,
} from 'lucide-react'
import { api, can, COLORS, uid, type Automation, type ColorRule, type Filter, type Option, type Page, type Prop, type Schema, type View, type ViewType } from './api'
import { iconOf, label, useStore } from './store'
import { copyText, Menu, Popover, type Item } from './ui'
import { pageUrl } from './pageActions'
import { Chip, ctxOf, StatusChip, typeIcon } from './db/Cells'
import { VIEW_COMPONENTS } from './db/Views'
import { defaultForm } from './db/Form'
import { applyView, groupable, isTemplate, needsValue, newRowDefaults, OP_NAMES, opsFor, propOf, textOf, value } from './db/model'
import { PageView } from './PageView'

export { RowProperties } from './db/Cells'

type Store = ReturnType<typeof useStore>

export const VIEW_NAMES: Record<ViewType, string> = { table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery', calendar: 'Calendar', timeline: 'Timeline', form: 'Form', chart: 'Chart', feed: 'Feed', dashboard: 'Dashboard' }
export const VIEW_ICONS: Record<ViewType, React.ReactNode> = {
  table: <Table size={14} />, board: <Kanban size={14} />, list: <List size={14} />, gallery: <LayoutGrid size={14} />, calendar: <Calendar size={14} />, timeline: <GanttChart size={14} />, form: <ClipboardPen size={14} />, chart: <BarChart3 size={14} />, feed: <Newspaper size={14} />, dashboard: <LayoutDashboard size={14} />,
}

const opt = (name: string, i: number, group?: Option['group']): Option => ({ id: uid(), name, color: COLORS[i % COLORS.length], ...(group ? { group } : {}) })

export function newDatabase(store: Store, parent_id: string | null, title = '', section: 'workspace' | 'private' = 'private', first: ViewType = 'table') {
  const status: Prop = { id: uid(), name: 'Status', type: 'status', options: [opt('Not started', 0, 'todo'), opt('In progress', 5, 'progress'), opt('Done', 4, 'done')] }
  const date: Prop = { id: uid(), name: 'Date', type: 'date' }
  const schema: Schema = {
    props: [status, date, { id: uid(), name: 'Tags', type: 'multi_select', options: [] }],
    views: [{ id: uid(), name: VIEW_NAMES[first] === 'Table' ? 'Table' : VIEW_NAMES[first], type: first, groupBy: status.id, dateProp: date.id }],
  }
  if (first === 'table') schema.views![0].groupBy = undefined
  if (first === 'form') schema.views![0].form = defaultForm({ schema } as Page)
  return store.create({ parent_id, kind: 'db', title, schema, section: parent_id ? undefined : section }, false)
}

export { coverStyle } from './ui'

/* ---------- filter & sort editors ---------- */

const STATUS_GROUPS: Record<string, string> = { todo: 'To-do', progress: 'In progress', done: 'Complete' }
const GROUP_ICONS: Record<string, React.ReactNode> = { todo: <CircleDashed />, progress: <CircleDot />, done: <CircleCheck /> }
const groupOf = (o?: object) => (o as Option | undefined)?.group

function FilterEditor({ f, db, onChange, onRemove }: { f: Filter; db: Page; onChange: (f: Filter) => void; onRemove: () => void }) {
  const store = useStore()
  const p = propOf(db.schema, f.prop)
  if (!p) return null
  const ops = opsFor(p.type)
  const options = p.options ?? (p.type === 'person' || p.type === 'created_by' || p.type === 'updated_by' ? [...store.people.entries()].map(([id, x]) => ({ id, name: x.name, color: 'gray' })) : null)
  const relRows = p.type === 'relation' && p.relation ? store.children(p.relation.db) : null
  return (
    <div className="filter-editor">
      <div className="filter-head">
        <span className="muted">{p.name}</span>
        <select value={f.op} onChange={e => onChange({ ...f, op: e.target.value })}>{ops.map(o => <option key={o} value={o}>{OP_NAMES[o]}</option>)}</select>
        <button className="ghost" title="Delete filter" onClick={onRemove}><Trash2 size={14} /></button>
      </div>
      {needsValue(f.op) && (options
        ? <div className="filter-options">{options.map((o, i) => (
            <Fragment key={o.id}>
              {/* Status options sit under their group, as in Notion: To-do, In progress, Complete. */}
              {p.type === 'status' && groupOf(o) && groupOf(o) !== groupOf(options[i - 1]) && <div className={'filter-group ' + groupOf(o)}>{GROUP_ICONS[groupOf(o)!]}{STATUS_GROUPS[groupOf(o)!]}</div>}
              <div className={'option-row' + (f.value === o.id ? ' on' : '')} onClick={() => onChange({ ...f, value: f.value === o.id ? '' : o.id })}>{p.type === 'status' ? <StatusChip o={o as Option} /> : <Chip o={o} />}{f.value === o.id && <span className="menu-check">✓</span>}</div>
            </Fragment>
          ))}</div>
        : relRows
          ? <div className="filter-options">{relRows.map(r => <div key={r.id} className={'option-row' + (f.value === r.id ? ' on' : '')} onClick={() => onChange({ ...f, value: r.id })}>{iconOf(r, 14)} {label(r)}</div>)}</div>
          : <input autoFocus className="wide" type={['date', 'created', 'updated'].includes(p.type) ? 'date' : ['number', 'unique_id'].includes(p.type) ? 'number' : 'text'}
              placeholder="Type a value…" value={f.value ?? ''} onChange={e => onChange({ ...f, value: e.target.value })} />)}
    </div>
  )
}

function PropertyList({ db, onPick, filter, placeholder = 'Filter by…', extra = [] }: { db: Page; onPick: (p: Prop) => void; filter?: (p: Prop) => boolean; placeholder?: string; extra?: Prop[] }) {
  const [q, setQ] = useState('')
  const all = [propOf(db.schema, 'title')!, ...(db.schema.props ?? []), ...extra].filter(p => (!filter || filter(p)) && p.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="menu-list">
      <input className="menu-filter" autoFocus placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} />
      {all.map(p => <button key={p.id} className="menu-item" onClick={() => onPick(p)}><span className="menu-icon">{typeIcon(p)}</span><span className="menu-label">{p.name}</span></button>)}
    </div>
  )
}

const colorName = (c: string) => c[0].toUpperCase() + c.slice(1)

/** Notion's Conditional color: each rule is a filter plus a colour ("Match option" or a fixed one) for the row or one cell. */
function ColorRules({ db, view, setView }: { db: Page; view: View; setView: (v: Partial<View>) => void }) {
  const [adding, setAdding] = useState(false)
  const rules = view.colors ?? []
  const put = (id: string, x: Partial<ColorRule>) => setView({ colors: rules.map(r => (r.id === id ? { ...r, ...x } : r)) })
  if (adding) return <PropertyList db={db} placeholder="Color by…" onPick={p => {
    setView({ colors: [...rules, { id: uid(), prop: p.id, op: 'not_empty', color: ['select', 'status', 'multi_select'].includes(p.type) ? 'match' : 'blue', apply: 'row' }] }); setAdding(false)
  }} />
  return (
    <div className="color-rules">
      {!rules.length && <p className="color-rules-intro">Customize page colors to easily distinguish categories, highlight overdue events, and bring clarity to your work.</p>}
      {rules.map(r => (
        <div key={r.id} className="color-rule">
          <FilterEditor f={r} db={db} onChange={f => put(r.id, f)} onRemove={() => setView({ colors: rules.filter(x => x.id !== r.id) })} />
          <label className="color-rule-row"><span>Page background</span>
            <select value={r.color} onChange={e => put(r.id, { color: e.target.value })}>
              {['select', 'status', 'multi_select'].includes(propOf(db.schema, r.prop)?.type ?? '') && <option value="match">Match option</option>}
              {COLORS.map(c => <option key={c} value={c}>{colorName(c)}</option>)}
            </select></label>
          <label className="color-rule-row"><span>Apply to</span>
            <select value={r.apply} onChange={e => put(r.id, { apply: e.target.value as 'row' })}><option value="row">Entire row</option><option value="prop">This property</option></select></label>
        </div>
      ))}
      <button className="menu-item color-rule-add" onClick={() => setAdding(true)}><span className="menu-icon"><Plus size={16} /></span><span className="menu-label">{rules.length ? 'Add another' : 'New color setting'}</span></button>
    </div>
  )
}

/** Automations (Notion's, simplified): When a page is added or a property changes (optionally to a value),
 *  set properties or notify someone. They run on the server, so they work for every way rows change. */
function Automations({ db, setSchema }: { db: Page; setSchema: (s: Schema) => void }) {
  const store = useStore()
  const list = db.schema.automations ?? []
  const [openId, setOpenId] = useState<string | null>(null)
  const props = db.schema.props ?? []
  const save = (next: Automation[]) => setSchema({ ...db.schema, automations: next })
  const put = (id: string, x: Partial<Automation>) => save(list.map(a => (a.id === id ? { ...a, ...x } : a)))
  const valueInput = (prop: string, value: unknown, set: (v: unknown) => void, allowAny = false) => {
    const p = propOf(db.schema, prop)
    if (!p) return null
    if (p.type === 'checkbox') return <select value={String(value ?? '')} onChange={e => set(allowAny && e.target.value === '' ? undefined : e.target.value === 'true')}>{allowAny && <option value="">Any change</option>}<option value="true">Checked</option><option value="false">Unchecked</option></select>
    if (['select', 'status', 'multi_select'].includes(p.type)) return <select value={String(Array.isArray(value) ? value[0] ?? '' : value ?? '')} onChange={e => set(e.target.value === '' ? (allowAny ? undefined : null) : p.type === 'multi_select' && !allowAny ? [e.target.value] : e.target.value)}>
      <option value="">{allowAny ? 'Any change' : 'Empty'}</option>{(p.options ?? []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    if (p.type === 'person') return <select value={String(Array.isArray(value) ? value[0] ?? '' : value ?? '')} onChange={e => set(e.target.value ? [e.target.value] : allowAny ? undefined : [])}>
      <option value="">{allowAny ? 'Any change' : 'Nobody'}</option>{[...store.people.values()].map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
    if (p.type === 'date' && !allowAny) return <select value={value ? 'today' : ''} onChange={e => set(e.target.value ? { start: new Date().toISOString().slice(0, 10) } : null)}><option value="">Empty</option><option value="today">Today (when it runs)</option></select>
    return <input placeholder={allowAny ? 'Any change' : 'Value'} defaultValue={String(value ?? '')} onBlur={e => set(e.target.value === '' && allowAny ? undefined : p.type === 'number' ? Number(e.target.value) : e.target.value)} />
  }
  const editing = list.find(a => a.id === openId)
  if (editing) {
    const a = editing
    return (
      <div className="automation-edit">
        <input className="wide" defaultValue={a.name} placeholder="Automation name" onBlur={e => put(a.id, { name: e.target.value || 'Automation' })} />
        <div className="menu-heading">When</div>
        <div className="automation-row">
          <select value={a.trigger.type} onChange={e => put(a.id, { trigger: e.target.value === 'added' ? { type: 'added' } : { type: 'edited', prop: props[0]?.id ?? '' } })}>
            <option value="added">Page added</option><option value="edited">Property edited</option></select>
          {a.trigger.type === 'edited' && <>
            <select value={a.trigger.prop} onChange={e => put(a.id, { trigger: { type: 'edited', prop: e.target.value } })}>{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            {valueInput(a.trigger.prop, a.trigger.value, v => put(a.id, { trigger: { type: 'edited', prop: (a.trigger as { prop: string }).prop, value: v as string | undefined } }), true)}
          </>}
        </div>
        <div className="menu-heading">Do</div>
        {a.actions.map((act, i) => (
          <div key={i} className="automation-row">
            {act.type === 'set' ? <>
              <span>Set</span>
              <select value={act.prop} onChange={e => put(a.id, { actions: a.actions.map((x, j) => (j === i ? { type: 'set', prop: e.target.value, value: null } : x)) })}>{props.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <span>to</span>{valueInput(act.prop, act.value, v => put(a.id, { actions: a.actions.map((x, j) => (j === i ? { ...act, value: v } : x)) }))}
            </> : <>
              <span>Notify</span>
              <select value={act.user} onChange={e => put(a.id, { actions: a.actions.map((x, j) => (j === i ? { type: 'notify', user: e.target.value } : x)) })}>{[...store.people.values()].map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </>}
            <button className="ghost" title="Remove action" onClick={() => put(a.id, { actions: a.actions.filter((_, j) => j !== i) })}><X size={14} /></button>
          </div>
        ))}
        <div className="automation-add">
          <button className="ghost" disabled={!props.length} onClick={() => put(a.id, { actions: [...a.actions, { type: 'set', prop: props[0].id, value: null }] })}><Plus size={14} /> Edit a property</button>
          <button className="ghost" onClick={() => put(a.id, { actions: [...a.actions, { type: 'notify', user: store.me?.user.id ?? '' }] })}><Plus size={14} /> Send a notification</button>
        </div>
        <button className="menu-item" onClick={() => setOpenId(null)}><span className="menu-icon"><Check size={15} /></span><span className="menu-label">Done</span></button>
      </div>
    )
  }
  return (
    <div className="automations">
      {!list.length && <p className="color-rules-intro">Automatically edit properties and send notifications when pages are added or change.</p>}
      {list.map(a => (
        <div key={a.id} className="option-row automation-item" onClick={() => setOpenId(a.id)}>
          <Zap size={15} /><span className="menu-label">{a.name}</span>
          <button className={'switch' + (a.enabled ? ' on' : '')} title={a.enabled ? 'Turn off' : 'Turn on'} onClick={e => { e.stopPropagation(); put(a.id, { enabled: !a.enabled }) }} />
          <button className="ghost option-more" title="Delete" onClick={e => { e.stopPropagation(); save(list.filter(x => x.id !== a.id)) }}><Trash2 size={14} /></button>
        </div>
      ))}
      <button className="menu-item" onClick={() => { const a: Automation = { id: uid(), name: 'New automation', enabled: true, trigger: { type: 'added' }, actions: [] }; save([...list, a]); setOpenId(a.id) }}>
        <span className="menu-icon"><Plus size={16} /></span><span className="menu-label">New automation</span></button>
    </div>
  )
}

/** Notion's "New ▾" menu: the database's templates (⋯ for default, edit, duplicate, delete), an empty page, New template. */
function TemplateMenu({ db, templates, isDefault, use, empty, edit, create, setDefault, duplicate, remove, close }: {
  db: Page; templates: Page[]; isDefault: (id: string) => boolean; close: () => void
  use: (id: string) => void; empty: () => void; edit: (t: Page) => void; create: () => void
  setDefault: (id: string) => void; duplicate: (id: string) => void; remove: (id: string) => void
}) {
  const store = useStore()
  const [more, setMore] = useState<{ el: HTMLElement; t: Page } | null>(null)
  // Repeat: the server adds a page from the template at 9:00 (this browser's time) every day, week (today's weekday) or month.
  const repeatOf = (t: Page) => (t.props as { _repeat?: { every: 'day' | 'week' | 'month' } } | undefined)?._repeat?.every
  const setRepeat = (t: Page, every: 'day' | 'week' | 'month' | null) => {
    const { _repeat, ...rest } = (t.props ?? {}) as Record<string, unknown>
    void _repeat
    if (!every) return store.patch(t.id, { props: rest })
    const next = new Date(); next.setHours(9, 0, 0, 0)
    while (next.getTime() <= Date.now()) { if (every === 'month') next.setMonth(next.getMonth() + 1); else next.setDate(next.getDate() + (every === 'week' ? 7 : 1)) }
    return store.patch(t.id, { props: { ...rest, _repeat: { every, next: next.getTime() } } })
  }
  const REPEAT = { day: 'Daily', week: 'Weekly', month: 'Monthly' }
  return (
    <div className="menu-list template-menu">
      <div className="template-head"><b>Templates for <span>{iconOf(db, 16)} {label(db)}</span></b>
        {!templates.length && <p>Create a reusable page template for this database.</p>}</div>
      {templates.map(t => (
        <div key={t.id} className="option-row template-row" onClick={() => use(t.id)}>
          <span className="menu-icon">{iconOf(t, 16)}</span><span className="menu-label">{label(t)}</span>
          {isDefault(t.id) && <span className="template-default">Default</span>}
          {repeatOf(t) && <span className="template-default" title="Adds a page from this template at 9:00"><Repeat size={12} /> {REPEAT[repeatOf(t)!]}</span>}
          <button className="ghost option-more" title="Template options" onClick={e => { e.stopPropagation(); setMore({ el: e.currentTarget, t }) }}><MoreHorizontal size={14} /></button>
        </div>
      ))}
      {templates.length > 0 && <button className="menu-item" onClick={empty}><span className="menu-icon">{iconOf(db, 16)}</span><span className="menu-label">Empty page</span></button>}
      <div className="menu-divider" />
      <button className="menu-item" onClick={create}><span className="menu-icon"><Plus size={16} /></span><span className="menu-label">New template</span></button>
      <Popover anchor={more?.el ?? null} side="right" onClose={() => setMore(null)} className="menu-pop" width={220}>
        {more && <Menu onClose={() => { setMore(null); close() }} items={[
          { label: isDefault(more.t.id) ? 'Remove as default' : 'Set as default', onClick: () => setDefault(more.t.id) },
          { icon: <PenLine size={15} />, label: 'Edit', onClick: () => edit(more.t) },
          { icon: <Repeat size={15} />, label: 'Repeat', hint: (repeatOf(more.t) ? REPEAT[repeatOf(more.t)!] : 'Off') + ' ›', submenu: () => <Menu onClose={() => { setMore(null); close() }} items={[
            { label: 'Off', checked: !repeatOf(more.t), onClick: () => setRepeat(more.t, null) },
            ...(['day', 'week', 'month'] as const).map(k => ({ label: REPEAT[k], checked: repeatOf(more.t) === k, onClick: () => setRepeat(more.t, k) })),
          ]} /> },
          { icon: <Copy size={15} />, label: 'Duplicate', onClick: () => duplicate(more.t.id) },
          { icon: <Trash2 size={15} />, label: 'Delete', danger: true, onClick: () => remove(more.t.id) },
        ]} />}
      </Popover>
    </div>
  )
}

/** The view menu under the view pill: search, views (drag to reorder, ⋯ for options), New view. */
function ViewList({ views, current, canEdit, pick, more, reorder, add }: {
  views: View[]; current: string; canEdit: boolean
  pick: (id: string) => void; more: (id: string, el: HTMLElement) => void; reorder: (views: View[]) => void; add: () => void
}) {
  const [q, setQ] = useState('')
  const [drag, setDrag] = useState<string | null>(null)
  const shown = views.filter(v => v.name.toLowerCase().includes(q.toLowerCase()))
  const drop = (target: string) => {
    if (!drag || drag === target) return
    const moved = views.find(v => v.id === drag)!
    const rest = views.filter(v => v.id !== drag)
    rest.splice(rest.findIndex(v => v.id === target), 0, moved)
    reorder(rest)
  }
  return (
    <div className="menu-list">
      <input className="menu-filter" autoFocus placeholder="Search for a view…" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && shown[0]) pick(shown[0].id) }} />
      {shown.map(v => (
        <div key={v.id} className={'view-row' + (v.id === current ? ' on' : '')} draggable={canEdit && !q}
          onDragStart={() => setDrag(v.id)} onDragEnd={() => setDrag(null)} onDragOver={e => drag && e.preventDefault()} onDrop={() => drop(v.id)}
          onClick={() => pick(v.id)}>
          <span className="view-grip">{canEdit && <GripVertical size={16} />}</span>
          <span className="view-icon">{VIEW_ICONS[v.type]}</span>
          <span className="menu-label">{v.name}</span>
          {canEdit && <button className="view-more" title="View options" onClick={e => { e.stopPropagation(); more(v.id, e.currentTarget) }}><MoreHorizontal size={16} /></button>}
        </div>
      ))}
      {canEdit && <>
        <div className="menu-divider" />
        <button className="menu-item" onClick={add}><span className="menu-icon"><Plus size={16} /></span><span className="menu-label">New view</span></button>
      </>}
    </div>
  )
}

const SORT_EXTRA = [{ id: 'created', name: 'Created time', type: 'created' }, { id: 'updated', name: 'Last edited time', type: 'updated' }] as Prop[]
const TEXTY = ['title', 'text', 'url', 'email', 'phone', 'select', 'multi_select', 'status', 'person']
const dirName = (p: Prop | undefined, dir: 'asc' | 'desc') => (p && TEXTY.includes(p.type) ? (dir === 'asc' ? 'Sort A → Z' : 'Sort Z → A') : dir === 'asc' ? 'Ascending' : 'Descending')

/** Notion's sort editor: "Sort by…" until there is a rule, then rows of [grip][property ▾][direction ▾][×]. */
function SortEditor({ view, db, setView }: { view: View; db: Page; setView: (v: Partial<View>) => void }) {
  const [pick, setPick] = useState<{ el: HTMLElement; i: number | null; what: 'prop' | 'dir' } | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const sorts = view.sort ?? []
  const prop = (id: string) => propOf(db.schema, id) ?? SORT_EXTRA.find(p => p.id === id)
  const used = (p: Prop) => !sorts.some(s => s.prop === p.id)
  if (!sorts.length) return <PropertyList db={db} placeholder="Sort by…" extra={SORT_EXTRA} filter={used} onPick={p => setView({ sort: [{ prop: p.id, dir: 'asc' }] })} />
  const put = (i: number, x: Partial<(typeof sorts)[number]>) => setView({ sort: sorts.map((s, j) => (j === i ? { ...s, ...x } : s)) })
  return (
    <div className="sort-editor">
      {sorts.map((s, i) => (
        <div key={s.prop} className={'sort-row' + (drag === i ? ' dragging' : '')} draggable
          onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} onDragOver={e => e.preventDefault()}
          onDrop={() => { if (drag === null || drag === i) return; const next = [...sorts]; next.splice(i, 0, next.splice(drag, 1)[0]); setView({ sort: next }); setDrag(null) }}>
          <span className="sort-grip"><GripVertical size={14} /></span>
          <button className="sort-btn" onClick={e => setPick({ el: e.currentTarget, i, what: 'prop' })}>{prop(s.prop) && typeIcon(prop(s.prop)!)}<span>{prop(s.prop)?.name ?? 'Deleted'}</span><ChevronDown size={12} /></button>
          <button className="sort-btn" onClick={e => setPick({ el: e.currentTarget, i, what: 'dir' })}><span>{dirName(prop(s.prop), s.dir)}</span><ChevronDown size={12} /></button>
          <button className="ghost sort-x" title="Remove sort rule" onClick={() => setView({ sort: sorts.filter((_, j) => j !== i) })}><X size={14} /></button>
        </div>
      ))}
      <button className="menu-item muted-item" onClick={e => setPick({ el: e.currentTarget, i: null, what: 'prop' })}><span className="menu-icon"><Plus size={16} /></span><span className="menu-label">Add sort</span></button>
      <button className="menu-item muted-item" onClick={() => setView({ sort: [] })}><span className="menu-icon"><Trash2 size={16} /></span><span className="menu-label">Delete sort</span></button>
      <Popover anchor={pick?.el ?? null} onClose={() => setPick(null)} className="menu-pop" width={pick?.what === 'dir' ? 160 : 290}>
        {pick?.what === 'dir'
          ? <Menu onClose={() => setPick(null)} items={(['asc', 'desc'] as const).map(d => ({ label: dirName(prop(sorts[pick.i!].prop), d), checked: sorts[pick.i!].dir === d, onClick: () => put(pick.i!, { dir: d }) }))} />
          : pick && <PropertyList db={db} placeholder="Sort by…" extra={SORT_EXTRA} filter={used}
              onPick={p => { setView({ sort: pick.i === null ? [...sorts, { prop: p.id, dir: 'asc' }] : sorts.map((x, j) => (j === pick.i ? { ...x, prop: p.id } : x)) }); setPick(null) }} />}
      </Popover>
    </div>
  )
}

/* ---------- view settings (the ⋯ panel) ---------- */

function ViewSettings({ db, view, setView, setSchema, views, close, setViewId, newPage, templates, filter }: {
  db: Page; view: View; setView: (v: Partial<View>) => void; setSchema: (s: Schema) => void; views: View[]; close: () => void; setViewId: (id: string) => void
  newPage: () => void; templates: () => void; filter: () => void
}) {
  const [page, setPage] = useState<'main' | 'layout' | 'props' | 'group' | 'date' | 'end' | 'open' | 'sort' | 'colors' | 'automations'>('main')
  const lock = { icon: <Lock size={15} />, label: <span className="menu-switch">Lock database<span className={'switch' + (db.schema.locked ? ' on' : '')} /></span>, onClick: () => setSchema({ ...db.schema, locked: !db.schema.locked }) }
  if (db.schema.locked) return <Menu onClose={close} items={[
    { note: 'This database is locked: its views and properties can’t be changed. Rows can still be edited.' },
    lock,
    { icon: <Link2 size={15} />, label: 'Copy link to view', onClick: () => copyText(pageUrl(db.id)) },
  ]} />
  const props = db.schema.props ?? []
  const hidden = new Set(view.hidden ?? [])
  const back = <button className="menu-item back" onClick={() => setPage('main')}><span className="menu-icon">‹</span><span className="menu-label"><b>{{ main: '', layout: 'Layout', props: 'Properties', group: 'Group', date: 'Date property', end: 'End date', open: 'Open pages in', sort: 'Sort', colors: 'Conditional color', automations: 'Automations' }[page]}</b></span></button>
  if (page === 'layout') return (
    <div className="menu-list">{back}
      <div className="layout-grid">{(Object.keys(VIEW_NAMES) as ViewType[]).map(t => (
        <button key={t} className={'layout-tile' + (view.type === t ? ' on' : '')} onClick={() => {
          const v: Partial<View> = { type: t }
          if (t === 'board' && !view.groupBy) v.groupBy = props.find(p => p.type === 'status' || p.type === 'select')?.id
          if ((t === 'calendar' || t === 'timeline') && !view.dateProp) v.dateProp = props.find(p => p.type === 'date')?.id
          if (t === 'form' && !view.form) v.form = defaultForm(db)
          setView(v)
        }}>{VIEW_ICONS[t]}<span>{VIEW_NAMES[t]}</span></button>
      ))}</div>
    </div>
  )
  if (page === 'props') return (
    <div className="menu-list">{back}
      {props.map(p => (
        <button key={p.id} className="menu-item" onClick={() => setView({ hidden: hidden.has(p.id) ? [...hidden].filter(h => h !== p.id) : [...hidden, p.id] })}>
          <span className="menu-icon">{typeIcon(p)}</span><span className="menu-label">{p.name}</span><span className="menu-hint">{hidden.has(p.id) ? <EyeOff size={14} /> : <Eye size={14} />}</span>
        </button>
      ))}
      <button className="menu-item" onClick={() => setView({ hidden: [] })}><span className="menu-label">Show all</span></button>
      <button className="menu-item" onClick={() => setView({ hidden: props.map(p => p.id) })}><span className="menu-label">Hide all</span></button>
    </div>
  )
  if (page === 'group') return (
    <div className="menu-list">{back}
      {view.type !== 'board' && <button className="menu-item" onClick={() => setView({ groupBy: undefined })}><span className="menu-label">None</span>{!view.groupBy && <span className="menu-check">✓</span>}</button>}
      {props.filter(groupable).map(p => <button key={p.id} className="menu-item" onClick={() => setView({ groupBy: p.id })}><span className="menu-icon">{typeIcon(p)}</span><span className="menu-label">{p.name}</span>{view.groupBy === p.id && <span className="menu-check">✓</span>}</button>)}
      <button className="menu-item" onClick={() => setView({ showEmptyGroups: !view.showEmptyGroups })}><span className="menu-label">Show empty groups</span>{view.showEmptyGroups && <span className="menu-check">✓</span>}</button>
    </div>
  )
  if (page === 'date' || page === 'end') return (
    <div className="menu-list">{back}
      {page === 'end' && <button className="menu-item" onClick={() => setView({ endProp: undefined })}><span className="menu-label">None (use date ranges)</span>{!view.endProp && <span className="menu-check">✓</span>}</button>}
      {props.filter(p => ['date', 'created', 'updated'].includes(p.type)).map(p => (
        <button key={p.id} className="menu-item" onClick={() => setView(page === 'date' ? { dateProp: p.id } : { endProp: p.id })}><span className="menu-icon">{typeIcon(p)}</span><span className="menu-label">{p.name}</span>{(page === 'date' ? view.dateProp : view.endProp) === p.id && <span className="menu-check">✓</span>}</button>
      ))}
    </div>
  )
  if (page === 'open') return (
    <div className="menu-list">{back}
      {([['peek', 'Side peek', <PanelRight size={15} />], ['center', 'Center peek', <SquareSplitHorizontal size={15} />], ['page', 'Full page', <Maximize2 size={15} />]] as const).map(([k, n, icon]) => (
        <button key={k} className="menu-item" onClick={() => setView({ open: k })}><span className="menu-icon">{icon}</span><span className="menu-label">{n}</span>{(view.open ?? 'peek') === k && <span className="menu-check">✓</span>}</button>
      ))}
    </div>
  )
  if (page === 'colors') return <div className="menu-list">{back}<ColorRules db={db} view={view} setView={setView} /></div>
  if (page === 'automations') return <div className="menu-list">{back}<Automations db={db} setSchema={setSchema} /></div>
  if (page === 'sort') return <div className="menu-list">{back}<SortEditor view={view} db={db} setView={setView} /></div>
  const items: Item[] = [
    // Notion's order: New page, templates, the view, then the data source and More settings.
    { icon: <Plus size={15} />, label: <span className="accent-text">New page</span>, onClick: newPage },
    { icon: <FileText size={15} />, label: 'Page templates', hint: '›', onClick: templates },
    { divider: true },
    { note: <input className="wide" defaultValue={view.name} onBlur={e => e.target.value.trim() && setView({ name: e.target.value.trim() })} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /> },
    { icon: VIEW_ICONS[view.type], label: 'Layout', hint: VIEW_NAMES[view.type] + ' ›', onClick: () => setPage('layout') },
    { icon: <Eye size={15} />, label: 'Property visibility', hint: `${props.length - hidden.size} shown ›`, onClick: () => setPage('props') },
    { icon: <FilterIcon size={15} />, label: 'Filter', hint: `${view.filters?.length || 'None'} ›`, onClick: filter },
    { icon: <ArrowDownUp size={15} />, label: 'Sort', hint: `${view.sort?.length || 'None'} ›`, onClick: () => setPage('sort') },
    { icon: <Group size={15} />, label: 'Group', hint: (propOf(db.schema, view.groupBy ?? '')?.name ?? 'None') + ' ›', onClick: () => setPage('group') },
    ...(view.type === 'calendar' || view.type === 'timeline' ? [{ icon: <Calendar size={15} />, label: view.type === 'calendar' ? 'Show calendar by' : 'Show timeline by', hint: (propOf(db.schema, view.dateProp ?? '')?.name ?? 'None') + ' ›', onClick: () => setPage('date') }] : []),
    ...(view.type === 'timeline' ? [{ icon: <Calendar size={15} />, label: 'End date', hint: (propOf(db.schema, view.endProp ?? '')?.name ?? 'None') + ' ›', onClick: () => setPage('end') }] : []),
    ...(view.type === 'gallery' ? [
      { icon: <LayoutGrid size={15} />, label: 'Card preview', hint: { content: 'Page content', cover: 'Page cover', none: 'None' }[view.cardPreview ?? 'content'] + ' ›', submenu: () => <Menu onClose={() => {}} items={(['none', 'cover', 'content'] as const).map(k => ({ label: { content: 'Page content', cover: 'Page cover', none: 'None' }[k], checked: (view.cardPreview ?? 'content') === k, onClick: () => setView({ cardPreview: k }) }))} /> },
      { icon: <LayoutGrid size={15} />, label: 'Card size', hint: { s: 'Small', m: 'Medium', l: 'Large' }[view.cardSize ?? 'm'], onClick: () => setView({ cardSize: view.cardSize === 's' ? 'm' : view.cardSize === 'l' ? 's' : 'l' }) },
    ] as Item[] : []),
    ...(view.type === 'table' ? [{ icon: <Settings2 size={15} />, label: 'Wrap all columns', checked: !!view.wrap, onClick: () => setView({ wrap: !view.wrap }) }] : []),
    ...(['table', 'board', 'list', 'gallery'].includes(view.type) ? [{ icon: <ListOrdered size={15} />, label: 'Load limit', hint: `${view.limit ?? 50} ›`, submenu: () => <Menu onClose={() => {}} items={([10, 25, 50, 100] as const).map(n => ({ label: String(n), checked: (view.limit ?? 50) === n, onClick: () => setView({ limit: n }) }))} /> }] as Item[] : []),
    { icon: <PanelRight size={15} />, label: 'Open pages in', hint: { peek: 'Side peek', center: 'Center peek', page: 'Full page' }[view.open ?? 'peek'] + ' ›', onClick: () => setPage('open') },
    { divider: true },
    { icon: <Palette size={15} />, label: 'Conditional color', hint: `${view.colors?.length || ''} ›`.trim(), onClick: () => setPage('colors') },
    { icon: <Link2 size={15} />, label: 'Copy link to view', onClick: () => copyText(`${pageUrl(db.id)}`) },
    { icon: <Copy size={15} />, label: 'Duplicate view', onClick: () => { const v = { ...view, id: uid(), name: view.name + ' (1)' }; setSchema({ ...db.schema, views: [...views, v] }); setViewId(v.id); close() } },
    ...(views.length > 1 ? [{ icon: <Trash2 size={15} />, label: 'Delete view', danger: true, onClick: () => { setSchema({ ...db.schema, views: views.filter(v => v.id !== view.id) }); close() } }] : []),
    { heading: 'Data source settings' },
    { icon: <DbIcon size={15} />, label: 'Source', hint: label(db) },
    { icon: <Settings2 size={15} />, label: 'Edit properties', hint: '›', onClick: () => setPage('props') },
    { icon: <Zap size={15} />, label: 'Automations', hint: `${db.schema.automations?.length || ''} ›`.trim(), onClick: () => setPage('automations') },
    { heading: 'More settings' },
    // Sub-items and Dependencies are pairs of two-way relations from the database to itself, as in Notion.
    ...(can(db, 'edit') && !db.schema.locked ? [
      { icon: <ListTree size={15} />, label: 'Sub-items', checked: !!db.schema.subItems, onClick: () => setSchema(db.schema.subItems ? { ...db.schema, subItems: undefined } : selfPair(db, 'Parent item', 'Sub-items', (a, b) => ({ subItems: { parent: a, children: b } }))) },
      { icon: <Waypoints size={15} />, label: 'Dependencies', checked: !!db.schema.deps, onClick: () => setSchema(db.schema.deps ? { ...db.schema, deps: undefined } : selfPair(db, 'Blocked by', 'Blocking', (a, b) => ({ deps: { blockedBy: a, blocking: b } }))) },
    ] : []),
    lock,
  ]
  // Sub-pages are rendered in place, so keep the menu open when moving between them.
  return <Menu items={items} onClose={() => { /* stays open for sub-pages */ }} />
}

/** Two relation properties linking the database to itself, each the other's two-way side; turning the feature
 *  back on reuses the pair it made before (by name), so values aren't lost. */
function selfPair(db: Page, nameA: string, nameB: string, mark: (a: string, b: string) => Partial<Schema>): Schema {
  const props = db.schema.props ?? []
  const old = [nameA, nameB].map(n => props.find(p => p.type === 'relation' && p.relation?.db === db.id && p.name === n))
  if (old[0] && old[1]) return { ...db.schema, ...mark(old[0].id, old[1].id) }
  const a = uid(), b = uid()
  return { ...db.schema, props: [...props, { id: a, name: nameA, type: 'relation', relation: { db: db.id, synced: b } }, { id: b, name: nameB, type: 'relation', relation: { db: db.id, synced: a } }], ...mark(a, b) }
}

/* ---------- peek ---------- */

function Peek({ row, mode, close, rows, setRow, dark }: { row: Page; mode: 'peek' | 'center'; close: () => void; rows: Page[]; setRow: (r: Page) => void; dark: boolean }) {
  const store = useStore()
  const i = rows.findIndex(r => r.id === row.id)
  useEffect(() => { if (mode === 'peek') dispatchEvent(new CustomEvent('bloki:narrow', { detail: innerWidth * 0.5 })) }, [mode])
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.popover')) close() }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [close])
  return (
    <div className={'peek-overlay ' + (mode === 'center' ? 'center' : 'side')} onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="peek">
        <div className="peek-bar">
          <button className="ghost" title="Close" onClick={close}><ChevronsRight size={18} /></button>
          <button className="ghost" title="Open as full page" onClick={() => { close(); store.go(row.id) }}><Maximize2 size={15} /></button>
          <button className="ghost" disabled={i <= 0} onClick={() => setRow(rows[i - 1])}><ChevronUp size={16} /></button>
          <button className="ghost" disabled={i < 0 || i >= rows.length - 1} onClick={() => setRow(rows[i + 1])}><ChevronDown size={16} /></button>
        </div>
        <PageView id={row.id} dark={dark} peek />
      </div>
    </div>
  )
}

/* ---------- the database ---------- */

export function Database({ id, inline }: { id: string; inline?: boolean }) {
  const store = useStore()
  const db = store.byId.get(id)
  const [viewId, setViewId] = useState<string>()
  const [pop, setPop] = useState<{ kind: 'add-view' | 'views' | 'tab' | 'filter-add' | 'filter' | 'sort' | 'settings' | 'new'; el: HTMLElement; index?: number } | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [peek, setPeek] = useState<Page | null>(null)
  const [local, setLocal] = useState<Partial<View>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const closePop = useCallback(() => setPop(null), [])
  const dark = document.documentElement.dataset.theme === 'dark'
  useEffect(() => { setLocal({}) }, [viewId])

  const schema = db?.schema ?? {}
  const views = schema.views ?? []
  const saved = views.find(v => v.id === viewId) ?? views[0]
  // Lock database (Notion): views and properties are frozen until someone who can edit unlocks it.
  const canStructure = !!db && can(db, 'edit') && !store.published
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 760px)').matches)
  useEffect(() => { const m = matchMedia('(max-width: 760px)'); const on = () => setNarrow(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on) }, [])
  const perm = { rows: !!db && can(db, 'edit_content') && !store.published, structure: canStructure && !db?.schema.locked }
  // People who can't change the database still get personal filters and sorts, as in Notion.
  const view: View | undefined = saved && { ...saved, ...local }
  const ctx = useMemo(() => ctxOf(store), [store])
  const rows = useMemo(() => {
    if (!db || !view) return []
    let r = applyView(store.children(db.id).filter(x => !isTemplate(x)), schema, view, ctx, store.me?.user.id)
    if (query) {
      const q = query.toLowerCase()
      r = r.filter(row => label(row).toLowerCase().includes(q) || (schema.props ?? []).some(p => textOf(value(row, p, schema, ctx), p, ctx).toLowerCase().includes(q)))
    }
    return r
  }, [db, view, store, schema, ctx, query])

  if (!db) return <div className="db-missing">This database doesn’t exist or you don’t have access.</div>
  if (db.trashed) return <div className="db-missing">This database is in Trash.</div>
  if (!view) return <div className="db-missing">This database has no views.</div>

  const setSchema = (s: Schema) => store.patch(db.id, { schema: s })
  const setView = (v: Partial<View>) => {
    if (!perm.structure) { setLocal(l => ({ ...l, ...v })); return }
    setSchema({ ...schema, views: views.map(x => (x.id === view.id ? { ...x, ...v } : x)) })
  }
  const props = (schema.props ?? []).filter(p => !view.hidden?.includes(p.id))
  const openRow = (r: Page) => ((view.open ?? 'peek') === 'page' ? store.go(r.id) : setPeek(r))
  // Templates: rows marked _template. Using one copies its title, icon, properties and content into a new row.
  const templates = store.children(db.id).filter(isTemplate)
  const fromTemplate = async (id: string) => {
    try {
      const t = await api.get(id)
      const { _template, ...props } = (t.props ?? {}) as Record<string, unknown>
      void _template
      const row = await store.create({ parent_id: db.id, title: t.title, icon: t.icon, props, content: t.content }, false)
      openRow(row)
    } catch (e) { store.setError((e as Error).message) }
  }
  const newTemplate = async () => {
    const row = await store.create({ parent_id: db.id, title: 'New template', props: { ...newRowDefaults(schema), _template: true } }, false)
    setPeek(row)
  }
  const addRow = async (defaults: Record<string, unknown> = {}, open = true) => {
    // New rows satisfy simple filters so they don't vanish when created.
    const p: Record<string, unknown> = { ...newRowDefaults(schema), ...defaults }
    for (const f of view.filters ?? []) {
      const pr = propOf(schema, f.prop)
      if (!pr || pr.id === 'title' || pr.id in p) continue
      if (f.op === 'checked') p[pr.id] = true
      if (f.op === 'is' && ['select', 'status'].includes(pr.type)) p[pr.id] = f.value
      if (f.op === 'contains' && ['multi_select', 'person', 'relation'].includes(pr.type) && f.value) p[pr.id] = [f.value]
      if (f.op === 'me' && store.me) p[pr.id] = [store.me.user.id]
    }
    try {
      const row = await store.create({ parent_id: db.id, props: p }, false)
      if (open && view.type !== 'table') openRow(row)
      return row
    } catch { return undefined }
  }
  const addView = (type: ViewType) => {
    const v: View = { id: uid(), name: VIEW_NAMES[type], type }
    if (type === 'board') v.groupBy = schema.props?.find(p => p.type === 'status' || p.type === 'select')?.id
    if (type === 'calendar' || type === 'timeline') v.dateProp = schema.props?.find(p => p.type === 'date')?.id
    if (type === 'form') v.form = defaultForm(db)
    if (type === 'chart') v.chart = { type: 'bar' }
    setSchema({ ...schema, views: [...views, v] })
    setViewId(v.id)
  }
  const addFilter = (prop: string) => {
    const pr = propOf(schema, prop)!
    const filters = [...(view.filters ?? []), { prop, op: opsFor(pr.type)[0], value: '' }]
    setView({ filters })
    setTimeout(() => {
      const pills = document.querySelectorAll<HTMLElement>(`[data-db="${db.id}"] .filter-pill`)
      const el = pills[filters.length - 1]
      if (el) setPop({ kind: 'filter', el, index: filters.length - 1 })
    }, 50)
  }
  const filters = view.filters ?? []
  const sorts = view.sort ?? []
  const Body = VIEW_COMPONENTS[view.type]

  return (
    <div className={'database' + (inline ? ' inline' : ' full')} data-db={db.id}>
      {inline && (
        <div className="db-inline-title">
          <span className="db-inline-icon">{iconOf(db, 20)}</span>
          <input defaultValue={db.title} key={db.title} placeholder="Untitled" readOnly={!perm.structure} onBlur={e => e.target.value !== db.title && store.patch(db.id, { title: e.target.value })}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <button className="ghost" title="Open as full page" onClick={() => store.go(db.id)}><ArrowUpRight size={15} /></button>
        </div>
      )}
      <div className="db-bar">
        {/* As in Notion: views as pill tabs; clicking the open one shows its options, the rest overflow into "N more…".
            ponytail: shows at most three tabs rather than measuring how many fit. */}
        <div className="db-tabs">
          {(() => {
            // In a narrow window Notion keeps only the open view, with a ▾ that lists the others.
            const first = views.slice(0, narrow ? 1 : 3)
            const shown = narrow ? [view] : first.some(v => v.id === view.id) ? first : [...views.slice(0, 2), view]
            return <>
              {shown.map(v => (
                <button key={v.id} className={'view-tab' + (v.id === view.id ? ' on' : '')}
                  onClick={e => (v.id === view.id ? perm.structure && setPop({ kind: 'tab', el: e.currentTarget }) : setViewId(v.id))}
                  onDoubleClick={() => perm.structure && setRenaming(v.id)}>
                  {VIEW_ICONS[v.type]}
                  {renaming === v.id
                    ? <input autoFocus className="tab-rename" defaultValue={v.name} onClick={e => e.stopPropagation()} onBlur={e => { setSchema({ ...schema, views: views.map(x => (x.id === v.id ? { ...x, name: e.target.value || x.name } : x)) }); setRenaming(null) }} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                    : <span>{v.name}</span>}
                </button>
              ))}
              {narrow
                ? <button className="views-more caret-only" title="All views" onClick={e => setPop({ kind: 'views', el: e.currentTarget })}><ChevronDown size={16} /></button>
                : views.length > shown.length
                ? <button className="views-more" onClick={e => setPop({ kind: 'views', el: e.currentTarget })}>{views.length - shown.length} more…</button>
                : perm.structure && <button className="icon-btn view-add" title="Add view" onClick={e => setPop({ kind: 'add-view', el: e.currentTarget })}><Plus size={16} /></button>}
            </>
          })()}
        </div>
        <div className="db-tools">
          {/* A form adds rows instead of showing them, so it has its own Preview and Share form instead of these. */}
          {view.type !== 'form' && <>
          <button className={'icon-btn' + (filters.length ? ' on-accent' : '')} title="Filter" onClick={e => (filters.length ? setPop({ kind: 'filter-add', el: e.currentTarget }) : setPop({ kind: 'filter-add', el: e.currentTarget }))}><FilterIcon size={15} /></button>
          <button className={'icon-btn' + (sorts.length ? ' on-accent' : '')} title="Sort" onClick={e => setPop({ kind: 'sort', el: e.currentTarget })}><ArrowDownUp size={15} /></button>
          {query === null
            ? <button className="icon-btn" title="Search" onClick={() => setQuery('')}><Search size={15} /></button>
            : <span className="db-search"><Search size={14} /><input autoFocus placeholder="Type to search…" value={query} onChange={e => setQuery(e.target.value)} onBlur={() => !query && setQuery(null)} onKeyDown={e => e.key === 'Escape' && setQuery(null)} /></span>}
          </>}
          <button className="icon-btn" title="Settings" onClick={e => setPop({ kind: 'settings', el: e.currentTarget })}><MoreHorizontal size={16} /></button>
          {perm.rows && view.type !== 'form' && (
            <span className="new-split">
              <button className="primary" onClick={() => (schema.defaultTemplate && store.byId.get(schema.defaultTemplate) && !store.byId.get(schema.defaultTemplate)!.trashed ? fromTemplate(schema.defaultTemplate) : addRow())}>New</button>
              <button className="primary caret" onClick={e => setPop({ kind: 'new', el: e.currentTarget })}><ChevronDown size={14} /></button>
            </span>
          )}
        </div>
      </div>

      {(filters.length > 0 || sorts.length > 0) && (
        <div className="pill-bar">
          {sorts.length > 0 && (
            <button className="pill on" onClick={e => setPop({ kind: 'sort', el: e.currentTarget })}><ArrowDownUp size={12} /> {sorts.length === 1 ? propOf(schema, sorts[0].prop)?.name ?? 'Sort' : `${sorts.length} sorts`} <ChevronDown size={12} /></button>
          )}
          {sorts.length > 0 && filters.length > 0 && <span className="pill-sep" />}
          {filters.map((f, i) => {
            const pr = propOf(schema, f.prop)
            const valueText = !needsValue(f.op) ? OP_NAMES[f.op] : pr?.options?.find(o => o.id === f.value)?.name ?? store.people.get(f.value ?? '')?.name ?? store.byId.get(f.value ?? '')?.title ?? f.value
            return (
              <button key={i} className={'pill filter-pill' + (valueText ? ' on' : '')} onClick={e => setPop({ kind: 'filter', el: e.currentTarget, index: i })}>
                {pr && typeIcon(pr)}<span><b className="pill-name">{pr?.name}</b>{valueText ? `: ${valueText}` : ''}</span><ChevronDown size={14} />
              </button>
            )
          })}
          <button className="pill ghost-pill add-filter" onClick={e => setPop({ kind: 'filter-add', el: e.currentTarget })}><Plus size={14} /> Filter</button>
          {Object.keys(local).length > 0 && <>
            <button className="pill ghost-pill" onClick={() => setLocal({})}>Reset</button>
          </>}
        </div>
      )}

      <Body db={db} rows={rows} props={props} view={view} setView={setView} addRow={addRow} openRow={openRow} perm={perm} addFilter={addFilter} />

      {!rows.length && !['table', 'calendar', 'timeline', 'form', 'chart', 'dashboard'].includes(view.type) && <div className="view-empty muted">{query || filters.length ? 'No results' : 'No pages yet'}</div>}

      <Popover anchor={pop?.kind === 'add-view' ? pop.el : null} onClose={closePop} className="add-view-pop" width={390}>
        {/* Notion shows the layouts as a grid of tiles, in this order. */}
        <div className="add-view-head">Add a new view</div>
        <div className="add-view-grid">
          {(['table', 'board', 'gallery', 'list', 'chart', 'dashboard', 'timeline', 'feed', 'calendar', 'form'] as ViewType[]).map(t => (
            <button key={t} onClick={() => { addView(t); closePop() }}>{VIEW_ICONS[t]}<span>{VIEW_NAMES[t]}</span></button>
          ))}
        </div>
      </Popover>
      <Popover anchor={pop?.kind === 'views' ? pop.el : null} onClose={closePop} className="menu-pop" width={290}>
        <ViewList views={views} current={view.id} canEdit={perm.structure}
          pick={id => { setViewId(id); closePop() }}
          more={(id, el) => { setViewId(id); setTimeout(() => setPop({ kind: 'tab', el }), 0) }}
          reorder={next => setSchema({ ...schema, views: next })}
          add={() => { const el = pop!.el; setTimeout(() => setPop({ kind: 'add-view', el }), 0) }} />
      </Popover>
      <Popover anchor={pop?.kind === 'tab' ? pop.el : null} onClose={closePop} className="menu-pop" width={220}>
        <Menu onClose={closePop} items={[
          { icon: <PenLine size={15} />, label: 'Rename', onClick: () => setRenaming(view.id) },
          { icon: <Settings2 size={15} />, label: 'Edit view', onClick: () => setTimeout(() => setPop({ kind: 'settings', el: document.querySelector(`[data-db="${db.id}"] .db-tools .icon-btn:is([title="Settings"],[data-tip="Settings"])`) as HTMLElement }), 0) },
          { icon: <Copy size={15} />, label: 'Duplicate', onClick: () => { const v = { ...view, ...local, id: uid(), name: view.name + ' (1)' }; setSchema({ ...schema, views: [...views, v] }); setViewId(v.id) } },
          { icon: <Link2 size={15} />, label: 'Copy link to view', onClick: () => copyText(pageUrl(db.id)) },
          ...(views.length > 1 ? [{ icon: <Trash2 size={15} />, label: 'Delete', danger: true, onClick: () => { setSchema({ ...schema, views: views.filter(v => v.id !== view.id) }); setViewId(undefined) } }] : []),
        ]} />
      </Popover>
      <Popover anchor={pop?.kind === 'filter-add' ? pop.el : null} onClose={closePop} className="menu-pop" width={290}>
        <PropertyList db={db} onPick={p => { closePop(); addFilter(p.id) }} />
      </Popover>
      <Popover anchor={pop?.kind === 'filter' ? pop.el : null} onClose={closePop} className="menu-pop" width={260}>
        {pop?.kind === 'filter' && filters[pop.index!] && (
          <FilterEditor f={filters[pop.index!]} db={db}
            onChange={f => setView({ filters: filters.map((x, j) => (j === pop.index ? f : x)) })}
            onRemove={() => { setView({ filters: filters.filter((_, j) => j !== pop.index) }); closePop() }} />
        )}
      </Popover>
      <Popover anchor={pop?.kind === 'sort' ? pop.el : null} onClose={closePop} className="menu-pop" width={sorts.length ? 304 : 290}>
        <SortEditor view={view} db={db} setView={setView} />
      </Popover>
      <Popover anchor={pop?.kind === 'settings' ? pop.el : null} onClose={closePop} align="end" className="menu-pop" width={290}>
        {canStructure
          ? <ViewSettings db={db} view={view} setView={setView} setSchema={setSchema} views={views} close={closePop} setViewId={setViewId}
              newPage={() => { closePop(); addRow({}, true) }} templates={() => { const el = pop!.el; setTimeout(() => setPop({ kind: 'new', el }), 0) }}
              filter={() => { const el = pop!.el; setTimeout(() => setPop({ kind: 'filter-add', el }), 0) }} />
          : <Menu onClose={closePop} items={[{ note: 'You can view this database. Ask for edit access to change its views.' }, { icon: <Link2 size={15} />, label: 'Copy link', onClick: () => copyText(pageUrl(db.id)) }]} />}
      </Popover>
      <Popover anchor={pop?.kind === 'new' ? pop.el : null} onClose={closePop} align="end" className="menu-pop" width={360}>
        <TemplateMenu db={db} templates={templates} isDefault={id => schema.defaultTemplate === id} close={closePop}
          use={id => { closePop(); fromTemplate(id) }} empty={() => { closePop(); addRow({}, true) }}
          edit={t => { closePop(); setPeek(t) }} create={() => { closePop(); newTemplate() }}
          setDefault={id => setSchema({ ...schema, defaultTemplate: schema.defaultTemplate === id ? undefined : id })}
          duplicate={async id => { await api.duplicate(id); await store.reload() }}
          remove={id => { store.patch(id, { trashed: true }); if (schema.defaultTemplate === id) setSchema({ ...schema, defaultTemplate: undefined }) }} />
      </Popover>
      {peek && store.byId.get(peek.id) && (
        <Peek row={store.byId.get(peek.id)!} mode={(view.open ?? 'peek') === 'center' ? 'center' : 'peek'} close={() => setPeek(null)} rows={rows} setRow={setPeek} dark={dark} />
      )}
    </div>
  )
}
