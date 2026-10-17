/** Reading a Notion export (Settings → Export → Markdown & CSV): the ZIP, and the page tree inside it. */
import { parseCSV } from './db/model.ts'

/** Files in a ZIP by path; ZIPs inside it (Notion wraps big exports in parts) are opened too.
 *  ponytail: no ZIP64, so a single export over 4 GB won't open; split the export in Notion if that happens. */
export async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf), out = new Map<string, Uint8Array>()
  let end = buf.byteLength - 22
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('This is not a ZIP file.')
  let p = v.getUint32(end + 16, true)
  for (let i = v.getUint16(end + 10, true); i > 0; i--) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), off = v.getUint32(p + 42, true)
    const nameLen = v.getUint16(p + 28, true)
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen))
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue
    const raw = new Uint8Array(buf, off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), size)
    if (method !== 0 && method !== 8) throw new Error(`Can't read ${name} (unknown compression).`)
    const data = method === 0 ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
    if (name.toLowerCase().endsWith('.zip')) for (const [k, d] of await unzip(data.slice().buffer)) out.set(k, d)
    else out.set(name, data)
  }
  return out
}

export type NotionNode = {
  kind: 'page' | 'db'
  title: string
  path: string // the .md/.csv file; links and images in it are relative to its folder
  md?: string // page text without the title (and, for rows, without the property lines)
  head?: string[] // database columns; the first is the name
  cells?: string[] // a row's values for head[1..]
  children: NotionNode[] // sub-pages, or a database's rows
}

// Notion names files "Title 1a2b…(32 hex)"; older exports have no id.
const bare = (file: string) => file.replace(/\.(md|csv)$/, '').replace(/_all$/, '').replace(/ [0-9a-f]{32}$/, '')

function splitMd(src: string, fallback: string, props: string[] = []) {
  const lines = src.replace(/^﻿/, '').split('\n')
  const title = lines[0]?.startsWith('# ') ? lines.shift()!.slice(2).trim() : fallback
  while (lines[0]?.trim() === '') lines.shift()
  // A row page lists its properties as "Name: value" lines under the title.
  if (props.length) while (lines.length && props.some(n => lines[0].startsWith(n + ': '))) lines.shift()
  return { title, md: lines.join('\n').trim() }
}

export function planNotion(files: Map<string, Uint8Array>): NotionNode[] {
  const paths = [...files.keys()]
  const text = (p: string) => new TextDecoder().decode(files.get(p))
  const inDir = (dir: string) => paths.filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
  const walk = (dir: string): NotionNode[] => {
    const owned = new Set<string>(), nodes: NotionNode[] = []
    for (const path of inDir(dir)) {
      const name = path.slice(dir.length)
      if (path.endsWith('.md')) {
        const folder = path.slice(0, -3) + '/'
        owned.add(folder)
        nodes.push({ kind: 'page', path, ...splitMd(text(path), bare(name)), children: walk(folder) })
      } else if (path.endsWith('.csv')) {
        // "X.csv" is the view you exported from, "X_all.csv" every row; take the second when both are there.
        if (!path.endsWith('_all.csv') && files.has(path.slice(0, -4) + '_all.csv')) continue
        const folder = path.slice(0, -4).replace(/_all$/, '') + '/'
        owned.add(folder)
        const [head = ['Name'], ...rows] = parseCSV(text(path).replace(/^﻿/, '')).filter(r => r.some(c => c !== ''))
        const pages = inDir(folder).filter(p => p.endsWith('.md')).map(p => ({ p, ...splitMd(text(p), bare(p.slice(folder.length)), head.slice(1)) }))
        const rowNode = (title: string, cells: string[]): NotionNode => {
          const i = pages.findIndex(x => x.title === title)
          const pg = i < 0 ? undefined : pages.splice(i, 1)[0]
          return { kind: 'page', title, cells, path: pg?.p ?? path, md: pg?.md, children: pg ? walk(pg.p.slice(0, -3) + '/') : [] }
        }
        const children = rows.map(r => rowNode(r[0] ?? '', r.slice(1)))
        while (pages.length) children.push(rowNode(pages[0].title, []))
        nodes.push({ kind: 'db', title: bare(name), path, head, children })
      }
    }
    // Folders nobody owns (the export's own top folder) just hold more pages.
    const dirs = new Set(paths.filter(p => p.startsWith(dir) && p.slice(dir.length).includes('/')).map(p => dir + p.slice(dir.length).split('/')[0] + '/'))
    for (const d of dirs) if (!owned.has(d)) nodes.push(...walk(d))
    return nodes
  }
  return walk('')
}

/** A link or image path in a Notion .md file, as a path in the ZIP. */
export function resolve(from: string, href: string) {
  let target: string
  try { target = decodeURIComponent(href) } catch { target = href }
  const parts = from.split('/').slice(0, -1)
  for (const seg of target.split('/')) seg === '..' ? parts.pop() : seg !== '.' && parts.push(seg)
  return parts.join('/')
}

const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
type Column = { type: 'text' | 'number' | 'date' | 'checkbox' | 'url' | 'email' | 'select' | 'multi_select'; options?: { id: string; name: string; color: string }[]; convert: (v: string) => unknown }

/** Notion's CSV has only text; guess each column's type from its values, as Notion does on import. */
export function inferColumn(values: string[], newId: () => string): Column {
  const vals = values.map(v => v.trim()).filter(Boolean)
  const all = (re: RegExp) => vals.length > 0 && vals.every(v => re.test(v))
  const day = (v: string) => { const t = Date.parse(v.replace(/\s*\(.*\)$/, '')); return Number.isNaN(t) ? null : new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
  if (all(/^-?[\d,]*\.?\d+%?$/) && vals.some(v => /\d/.test(v))) return { type: 'number', convert: v => (v.trim() ? Number(v.replace(/[,%]/g, '')) : null) }
  if (all(/^(Yes|No)$/i)) return { type: 'checkbox', convert: v => /^yes$/i.test(v.trim()) }
  if (all(/^https?:\/\/\S+$/)) return { type: 'url', convert: v => v.trim() }
  if (all(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return { type: 'email', convert: v => v.trim() }
  // Dates: "October 17, 2026", "2026/10/17 3:00 PM", ranges "A → B".
  if (all(/\d{4}/) && vals.every(v => v.split(' → ').every(d => day(d)))) return { type: 'date', convert: v => { if (!v.trim()) return null; const [a, b] = v.split(' → '); return b ? { start: day(a), end: day(b) } : { start: day(a) } } }
  // A short list of repeated values is a select; comma-separated ones a multi-select.
  const multi = vals.some(v => v.includes(', '))
  const items = vals.flatMap(v => (multi ? v.split(', ') : [v])).map(x => x.trim())
  const names = [...new Set(items)]
  if (vals.length >= 2 && names.length <= 30 && names.length < items.length && names.every(n => n.length <= 60)) {
    const options = names.map((name, i) => ({ id: newId(), name, color: COLORS[i % COLORS.length] }))
    const idOf = (n: string) => options.find(o => o.name === n.trim())?.id
    return multi
      ? { type: 'multi_select', options, convert: v => v.split(', ').map(idOf).filter(Boolean) }
      : { type: 'select', options, convert: v => idOf(v) ?? null }
  }
  return { type: 'text', convert: v => v }
}
