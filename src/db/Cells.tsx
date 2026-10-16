import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlignLeft, ArrowUpRight, AtSign, Calendar, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, CircleDot, Clock, Copy, Fingerprint, Hash, Link2, List,
  MoreHorizontal, Paperclip, Phone, Plus, Search, Sigma, Trash2, User, UserCircle, X, ListChecks, SlidersHorizontal,
} from 'lucide-react'
import { api, COLORS, uid, type Option, type Page, type Prop, type PropType, type Schema } from '../api'
import { iconOf, label, useStore } from '../store'
import { Popover, Menu, usePopover } from '../ui'
import { FUNCTION_NAMES, FormulaError, toText, type Value } from './formula'
import { COMPUTED, dateValue, formatDate, formatNumber, isoDay, NUMBER_FORMATS, optionOf, propOf, ROLLUP_FNS, toDate, TYPE_NAMES, value, type Ctx, type DateValue } from './model'

type Store = ReturnType<typeof useStore>
export const ctxOf = (store: Store): Ctx => ({ byId: store.byId, people: store.people })

export const TYPE_ICONS: Record<PropType | 'title', ReactNode> = {
  title: <AlignLeft size={14} />, text: <AlignLeft size={14} />, number: <Hash size={14} />, select: <ChevronDown size={14} />, multi_select: <List size={14} />,
  status: <CircleDot size={14} />, date: <Calendar size={14} />, person: <User size={14} />, files: <Paperclip size={14} />, checkbox: <CheckSquare size={14} />,
  url: <Link2 size={14} />, email: <AtSign size={14} />, phone: <Phone size={14} />, formula: <Sigma size={14} />, relation: <ArrowUpRight size={14} />,
  rollup: <Search size={14} />, created: <Clock size={14} />, created_by: <UserCircle size={14} />, updated: <Clock size={14} />, updated_by: <UserCircle size={14} />,
  unique_id: <Fingerprint size={14} />,
}
export const typeIcon = (p: Prop) => (p.id === 'title' ? TYPE_ICONS.title : TYPE_ICONS[p.type])

export function Chip({ o, onRemove }: { o?: Option; onRemove?: () => void }) {
  if (!o) return null
  return <span className={'chip opt-' + o.color}>{o.name}{onRemove && <button className="chip-x" onClick={e => { e.stopPropagation(); onRemove() }}><X size={10} /></button>}</span>
}
export function StatusChip({ o }: { o?: Option }) {
  if (!o) return null
  return <span className={'chip status opt-' + o.color}><span className="status-dot" />{o.name}</span>
}
function Person({ id }: { id: string }) {
  const { people } = useStore()
  const name = people.get(id)?.name ?? 'Former member'
  return <span className="person-pill"><span className="avatar small">{name[0]}</span>{name}</span>
}
function RelationPill({ id }: { id: string }) {
  const store = useStore()
  const p = store.byId.get(id)
  if (!p) return null
  return <span className="relation-pill" onClick={e => { e.stopPropagation(); store.go(id) }}>{iconOf(p, 14)}<span>{label(p)}</span></span>
}

