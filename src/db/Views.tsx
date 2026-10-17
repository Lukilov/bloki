import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Copy, EyeOff, Filter as FilterIcon, GripVertical, Maximize2, MoreHorizontal, Plus, Trash2, X,
  ArrowLeftToLine, ArrowRightToLine, WrapText, ArrowDownUp, Calculator, Snowflake, FileText,
  Group as GroupIcon, ListTree,
} from 'lucide-react'
import { api, type Page, type Prop, type View } from '../api'
import { iconOf, label, useStore } from '../store'
import { Menu, Popover, usePopover } from '../ui'
import { coverStyle } from '../Database'
import { FormView } from './Form'
import { ChartView } from './Chart'
import { DashboardView, FeedView, WIDGETS } from './Feed'
import { Cell, CellView, Chip, ctxOf, newProp, PropertyEditor, propertyActions, StatusChip, typeIcon, TypePicker, monthGrid } from './Cells'
import { aggregate, calcsFor, nestRows, weekLanes, rowColors, dateValue, groupable, groupRows, isoDay, propOf, ROLLUP_FNS, toDate, value, visibleRange, type Group } from './model'

type Store = ReturnType<typeof useStore>
export type ViewProps = {
  db: Page; rows: Page[]; props: Prop[]; view: View
  setView: (v: Partial<View>) => void
  addRow: (defaults?: Record<string, unknown>, open?: boolean) => Promise<Page | undefined>
  openRow: (row: Page) => void
  perm: { rows: boolean; structure: boolean }
  addFilter: (prop: string) => void
}

const midpoint = (a?: number, b?: number) => (a === undefined ? (b ?? 1) - 1 : b === undefined ? a + 1 : (a + b) / 2)

/** Move a row to sit before `before` (or at the end), by position. */
function reorder(store: Store, rows: Page[], id: string, beforeId: string | null) {
  const list = rows.filter(r => r.id !== id)
  const i = beforeId ? list.findIndex(r => r.id === beforeId) : list.length
  const pos = midpoint(list[i - 1]?.position, list[i]?.position)
  return store.patch(id, { position: pos })
}

/* ---------- Table ---------- */

/** Background for a Conditional color result (the same tints as block backgrounds). */
const tint = (c?: string): React.CSSProperties | undefined => (c ? { background: `var(--c-${c})` } : undefined)

function HeaderMenu({ prop, p, close }: { prop: Prop; p: ViewProps; close: () => void }) {
  const store = useStore()
  const { db, view, setView } = p
  const all = db.schema.props ?? []
  const idx = all.findIndex(x => x.id === prop.id)
  const actions = propertyActions(store, db, prop, close, p.perm.structure ? () => setView({ hidden: [...(view.hidden ?? []), prop.id] }) : undefined)
  const insert = (at: number) => { const n = newProp('text'); store.patch(db.id, { schema: { ...db.schema, props: [...all.slice(0, at), n, ...all.slice(at)] } }); close() }
  return (
    <div className="header-menu">
      {p.perm.structure && <PropertyEditor prop={prop} db={db} close={close} inHeader />}
      <Menu onClose={close} items={[
        ...(p.perm.structure ? [{ divider: true } as const] : []),
        // Notion's order: page icon switch (Name only), Filter, Sort ›, Group, Calculate ›, Freeze, wrapping, then inserting columns.
        ...(prop.id === 'title' ? [{ icon: <FileText size={15} />, label: <span className="menu-switch">Show page icon<span className={'switch' + (view.hideIcon ? '' : ' on')} /></span>, onClick: () => setView({ hideIcon: !view.hideIcon }) }] : []),
        { icon: <FilterIcon size={15} />, label: 'Filter', onClick: () => p.addFilter(prop.id) },
        { icon: <ArrowDownUp size={15} />, label: 'Sort', submenu: () => <Menu onClose={close} items={[
          { icon: <ArrowUp size={15} />, label: 'Sort ascending', onClick: () => setView({ sort: [{ prop: prop.id, dir: 'asc' }] }) },
          { icon: <ArrowDown size={15} />, label: 'Sort descending', onClick: () => setView({ sort: [{ prop: prop.id, dir: 'desc' }] }) },
        ]} /> },
        ...(groupable(prop) ? [{ icon: <GroupIcon size={15} />, label: 'Group', checked: view.groupBy === prop.id, onClick: () => setView({ groupBy: view.groupBy === prop.id ? undefined : prop.id }) }] : []),
        ...(view.type === 'table' ? [
          { icon: <Calculator size={15} />, label: 'Calculate', submenu: () => <CalcMenu prop={prop} p={p} close={close} /> },
          { icon: <Snowflake size={15} />, label: view.freeze === prop.id ? 'Unfreeze columns' : 'Freeze', onClick: () => setView({ freeze: view.freeze === prop.id ? undefined : prop.id }) },
        ] : []),
        ...(actions.hide ? [actions.hide] : []),
        { icon: <WrapText size={15} />, label: view.wrap ? 'Unwrap content' : 'Wrap content', onClick: () => setView({ wrap: !view.wrap }) },
        ...(p.perm.structure ? [
          // The Name column always comes first in Bloki, so it only gets "Insert right".
          ...(prop.id !== 'title' ? [{ icon: <ArrowLeftToLine size={15} />, label: 'Insert left', onClick: () => insert(idx) }] : []),
          { icon: <ArrowRightToLine size={15} />, label: 'Insert right', onClick: () => insert(idx + 1) },
          ...(actions.duplicate ? [{ divider: true } as const, actions.duplicate, actions.remove!] : []),
        ] : []),
      ]} />
    </div>
  )
}

