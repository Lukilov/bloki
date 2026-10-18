import { useEffect, useRef, useState } from 'react'
import { defaultProps } from '@blocknote/core'
import { createReactBlockSpec, createReactInlineContentSpec, createReactStyleSpec, useEditorChange } from '@blocknote/react'
import { AlarmClock, Bookmark, ChevronRight, Globe, Sigma } from 'lucide-react'
import { DatePicker } from './db/Cells'
import { ancestors, iconOf, label, useStore } from './store'
import { Database } from './Database'
import { Icon, IconPicker } from './IconPicker'
import { Popover, usePopover } from './ui'

/* ---------- Inline content ---------- */

function MentionChip({ id }: { id: string }) {
  const { byId, go } = useStore()
  const p = byId.get(id)
  return (
    <span className={'mention page-mention' + (!p || p.trashed ? ' gone' : '')} contentEditable={false} onClick={() => p && go(id)}>
      <span className="mention-icon">{p ? iconOf(p, 16) : '🔒'}</span><span className="mention-title">{p ? label(p) : 'No access'}</span>
    </span>
  )
}
export const Mention = createReactInlineContentSpec(
  { type: 'mention', propSchema: { pageId: { default: '' } }, content: 'none' },
  { render: ({ inlineContent }) => <MentionChip id={inlineContent.props.pageId} /> },
)

function PersonChip({ id }: { id: string }) {
  const { people } = useStore()
  return <span className="mention person" contentEditable={false}>@{people.get(id)?.name ?? 'Former member'}</span>
}
export const PersonMention = createReactInlineContentSpec(
  { type: 'person', propSchema: { userId: { default: '' } }, content: 'none' },
  { render: ({ inlineContent }) => <PersonChip id={inlineContent.props.userId} /> },
)

/** Settings → Preferences → Date format for @date mentions (set from the signed-in person's preferences). */
let mentionFormat: 'relative' | 'full' | 'iso' = 'relative'
export const setMentionDateFormat = (f?: 'relative' | 'full' | 'iso') => { mentionFormat = f ?? 'relative' }
export function formatMentionDate(iso: string): string {
  // A mention with a time shows it after the day: "Tomorrow 15:00".
  if (iso.length > 10) return `${formatMentionDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`
  const d = new Date(iso + 'T00:00')
  if (mentionFormat === 'iso') return iso.replace(/-/g, '/')
  const days = Math.round((d.getTime() - new Date(new Date().toDateString()).getTime()) / 864e5)
  const rel = mentionFormat === 'relative' ? (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : null) : null
  return rel ?? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}
// Notion's "Remind" choices; a date without a time reminds at 9:00 on the day.
const REMIND: [string, string, number][] = [['', 'None', 0], ['at', 'At time of event', 0], ['1d', '1 day before', 1], ['2d', '2 days before', 2], ['1w', '1 week before', 7]]
/** When a reminder fires, in this browser's time zone (stored as a timestamp so the server needs no zone). */
const remindAt = (date: string, remind: string) => {
  const r = REMIND.find(x => x[0] === remind)
  if (!r || !remind || !date) return ''
  const t = new Date(date.length > 10 ? date : date + 'T09:00')
  t.setDate(t.getDate() - r[2])
  return String(t.getTime())
}