/** Read-only rendering of a property value. */
export function CellView({ prop, row, schema, wrap }: { prop: Prop; row: Page; schema: Schema; wrap?: boolean }) {
  const store = useStore()
  const v = value(row, prop, schema, ctxOf(store))
  if (v instanceof FormulaError) return <span className="cell-error" title={v.message}>Error</span>
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return prop.type === 'checkbox' ? <span className="checkbox" /> : null
  switch (prop.type) {
    case 'select': return <Chip o={optionOf(prop, v)} />
    case 'status': return <StatusChip o={optionOf(prop, v)} />
    case 'multi_select': return <span className={'chips-cell' + (wrap ? ' wrap' : '')}>{(v as string[]).map(id => <Chip key={id} o={optionOf(prop, id)} />)}</span>
    case 'checkbox': return <span className={'checkbox' + (v === true ? ' on' : '')}>{v === true && '✓'}</span>
    case 'date': return <span>{formatDate(v)}</span>
    case 'created': case 'updated': return <span>{new Date(Number(v)).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
    case 'person': return <span className={'chips-cell' + (wrap ? ' wrap' : '')}>{[v].flat().map(id => <Person key={String(id)} id={String(id)} />)}</span>
    case 'created_by': case 'updated_by': return <Person id={String(v)} />
    case 'relation': return <span className={'chips-cell' + (wrap ? ' wrap' : '')}>{(v as string[]).map(id => <RelationPill key={id} id={id} />)}</span>
    case 'files': return <span className="chips-cell">{(v as { name: string; url: string }[]).map(f => <a key={f.url} className="file-pill" href={f.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}><Paperclip size={12} />{f.name}</a>)}</span>
    case 'url': return <a className="link-cell" href={/^https?:\/\//.test(String(v)) ? String(v) : `https://${v}`} target="_blank" rel="noreferrer noopener" onClick={e => e.stopPropagation()}>{String(v)}</a>
    case 'email': return <a className="link-cell" href={`mailto:${v}`} onClick={e => e.stopPropagation()}>{String(v)}</a>
    case 'phone': return <a className="link-cell" href={`tel:${v}`} onClick={e => e.stopPropagation()}>{String(v)}</a>
    case 'number': return <span className="num">{formatNumber(v, prop.format)}</span>
    case 'unique_id': return <span>{prop.prefix ? `${prop.prefix}-` : ''}{String(v)}</span>
    case 'formula': case 'rollup': {
      const x = v as Value
      if (typeof x === 'boolean') return <span className={'checkbox' + (x ? ' on' : '')}>{x && '✓'}</span>
      if (typeof x === 'number') return <span className="num">{formatNumber(x, prop.format)}</span>
      return <span className={wrap ? 'wrap-text' : ''}>{toText(x)}</span>
    }
    default: return <span className={wrap ? 'wrap-text' : ''}>{String(v)}</span>
  }
}

/* ---------- editors ---------- */

export function setValue(store: Store, row: Page, prop: Prop, v: unknown) {
  if (prop.id === 'title') return store.patch(row.id, { title: String(v ?? '') })
  return store.patch(row.id, { props: { ...row.props, [prop.id]: v } })
}

/** Keep a two-way relation's other side in step with this one. */
async function syncRelation(store: Store, row: Page, prop: Prop, before: string[], after: string[]) {
  const synced = prop.relation?.synced
  if (!synced) return
  const changed = [...after.filter(id => !before.includes(id)).map(id => [id, true] as const), ...before.filter(id => !after.includes(id)).map(id => [id, false] as const)]
  for (const [id, add] of changed) {
    const other = store.byId.get(id)
    if (!other) continue
    const cur = Array.isArray(other.props?.[synced]) ? (other.props[synced] as string[]) : []
    const next = add ? [...new Set([...cur, row.id])] : cur.filter(x => x !== row.id)
    try { await api.update(id, { props: { ...other.props, [synced]: next } }) } catch (e) { store.setError((e as Error).message) }
  }
  await store.reload()
}

export function updateOptions(store: Store, db: Page, prop: Prop, options: Option[]) {
  return store.patch(db.id, { schema: { ...db.schema, props: db.schema.props?.map(p => (p.id === prop.id ? { ...p, options } : p)) } })
}

function OptionMenu({ o, onChange, onDelete }: { o: Option; onChange: (o: Option) => void; onDelete: () => void }) {
  const [name, setName] = useState(o.name)
  return (
    <div className="menu-list option-menu">
      <input className="menu-filter" autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== o.name && onChange({ ...o, name: name.trim() })}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <button className="menu-item danger" onClick={onDelete}><span className="menu-icon"><Trash2 size={15} /></span><span className="menu-label">Delete</span></button>
      <div className="menu-heading">Colors</div>
      {COLORS.map(c => (
        <button key={c} className="menu-item" onClick={() => onChange({ ...o, color: c })}>
          <span className={'swatch opt-' + c} /><span className="menu-label">{c[0].toUpperCase() + c.slice(1)}</span>{o.color === c && <span className="menu-check">✓</span>}
        </button>
      ))}
    </div>
  )
}

/** Status options without a group (older data) fall back to first = to-do, last = complete. */
export function statusGroup(o: Option, all: Option[]): Option['group'] {
  if (o.group) return o.group
  const i = all.indexOf(o)
  return i === 0 ? 'todo' : i === all.length - 1 ? 'done' : 'progress'
}

/** Notion's select / multi-select / status picker. */
export function OptionPicker({ prop, db, selected, multi, onChange, canEditOptions }: {
  prop: Prop; db: Page; selected: string[]; multi: boolean; onChange: (ids: string[]) => void; canEditOptions: boolean
}) {
  const store = useStore()
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<{ el: HTMLElement; o: Option } | null>(null)
  const [editProp, setEditProp] = useState<HTMLElement | null>(null)
  const options = prop.options ?? []
  const shown = options.filter(o => o.name.toLowerCase().includes(q.toLowerCase()))
  const exact = options.find(o => o.name.toLowerCase() === q.trim().toLowerCase())
  const toggle = (id: string) => onChange(multi ? (selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]) : selected.includes(id) ? [] : [id])
  const create = async () => {
    const o: Option = { id: uid(), name: q.trim(), color: COLORS[Math.floor(Math.random() * COLORS.length)], ...(prop.type === 'status' ? { group: 'todo' as const } : {}) }
    await updateOptions(store, db, prop, [...options, o])
    onChange(multi ? [...selected, o.id] : [o.id])
    setQ('')
  }
  const groups = prop.type === 'status'
    ? ([['todo', 'To-do'], ['progress', 'In progress'], ['done', 'Complete']] as const).map(([g, name]) => ({ name, list: shown.filter(o => statusGroup(o, options) === g) }))
    : [{ name: multi || !canEditOptions ? 'Select an option or create one' : 'Select an option or create one', list: shown }]
  return (
    <div className="option-picker">
      <div className="picker-field">
        {selected.map(id => <Chip key={id} o={optionOf(prop, id)} onRemove={() => onChange(selected.filter(x => x !== id))} />)}
        <input autoFocus placeholder={selected.length ? '' : 'Search for an option…'} value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && q.trim()) { if (exact) toggle(exact.id); else if (canEditOptions) create() }
            if (e.key === 'Backspace' && !q && selected.length) onChange(selected.slice(0, -1))
          }} />
      </div>
      {groups.map(g => (
        <div key={g.name}>
          <div className="menu-heading">{g.name}</div>
          {g.list.map(o => (
            <div key={o.id} className={'option-row' + (selected.includes(o.id) ? ' on' : '')} onClick={() => toggle(o.id)}>
              {prop.type === 'status' ? <StatusChip o={o} /> : <Chip o={o} />}
              {canEditOptions && <button className="ghost option-more" onClick={e => { e.stopPropagation(); setMenu({ el: e.currentTarget, o }) }}><MoreHorizontal size={14} /></button>}
            </div>
          ))}
        </div>
      ))}
      {q.trim() && !exact && canEditOptions && (
        <div className="option-row create" onClick={create}>Create <Chip o={{ id: '', name: q.trim(), color: 'gray' }} /></div>
      )}
      {canEditOptions && <>
        {/* Notion ends the picker with "Edit property", which opens the property's settings beside it. */}
        <div className="menu-divider" />
        <button className="menu-item" onClick={e => setEditProp(e.currentTarget)}><span className="menu-icon"><SlidersHorizontal size={16} /></span><span className="menu-label">Edit property</span></button>
        <Popover anchor={editProp} side="right" onClose={() => setEditProp(null)} className="menu-pop" width={290}>
          {editProp && <PropertyEditor prop={prop} db={db} close={() => setEditProp(null)} />}
        </Popover>
      </>}
      <Popover anchor={menu?.el ?? null} side="right" onClose={() => setMenu(null)} className="menu-pop" width={220}>
        {menu && <OptionMenu o={menu.o}
          onChange={o => { updateOptions(store, db, prop, options.map(x => (x.id === o.id ? o : x))); setMenu({ ...menu, o }) }}
          onDelete={() => { updateOptions(store, db, prop, options.filter(x => x.id !== menu.o.id)); onChange(selected.filter(x => x !== menu.o.id)); setMenu(null) }} />}
      </Popover>
    </div>
  )
}