/** Notion's Calculate menu: None, then Count › and Percent › groups, then type-specific "More options". */
function CalcMenu({ prop, p, close }: { prop: Prop; p: ViewProps; close: () => void }) {
  const fn = p.view.calcs?.[prop.id]
  const item = (k: string) => ({ label: ROLLUP_FNS[k], checked: fn === k, onClick: () => p.setView({ calcs: { ...p.view.calcs, [prop.id]: k } }) })
  const all = calcsFor(prop)
  const count = all.filter(k => ['count', 'count_values', 'unique', 'empty', 'not_empty'].includes(k))
  const percent = all.filter(k => k.startsWith('percent'))
  const more = all.filter(k => !count.includes(k) && !percent.includes(k))
  const sub = (keys: string[]) => () => <Menu onClose={close} items={keys.map(item)} />
  return <Menu onClose={close} items={[
    { label: 'None', checked: !fn, onClick: () => { const c = { ...p.view.calcs }; delete c[prop.id]; p.setView({ calcs: c }) } },
    ...(count.length ? [{ label: 'Count', checked: count.includes(fn ?? ''), submenu: sub(count) }] : []),
    ...(percent.length ? [{ label: 'Percent', checked: percent.includes(fn ?? ''), submenu: sub(percent) }] : []),
    ...(more.length ? [{ label: 'More options', checked: more.includes(fn ?? ''), submenu: sub(more) }] : []),
  ]} />
}

function CalcCell({ prop, p, rows }: { prop: Prop; p: ViewProps; rows: Page[] }) {
  const store = useStore()
  const [anchor, open, close] = usePopover()
  const fn = p.view.calcs?.[prop.id]
  const result = fn ? aggregate(fn, rows.map(r => value(r, prop, p.db.schema, ctxOf(store))), prop, ctxOf(store)) : null
  return (
    <>
      <div className={'calc-cell' + (fn ? ' on' : '')} onClick={e => p.perm.structure && open(e.currentTarget)}>
        {fn ? <><span className="muted">{ROLLUP_FNS[fn].replace('Count all', 'Count').replace('Show original', '')}</span> {String(result ?? '')}</> : <span className="calc-hint">Calculate <ChevronDown size={12} /></span>}
      </div>
      <Popover anchor={anchor} onClose={close} className="menu-pop" width={220}>
        <CalcMenu prop={prop} p={p} close={close} />
      </Popover>
    </>
  )
}

// Rows whose sub-items are showing, per window (kept across re-renders so a new sub-item can open its parent).
const openRows = new Set<string>()

/** Adds a sub-item under `row` and keeps both sides of the Parent item / Sub-items relation in step. */
async function addSubItem(store: ReturnType<typeof useStore>, p: ViewProps, row: Page) {
  const s = p.db.schema.subItems
  if (!s) return
  const child = await p.addRow({ [s.parent]: [row.id] }, false)
  if (!child) return
  const cur = Array.isArray(row.props?.[s.children]) ? row.props[s.children] as string[] : []
  await api.update(row.id, { props: { ...row.props, [s.children]: [...cur, child.id] } })
  openRows.add(row.id)
  await store.reload()
}

function RowMenu({ row, p, close }: { row: Page; p: ViewProps; close: () => void }) {
  const store = useStore()
  return (
    <Menu onClose={close} items={[
      { icon: <Maximize2 size={15} />, label: 'Open in side peek', onClick: () => p.openRow(row) },
      { icon: <ArrowRightToLine size={15} />, label: 'Open as page', onClick: () => store.go(row.id) },
      { divider: true },
      ...(p.perm.rows ? [
        ...(p.db.schema.subItems ? [{ icon: <ListTree size={15} />, label: 'Add sub-item', onClick: () => addSubItem(store, p, row) }] : []),
        { icon: <Copy size={15} />, label: 'Duplicate', onClick: async () => { await api.duplicate(row.id); await store.reload() } },
        { icon: <Trash2 size={15} />, label: 'Delete', danger: true, onClick: () => store.patch(row.id, { trashed: true }) },
      ] : []),
    ]} />
  )
}

/**
 * Long tables only mount the rows near the screen, with empty space standing in for the rest.
 * ponytail: assumes rows share the first row's height; wrapped rows of very different heights make the
 * scrollbar drift a little, measure each row if that ever matters.
 */
