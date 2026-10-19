/** Imports from other apps, as plans the app then creates: databases (Trello, Asana) and page trees (Evernote, Confluence). */
import { parseCSV } from './db/model.ts'
import { inferColumn } from './notionZip.ts'

export type PlanProp = { id: string; name: string; type: 'text' | 'number' | 'date' | 'checkbox' | 'url' | 'email' | 'select' | 'multi_select'; options?: { id: string; name: string; color: string }[] }
export type DbPlan = { title: string; props: PlanProp[]; rows: { title: string; props: Record<string, unknown>; md: string }[] }
export type PagePlan = { title: string; html: string; children: PagePlan[] }

const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
// Trello's label colours, as close as Bloki's palette gets.
const TRELLO: Record<string, string> = { green: 'green', yellow: 'yellow', orange: 'orange', red: 'red', purple: 'purple', blue: 'blue', sky: 'blue', lime: 'green', pink: 'pink', black: 'gray' }

type TrelloBoard = {
  name?: string
  lists?: { id: string; name: string; closed?: boolean }[]
  labels?: { id: string; name?: string; color?: string }[]
  cards?: { id: string; name: string; desc?: string; idList: string; due?: string | null; closed?: boolean; idLabels?: string[] }[]
  checklists?: { idCard: string; name: string; checkItems?: { name: string; state: string }[] }[]
}

/** A Trello board's JSON export (Menu → Print, export and share → Export as JSON): a database with List, Labels and Due. */
export function planTrello(board: TrelloBoard, newId: () => string): DbPlan {
  const lists = (board.lists ?? []).filter(l => !l.closed)
  const list: PlanProp = { id: newId(), name: 'List', type: 'select', options: lists.map((l, i) => ({ id: newId(), name: l.name, color: COLORS[i % COLORS.length] })) }
  const labels: PlanProp = { id: newId(), name: 'Labels', type: 'multi_select', options: (board.labels ?? []).map(l => ({ id: l.id, name: l.name || l.color || 'Label', color: TRELLO[l.color ?? ''] ?? 'gray' })) }
  const due: PlanProp = { id: newId(), name: 'Due', type: 'date' }
  const optFor = new Map(lists.map((l, i) => [l.id, list.options![i].id]))
  const rows = (board.cards ?? []).filter(c => !c.closed && optFor.has(c.idList)).map(c => {
    const checks = (board.checklists ?? []).filter(k => k.idCard === c.id)
      .map(k => `### ${k.name}\n\n${(k.checkItems ?? []).map(i => `- [${i.state === 'complete' ? 'x' : ' '}] ${i.name}`).join('\n')}`)
    return {
      title: c.name,
      props: { [list.id]: optFor.get(c.idList), [labels.id]: (c.idLabels ?? []).filter(id => labels.options!.some(o => o.id === id)), ...(c.due ? { [due.id]: { start: c.due.slice(0, 10) } } : {}) },
      md: [c.desc ?? '', ...checks].filter(Boolean).join('\n\n'),
    }
  })
  return { title: board.name || 'Trello board', props: [list, labels, due], rows }
}

/** An Asana project's CSV export: Name becomes the page name, Notes its text, the rest typed columns, plus Done. */
export function planAsana(csv: string, title: string, newId: () => string): DbPlan {
  const [head = [], ...rows] = parseCSV(csv.replace(/^﻿/, '')).filter(r => r.some(c => c !== ''))
  const at = (n: string) => head.indexOf(n)
  const name = at('Name'), notes = at('Notes'), completed = at('Completed At')
  const skip = new Set([name, notes, at('Task ID'), at('Last Modified'), at('Parent task')])
  const cols = head.map((h, i) => (skip.has(i) ? null : { i, h, c: inferColumn(rows.map(r => r[i] ?? ''), newId) })).filter((x): x is NonNullable<typeof x> => !!x)
  const props: PlanProp[] = cols.map(({ h, c }) => ({ id: newId(), name: h, type: c.type, ...(c.options ? { options: c.options } : {}) }))
  const done: PlanProp = { id: newId(), name: 'Done', type: 'checkbox' }
  return {
    title,
    props: [...props, ...(completed >= 0 ? [done] : [])],
    rows: rows.map(r => ({
      title: r[name] ?? '',
      props: { ...Object.fromEntries(cols.map(({ i, c }, k) => [props[k].id, c.convert(r[i] ?? '')])), ...(completed >= 0 ? { [done.id]: !!r[completed]?.trim() } : {}) },
      md: notes >= 0 ? r[notes] ?? '' : '',
    })),
  }
}

/** Evernote's .enex export: one page per note (its ENML body is XHTML), tags noted at the top. */
export function planEvernote(xml: string, parse: (s: string, type: DOMParserSupportedType) => Document): PagePlan[] {
  const doc = parse(xml, 'text/xml')
  return [...doc.querySelectorAll('note')].map(n => {
    const body = parse(n.querySelector('content')?.textContent ?? '', 'text/html').querySelector('en-note, body')
    const tags = [...n.querySelectorAll('tag')].map(t => t.textContent ?? '').filter(Boolean)
    return { title: n.querySelector('title')?.textContent ?? 'Untitled', html: (tags.length ? `<p><em>Tags: ${tags.map(esc).join(', ')}</em></p>` : '') + (body?.innerHTML ?? ''), children: [] }
  })
}

/** Confluence's HTML space export (zip): the page tree from index.html's nested lists, each page's main content. */
export function planConfluence(files: Map<string, Uint8Array>, parse: (s: string, type: DOMParserSupportedType) => Document): PagePlan[] {
  const text = (p: string) => new TextDecoder().decode(files.get(p))
  const index = [...files.keys()].find(p => /(^|\/)index\.html$/.test(p))
  if (!index) return []
  const dir = index.slice(0, index.lastIndexOf('/') + 1)
  const page = (href: string): PagePlan | null => {
    const path = dir + decodeURIComponent(href.split('#')[0])
    if (!files.has(path)) return null
    const d = parse(text(path), 'text/html')
    const main = d.querySelector('#main-content, .wiki-content, #content') ?? d.body
    for (const junk of main.querySelectorAll('script, style, #breadcrumb-section, .pageSection.group, #footer')) junk.remove()
    const title = (d.querySelector('#title-text')?.textContent ?? d.title ?? '').replace(/^.*?:\s*/, '').trim() || 'Untitled'
    return { title, html: main.innerHTML, children: [] }
  }
  const walk = (ul: Element | null): PagePlan[] => ul ? [...ul.children].filter(li => li.tagName === 'LI').flatMap(li => {
    const a = li.querySelector(':scope > a')
    const p = a ? page(a.getAttribute('href') ?? '') : null
    if (!p) return walk(li.querySelector(':scope > ul'))
    p.children = walk(li.querySelector(':scope > ul'))
    return [p]
  }) : []
  const d = parse(text(index), 'text/html')
  const top = d.querySelector('.pageSection ul, #main-content ul, ul')
  return walk(top)
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
