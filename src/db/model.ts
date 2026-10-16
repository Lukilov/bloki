/** Pure database logic: property values, formulas, rollups, filters, sorting, grouping, calculations. */
import type { ColorRule, Filter, Option, Page, Prop, PropType, Schema, View } from '../api.ts'
import { FormulaError, run, toText, type Value } from './formula.ts'

export type Ctx = { byId: Map<string, Page>; people: Map<string, { name: string }> }

export const TITLE: Prop = { id: 'title', name: 'Name', type: 'text' }
export const TYPE_NAMES: Record<PropType, string> = {
  text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select', status: 'Status', date: 'Date', person: 'Person', files: 'Files & media',
  checkbox: 'Checkbox', url: 'URL', email: 'Email', phone: 'Phone', formula: 'Formula', relation: 'Relation', rollup: 'Rollup',
  created: 'Created time', created_by: 'Created by', updated: 'Last edited time', updated_by: 'Last edited by', unique_id: 'ID',
}
export const COMPUTED: PropType[] = ['formula', 'rollup', 'created', 'created_by', 'updated', 'updated_by', 'unique_id']

export function propOf(schema: Schema, id: string): Prop | undefined {
  return id === 'title' ? { ...TITLE, name: titleName(schema) } : schema.props?.find(p => p.id === id)
}
export const titleName = (schema: Schema) => (schema as { titleName?: string }).titleName ?? 'Name'

/* ---------- dates ---------- */