function useRowWindow(count: number): [number, number, number, React.RefObject<HTMLDivElement | null>] {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<[number, number, number]>(() => [0, Math.min(count, 60), 36])
  useEffect(() => {
    const update = () => {
      const el = ref.current
      if (!el) return
      const rowH = (el.querySelector('.tr') as HTMLElement | null)?.offsetHeight || 36
      const [a, b] = visibleRange(el.getBoundingClientRect().top, innerHeight, count, rowH)
      setState(s => (s[0] === a && s[1] === b && s[2] === rowH ? s : [a, b, rowH]))
    }
    update()
    // Scrolling any ancestor (the page, a peek) moves the table, so listen in the capture phase.
    document.addEventListener('scroll', update, { capture: true, passive: true })
    addEventListener('resize', update)
    return () => { document.removeEventListener('scroll', update, { capture: true }); removeEventListener('resize', update) }
  }, [count])
  return [state[0], Math.min(state[1], count), state[2], ref]
}

/** Frozen columns (up to view.freeze) stick to the left edge while the table scrolls sideways. */
function frozen(cols: Prop[], view: View, width: (id: string) => number): (id: string) => React.CSSProperties | undefined {
  const upTo = view.freeze ? cols.findIndex(c => c.id === view.freeze) : -1
  const left: Record<string, number> = {}
  cols.slice(0, upTo + 1).reduce((x, c) => { left[c.id] = x; return x + width(c.id) }, 0)
  return id => (id in left ? { position: 'sticky', left: left[id], zIndex: 2, background: 'var(--bg)' } : undefined)
}

