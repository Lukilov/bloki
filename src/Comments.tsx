import { useRef, useState, type ReactNode } from 'react'
import { ArrowUp, AtSign, Check, Paperclip, FileText, Link2, ListFilter, MessageSquare, MoreHorizontal, PenLine, RotateCcw, SmilePlus, Trash2, X } from 'lucide-react'
import { IconPicker } from './IconPicker'
import { api, can, type Comment, type Page } from './api'
import { useStore } from './store'
import { copyText, Menu, Popover, timeAgo, usePopover } from './ui'
import { pageUrl } from './pageActions'

export type Thread = { root: Comment; replies: Comment[] }
export const threads = (all: Comment[]): Thread[] =>
  all.filter(c => !c.thread_id).map(root => ({ root, replies: all.filter(c => c.thread_id === root.id) }))

export const Avatar = ({ name, size = 22 }: { name?: string | null; size?: number }) => (
  <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.5 }}>{(name ?? '?')[0]?.toUpperCase()}</span>
)

/** Notion's comment box: avatar, text, then attach, @-mention and send. Mentions are sent as user ids so the server can notify them. */
function Composer({ placeholder, onSend, autoFocus, initial = '', onCancel, tools = true }: { placeholder: string; onSend: (text: string, mentions: string[]) => Promise<void>; autoFocus?: boolean; initial?: string; onCancel?: () => void; tools?: boolean }) {
  const store = useStore()
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [mentions, setMentions] = useState<string[]>([])
  const [at, openAt, closeAt] = usePopover()
  const box = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const add = (s: string) => { setText(t => (t && !t.endsWith(' ') ? t + ' ' : t) + s + ' '); box.current?.focus() }
  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    // Only people whose @Name is still in the text count as mentioned.
    const named = mentions.filter(id => text.includes('@' + (store.people.get(id)?.name ?? '\0')))
    try { await onSend(text.trim(), named); setText(''); setMentions([]) } catch (e) { store.setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="composer">
      <Avatar name={store.me?.user.name} size={24} />
      <textarea ref={box} rows={1} autoFocus={autoFocus} placeholder={placeholder} value={text}
        onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          if (e.key === 'Escape') onCancel?.()
        }} />
      {tools && <>
        <button className="ghost composer-tool" title="Attach file" disabled={busy} onClick={() => file.current?.click()}><Paperclip size={16} /></button>
        <input ref={file} type="file" hidden onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (!f) return
          setBusy(true)
          try { add(`📎 ${f.name} ${location.origin}${await api.upload(f)}`) } catch (err) { store.setError((err as Error).message) } finally { setBusy(false) }
        }} />
        <button className="ghost composer-tool" title="Mention a person" onClick={e => openAt(e.currentTarget)}><AtSign size={16} /></button>
        <Popover anchor={at} onClose={closeAt} className="menu-pop" width={240}>
          <Menu filter onClose={closeAt} items={[...store.people.values()].map(p => ({ icon: <Avatar name={p.name} size={20} />, label: p.name, onClick: () => { add('@' + p.name); setMentions(m => [...new Set([...m, p.id])]) } }))} />
        </Popover>
      </>}
      <button className={'send' + (text.trim() ? ' ready' : '')} disabled={!text.trim() || busy} title="Send" onClick={send}><ArrowUp size={12} strokeWidth={2.5} /></button>
    </div>
  )
}