export const weekdays = (monday: boolean) => (monday ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
export function monthGrid(year: number, month: number, monday = true) {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - (monday ? (first.getDay() + 6) % 7 : first.getDay()))
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}

/** Notion's date picker: calendar, end date, include time, clear. */
export function DatePicker({ value: v, onChange }: { value: unknown; onChange: (v: DateValue | null) => void }) {
  const monday = (useStore().me?.prefs?.weekStart ?? 'monday') === 'monday'
  const d = dateValue(v)
  const [hasEnd, setHasEnd] = useState(!!d?.end)
  const [withTime, setWithTime] = useState((d?.start.length ?? 0) > 10)
  const [editing, setEditing] = useState<'start' | 'end'>('start')
  const base = d ? toDate(editing === 'end' && d.end ? d.end : d.start) : new Date()
  const [cursor, setCursor] = useState({ y: base.getFullYear(), m: base.getMonth() })
  const time = (s?: string) => (s && s.length > 10 ? s.slice(11, 16) : '09:00')
  const make = (day: string, t?: string) => (withTime ? `${day}T${t ?? '09:00'}` : day)
  const today = isoDay(new Date())

  const pick = (day: string) => {
    if (!hasEnd) return onChange({ start: make(day, time(d?.start)) })
    if (editing === 'start' || !d) { onChange({ start: make(day, time(d?.start)), end: d?.end && d.end.slice(0, 10) >= day ? d.end : make(day, time(d?.end)) }); setEditing('end') }
    else { const s = d.start.slice(0, 10) <= day ? d.start : make(day); onChange({ start: s, end: make(day, time(d.end)) }); setEditing('start') }
  }
  const inRange = (day: string) => !!d?.end && day >= d.start.slice(0, 10) && day <= d.end.slice(0, 10)

  return (
    <div className="date-picker">
      <div className="date-fields">
        <input readOnly className={editing === 'start' ? 'on' : ''} value={d ? formatDate(d.start) : ''} placeholder="Start date" onClick={() => setEditing('start')} />
        {withTime && <input type="time" value={time(d?.start)} onChange={e => d && onChange({ ...d, start: `${d.start.slice(0, 10)}T${e.target.value}` })} />}
        {hasEnd && <input readOnly className={editing === 'end' ? 'on' : ''} value={d?.end ? formatDate(d.end) : ''} placeholder="End date" onClick={() => setEditing('end')} />}
        {hasEnd && withTime && <input type="time" value={time(d?.end)} onChange={e => d?.end && onChange({ ...d, end: `${d.end.slice(0, 10)}T${e.target.value}` })} />}
      </div>
      <div className="cal-mini-head">
        <b>{new Date(cursor.y, cursor.m).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</b>
        <span>
          <button className="ghost" onClick={() => { const n = new Date(); setCursor({ y: n.getFullYear(), m: n.getMonth() }) }}>Today</button>
          <button className="ghost" onClick={() => setCursor(c => { const x = new Date(c.y, c.m - 1); return { y: x.getFullYear(), m: x.getMonth() } })}><ChevronLeft size={14} /></button>
          <button className="ghost" onClick={() => setCursor(c => { const x = new Date(c.y, c.m + 1); return { y: x.getFullYear(), m: x.getMonth() } })}><ChevronRight size={14} /></button>
        </span>
      </div>
      <div className="cal-mini">
        {weekdays(monday).map(w => <span key={w} className="dow">{w}</span>)}
        {monthGrid(cursor.y, cursor.m, monday).map(day => {
          const k = isoDay(day)
          const sel = d && (k === d.start.slice(0, 10) || k === d.end?.slice(0, 10))
          return <button key={k} className={'day' + (day.getMonth() !== cursor.m ? ' other' : '') + (k === today ? ' today' : '') + (sel ? ' sel' : '') + (inRange(k) ? ' range' : '')} onClick={() => pick(k)}>{day.getDate()}</button>
        })}
      </div>
      <div className="menu-divider" />
      <label className="toggle-row">End date <input type="checkbox" checked={hasEnd} onChange={e => { setHasEnd(e.target.checked); if (!e.target.checked && d) onChange({ start: d.start }); else if (d) onChange({ start: d.start, end: d.start }) }} /></label>
      <label className="toggle-row">Include time <input type="checkbox" checked={withTime} onChange={e => {
        setWithTime(e.target.checked)
        if (d) onChange(e.target.checked ? { start: `${d.start.slice(0, 10)}T09:00`, ...(d.end ? { end: `${d.end.slice(0, 10)}T10:00` } : {}) } : { start: d.start.slice(0, 10), ...(d.end ? { end: d.end.slice(0, 10) } : {}) })
      }} /></label>
      <button className="menu-item" onClick={() => onChange(null)}><span className="menu-label">Clear</span></button>
    </div>
  )
}

function PersonPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const store = useStore()
  const [q, setQ] = useState('')
  const people = [...store.people.values()].filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="option-picker">
      <div className="picker-field">
        {selected.map(id => <span key={id} className="person-pill">{store.people.get(id)?.name ?? '?'}<button className="chip-x" onClick={() => onChange(selected.filter(x => x !== id))}><X size={10} /></button></span>)}
        <input autoFocus placeholder={selected.length ? '' : 'Search for people…'} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="menu-heading">Select as many as you like</div>
      {people.map(p => (
        <div key={p.id} className={'option-row' + (selected.includes(p.id) ? ' on' : '')} onClick={() => onChange(selected.includes(p.id) ? selected.filter(x => x !== p.id) : [...selected, p.id])}>
          <span className="person-pill"><span className="avatar small">{p.name[0]}</span>{p.name}</span>
          {selected.includes(p.id) && <span className="menu-check">✓</span>}
        </div>
      ))}
    </div>
  )
}