function TableBody({ p, rows: all, cols, selected, setSelected, fresh }: { p: ViewProps; rows: Page[]; cols: Prop[]; selected: Set<string>; setSelected: (s: Set<string>) => void; fresh?: string | null }) {
  const store = useStore()
  // With sub-items on, rows sit under their parent item, opened and closed with the arrow beside the name.
  const [, redraw] = useState(0)
  const sub = p.db.schema.subItems
  const tree = sub ? nestRows(all, sub.parent, openRows) : null
  const rows = tree ? tree.map(n => n.row) : all
  const node = new Map(tree?.map(n => [n.row.id, n]))
  const toggleRow = (id: string) => { if (openRows.has(id)) openRows.delete(id); else openRows.add(id); redraw(x => x + 1) }
  const [menu, setMenu] = useState<{ el: HTMLElement; row: Page } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const sorted = !!p.view.sort?.length
  const [from, to, rowH, ref] = useRowWindow(rows.length)
  const stick = frozen(cols, p.view, id => p.view.widths?.[id] ?? (id === 'title' ? 280 : 180))
  const colorsOf = (r: Page) => rowColors(r, p.view.colors, p.db.schema, ctxOf(store), store.me?.user.id)
  return (
    <div ref={ref}>
      {from > 0 && <div style={{ height: from * rowH }} />}
      {rows.slice(from, to).map(r => (
        <div key={r.id} className={'tr' + (selected.has(r.id) ? ' selected' : '') + (over === r.id ? ' drop-above' : '')} style={tint(colorsOf(r).row)}
          onDragOver={e => { if (!sorted && e.dataTransfer.types.includes('text/row')) { e.preventDefault(); setOver(r.id) } }}
          onDragLeave={() => setOver(null)}
          onDrop={e => { setOver(null); const id = e.dataTransfer.getData('text/row'); if (id && id !== r.id && p.perm.rows) reorder(store, rows, id, r.id) }}>
          <div className="row-gutter">
            {p.perm.rows && <button className="ghost drag" draggable onDragStart={e => e.dataTransfer.setData('text/row', r.id)} onClick={e => setMenu({ el: e.currentTarget, row: r })} title="Drag to move, click for menu"><GripVertical size={14} /></button>}
            <input type="checkbox" checked={selected.has(r.id)} onChange={e => { const n = new Set(selected); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSelected(n) }} />
          </div>
          {cols.map(c => (
            <div key={c.id} className={'td' + (c.id === 'title' ? ' title-td' : '')} style={{ width: p.view.widths?.[c.id] ?? (c.id === 'title' ? 280 : 180), ...stick(c.id), ...tint(colorsOf(r).cells[c.id]) }}>
              {c.id === 'title'
                ? <div className="title-cell" style={tree ? { paddingLeft: (node.get(r.id)?.depth ?? 0) * 24 } : undefined}>
                    {tree && (node.get(r.id)?.kids
                      ? <button className="ghost row-twisty" aria-label={openRows.has(r.id) ? 'Hide sub-items' : 'Show sub-items'} onClick={() => toggleRow(r.id)}>{openRows.has(r.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                      : <span className="row-twisty" />)}
                    {!p.view.hideIcon && <span className="row-icon">{iconOf(r, 16)}</span>}
                    <Cell prop={c} row={r} db={p.db} readOnly={!p.perm.rows} wrap={p.view.wrap} className="title-value" autoEdit={r.id === fresh} />
                    <button className="open-btn" onClick={() => p.openRow(r)}><Maximize2 size={12} /> OPEN</button>
                  </div>
                : <Cell prop={c} row={r} db={p.db} readOnly={!p.perm.rows} wrap={p.view.wrap} />}
            </div>
          ))}
          <div className="td filler" />
        </div>
      ))}
      <Popover anchor={menu?.el ?? null} onClose={() => setMenu(null)} className="menu-pop" width={220}>
        {menu && <RowMenu row={menu.row} p={p} close={() => setMenu(null)} />}
      </Popover>
      {to < rows.length && <div style={{ height: (rows.length - to) * rowH }} />}
    </div>
  )
}

export function TableView(p: ViewProps) {
  const store = useStore()
  const { db, view, props } = p
  const [head, setHead] = useState<{ el: HTMLElement; prop: Prop } | null>(null)
  const [add, openAdd, closeAdd] = usePopover()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // As in Notion, "+ New page" puts the cursor straight into the new row's name.
  const [fresh, setFresh] = useState<string | null>(null)
  const title = propOf(db.schema, 'title')!
  const cols = [title, ...props]
  const groupProp = view.groupBy ? propOf(db.schema, view.groupBy) : undefined
  const groups: Group[] = groupProp ? groupRows(p.rows, groupProp, db.schema, ctxOf(store)).filter(g => g.rows.length || view.showEmptyGroups) : [{ key: '*', label: '', rows: p.rows }]
  const collapsed = new Set(view.collapsedGroups ?? [])

  const resize = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const start = e.clientX, w0 = view.widths?.[id] ?? (id === 'title' ? 280 : 180)
    let w = w0
    const move = (m: MouseEvent) => { w = Math.max(80, w0 + m.clientX - start); document.querySelectorAll<HTMLElement>(`[data-col="${id}"]`).forEach(el => (el.style.width = w + 'px')) }
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); p.setView({ widths: { ...view.widths, [id]: w } }) }
    addEventListener('mousemove', move); addEventListener('mouseup', up)
  }
  const width = (id: string) => view.widths?.[id] ?? (id === 'title' ? 280 : 180)
  const stick = frozen(cols, view, width)

  return (
    <div className="table-view">
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          {p.perm.rows && <button onClick={async () => { for (const id of selected) await api.duplicate(id); await store.reload(); setSelected(new Set()) }}><Copy size={14} /> Duplicate</button>}
          {p.perm.rows && <button className="danger" onClick={async () => { for (const id of selected) await api.update(id, { trashed: true }); await store.reload(); setSelected(new Set()) }}><Trash2 size={14} /> Delete</button>}
          <button className="ghost" onClick={() => setSelected(new Set())}><X size={14} /></button>
        </div>
      )}
      <div className="table-scroll">
        <div className="thead">
          <div className="row-gutter head-gutter"><input type="checkbox" checked={!!p.rows.length && selected.size === p.rows.length} onChange={e => setSelected(e.target.checked ? new Set(p.rows.map(r => r.id)) : new Set())} /></div>
          {cols.map(c => (
            <div key={c.id} data-col={c.id} className="th" style={{ width: width(c.id), ...stick(c.id) }} onClick={e => setHead({ el: e.currentTarget, prop: c })}>
              <span className="th-icon">{typeIcon(c)}</span><span className="th-name">{c.name}</span>
              <span className="col-resize" onMouseDown={resize(c.id)} onClick={e => e.stopPropagation()} />
            </div>
          ))}
          {p.perm.structure && <div className="th add-th" onClick={e => openAdd(e.currentTarget)}><Plus size={15} /></div>}
          <div className="th filler" />
        </div>
        {groups.map(g => (
          <Fragment key={g.key}>
            {groupProp && (
              <div className="group-head" onClick={() => p.setView({ collapsedGroups: collapsed.has(g.key) ? [...collapsed].filter(k => k !== g.key) : [...collapsed, g.key] })}>
                {collapsed.has(g.key) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                {g.option ? (groupProp.type === 'status' ? <StatusChip o={g.option} /> : <Chip o={g.option} />) : <span>{g.label}</span>}
                <span className="muted">{g.rows.length}</span>
              </div>
            )}
            {!collapsed.has(g.key) && <>
              <TableBody p={{ ...p, view: { ...view, widths: Object.fromEntries(cols.map(c => [c.id, width(c.id)])) } }} rows={g.rows} cols={cols} selected={selected} setSelected={setSelected} fresh={fresh} />
              {p.perm.rows && <button className="new-row" onClick={() => p.addRow(groupProp && g.key !== '*' ? { [groupProp.id]: groupProp.type === 'multi_select' || groupProp.type === 'person' ? (g.key ? [g.key] : []) : groupProp.type === 'checkbox' ? g.key === 'true' : g.key || null } : {}, false).then(r => setFresh(r?.id ?? null))}><Plus size={14} /> New page</button>}
            </>}
          </Fragment>
        ))}
        <div className="calc-row">
          <div className="row-gutter" />
          {cols.map(c => <div key={c.id} data-col={c.id} style={{ width: width(c.id), ...stick(c.id) }}><CalcCell prop={c} p={p} rows={p.rows} /></div>)}
        </div>
      </div>
      <Popover anchor={head?.el ?? null} onClose={() => setHead(null)} className="menu-pop" width={244}>
        {head && <HeaderMenu prop={cols.find(c => c.id === head.prop.id) ?? head.prop} p={p} close={() => setHead(null)} />}
      </Popover>
      <Popover anchor={add} onClose={closeAdd} className="menu-pop" width={260}>
        <TypePicker onPick={t => { store.patch(db.id, { schema: { ...db.schema, props: [...(db.schema.props ?? []), newProp(t)] } }); closeAdd() }} />
      </Popover>
    </div>
  )
}

