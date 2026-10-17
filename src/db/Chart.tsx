import { type View } from '../api'
import { useStore } from '../store'
import { ctxOf } from './Cells'
import { aggregate, groupable, groupRows, value } from './model'
import type { ViewProps } from './Views'

type ChartSettings = NonNullable<View['chart']>
const TYPES: [ChartSettings['type'], string][] = [['bar', 'Vertical bar'], ['hbar', 'Horizontal bar'], ['line', 'Line'], ['donut', 'Donut']]
const NUMERIC = ['number', 'formula', 'rollup', 'unique_id']

/** Chart view, as Notion's: rows grouped by one property (the X axis), counted or summed into bars, a line or a donut. */
export function ChartView({ db, rows, props, view, setView, perm }: ViewProps) {
  const store = useStore()
  const chart: ChartSettings = view.chart ?? { type: 'bar' }
  const set = (c: Partial<ChartSettings>) => setView({ chart: { ...chart, ...c } })
  const xs = props.filter(groupable)
  const x = xs.find(p => p.id === chart.x) ?? xs.find(p => p.type === 'status' || p.type === 'select') ?? xs[0]
  const nums = props.filter(p => NUMERIC.includes(p.type))
  const y = nums.find(p => p.id === chart.y)
  const fn = chart.fn ?? 'sum'
  if (!x) return <div className="view-empty muted">Add a select, status or other groupable property to chart this database.</div>
  const ctx = ctxOf(store)
  let data = groupRows(rows, x, db.schema, ctx).filter(g => g.rows.length).map(g => ({
    key: g.key, label: g.label, color: g.option ? `var(--t-${g.option.color})` : 'var(--t-blue)',
    v: y ? Number(aggregate(fn, g.rows.map(r => value(r, y, db.schema, ctx)), y, ctx)) || 0 : g.rows.length,
  }))
  if (chart.sort === 'desc') data = [...data].sort((a, b) => b.v - a.v)
  if (chart.sort === 'asc') data = [...data].sort((a, b) => a.v - b.v)
  const max = Math.max(1, ...data.map(d => d.v))
  const total = data.reduce((a, d) => a + d.v, 0)
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

  return (
    <div className="chart-view">
      {perm.structure && (
        <div className="chart-bar">
          <select aria-label="Chart type" value={chart.type} onChange={e => set({ type: e.target.value as ChartSettings['type'] })}>{TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select>
          <label>X axis <select value={x.id} onChange={e => set({ x: e.target.value })}>{xs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Y axis <select value={y ? `${fn}:${y.id}` : 'count'} onChange={e => { const [f, id] = e.target.value.split(':'); set(id ? { fn: f as 'sum' | 'average', y: id } : { y: undefined }) }}>
            <option value="count">Count</option>
            {nums.flatMap(p => [<option key={'s' + p.id} value={`sum:${p.id}`}>Sum of {p.name}</option>, <option key={'a' + p.id} value={`average:${p.id}`}>Average of {p.name}</option>])}
          </select></label>
          <label>Sort <select value={chart.sort ?? 'x'} onChange={e => set({ sort: e.target.value as ChartSettings['sort'] })}>
            <option value="x">By {x.name}</option><option value="desc">Largest first</option><option value="asc">Smallest first</option>
          </select></label>
        </div>
      )}
      {!data.length ? <div className="view-empty muted">No data</div>
        : chart.type === 'donut' ? (
          <div className="chart-donut-wrap">
            <div className="chart-donut" style={{ background: `conic-gradient(${data.reduce<{ at: number; parts: string[] }>((acc, d) => ({ at: acc.at + d.v / (total || 1) * 100, parts: [...acc.parts, `${d.color} ${acc.at}% ${acc.at + d.v / (total || 1) * 100}%`] }), { at: 0, parts: [] }).parts.join(',')})` }}>
              <span><b>{fmt(total)}</b><small>{y ? `${fn === 'sum' ? 'Sum' : 'Average'} of ${y.name}` : 'Total'}</small></span>
            </div>
            <ul className="chart-legend">{data.map(d => <li key={d.key}><i style={{ background: d.color }} />{d.label}<b>{fmt(d.v)}</b></li>)}</ul>
          </div>
        ) : chart.type === 'hbar' ? (
          <div className="chart-hbars">{data.map(d => (
            <div key={d.key} className="chart-hrow"><span className="chart-label" title={d.label}>{d.label}</span>
              <span className="chart-track"><i style={{ width: `${(d.v / max) * 100}%`, background: d.color }} /></span><b>{fmt(d.v)}</b></div>
          ))}</div>
        ) : (
          <div className="chart-plot">
            <div className="chart-area">
              {chart.type === 'line'
                ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="chart-line">
                    <polyline vectorEffect="non-scaling-stroke" points={data.map((d, i) => `${((i + 0.5) / data.length) * 100},${100 - (d.v / max) * 100}`).join(' ')} />
                  </svg>
                : null}
              {data.map(d => (
                <div key={d.key} className="chart-col">
                  <b style={{ bottom: `${(d.v / max) * 100}%` }}>{fmt(d.v)}</b>
                  {chart.type === 'bar' ? <i style={{ height: `${(d.v / max) * 100}%`, background: d.color }} /> : <em style={{ bottom: `${(d.v / max) * 100}%` }} />}
                </div>
              ))}
            </div>
            <div className="chart-x">{data.map(d => <span key={d.key} title={d.label}>{d.label}</span>)}</div>
          </div>
        )}
    </div>
  )
}