export type DateValue = { start: string; end?: string }
/** Date values are "YYYY-MM-DD", "YYYY-MM-DDTHH:mm", or { start, end } ranges. */
export function dateValue(v: unknown): DateValue | null {
  if (!v) return null
  if (typeof v === 'string') return { start: v }
  if (typeof v === 'object' && 'start' in (v as object)) return v as DateValue
  return null
}
export const toDate = (s: string) => new Date(s.length === 10 ? s + 'T00:00' : s)
export function formatDate(v: unknown, withTime?: boolean): string {
  const d = dateValue(v)
  if (!d) return ''
  const f = (s: string) => {
    const x = toDate(s)
    const day = x.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    return s.length > 10 || withTime ? `${day} ${x.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : day
  }
  return d.end ? `${f(d.start)} → ${f(d.end)}` : f(d.start)
}
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/* ---------- raw and computed values ---------- */

export function raw(row: Page, prop: string): unknown {
  switch (prop) {
    case 'title': return row.title
    default: return row.props?.[prop]
  }
}

/** The value of any property of a row, computing formulas, rollups and system properties. */
export function value(row: Page, p: Prop, schema: Schema, ctx: Ctx, seen: Set<string> = new Set()): unknown {
  switch (p.type) {
    case 'created': return row.created
    case 'updated': return row.updated
    case 'created_by': return row.created_by
    case 'updated_by': return row.updated_by
    case 'formula': {
      if (seen.has(p.id)) return new FormulaError('Formula refers to itself')
      const r = run(p.formula ?? '', { prop: name => formulaInput(row, name, schema, ctx, new Set([...seen, p.id])) })
      return r
    }
    case 'rollup': return rollup(row, p, schema, ctx)
    case 'relation': return Array.isArray(row.props?.[p.id]) ? (row.props[p.id] as string[]).filter(id => ctx.byId.has(id) && !ctx.byId.get(id)!.trashed) : []
    default: return p.id === 'title' ? row.title : row.props?.[p.id]
  }
}

/** What prop("Name") returns inside a formula. */
function formulaInput(row: Page, name: string, schema: Schema, ctx: Ctx, seen: Set<string>): Value {
  const p = name === titleName(schema) ? TITLE : schema.props?.find(x => x.name === name)
  if (!p) throw new FormulaError(`No property named “${name}”`)
  const v = value(row, p, schema, ctx, seen)
  if (v instanceof FormulaError) throw v
  return toValue(v, p, ctx)
}

export function toValue(v: unknown, p: Prop, ctx: Ctx): Value {
  if (v === undefined || v === null || v === '') return p.type === 'checkbox' ? false : null
  switch (p.type) {
    case 'select': case 'status': return optionOf(p, v)?.name ?? null
    case 'multi_select': return (v as string[]).map(id => optionOf(p, id)?.name ?? '').filter(Boolean)
    case 'person': return [v].flat().map(id => ctx.people.get(String(id))?.name ?? '')
    case 'created_by': case 'updated_by': return ctx.people.get(String(v))?.name ?? ''
    case 'date': { const d = dateValue(v); return d ? toDate(d.start) : null }
    case 'created': case 'updated': return new Date(Number(v))
    case 'relation': return (v as string[]).map(id => ctx.byId.get(id)?.title || 'Untitled')
    case 'files': return (v as { name: string }[]).map(f => f.name)
    case 'checkbox': return v === true
    case 'number': case 'unique_id': return Number(v)
    case 'formula': case 'rollup': return v as Value
    default: return String(v)
  }
}

export const optionOf = (p: Prop, id: unknown): Option | undefined => p.options?.find(o => o.id === id)

/** Values a new row starts with: a Status property begins at its first to-do option ("Not started"), as in Notion. */
export function newRowDefaults(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of schema.props ?? []) {
    if (p.type !== 'status') continue
    const first = p.options?.find(o => o.group === 'todo') ?? p.options?.[0]
    if (first) out[p.id] = first.id
  }
  return out
}

export const ROLLUP_FNS: Record<string, string> = {
  show: 'Show original', count: 'Count all', count_values: 'Count values', unique: 'Count unique values', empty: 'Count empty', not_empty: 'Count not empty',
  percent_empty: 'Percent empty', percent_not_empty: 'Percent not empty', sum: 'Sum', average: 'Average', median: 'Median', min: 'Min', max: 'Max', range: 'Range',
  earliest: 'Earliest date', latest: 'Latest date', checked: 'Checked', unchecked: 'Unchecked', percent_checked: 'Percent checked',
}

export function rollup(row: Page, p: Prop, schema: Schema, ctx: Ctx): unknown {
  const rel = schema.props?.find(x => x.id === p.rollup?.relation)
  if (!rel?.relation || !p.rollup) return null
  const target = ctx.byId.get(rel.relation.db)
  if (!target) return null
  const tp = propOf(target.schema, p.rollup.target)
  if (!tp) return null
  const rows = (value(row, rel, schema, ctx) as string[]).map(id => ctx.byId.get(id)!).filter(Boolean)
  const vals = rows.map(r => value(r, tp, target.schema, ctx))
  return aggregate(p.rollup.fn, vals, tp, ctx)
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || v === false

/** Shared by rollups and the table's Calculate row. */
export function aggregate(fn: string, vals: unknown[], p: Prop, ctx: Ctx): unknown {
  const n = vals.length
  const nonEmpty = vals.filter(v => !isEmpty(v))
  const numbers = vals.map(v => (typeof v === 'number' ? v : Number(v))).filter(v => !Number.isNaN(v) && v !== null)
  const times = vals.map(v => dateValue(v)?.start ?? (typeof v === 'number' && ['created', 'updated'].includes(p.type) ? new Date(v).toISOString() : null)).filter(Boolean) as string[]
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)}%` : '0%')
  switch (fn) {
    case 'show': return vals.flatMap(v => [toValue(v, p, ctx)].flat()).filter(v => v !== null && v !== '')
    case 'count': return n
    case 'count_values': return vals.flatMap(v => (Array.isArray(v) ? v : isEmpty(v) ? [] : [v])).length
    case 'unique': return new Set(vals.flatMap(v => (Array.isArray(v) ? v : isEmpty(v) ? [] : [v])).map(v => JSON.stringify(v))).size
    case 'empty': return n - nonEmpty.length
    case 'not_empty': return nonEmpty.length
    case 'percent_empty': return pct(n - nonEmpty.length)
    case 'percent_not_empty': return pct(nonEmpty.length)
    case 'sum': return numbers.reduce((a, b) => a + b, 0)
    case 'average': return numbers.length ? Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100 : null
    case 'median': { const s = [...numbers].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null }
    case 'min': return numbers.length ? Math.min(...numbers) : null
    case 'max': return numbers.length ? Math.max(...numbers) : null
    case 'range': return numbers.length ? Math.max(...numbers) - Math.min(...numbers) : null
    case 'earliest': return times.length ? formatDate(times.sort()[0]) : null
    case 'latest': return times.length ? formatDate(times.sort().at(-1)) : null
    case 'checked': return vals.filter(v => v === true).length
    case 'unchecked': return vals.filter(v => v !== true).length
    case 'percent_checked': return pct(vals.filter(v => v === true).length)
    default: return null
  }
}