/* ---------- Board ---------- */

function CardProps({ row, props, db }: { row: Page; props: Prop[]; db: Page }) {
  const store = useStore()
  return <>{props.map(pr => {
    const v = value(row, pr, db.schema, ctxOf(store))
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return null
    return <div key={pr.id} className="card-prop"><CellView prop={pr} row={row} schema={db.schema} /></div>
  })}</>
}

function Card({ row, p, cover }: { row: Page; p: ViewProps; cover?: boolean }) {
  const store = useStore()
  const [menu, open, close] = usePopover()
  return (
    <div className="card" style={tint(rowColors(row, p.view.colors, p.db.schema, ctxOf(store), store.me?.user.id).row)} draggable={p.perm.rows} onDragStart={e => e.dataTransfer.setData('text/row', row.id)} onClick={() => p.openRow(row)}>
      {cover && (p.view.cardPreview ?? 'cover') === 'cover' && <div className="card-cover" style={coverStyle(row.cover, row.cover_y)}>{!row.cover && <span className="card-cover-icon">{iconOf(row, 32)}</span>}</div>}
      <div className="card-body">
        <div className="card-title">{row.icon && <span className="card-icon">{iconOf(row, 16)}</span>}{label(row)}</div>
        <CardProps row={row} props={p.props} db={p.db} />
      </div>
      <button className="card-more" onClick={e => { e.stopPropagation(); open(e.currentTarget) }}><MoreHorizontal size={14} /></button>
      <Popover anchor={menu} onClose={close} className="menu-pop" width={220}><RowMenu row={row} p={p} close={close} /></Popover>
    </div>
  )
}

export function BoardView(p: ViewProps) {
  const store = useStore()
  const { db, view } = p
  const group = view.groupBy ? propOf(db.schema, view.groupBy) : undefined
  const [over, setOver] = useState<string | null>(null)
  const [gmenu, setGmenu] = useState<{ el: HTMLElement; key: string } | null>(null)
  if (!group) return <div className="view-empty">Group this board by a Select, Status or Person property in the view settings (⋯).</div>
  const groups = groupRows(p.rows, group, db.schema, ctxOf(store))
  const hidden = new Set(view.hiddenGroups ?? [])
  const shown = groups.filter(g => !hidden.has(g.key) && (g.key !== '' || g.rows.length))
  const cardProps = p.props.filter(x => x.id !== group.id)
  const valueFor = (key: string) => group.type === 'multi_select' || group.type === 'person' || group.type === 'relation' ? (key ? [key] : []) : group.type === 'checkbox' ? key === 'true' : key || null

  const drop = (key: string, e: React.DragEvent, beforeId: string | null) => {
    setOver(null)
    const row = store.byId.get(e.dataTransfer.getData('text/row'))
    if (!row || !p.perm.rows) return
    const cur = value(row, group, db.schema, ctxOf(store))
    const curKey = Array.isArray(cur) ? (cur[0] ?? '') : cur === true ? 'true' : cur === false ? 'false' : String(cur ?? '')
    if (curKey !== key) store.patch(row.id, { props: { ...row.props, [group.id]: valueFor(key) } })
    if (!view.sort?.length) {
      const col = groups.find(g => g.key === key)?.rows ?? []
      reorder(store, col, row.id, beforeId)
    }
  }
  return (
    <div className="board">
      {shown.map(g => (
        <div key={g.key} className={'column' + (over === g.key ? ' over' : '')}
          data-color={g.option?.color} style={g.option ? { '--col-bg': `var(--opt-${g.option.color})`, '--col-text': `var(--t-${g.option.color})` } as React.CSSProperties : undefined}
          onDragOver={e => { e.preventDefault(); setOver(g.key) }} onDragLeave={() => setOver(null)} onDrop={e => drop(g.key, e, null)}>
          <div className="column-head">
            {g.option ? (group.type === 'status' ? <StatusChip o={g.option} /> : <Chip o={g.option} />) : <span className="group-label">{g.label}</span>}
            <span className="muted count">{g.rows.length}</span>
            <span className="column-actions">
              <button className="ghost" onClick={e => setGmenu({ el: e.currentTarget, key: g.key })}><MoreHorizontal size={14} /></button>
              {p.perm.rows && <button className="ghost" onClick={() => p.addRow({ [group.id]: valueFor(g.key) })}><Plus size={14} /></button>}
            </span>
          </div>
          {g.rows.map(r => <div key={r.id} onDrop={e => { e.stopPropagation(); drop(g.key, e, r.id) }}><Card row={r} p={{ ...p, props: cardProps }} /></div>)}
          {p.perm.rows && <button className="new-row" onClick={() => p.addRow({ [group.id]: valueFor(g.key) })}><Plus size={14} /> New page</button>}
        </div>
      ))}
      {hidden.size > 0 && (
        <div className="column hidden-groups">
          <div className="column-head"><span className="muted">Hidden groups</span></div>
          {groups.filter(g => hidden.has(g.key)).map(g => (
            <div key={g.key} className="hidden-group" onClick={() => p.setView({ hiddenGroups: [...hidden].filter(k => k !== g.key) })}>
              {g.option ? <Chip o={g.option} /> : g.label} <span className="muted">{g.rows.length}</span>
            </div>
          ))}
        </div>
      )}
      <Popover anchor={gmenu?.el ?? null} onClose={() => setGmenu(null)} className="menu-pop" width={200}>
        {gmenu && <Menu onClose={() => setGmenu(null)} items={[{ icon: <EyeOff size={15} />, label: 'Hide', onClick: () => p.setView({ hiddenGroups: [...hidden, gmenu.key] }) }]} />}
      </Popover>
    </div>
  )
}