function RelationPicker({ prop, selected, onChange }: { prop: Prop; selected: string[]; onChange: (ids: string[]) => void }) {
  const store = useStore()
  const [q, setQ] = useState('')
  const target = prop.relation ? store.byId.get(prop.relation.db) : undefined
  if (!target) return <div className="menu-note">The related database was deleted or you don’t have access.</div>
  const rows = store.children(target.id).filter(r => label(r).toLowerCase().includes(q.toLowerCase()))
  const linked = rows.filter(r => selected.includes(r.id))
  const rest = rows.filter(r => !selected.includes(r.id))
  return (
    <div className="option-picker relation-picker">
      <div className="picker-field"><Search size={14} className="muted" /><input autoFocus placeholder={`Link or create a page…`} value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="menu-heading">In {iconOf(target, 12)} {label(target)}</div>
      {linked.map(r => (
        <div key={r.id} className="option-row on" onClick={() => onChange(selected.filter(x => x !== r.id))}>
          <span className="relation-pill">{iconOf(r, 14)}<span>{label(r)}</span></span><span className="option-more"><X size={14} /></span>
        </div>
      ))}
      {rest.slice(0, 50).map(r => (
        <div key={r.id} className="option-row" onClick={() => onChange([...selected, r.id])}>
          <span className="relation-pill">{iconOf(r, 14)}<span>{label(r)}</span></span><span className="option-more"><Plus size={14} /></span>
        </div>
      ))}
      {q.trim() && (
        <div className="option-row create" onClick={async () => {
          const p = await store.create({ parent_id: target.id, title: q.trim() }, false)
          onChange([...selected, p.id]); setQ('')
        }}><Plus size={14} /> New page “{q.trim()}”</div>
      )}
    </div>
  )
}