/** Calculations offered for a property, by type (Notion's Calculate menu). */
export function calcsFor(p: Prop): string[] {
  const base = ['count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty']
  if (p.type === 'checkbox') return ['count', 'checked', 'unchecked', 'percent_checked']
  if (['number', 'formula', 'rollup', 'unique_id'].includes(p.type)) return [...base, 'sum', 'average', 'median', 'min', 'max', 'range']
  if (['date', 'created', 'updated'].includes(p.type)) return [...base, 'earliest', 'latest']
  return base
}

/* ---------- number formatting ---------- */

export const NUMBER_FORMATS: Record<string, string> = { plain: 'Number', commas: 'Number with commas', percent: 'Percent', dollar: 'US dollar', euro: 'Euro', pound: 'Pound', yen: 'Yen', rupee: 'Rupee', won: 'Won', franc: 'Franc' }
export function formatNumber(n: unknown, format = 'plain'): string {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return ''
  const x = Number(n)
  const cur: Record<string, string> = { dollar: 'USD', euro: 'EUR', pound: 'GBP', yen: 'JPY', rupee: 'INR', won: 'KRW', franc: 'CHF' }
  if (cur[format]) return x.toLocaleString(undefined, { style: 'currency', currency: cur[format] })
  if (format === 'percent') return `${Math.round(x * 100 * 100) / 100}%`
  if (format === 'commas') return x.toLocaleString()
  return String(Math.round(x * 1e8) / 1e8)
}

/** Plain text of a value, for search, filters on text, and sorting fallbacks. */
export function textOf(v: unknown, p: Prop, ctx: Ctx): string {
  if (v instanceof FormulaError) return ''
  if (['date'].includes(p.type)) return formatDate(v)
  if (['created', 'updated'].includes(p.type)) return v ? new Date(Number(v)).toLocaleString() : ''
  if (p.type === 'number') return formatNumber(v, p.format)
  return toText(toValue(v, p, ctx))
}

/* ---------- filters ---------- */

export const OP_NAMES: Record<string, string> = {
  contains: 'Contains', not_contains: 'Does not contain', is: 'Is', is_not: 'Is not', starts: 'Starts with', ends: 'Ends with', empty: 'Is empty', not_empty: 'Is not empty',
  eq: '=', neq: '≠', gt: '>', lt: '<', gte: '≥', lte: '≤', checked: 'Is checked', unchecked: 'Is unchecked', before: 'Is before', after: 'Is after',
  on_or_before: 'Is on or before', on_or_after: 'Is on or after', past_week: 'Is within past week', next_week: 'Is within next week', this_month: 'Is this month', me: 'Is me',
}
export function opsFor(t: PropType): string[] {
  if (t === 'checkbox') return ['checked', 'unchecked']
  if (['number', 'unique_id'].includes(t)) return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'not_empty']
  if (['select', 'status'].includes(t)) return ['is', 'is_not', 'empty', 'not_empty']
  if (['multi_select', 'relation', 'files'].includes(t)) return ['contains', 'not_contains', 'empty', 'not_empty']
  if (['person', 'created_by', 'updated_by'].includes(t)) return ['contains', 'not_contains', 'me', 'empty', 'not_empty']
  if (['date', 'created', 'updated'].includes(t)) return ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'past_week', 'next_week', 'this_month', 'empty', 'not_empty']
  return ['contains', 'not_contains', 'is', 'is_not', 'starts', 'ends', 'empty', 'not_empty']
}
export const needsValue = (op: string) => !['empty', 'not_empty', 'checked', 'unchecked', 'past_week', 'next_week', 'this_month', 'me'].includes(op)