/* ---------- Gallery & List ---------- */

export function GalleryView(p: ViewProps) {
  return (
    <div className={'gallery size-' + (p.view.cardSize ?? 'm')}>
      {p.rows.map(r => <Card key={r.id} row={r} p={p} cover />)}
      {p.perm.rows && <button className="card new-card" onClick={() => p.addRow()}><Plus size={16} /> New page</button>}
    </div>
  )
}

export function ListView(p: ViewProps) {
  const store = useStore()
  return (
    <div className="list-view">
      {p.rows.map(r => (
        <div key={r.id} className="list-row" style={tint(rowColors(r, p.view.colors, p.db.schema, ctxOf(store), store.me?.user.id).row)} onClick={() => p.openRow(r)} draggable={p.perm.rows} onDragStart={e => e.dataTransfer.setData('text/row', r.id)}>
          <span className="list-title">{iconOf(r, 16)}<span>{label(r)}</span></span>
          <span className="list-props"><CardProps row={r} props={p.props} db={p.db} /></span>
        </div>
      ))}
      {p.perm.rows && <button className="new-row" onClick={() => p.addRow()}><Plus size={14} /> New page</button>}
    </div>
  )
}

/* ---------- Calendar ---------- */

export function CalendarView(p: ViewProps) {
  const store = useStore()
  const { db, view } = p
  const date = view.dateProp ? propOf(db.schema, view.dateProp) : undefined
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [moreDay, setMoreDay] = useState<{ el: HTMLElement; key: string } | null>(null)
  const monday = (store.me?.prefs?.weekStart ?? 'monday') === 'monday'
  if (!date) return <div className="view-empty">Add a Date property to use the calendar.</div>
  const days = monthGrid(cursor.y, cursor.m, monday)
  const today = isoDay(new Date())
  const shift = (n: number) => setCursor(c => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const startOf = (r: Page) => dateValue(value(r, date, db.schema, ctxOf(store)))?.start.slice(0, 10)
  const endOf = (r: Page) => dateValue(value(r, date, db.schema, ctxOf(store)))?.end?.slice(0, 10)
  const on = (k: string) => p.rows.filter(r => { const s = startOf(r); const e = endOf(r) ?? s; return !!s && k >= s && k <= e! })
  const events = p.rows.flatMap(r => { const st = startOf(r); if (!st) return []; const en = endOf(r); return [{ id: r.id, start: st, end: en && en > st ? en : st }] })
  const move = (row: Page, k: string) => {
    const d = dateValue(value(row, date, db.schema, ctxOf(store)))
    if (!d) return store.patch(row.id, { props: { ...row.props, [date.id]: k } })
    const delta = (toDate(k).getTime() - toDate(d.start.slice(0, 10)).getTime()) / 864e5
    const sh = (s: string) => isoDay(new Date(toDate(s.slice(0, 10)).getTime() + delta * 864e5)) + s.slice(10)
    store.patch(row.id, { props: { ...row.props, [date.id]: d.end ? { start: sh(d.start), end: sh(d.end) } : sh(d.start) } })
  }
  return (
    <div className="calendar">
      <div className="cal-head">
        <b>{new Date(cursor.y, cursor.m).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b>
        <span className="cal-nav">
          <button className="ghost" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
          <button className="ghost" onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }) }}>Today</button>
          <button className="ghost" onClick={() => shift(1)}><ChevronRight size={16} /></button>
        </span>
      </div>
      <div className="cal-grid cal-dows">
        {(monday ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map(d => <div key={d} className="cal-dow">{d}</div>)}
      </div>
      {/* Week by week: day cells underneath, events on top as bars across their days (lanes of 28px under the date). */}
      {Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7)).map(week => {
        const keys = week.map(isoDay)
        const { bars, more } = weekLanes(keys, events, CAL_LANES)
        return (
          <div key={keys[0]} className="cal-week">
            {week.map((d, i) => (
              <div key={keys[i]} className={'cal-day' + (d.getMonth() !== cursor.m ? ' other' : '') + (keys[i] === today ? ' today' : '') + (d.getDay() % 6 === 0 ? ' cal-weekend' : '')}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { const row = store.byId.get(e.dataTransfer.getData('text/row')); if (row && p.perm.rows) move(row, keys[i]) }}>
                <div className="cal-day-head">
                  {p.perm.rows && <button className="ghost cal-add" title="New page" onClick={() => p.addRow({ [date.id]: keys[i] })}><Plus size={13} /></button>}
                  <span className="cal-num">{d.getDate() === 1 ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d.getDate()}</span>
                </div>
                {more[i] > 0 && <button className="ghost cal-more" style={{ top: 28 + CAL_LANES * 28 }} onClick={e => setMoreDay({ el: e.currentTarget, key: keys[i] })}>{more[i]} more</button>}
              </div>
            ))}
            {bars.map(b => {
              const r = store.byId.get(b.id)!
              return (
                <div key={b.id} className={'cal-item' + (b.fromBefore ? ' from-before' : '') + (b.toAfter ? ' to-after' : '')}
                  style={{ left: `calc(${(b.col / 7) * 100}% + 4px)`, width: `calc(${(b.span / 7) * 100}% - 8px)`, top: 28 + b.lane * 28, ...tint(rowColors(r, p.view.colors, p.db.schema, ctxOf(store), store.me?.user.id).row) }}
                  draggable={p.perm.rows} onDragStart={e => e.dataTransfer.setData('text/row', r.id)} onClick={() => p.openRow(r)}>
                  <span className="cal-item-title">{r.icon && <>{iconOf(r, 12)} </>}{label(r)}</span>
                  <CardProps row={r} props={p.props.filter(x => x.id !== date.id)} db={db} />
                </div>
              )
            })}
          </div>
        )
      })}
      <Popover anchor={moreDay?.el ?? null} onClose={() => setMoreDay(null)} className="menu-pop" width={260}>
        {moreDay && <div className="menu-list">
          <div className="menu-heading">{toDate(moreDay.key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          {on(moreDay.key).map(r => <button key={r.id} className="menu-item" onClick={() => { setMoreDay(null); p.openRow(r) }}><span className="menu-icon">{iconOf(r, 16)}</span><span className="menu-label">{label(r)}</span></button>)}
        </div>}
      </Popover>
    </div>
  )
}