function FilesEditor({ files, onChange }: { files: { name: string; url: string }[]; onChange: (f: { name: string; url: string }[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState('')
  const store = useStore()
  return (
    <div className="files-editor">
      {files.map(f => (
        <div key={f.url} className="option-row"><a className="file-pill" href={f.url} target="_blank" rel="noreferrer"><Paperclip size={12} />{f.name}</a>
          <button className="ghost option-more" onClick={() => onChange(files.filter(x => x.url !== f.url))}><Trash2 size={14} /></button></div>
      ))}
      <button className="primary wide" onClick={() => input.current?.click()}>Upload a file</button>
      <input ref={input} type="file" hidden multiple onChange={async e => {
        const added: { name: string; url: string }[] = []
        try { for (const f of Array.from(e.target.files ?? [])) added.push({ name: f.name, url: await api.upload(f) }) } catch (err) { store.setError((err as Error).message) }
        onChange([...files, ...added])
      }} />
      <div className="row"><input placeholder="Paste a link…" value={link} onChange={e => setLink(e.target.value)} />
        <button disabled={!/^https?:\/\//.test(link)} onClick={() => { onChange([...files, { name: link.split('/').pop() || link, url: link }]); setLink('') }}>Embed link</button></div>
    </div>
  )
}

function TextEditor({ initial, type, onDone }: { initial: string; type: PropType | 'title'; onDone: (v: string) => void }) {
  const [v, setV] = useState(initial)
  const ref = useRef(v)
  ref.current = v
  return (
    <textarea className="cell-textarea" autoFocus rows={1} value={v} inputMode={type === 'number' ? 'decimal' : undefined}
      onChange={e => { setV(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
      onFocus={e => { e.target.select(); e.target.style.height = e.target.scrollHeight + 'px' }}
      onBlur={() => onDone(ref.current)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } if (e.key === 'Escape') { setV(initial); ref.current = initial; (e.target as HTMLTextAreaElement).blur() } }} />
  )
}

/** A clickable cell: shows the value, opens the right editor in a popover. */
export function Cell({ prop, row, db, readOnly, wrap, className = '', placeholder, autoEdit }: {
  prop: Prop; row: Page; db: Page; readOnly?: boolean; wrap?: boolean; className?: string; placeholder?: string
  /** Start editing as soon as it appears (a row just added with "+ New page"). */
  autoEdit?: boolean
}) {
  const store = useStore()
  const [anchor, open, close] = usePopover()
  const computed = COMPUTED.includes(prop.type)
  const v = value(row, prop, db.schema, ctxOf(store))
  const editable = !readOnly && !computed
  const set = (x: unknown) => setValue(store, row, prop, x)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (autoEdit && editable && ref.current) open(ref.current) }, [autoEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable) return
    if (prop.type === 'checkbox') { set(v !== true); return }
    open(e.currentTarget)
  }
  let editor: ReactNode = null
  if (anchor) switch (prop.type) {
    case 'select': case 'status': editor = <OptionPicker prop={prop} db={db} multi={false} selected={v ? [String(v)] : []} canEditOptions={store.byId.get(db.id)?.access === 'full' || store.byId.get(db.id)?.access === 'edit'} onChange={ids => { set(ids[0] ?? null); close() }} />; break
    case 'multi_select': editor = <OptionPicker prop={prop} db={db} multi selected={(v as string[]) ?? []} canEditOptions={['full', 'edit'].includes(db.access)} onChange={set} />; break
    case 'date': editor = <DatePicker value={v} onChange={set} />; break
    case 'person': editor = <PersonPicker selected={[v ?? []].flat().map(String)} onChange={set} />; break
    case 'relation': editor = <RelationPicker prop={prop} selected={(v as string[]) ?? []} onChange={ids => { const before = (v as string[]) ?? []; set(ids).then(() => syncRelation(store, row, prop, before, ids)) }} />; break
    case 'files': editor = <FilesEditor files={(v as { name: string; url: string }[]) ?? []} onChange={set} />; break
    default: editor = <TextEditor initial={v === undefined || v === null ? '' : String(v)} type={prop.type} onDone={x => {
      close()
      const next = prop.type === 'number' ? (x.trim() === '' ? null : Number(x.replace(',', '.'))) : x
      if (prop.type === 'number' && next !== null && Number.isNaN(next)) return
      if ((next ?? '') !== (v ?? '')) set(next)
    }} />
  }
  const wide = ['select', 'status', 'multi_select', 'person', 'relation'].includes(prop.type)
  return (
    <>
      <div ref={ref} className={'cell ' + className + (editable ? ' editable' : '') + (anchor ? ' editing' : '')} onClick={onClick}>
        <CellView prop={prop} row={row} schema={db.schema} wrap={wrap} />
        {placeholder && (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) && <span className="cell-placeholder">{placeholder}</span>}
      </div>
      <Popover anchor={anchor} onClose={close} className={'menu-pop cell-pop' + (['text', 'title', 'number', 'url', 'email', 'phone'].includes(prop.type) ? ' text-pop' : '')}
        width={['text', 'title', 'number', 'url', 'email', 'phone'].includes(prop.type) ? Math.max(anchor?.getBoundingClientRect().width ?? 240, 240) : prop.type === 'date' ? 248 : ['select', 'status'].includes(prop.type) ? 240 : wide ? 300 : 280}>
        {editor}
      </Popover>
    </>
  )
}

/* ---------- property editor (header menu > Edit property) ---------- */

const PROP_TYPES: PropType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'files', 'checkbox', 'url', 'email', 'phone', 'formula', 'relation', 'rollup', 'created', 'created_by', 'updated', 'updated_by', 'unique_id']

export function newProp(type: PropType, name?: string): Prop {
  const p: Prop = { id: uid(), name: name ?? TYPE_NAMES[type], type }
  if (type === 'status') p.options = [{ id: uid(), name: 'Not started', color: 'gray', group: 'todo' }, { id: uid(), name: 'In progress', color: 'blue', group: 'progress' }, { id: uid(), name: 'Done', color: 'green', group: 'done' }]
  else if (type === 'select' || type === 'multi_select') p.options = []
  if (type === 'number') p.format = 'plain'
  if (type === 'formula') p.formula = ''
  return p
}

export function TypePicker({ onPick, current }: { onPick: (t: PropType) => void; current?: PropType }) {
  const [q, setQ] = useState('')
  return (
    <div className="menu-list">
      <input className="menu-filter" autoFocus placeholder="Search for a property type…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="menu-heading">Type</div>
      {PROP_TYPES.filter(t => TYPE_NAMES[t].toLowerCase().includes(q.toLowerCase())).map(t => (
        <button key={t} className="menu-item" onClick={() => onPick(t)}><span className="menu-icon">{TYPE_ICONS[t]}</span><span className="menu-label">{TYPE_NAMES[t]}</span>{current === t && <span className="menu-check">✓</span>}</button>
      ))}
    </div>
  )
}

function FormulaEditor({ prop, db, onSave }: { prop: Prop; db: Page; onSave: (f: string) => void }) {
  const store = useStore()
  const [src, setSrc] = useState(prop.formula ?? '')
  const sample = store.children(db.id)[0]
  const preview = useMemo(() => {
    if (!sample) return null
    const v = value(sample, { ...prop, formula: src }, db.schema, ctxOf(store))
    return v instanceof FormulaError ? <span className="danger">{v.message}</span> : <span>{toText(v as Value) || '(empty)'}</span>
  }, [src, sample, prop, db.schema, store])
  const names = [propOf(db.schema, 'title')!, ...(db.schema.props ?? [])].filter(p => p.id !== prop.id)
  const insert = (t: string) => setSrc(s => s + t)
  return (
    <div className="formula-editor">
      <textarea autoFocus spellCheck={false} value={src} onChange={e => setSrc(e.target.value)} placeholder='Type a formula, e.g. prop("Price") * prop("Qty")' />
      {sample && <div className="formula-preview muted small">Preview for “{label(sample)}”: {preview}</div>}
      <div className="formula-help">
        <div>
          <div className="menu-heading">Properties</div>
          {names.map(p => <button key={p.id} className="menu-item" onClick={() => insert(`prop("${p.name}")`)}><span className="menu-icon">{typeIcon(p)}</span><span className="menu-label">{p.name}</span></button>)}
        </div>
        <div>
          <div className="menu-heading">Functions</div>
          {FUNCTION_NAMES.map(f => <button key={f} className="menu-item" onClick={() => insert(`${f}(`)}><span className="menu-label mono">{f}</span></button>)}
        </div>
      </div>
      <button className="primary" onClick={() => onSave(src)}>Done</button>
    </div>
  )
}

/** Edit a property's name, type and settings. */
/** Hide, duplicate and delete for a property (none for the Name column). */
export function propertyActions(store: ReturnType<typeof useStore>, db: Page, prop: Prop, close: () => void, onHide?: () => void) {
  const props = db.schema.props ?? []
  if (prop.id === 'title') return { hide: null, duplicate: null, remove: null }
  return {
    hide: onHide ? { icon: <ListChecks size={15} />, label: 'Hide', danger: false, onClick: () => { onHide(); close() } } : null,
    duplicate: { icon: <Copy size={15} />, label: 'Duplicate property', danger: false, onClick: () => { store.patch(db.id, { schema: { ...db.schema, props: [...props.slice(0, props.indexOf(prop) + 1), { ...prop, id: uid(), name: prop.name + ' (1)' }, ...props.slice(props.indexOf(prop) + 1)] } }); close() } },
    remove: { icon: <Trash2 size={15} />, label: 'Delete property', danger: true, onClick: () => { if (confirm(`Delete the “${prop.name}” property?`)) { store.patch(db.id, { schema: { ...db.schema, props: props.filter(p => p.id !== prop.id) } }); close() } } },
  }
}

export function PropertyEditor({ prop, db, close, onHide, inHeader }: { prop: Prop; db: Page; close: () => void; onHide?: () => void; inHeader?: boolean }) {
  const store = useStore()
  const [name, setName] = useState(prop.name)
  const [pop, setPop] = useState<{ kind: 'type' | 'formula' | 'number' | 'relation' | 'rollup-rel' | 'rollup-prop' | 'rollup-fn'; el: HTMLElement } | null>(null)
  const props = db.schema.props ?? []
  const isTitle = prop.id === 'title'
  const save = (p: Partial<Prop>) => {
    if (isTitle) return store.patch(db.id, { schema: { ...db.schema, titleName: p.name ?? prop.name } })
    return store.patch(db.id, { schema: { ...db.schema, props: props.map(x => (x.id === prop.id ? { ...x, ...p } : x)) } })
  }
  const dbs = store.pages.filter(p => p.kind === 'db' && !p.trashed)
  const relProps = props.filter(p => p.type === 'relation')
  const relTarget = prop.rollup && store.byId.get(props.find(p => p.id === prop.rollup!.relation)?.relation?.db ?? '')
  const open = (kind: NonNullable<typeof pop>['kind']) => (e: React.MouseEvent<HTMLElement>) => setPop({ kind, el: e.currentTarget })

  const makeTwoWay = async (on: boolean) => {
    const target = prop.relation && store.byId.get(prop.relation.db)
    if (!target || !prop.relation) return
    if (on) {
      const back: Prop = { id: uid(), name: `Related to ${label(db)}`, type: 'relation', relation: { db: db.id, synced: prop.id } }
      await api.update(target.id, { schema: { ...target.schema, props: [...(target.schema.props ?? []), back] } })
      await save({ relation: { ...prop.relation, synced: back.id } })
    } else {
      await api.update(target.id, { schema: { ...target.schema, props: (target.schema.props ?? []).filter(p => p.id !== prop.relation!.synced) } })
      await save({ relation: { db: prop.relation.db } })
    }
    await store.reload()
  }

  return (
    <div className="menu-list prop-editor">
      <div className="prop-name-row">
        <span className="type-badge">{typeIcon(prop)}</span>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== prop.name && save({ name: name.trim() })}
          onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); close() } }} />
      </div>
      {!isTitle && <button className="menu-item" onClick={open('type')}><span className="menu-label">Type</span><span className="menu-hint">{TYPE_NAMES[prop.type]} ›</span></button>}
      {prop.type === 'number' && <button className="menu-item" onClick={open('number')}><span className="menu-label">Number format</span><span className="menu-hint">{NUMBER_FORMATS[prop.format ?? 'plain']} ›</span></button>}
      {prop.type === 'formula' && <button className="menu-item" onClick={open('formula')}><span className="menu-label">Formula</span><span className="menu-hint mono">{(prop.formula || 'Edit').slice(0, 18)} ›</span></button>}
      {prop.type === 'unique_id' && (
        <label className="menu-item"><span className="menu-label">Prefix</span><input className="small-input" defaultValue={prop.prefix ?? ''} onBlur={e => save({ prefix: e.target.value.trim() || undefined })} /></label>
      )}
      {prop.type === 'relation' && <>
        <button className="menu-item" onClick={open('relation')}><span className="menu-label">Related to</span><span className="menu-hint">{prop.relation ? label(store.byId.get(prop.relation.db)) : 'Select'} ›</span></button>
        {prop.relation && prop.relation.db !== db.id && (
          <label className="menu-item"><span className="menu-label">Show on {label(store.byId.get(prop.relation.db))}</span>
            <input type="checkbox" checked={!!prop.relation.synced} onChange={e => makeTwoWay(e.target.checked).catch(err => store.setError(err.message))} /></label>
        )}
      </>}
      {prop.type === 'rollup' && <>
        <button className="menu-item" onClick={open('rollup-rel')}><span className="menu-label">Relation</span><span className="menu-hint">{relProps.find(p => p.id === prop.rollup?.relation)?.name ?? 'Select'} ›</span></button>
        <button className="menu-item" disabled={!relTarget} onClick={open('rollup-prop')}><span className="menu-label">Property</span><span className="menu-hint">{relTarget && prop.rollup ? propOf(relTarget.schema, prop.rollup.target)?.name ?? 'Select' : 'Select'} ›</span></button>
        <button className="menu-item" onClick={open('rollup-fn')}><span className="menu-label">Calculate</span><span className="menu-hint">{ROLLUP_FNS[prop.rollup?.fn ?? 'show']} ›</span></button>
      </>}
      {prop.options && (
        <>
          <div className="menu-heading">Options</div>
          {prop.options.map(o => (
            <div key={o.id} className="option-row static"><span className={'swatch opt-' + o.color} />{prop.type === 'status' ? <StatusChip o={o} /> : <Chip o={o} />}
              {prop.type === 'status' && <select className="mini-select" value={statusGroup(o, prop.options!)} onChange={e => save({ options: prop.options!.map(x => (x.id === o.id ? { ...x, group: e.target.value as Option['group'] } : x)) })}>
                <option value="todo">To-do</option><option value="progress">In progress</option><option value="done">Complete</option></select>}
            </div>
          ))}
          <button className="menu-item" onClick={() => { const n = prompt('Option name'); if (n?.trim()) save({ options: [...prop.options!, { id: uid(), name: n.trim(), color: COLORS[prop.options!.length % COLORS.length], ...(prop.type === 'status' ? { group: 'todo' as const } : {}) }] }) }}>
            <span className="menu-icon"><Plus size={14} /></span><span className="menu-label">Add an option</span></button>
        </>
      )}
      {/* In the column menu these sit lower down, as in Notion; elsewhere they close the editor. */}
      {!inHeader && <>
        <div className="menu-divider" />
        {Object.values(propertyActions(store, db, prop, close, onHide)).filter(Boolean).map(a => (
          <button key={a!.label} className={'menu-item' + (a!.danger ? ' danger' : '')} onClick={a!.onClick}><span className="menu-icon">{a!.icon}</span><span className="menu-label">{a!.label}</span></button>
        ))}
      </>}

      <Popover anchor={pop?.kind === 'type' ? pop.el : null} side="right" onClose={() => setPop(null)} className="menu-pop" width={260}>
        <TypePicker current={prop.type} onPick={t => { const n = newProp(t, prop.name); save({ type: t, options: prop.options ?? n.options, format: n.format, formula: prop.formula ?? n.formula }); setPop(null) }} />
      </Popover>
      <Popover anchor={pop?.kind === 'number' ? pop.el : null} side="right" onClose={() => setPop(null)} className="menu-pop" width={220}>
        <Menu onClose={() => setPop(null)} items={Object.entries(NUMBER_FORMATS).map(([k, n]) => ({ label: n, checked: (prop.format ?? 'plain') === k, onClick: () => save({ format: k }) }))} />
      </Popover>
      <Popover anchor={pop?.kind === 'formula' ? pop.el : null} side="right" onClose={() => setPop(null)} className="menu-pop" width={560}>
        <FormulaEditor prop={prop} db={db} onSave={f => { save({ formula: f }); setPop(null) }} />
      </Popover>
      <Popover anchor={pop?.kind === 'relation' ? pop.el : null} side="right" onClose={() => setPop(null)} className="menu-pop" width={280}>
        <Menu filter onClose={() => setPop(null)} items={dbs.map(d => ({ icon: iconOf(d, 16), label: label(d), checked: prop.relation?.db === d.id, onClick: () => save({ relation: { db: d.id } }) }))} />
      </Popover>
      <Popover anchor={pop?.kind === 'rollup-rel' ? pop.el : null} side="right" onClose={() => setPop(null)} className="menu-pop" width={240}>
        <Menu onClose={() => setPop(null)} items={relProps.length ? relProps.map(r => ({ icon: TYPE_ICONS.relation, label: r.name, checked: prop.rollup?.relation === r.id, onClick: () => save({ rollup: { relation: r.id, target: 'title', fn: prop.rollup?.fn ?? 'show' } }) })) : [{ note: 'Add a Relation property first.' }]} />
      </Popover>
      <Popover anchor={pop?.kind === 'rollup-prop' ? pop.el : null} side="right" onClose={() => setPop(null)} className="menu-pop" width={240}>
        {relTarget && <Menu onClose={() => setPop(null)} items={[propOf(relTarget.schema, 'title')!, ...(relTarget.schema.props ?? [])].map(p => ({ icon: typeIcon(p), label: p.name, checked: prop.rollup?.target === p.id, onClick: () => save({ rollup: { ...prop.rollup!, target: p.id } }) }))} />}
      </Popover>
      <Popover anchor={pop?.kind === 'rollup-fn' ? pop.el : null} side="right" onClose={() => setPop(null)} className="menu-pop" width={240}>
        <Menu onClose={() => setPop(null)} items={Object.entries(ROLLUP_FNS).map(([k, n]) => ({ label: n, checked: (prop.rollup?.fn ?? 'show') === k, onClick: () => save({ rollup: { relation: prop.rollup?.relation ?? '', target: prop.rollup?.target ?? 'title', fn: k } }) }))} />
      </Popover>
    </div>
  )
}