/** Comment text with links clickable and @mentions of known people highlighted. */
function Body({ text }: { text: string }) {
  const store = useStore()
  const names = [...store.people.values()].map(p => p.name).filter(Boolean).sort((a, b) => b.length - a.length)
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(https?://[^\\s]+${names.length ? '|' + names.map(n => '@' + esc(n)).join('|') : ''})`, 'g')
  return <>{text.split(re).map((part, i) => (i % 2
    ? part.startsWith('@') ? <span key={i} className="comment-mention">{part}</span> : <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>
    : part))}</>
}

function CommentRow({ c, page, isRoot, setAll, quote }: { c: Comment; page: Page; isRoot: boolean; setAll: (c: Comment[]) => void; quote?: ReactNode }) {
  const store = useStore()
  const [menu, open, close] = usePopover()
  const [react, openReact, closeReact] = usePopover()
  const [editing, setEditing] = useState(false)
  const mine = c.user_id === store.me?.user.id
  const run = (p: Promise<Comment[]>) => p.then(setAll).catch(e => store.setError(e.message))
  return (
    <div className="comment">
      <div className="comment-head">
        <Avatar name={c.name} size={24} />
        <b>{c.name}</b>
        <span className="muted small">{timeAgo(c.created).replace(/ ago$/, '')}</span>
        <span className="comment-actions">
          {can(page, 'comment') && <button className="ghost" title="Add reaction" onClick={e => openReact(e.currentTarget)}><SmilePlus size={14} /></button>}
          {isRoot && can(page, 'comment') && (
            <button className="ghost" title={c.resolved ? 'Re-open' : 'Resolve'} onClick={() => run(api.updateComment(c.id, { resolved: !c.resolved }))}>
              {c.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
            </button>
          )}
          <button className="ghost" title="More actions" onClick={e => open(e.currentTarget)}><MoreHorizontal size={14} /></button>
        </span>
      </div>
      <Popover anchor={menu} onClose={close} className="menu-pop" width={220} align="end">
        <Menu onClose={close} items={[
          ...(mine ? [{ icon: <PenLine size={16} />, label: 'Edit comment', onClick: () => setEditing(true) }] : []),
          { icon: <Link2 size={16} />, label: 'Copy link to comment', onClick: () => { copyText(pageUrl(page.id)); store.toast('Copied link to clipboard') } },
          ...(mine || can(page, 'full') ? [{ icon: <Trash2 size={16} />, label: isRoot ? 'Delete discussion' : 'Delete comment', danger: true, onClick: () => run(api.updateComment(c.id, { delete: true })) }] : []),
        ]} />
      </Popover>
      <Popover anchor={react} onClose={closeReact} className="menu-pop" width={408}>
        <IconPicker emojiOnly onPick={v => { closeReact(); run(api.updateComment(c.id, { react: v })) }} />
      </Popover>
      {quote && <div className="discussion-quote">{quote}</div>}
      {editing
        ? <Composer autoFocus tools={false} placeholder="Edit comment…" initial={c.body} onCancel={() => setEditing(false)} onSend={async t => { setAll(await api.updateComment(c.id, { body: t })); setEditing(false) }} />
        : <div className="comment-body"><Body text={c.body} /></div>}
      {/* Reactions as in Notion: a pill per emoji with its count, highlighted when it includes you. */}
      {Object.keys(c.reactions ?? {}).length > 0 && (
        <div className="reactions">
          {Object.entries(c.reactions!).map(([e, who]) => (
            <button key={e} className={'reaction' + (who.includes(store.me?.user.id ?? '') ? ' mine' : '')} disabled={!can(page, 'comment')}
              title={who.map(id => store.people.get(id)?.name ?? 'Someone').join(', ')} onClick={() => run(api.updateComment(c.id, { react: e }))}>{e} {who.length}</button>
          ))}
          {can(page, 'comment') && <button className="reaction add" title="Add reaction" onClick={ev => openReact(ev.currentTarget)}><SmilePlus size={14} /></button>}
        </div>
      )}
    </div>
  )
}

export function Discussion({ t, page, setAll, compact, noReply, quote }: { t: Thread; page: Page; setAll: (c: Comment[]) => void; compact?: boolean; noReply?: boolean; quote?: ReactNode }) {
  const [replying, setReplying] = useState(!compact)
  return (
    <div className={'discussion' + (t.root.resolved ? ' resolved' : '')}>
      <CommentRow c={t.root} page={page} isRoot setAll={setAll} quote={quote ?? t.root.quote} />
      {t.replies.map(r => <CommentRow key={r.id} c={r} page={page} isRoot={false} setAll={setAll} />)}
      {can(page, 'comment') && !t.root.resolved && !noReply && (replying
        ? <Composer placeholder="Reply…" onSend={async (text, mentions) => setAll(await api.addComment(page.id, text, { thread_id: t.root.id, mentions }))} />
        : <button className="ghost reply-btn" onClick={() => setReplying(true)}>Reply…</button>)}
    </div>
  )
}

/** Discussions shown under the page title (comments not tied to text). */
export function PageDiscussions({ page, all, setAll, composing, setComposing }: { page: Page; all: Comment[]; setAll: (c: Comment[]) => void; composing: boolean; setComposing: (b: boolean) => void }) {
  const open = threads(all).filter(t => !t.root.block_id && !t.root.resolved)
  // Like Notion, the composer stays under page comments once there are any.
  if (!open.length && !composing) return null
  return (
    <div className="page-discussions">
      {open.map(t => <Discussion key={t.root.id} t={t} page={page} setAll={setAll} compact noReply />)}
      {can(page, 'comment') && (
        <Composer autoFocus={composing} placeholder="Add a comment…" onCancel={() => setComposing(false)}
          onSend={async (text, mentions) => setAll(await api.addComment(page.id, text, { mentions }))} />
      )}
    </div>
  )
}

/** Notion's Comments button opens this: open discussions in short rows, then "See all" for the panel. */
export function DiscussionsPopover({ all, seeAll }: { all: Comment[]; seeAll: () => void }) {
  const list = threads(all).filter(t => !t.root.resolved).reverse()
  return (
    <div className="discussions-pop">
      <div className="discussions-head">Discussions</div>
      {list.length ? list.slice(0, 8).map(t => (
        <button key={t.root.id} className="discussion-line" onClick={seeAll}>
          <Avatar name={t.root.name} size={24} /><b>{t.root.name}</b><span>{t.root.body}</span>
        </button>
      )) : <div className="discussions-empty">No open comments on this page</div>}
      <div className="menu-divider" />
      <button className="discussions-all" onClick={seeAll}>See all</button>
    </div>
  )
}

/** Right-hand panel with every discussion on the page, as Notion's comment sidebar. */
export function CommentsPanel({ page, all, setAll, close, draft, clearDraft }: {
  page: Page; all: Comment[]; setAll: (c: Comment[]) => void; close: () => void
  draft: { blockId: string; quote: string; id: string } | null; clearDraft: () => void
}) {
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const [filter, openFilter, closeFilter] = usePopover()
  const list = threads(all).filter(t => (tab === 'open' ? !t.root.resolved : t.root.resolved)).reverse()
  // Notion groups discussions under day headings and quotes the page for page-level comments.
  const day = (t: number) => { const d = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 864e5); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : new Date(t).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) }
  const pageQuote = <><FileText size={14} /> {page.title || 'Untitled'}</>
  return (
    <aside className="right-panel">
      <div className="panel-head">
        <b>{tab === 'open' ? 'All discussions' : 'Resolved discussions'}</b>
        <span className="panel-tools">
          <button className={'ghost' + (tab === 'resolved' ? ' on' : '')} title="Filter" onClick={e => openFilter(e.currentTarget)}><ListFilter size={16} /></button>
          <button className="ghost" title="Close" onClick={close}><X size={16} /></button>
        </span>
      </div>
      <Popover anchor={filter} onClose={closeFilter} className="menu-pop" width={200} align="end">
        <Menu onClose={closeFilter} items={[
          { label: 'Open', checked: tab === 'open', onClick: () => setTab('open') },
          { label: 'Resolved', checked: tab === 'resolved', onClick: () => setTab('resolved') },
        ]} />
      </Popover>
      {draft && (
        <div className="discussion">
          <div className="discussion-quote">{draft.quote}</div>
          <Composer autoFocus placeholder="Add a comment…" onCancel={clearDraft}
            onSend={async (text, mentions) => { setAll(await api.addComment(page.id, text, { block_id: draft.blockId, quote: draft.quote, id: draft.id, mentions })); clearDraft() }} />
        </div>
      )}
      {!list.length && !draft && (
        <div className="inbox-empty"><MessageSquare size={32} strokeWidth={1.2} />
          <div>{tab === 'open' ? 'No open comments yet' : 'No resolved comments'}</div>
          <div className="muted small">Open comments on this page will appear here</div></div>
      )}
      {list.map((t, i) => (
        <div key={t.root.id}>
          {(i === 0 || day(list[i - 1].root.created) !== day(t.root.created)) && <div className="panel-group">{day(t.root.created)}</div>}
          <Discussion t={t} page={page} setAll={setAll} quote={t.root.block_id ? undefined : pageQuote} />
        </div>
      ))}
    </aside>
  )
}