// How many events show under a date before the rest fold into "N more".
const CAL_LANES = 3

/* ---------- Timeline ---------- */

// Notion's default timeline zoom shows 40px days with their numbers.
const DAY_WIDTH = { week: 40, month: 18, quarter: 6 }

export function TimelineView(p: ViewProps) {
  const store = useStore()
  const { db, view } = p
  const startProp = view.dateProp ? propOf(db.schema, view.dateProp) : undefined
  const endProp = view.endProp ? propOf(db.schema, view.endProp) : undefined
  const scale = view.scale ?? 'week'
  const dw = DAY_WIDTH[scale]
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollX, setScrollX] = useState(0)
  const origin = useMemo(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); d.setHours(0, 0, 0, 0); return d }, [])
  const span = scale === 'quarter' ? 365 : scale === 'month' ? 150 : 60
  // Start scrolled to today.
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = ((Date.now() - origin.getTime()) / 864e5) * dw - 200 }, [dw, origin])
  if (!startProp) return <div className="view-empty">Pick a date property for the timeline in the view settings (⋯).</div>
  const ctx = ctxOf(store)
  const rangeOf = (r: Page) => {
    const s = dateValue(value(r, startProp, db.schema, ctx))
    if (!s) return null
    const e = endProp ? dateValue(value(r, endProp, db.schema, ctx))?.start : s.end
    return { start: s.start.slice(0, 10), end: (e ?? s.start).slice(0, 10) }
  }
  const x = (day: string) => ((toDate(day).getTime() - origin.getTime()) / 864e5) * dw
  // In day zoom the today line runs through the middle of today's column, as in Notion.
  const todayX = x(isoDay(new Date())) + (scale === 'week' ? dw / 2 : 0)
  const days = Array.from({ length: span }, (_, i) => new Date(origin.getTime() + i * 864e5))
  const setRange = (r: Page, start: string, end: string) => {
    if (endProp) store.patch(r.id, { props: { ...r.props, [startProp.id]: start, [endProp.id]: end } })
    else store.patch(r.id, { props: { ...r.props, [startProp.id]: start === end ? start : { start, end } } })
  }
  const drag = (r: Page, mode: 'move' | 'start' | 'end') => (e: React.MouseEvent) => {
    if (!p.perm.rows) return
    e.preventDefault(); e.stopPropagation()
    const rg = rangeOf(r)!
    const x0 = e.clientX
    const shiftDay = (d: string, n: number) => isoDay(new Date(toDate(d).getTime() + n * 864e5))
    const up = (m: MouseEvent) => {
      removeEventListener('mouseup', up)
      const n = Math.round((m.clientX - x0) / dw)
      if (!n) { if (mode === 'move') p.openRow(r); return }
      if (mode === 'move') setRange(r, shiftDay(rg.start, n), shiftDay(rg.end, n))
      if (mode === 'start') setRange(r, shiftDay(rg.start, n) > rg.end ? rg.end : shiftDay(rg.start, n), rg.end)
      if (mode === 'end') setRange(r, rg.start, shiftDay(rg.end, n) < rg.start ? rg.start : shiftDay(rg.end, n))
    }
    addEventListener('mouseup', up)
  }
  return (
    <div className="timeline">
      <div className="timeline-tools">
        {(['week', 'month', 'quarter'] as const).map(s => <button key={s} className={'ghost' + (scale === s ? ' on' : '')} onClick={() => p.setView({ scale: s })}>{s[0].toUpperCase() + s.slice(1)}</button>)}
        <button className="ghost" onClick={() => scroller.current?.scrollTo({ left: todayX - 200, behavior: 'smooth' })}>Today</button>
      </div>
      <div className="timeline-body">
        <div className="timeline-names">
          <div className="timeline-corner" />
          {p.rows.map(r => <div key={r.id} className="timeline-name" onClick={() => p.openRow(r)}>{iconOf(r, 14)} <span>{label(r)}</span></div>)}
          {p.perm.rows && <button className="new-row" onClick={() => p.addRow({ [startProp.id]: isoDay(new Date()) })}><Plus size={14} /> New page</button>}
        </div>
        <div className="timeline-scroll" ref={scroller} onScroll={e => setScrollX(e.currentTarget.scrollLeft)}>
          <div className="timeline-canvas" style={{ width: span * dw }}>
            <div className={'timeline-scale' + (scale === 'week' ? ' days' : '')}>
              {/* The month in view stays pinned at the left, like Notion's "October 2026". */}
              {scale === 'week' && <span className="timeline-month">{new Date(origin.getTime() + Math.floor(scrollX / dw) * 864e5).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>}
              {scale !== 'week' && days.map(d => d.getDate() === 1 && (
                <span key={'m' + d.getTime()} className="tick month" style={{ left: x(isoDay(d)) }}>
                  {d.toLocaleDateString(undefined, { month: 'short', year: d.getMonth() === 0 ? 'numeric' : undefined })}
                </span>
              ))}
              {scale === 'week' && days.map(d => (
                <span key={d.getTime()} className={'tick day' + (isoDay(d) === isoDay(new Date()) ? ' today' : '')} style={{ left: x(isoDay(d)), width: dw }}>{d.getDate()}</span>
              ))}
            </div>
            {scale === 'week' && days.map(d => (d.getDay() === 0 || d.getDay() === 6) && <div key={'w' + d.getTime()} className="tl-weekend" style={{ left: x(isoDay(d)), width: dw }} />)}
            <div className="today-line" style={{ left: todayX }} />
            <div className="timeline-rows">
            {/* Dependencies: an arrow from the end of each blocking item to the start of the one it blocks. */}
            {db.schema.deps && (() => {
              const at = new Map(p.rows.map((r, i) => [r.id, { i, rg: rangeOf(r) }]))
              const arrows = p.rows.flatMap((r, i) => {
                const to = rangeOf(r), v = r.props?.[db.schema.deps!.blockedBy]
                return to && Array.isArray(v) ? v.flatMap(id => { const f = at.get(String(id)); return f?.rg ? [{ key: id + r.id, x1: x(f.rg.end) + dw, y1: f.i * 36 + 18, x2: x(to.start), y2: i * 36 + 18, late: f.rg.end >= to.start }] : [] }) : []
              })
              return arrows.length > 0 && (
                <svg className="tl-deps" width={span * dw} height={p.rows.length * 36}>
                  <defs><marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 8 4 0 8z" /></marker></defs>
                  {arrows.map(a => {
                    const mid = Math.max(a.x1 + 8, Math.min(a.x2 - 8, (a.x1 + a.x2) / 2))
                    return <path key={a.key} className={a.late ? 'late' : ''} markerEnd="url(#tl-arrow)" d={`M${a.x1} ${a.y1} H${mid} V${a.y2} H${a.x2 - 1}`} />
                  })}
                </svg>
              )
            })()}
            {p.rows.map(r => {
              const rg = rangeOf(r)
              return (
                <div key={r.id} className="timeline-row">
                  {rg && (
                    <div className={'bar' + (Math.max(dw, x(rg.end) - x(rg.start) + dw) < 120 ? ' narrow' : '')} style={{ left: x(rg.start), width: Math.max(dw, x(rg.end) - x(rg.start) + dw) }} onMouseDown={drag(r, 'move')}>
                      <span className="bar-handle left" onMouseDown={drag(r, 'start')} />
                      <span className="bar-label">{label(r)}</span>
                      <span className="bar-handle right" onMouseDown={drag(r, 'end')} />
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const VIEW_COMPONENTS: Record<View['type'], (p: ViewProps) => ReactNode> = {
  table: TableView, board: BoardView, gallery: GalleryView, list: ListView, calendar: CalendarView, timeline: TimelineView, form: FormView, chart: ChartView, feed: FeedView, dashboard: DashboardView,
}
Object.assign(WIDGETS, VIEW_COMPONENTS)