/** The property list at the top of a database row's page. */
export function RowProperties({ db, row, readOnly }: { db: Page; row: Page; readOnly: boolean }) {
  const store = useStore()
  const [edit, setEdit] = useState<{ el: HTMLElement; prop: Prop } | null>(null)
  const [add, openAdd, closeAdd] = usePopover()
  const [showEmpty, setShowEmpty] = useState(true)
  // Properties hidden with Customize layout don't show on row pages.
  const layout = db.schema.layout ?? {}
  const props = (db.schema.props ?? []).filter(p => !layout.hidden?.includes(p.id))
  const structure = ['full', 'edit'].includes(db.access) && !store.published
  const empty = (p: Prop) => { const v = value(row, p, db.schema, ctxOf(store)); return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) }
  const shown = props.filter(p => showEmpty || !empty(p))
  return (
    <div className="row-props">
      {shown.map(p => (
        <div className="prop-row" key={p.id}>
          <button className="prop-name" disabled={!structure} onClick={e => setEdit({ el: e.currentTarget, prop: p })}>{layout.icons !== false && <span className="prop-icon">{typeIcon(p)}</span>}{p.name}</button>
          <Cell prop={p} row={row} db={db} readOnly={readOnly} className="prop-value" placeholder="Empty" />
        </div>
      ))}
      {props.some(empty) && <button className="ghost prop-toggle" onClick={() => setShowEmpty(!showEmpty)}>{showEmpty ? 'Hide empty properties' : `${props.filter(empty).length} more properties`}</button>}
      {structure && <button className="ghost prop-add" onClick={e => openAdd(e.currentTarget)}><Plus size={14} /> Add a property</button>}
      <Popover anchor={edit?.el ?? null} onClose={() => setEdit(null)} className="menu-pop" width={290}>
        {edit && <PropertyEditor prop={props.find(p => p.id === edit.prop.id) ?? edit.prop} db={store.byId.get(db.id) ?? db} close={() => setEdit(null)} />}
      </Popover>
      <Popover anchor={add} onClose={closeAdd} className="menu-pop" width={260}>
        <TypePicker onPick={t => { store.patch(db.id, { schema: { ...db.schema, props: [...(db.schema.props ?? []), newProp(t)] } }); closeAdd() }} />
      </Popover>
      <div className="menu-divider" />
    </div>
  )
}