export function matches(row: Page, f: Filter, schema: Schema, ctx: Ctx, me?: string): boolean {
  const p = propOf(schema, f.prop)
  if (!p) return true
  const v = value(row, p, schema, ctx)
  const fv = f.value ?? ''
  const day = (x: unknown) => {
    if (['created', 'updated'].includes(p.type)) return x ? isoDay(new Date(Number(x))) : ''
    return dateValue(x)?.start.slice(0, 10) ?? ''
  }
  const today = isoDay(new Date())
  const shift = (n: number) => isoDay(new Date(Date.now() + n * 864e5))
  const ids = Array.isArray(v) ? v.map(String) : v ? [String(v)] : []
  switch (f.op) {
    case 'empty': return isEmpty(v)
    case 'not_empty': return !isEmpty(v)
    case 'checked': return v === true
    case 'unchecked': return v !== true
    case 'me': return !!me && ids.includes(me)
    case 'eq': return Number(v) === Number(fv)
    case 'neq': return Number(v) !== Number(fv)
    case 'gt': return Number(v) > Number(fv)
    case 'lt': return Number(v) < Number(fv)
    case 'gte': return Number(v) >= Number(fv)
    case 'lte': return Number(v) <= Number(fv)
    case 'before': return !!day(v) && day(v) < fv
    case 'after': return !!day(v) && day(v) > fv
    case 'on_or_before': return !!day(v) && day(v) <= fv
    case 'on_or_after': return !!day(v) && day(v) >= fv
    case 'past_week': return !!day(v) && day(v) >= shift(-7) && day(v) <= today
    case 'next_week': return !!day(v) && day(v) >= today && day(v) <= shift(7)
    case 'this_month': return day(v).slice(0, 7) === today.slice(0, 7)
  }
  // Option-like properties compare by option id; everything else by text.
  if (['select', 'status'].includes(p.type)) return f.op === 'is' ? v === fv : v !== fv
  if (['multi_select', 'relation', 'person', 'created_by', 'updated_by'].includes(p.type)) return f.op === 'contains' ? ids.includes(fv) : !ids.includes(fv)
  if (['date', 'created', 'updated'].includes(p.type)) return day(v) === fv
  const text = textOf(v, p, ctx).toLowerCase()
  const q = fv.toLowerCase()
  switch (f.op) {
    case 'contains': return text.includes(q)
    case 'not_contains': return !text.includes(q)
    case 'is': return text === q
    case 'is_not': return text !== q
    case 'starts': return text.startsWith(q)
    case 'ends': return text.endsWith(q)
  }
  return true
}

/* ---------- sorting & grouping ---------- */

export function sortKey(row: Page, p: Prop, schema: Schema, ctx: Ctx): string | number | null {
  const v = value(row, p, schema, ctx)
  if (isEmpty(v) && p.type !== 'checkbox') return null
  switch (p.type) {
    case 'number': case 'unique_id': case 'created': case 'updated': return Number(v)
    case 'checkbox': return v === true ? 1 : 0
    case 'select': case 'status': return p.options?.findIndex(o => o.id === v) ?? 0
    case 'date': return dateValue(v)?.start ?? null
    case 'formula': case 'rollup': { if (v instanceof FormulaError) return null; return typeof v === 'number' ? v : v instanceof Date ? v.getTime() : toText(v as Value) }
    default: return textOf(v, p, ctx).toLowerCase()
  }
}