function DateMentionView({ props, update, editable }: { props: { date: string; remind: string }; update: (p: Record<string, string>) => void; editable: boolean }) {
  const store = useStore()
  const [anchor, open, close] = usePopover()
  const set = (date: string, remind: string) => update({ date, remind, at: remindAt(date, remind), by: remind ? store.me?.user.id ?? '' : '' })
  return (
    <span className={'mention date-mention' + (props.remind ? ' has-reminder' : '')} contentEditable={false} onClick={e => editable && open(e.currentTarget)}>
      @{formatMentionDate(props.date)}{props.remind && <AlarmClock size={13} className="mention-alarm" aria-label="Reminder set" />}
      <Popover anchor={anchor} onClose={close} className="menu-pop" width={260}>
        <DatePicker value={props.date} onChange={v => v && set(v.start, props.remind)} />
        <label className="remind-row">Remind
          <select value={props.remind} onChange={e => set(props.date, e.target.value)}>{REMIND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
      </Popover>
    </span>
  )
}

export const DateMention = createReactInlineContentSpec(
  { type: 'date', propSchema: { date: { default: '' }, remind: { default: '' }, at: { default: '' }, by: { default: '' } }, content: 'none' },
  { render: ({ inlineContent, updateInlineContent, editor }) => <DateMentionView props={inlineContent.props} editable={editor.isEditable} update={p => updateInlineContent({ type: 'date', props: { ...inlineContent.props, ...p } } as never)} /> },
)

function InlineEquationView({ latex, update, editable }: { latex: string; update: (latex: string) => void; editable: boolean }) {
  const [anchor, open, close] = usePopover()
  const [draft, setDraft] = useState(latex)
  const ref = useRef<HTMLSpanElement>(null)
  // A new, empty equation opens its editor straight away, as in Notion.
  useEffect(() => { if (!latex && editable && ref.current) open(ref.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const done = () => { if (draft !== latex) update(draft); close() }
  return (
    <span ref={ref} className="inline-equation" contentEditable={false} onClick={e => { if (editable) { setDraft(latex); open(e.currentTarget) } }}>
      {latex ? <Tex latex={latex} display={false} /> : <span className="muted">New equation</span>}
      <Popover anchor={anchor} onClose={done} className="menu-pop equation-pop" width={320}>
        <div className="equation-editor inline">
          <textarea autoFocus value={draft} placeholder="E = mc^2" onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done() } if (e.key === 'Escape') close() }} />
          <button className="primary" onClick={done}>Done ↵</button>
        </div>
      </Popover>
    </span>
  )
}

/** Notion's inline equation: TeX inside a line of text. */
export const InlineEquation = createReactInlineContentSpec(
  { type: 'inlineEquation', propSchema: { latex: { default: '' } }, content: 'none' },
  { render: ({ inlineContent, updateInlineContent, editor }) => <InlineEquationView latex={inlineContent.props.latex} editable={editor.isEditable} update={latex => updateInlineContent({ type: 'inlineEquation', props: { latex } } as never)} /> },
)

/* ---------- Styles ---------- */

/** Text under discussion. Styles render outside React context, so highlighting is driven by CSS from the page. */
export const CommentMark = createReactStyleSpec(
  { type: 'comment', propSchema: 'string' },
  { render: ({ value, contentRef }) => <span className="comment-mark" data-thread={value} ref={contentRef} /> },
)

/* ---------- Blocks ---------- */

function CalloutIcon({ icon, onPick, editable }: { icon: string; onPick: (v: string) => void; editable: boolean }) {
  const [anchor, open, close] = usePopover()
  return (
    <>
      <button className="callout-icon" contentEditable={false} disabled={!editable} onClick={e => open(e.currentTarget)}><Icon value={icon} size={20} /></button>
      <Popover anchor={anchor} onClose={close} className="menu-pop" width={408}><IconPicker onPick={v => { onPick(v); close() }} /></Popover>
    </>
  )
}
export const Callout = createReactBlockSpec(
  { type: 'callout', propSchema: { icon: { default: '💡' }, backgroundColor: { default: 'gray_background' }, textColor: defaultProps.textColor }, content: 'inline' },
  {
    render: ({ block, editor, contentRef }) => (
      <div className="callout" data-bg={block.props.backgroundColor}>
        <CalloutIcon icon={block.props.icon} editable={editor.isEditable} onPick={icon => editor.updateBlock(block, { props: { icon } })} />
        <div className="callout-body" ref={contentRef} />
      </div>
    ),
  },
)

export const InlineDatabase = createReactBlockSpec(
  { type: 'database', propSchema: { dbId: { default: '' } }, content: 'none' },
  // Clicks inside the database stay there: the editor would otherwise select the whole block (Notion doesn't).
  { render: ({ block }) => <div className="inline-db" contentEditable={false} onMouseDown={e => e.stopPropagation()}><Database id={block.props.dbId} inline /></div> },
)

function PageLinkView({ id }: { id: string }) {
  const { byId, go } = useStore()
  const p = byId.get(id)
  return (
    <div className={'page-block' + (!p || p.trashed ? ' gone' : '')} contentEditable={false} onClick={() => p && go(id)}>
      <span className="page-block-icon">{p ? iconOf(p, 19) : '🔒'}</span>
      <span className="page-block-title">{p ? label(p) : 'No access'}</span>
    </div>
  )
}
/** A sub-page or "Link to page" block. */
export const PageLink = createReactBlockSpec(
  { type: 'page', propSchema: { pageId: { default: '' } }, content: 'none' },
  { render: ({ block }) => <PageLinkView id={block.props.pageId} /> },
)

function Toc({ editor }: { editor: { document: unknown[] } }) {
  const [, force] = useState(0)
  useEditorChange(() => force(n => n + 1), editor as never)
  const headings: { id: string; level: number; text: string }[] = []
  const walk = (blocks: unknown[]) => {
    for (const b of blocks as { id: string; type: string; props: { level?: number }; content?: { text?: string }[]; children?: unknown[] }[]) {
      if (b.type === 'heading') headings.push({ id: b.id, level: b.props.level ?? 1, text: (b.content ?? []).map(c => c.text ?? '').join('') })
      if (b.children?.length) walk(b.children)
    }
  }
  walk(editor.document)
  if (!headings.length) return <div className="toc muted" contentEditable={false}>Add headings to create a table of contents.</div>
  return (
    <div className="toc" contentEditable={false}>
      {headings.map(h => (
        <a key={h.id} className={'toc-item level-' + h.level} onClick={() => document.querySelector(`[data-id="${h.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          {h.text || 'Untitled'}
        </a>
      ))}
    </div>
  )
}
export const TableOfContents = createReactBlockSpec(
  { type: 'toc', propSchema: {}, content: 'none' },
  { render: ({ editor }) => <Toc editor={editor} /> },
)

function BreadcrumbView() {
  const store = useStore()
  const crumbs = ancestors(store.byId, store.current)
  return (
    <div className="breadcrumb-block" contentEditable={false}>
      {crumbs.map((c, i) => (
        <span key={c.id}>{i > 0 && <ChevronRight size={12} className="muted" />}<a onClick={() => store.go(c.id)}>{iconOf(c, 14)} {label(c)}</a></span>
      ))}
    </div>
  )
}
export const Breadcrumb = createReactBlockSpec(
  { type: 'breadcrumb', propSchema: {}, content: 'none' },
  { render: () => <BreadcrumbView /> },
)

/** Known providers render as embedded players; everything else becomes a bookmark card. */
export function embedUrl(raw: string): string | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' && u.searchParams.get('v')) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.searchParams.get('v')!)}`
  if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`
  if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video${u.pathname}`
  if (host === 'loom.com' && u.pathname.startsWith('/share/')) return `https://www.loom.com/embed/${u.pathname.slice(7)}`
  if (host === 'open.spotify.com') return `https://open.spotify.com/embed${u.pathname}`
  if (host === 'figma.com') return `https://www.figma.com/embed?embed_host=bloki&url=${encodeURIComponent(raw)}`
  if (host === 'google.com' && u.pathname.startsWith('/maps')) return `https://maps.google.com/maps?q=${encodeURIComponent(u.searchParams.get('q') ?? u.pathname.split('/')[3] ?? '')}&output=embed`
  if (host === 'codepen.io' && u.pathname.includes('/pen/')) return raw.replace('/pen/', '/embed/')
  return null
}

function EmbedView({ url, mode, setUrl, editable }: { url: string; mode: 'embed' | 'bookmark'; setUrl: (u: string) => void; editable: boolean }) {
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!url) input.current?.focus() }, [url])
  if (!url) {
    return (
      <div className="embed-empty" contentEditable={false}>
        {mode === 'embed' ? <Globe size={18} /> : <Bookmark size={18} />}
        {editable
          ? <form onSubmit={e => { e.preventDefault(); if (/^https:\/\//.test(draft)) setUrl(draft) }}>
              <input ref={input} placeholder={mode === 'embed' ? 'Paste in https://… (YouTube, Vimeo, Loom, Figma, Spotify, Maps, CodePen)' : 'Paste in https://…'} value={draft} onChange={e => setDraft(e.target.value)} />
              <button className="primary" disabled={!/^https:\/\//.test(draft)}>{mode === 'embed' ? 'Embed link' : 'Create bookmark'}</button>
            </form>
          : <span className="muted">{mode === 'embed' ? 'Embed' : 'Bookmark'}</span>}
      </div>
    )
  }
  const src = mode === 'embed' ? embedUrl(url) : null
  if (src) {
    return (
      <div className="embed" contentEditable={false}>
        <iframe src={src} title="Embedded content" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" allow="encrypted-media; picture-in-picture; fullscreen" loading="lazy" referrerPolicy="no-referrer" />
      </div>
    )
  }
  let host = url
  try { host = new URL(url).hostname } catch { /* keep raw */ }
  return (
    <a className="bookmark" contentEditable={false} href={url} target="_blank" rel="noreferrer noopener">
      <span className="bookmark-text">
        <span className="bookmark-title">{host}</span>
        <span className="bookmark-url muted small"><img src={`https://${host}/favicon.ico`} alt="" width={14} height={14} referrerPolicy="no-referrer" onError={e => (e.currentTarget.style.display = 'none')} /> {url}</span>
      </span>
    </a>
  )
}
export const Embed = createReactBlockSpec(
  { type: 'embed', propSchema: { url: { default: '' }, mode: { default: 'embed', values: ['embed', 'bookmark'] as const } }, content: 'none' },
  { render: ({ block, editor }) => <EmbedView url={block.props.url} mode={block.props.mode} editable={editor.isEditable} setUrl={url => editor.updateBlock(block, { props: { url } })} /> },
)

let katex: Promise<typeof import('katex')> | null = null
const loadKatex = () => (katex ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([k]) => k))

export function Tex({ latex, display }: { latex: string; display: boolean }) {
  const [html, setHtml] = useState('')
  useEffect(() => {
    let live = true
    // KaTeX output is generated markup with trust disabled, so user input can't inject HTML.
    loadKatex().then(k => live && setHtml(k.default.renderToString(latex || '\\text{}', { displayMode: display, throwOnError: false, trust: false })))
    return () => { live = false }
  }, [latex, display])
  return <span className={display ? 'tex block' : 'tex'} dangerouslySetInnerHTML={{ __html: html }} />
}

function EquationView({ latex, setLatex, editable }: { latex: string; setLatex: (s: string) => void; editable: boolean }) {
  const [editing, setEditing] = useState(!latex && editable)
  const [draft, setDraft] = useState(latex)
  return (
    <div className="equation" contentEditable={false} onClick={() => editable && setEditing(true)}>
      {latex ? <Tex latex={latex} display /> : <span className="muted"><Sigma size={16} /> Add a TeX equation</span>}
      {editing && (
        <div className="equation-editor" onClick={e => e.stopPropagation()}>
          <textarea autoFocus value={draft} placeholder="E = mc^2" onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); setLatex(draft); setEditing(false) } if (e.key === 'Escape') setEditing(false) }} />
          <button className="primary" onClick={() => { setLatex(draft); setEditing(false) }}>Done ↵</button>
        </div>
      )}
    </div>
  )
}
export const Equation = createReactBlockSpec(
  { type: 'equation', propSchema: { latex: { default: '' } }, content: 'none' },
  { render: ({ block, editor }) => <EquationView latex={block.props.latex} editable={editor.isEditable} setLatex={latex => editor.updateBlock(block, { props: { latex } })} /> },
)