/** Conditional color: the colour a row gets (first matching "Entire row" rule) and per-cell colours ("This property"). */
export function rowColors(row: Page, rules: ColorRule[] | undefined, schema: Schema, ctx: Ctx, me?: string): { row?: string; cells: Record<string, string> } {
  const out: { row?: string; cells: Record<string, string> } = { cells: {} }
  for (const r of rules ?? []) {
    if (!matches(row, r, schema, ctx, me)) continue
    let c = r.color
    if (c === 'match') { const p = propOf(schema, r.prop); const v = p ? value(row, p, schema, ctx) : null; c = p ? optionOf(p, Array.isArray(v) ? v[0] : v)?.color ?? '' : '' }
    if (!c || c === 'default') continue
    if (r.apply === 'row') out.row ??= c
    else out.cells[r.prop] ??= c
  }
  return out
}

/** Database templates are rows marked _template: they stay out of views and are copied by "New". */
export const isTemplate = (p: Page) => !!(p.props as Record<string, unknown> | undefined)?._template

export function applyView(rows: Page[], schema: Schema, view: View, ctx: Ctx, me?: string): Page[] {
  let out = rows.filter(r => (view.filters ?? []).every(f => matches(r, f, schema, ctx, me)))
  const sorts = view.sort ?? []
  if (!sorts.length) return [...out].sort((a, b) => a.position - b.position)
  out = [...out].sort((a, b) => {
    for (const s of sorts) {
      const p = propOf(schema, s.prop) ?? (s.prop === 'created' ? { id: 'created', name: '', type: 'created' as const } : s.prop === 'updated' ? { id: 'updated', name: '', type: 'updated' as const } : undefined)
      if (!p) continue
      const x = sortKey(a, p, schema, ctx), y = sortKey(b, p, schema, ctx)
      if (x === y) continue
      // Empty values always sort last, as in Notion.
      if (x === null) return 1
      if (y === null) return -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
      if (c) return s.dir === 'desc' ? -c : c
    }
    return a.position - b.position
  })
  return out
}

export type Group = { key: string; label: string; option?: Option; rows: Page[] }
/** Groups for boards and grouped tables; '' is the "No value" group. */
export function groupRows(rows: Page[], p: Prop, schema: Schema, ctx: Ctx): Group[] {
  const keysOf = (r: Page): string[] => {
    const v = value(r, p, schema, ctx)
    if (p.type === 'checkbox') return [v === true ? 'true' : 'false']
    if (Array.isArray(v)) return v.length ? v.map(String) : ['']
    if (p.type === 'date') return [dateValue(v)?.start.slice(0, 10) ?? '']
    return [v === undefined || v === null ? '' : String(v)]
  }
  const groups = new Map<string, Group>()
  const ensure = (key: string, label: string, option?: Option) => { if (!groups.has(key)) groups.set(key, { key, label, option, rows: [] }) }
  ensure('', `No ${p.name}`)
  if (p.options) for (const o of p.options) ensure(o.id, o.name, o)
  if (p.type === 'checkbox') { ensure('true', 'Checked'); ensure('false', 'Unchecked'); groups.delete('') }
  for (const r of rows) for (const k of keysOf(r)) {
    if (!groups.has(k)) ensure(k, p.type === 'person' ? ctx.people.get(k)?.name ?? 'Unknown' : p.type === 'relation' ? ctx.byId.get(k)?.title || 'Untitled' : p.type === 'date' ? formatDate(k) : k)
    groups.get(k)!.rows.push(r)
  }
  const list = [...groups.values()]
  // Notion puts "No value" first for boards.
  return list
}

export function groupable(p: Prop) {
  return ['select', 'status', 'multi_select', 'person', 'checkbox', 'text', 'date', 'relation', 'url', 'email', 'phone', 'created_by'].includes(p.type)
}

/**
 * Which rows of a long list to render: those on screen plus `overscan` either side. `top` is where the list
 * starts relative to the viewport (negative once scrolled past). Short lists render whole.
 */
export function visibleRange(top: number, viewHeight: number, count: number, rowHeight: number, overscan = 20, minCount = 100): [number, number] {
  if (count <= minCount) return [0, count]
  const start = Math.max(0, Math.floor(-top / rowHeight) - overscan)
  const end = Math.min(count, Math.max(start, Math.ceil((viewHeight - top) / rowHeight) + overscan))
  return [Math.min(start, end), end]
}

/** Minimal CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(x => x.trim()))
}

