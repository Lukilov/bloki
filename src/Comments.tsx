import { useState } from 'react'
import { ArrowUp, Check, Link2, MessageSquare, MoreHorizontal, PenLine, RotateCcw, Trash2, X } from 'lucide-react'
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

function Composer({ placeholder, onSend, autoFocus, initial = '', onCancel }: { placeholder: string; onSend: (text: string) => Promise<void>; autoFocus?: boolean; initial?: string; onCancel?: () => void }) {
  const store = useStore()
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try { await onSend(text.trim()); setText('') } catch (e) { store.setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="composer">
      <Avatar name={store.me?.user.name} size={24} />
      <textarea rows={1} autoFocus={autoFocus} placeholder={placeholder} value={text}
        onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          if (e.key === 'Escape') onCancel?.()
        }} />
      <button className={'send' + (text.trim() ? ' ready' : '')} disabled={!text.trim() || busy} title="Send" onClick={send}><ArrowUp size={12} strokeWidth={2.5} /></button>
    </div>
  )
}

function CommentRow({ c, page, isRoot, setAll }: { c: Comment; page: Page; isRoot: boolean; setAll: (c: Comment[]) => void }) {
  const store = useStore()
  const [menu, open, close] = usePopover()
  const [editing, setEditing] = useState(false)
  const mine = c.user_id === store.me?.user.id
  const run = (p: Promise<Comment[]>) => p.then(setAll).catch(e => store.setError(e.message))
  return (
    <div className="comment">
      <div className="comment-head">
        <Avatar name={c.name} size={24} />
        <b>{c.name}</b>
        <span className="muted small">{timeAgo(c.created)}</span>
        <span className="comment-actions">
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
      {editing
        ? <Composer autoFocus placeholder="Edit comment…" initial={c.body} onCancel={() => setEditing(false)} onSend={async t => { setAll(await api.updateComment(c.id, { body: t })); setEditing(false) }} />
        : <div className="comment-body">{c.body}</div>}
    </div>
  )
}

export function Discussion({ t, page, setAll, compact, noReply }: { t: Thread; page: Page; setAll: (c: Comment[]) => void; compact?: boolean; noReply?: boolean }) {
  const [replying, setReplying] = useState(!compact)
  return (
    <div className={'discussion' + (t.root.resolved ? ' resolved' : '')}>
      {t.root.quote && <div className="discussion-quote">{t.root.quote}</div>}
      <CommentRow c={t.root} page={page} isRoot setAll={setAll} />
      {t.replies.map(r => <CommentRow key={r.id} c={r} page={page} isRoot={false} setAll={setAll} />)}
      {can(page, 'comment') && !t.root.resolved && !noReply && (replying
        ? <Composer placeholder="Reply…" onSend={async text => setAll(await api.addComment(page.id, text, { thread_id: t.root.id }))} />
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
          onSend={async text => setAll(await api.addComment(page.id, text))} />
      )}
    </div>
  )
}

/** Right-hand panel with every discussion on the page, as Notion's comment sidebar. */
export function CommentsPanel({ page, all, setAll, close, draft, clearDraft }: {
  page: Page; all: Comment[]; setAll: (c: Comment[]) => void; close: () => void
  draft: { blockId: string; quote: string; id: string } | null; clearDraft: () => void
}) {
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const list = threads(all).filter(t => (tab === 'open' ? !t.root.resolved : t.root.resolved)).reverse()
  return (
    <aside className="right-panel">
      <div className="panel-head">
        <b>Comments</b>
        <span className="panel-tools">
          <select value={tab} onChange={e => setTab(e.target.value as 'open')}><option value="open">Open</option><option value="resolved">Resolved</option></select>
          <button className="ghost" title="Close" onClick={close}><X size={16} /></button>
        </span>
      </div>
      {draft && (
        <div className="discussion">
          <div className="discussion-quote">{draft.quote}</div>
          <Composer autoFocus placeholder="Add a comment…" onCancel={clearDraft}
            onSend={async text => { setAll(await api.addComment(page.id, text, { block_id: draft.blockId, quote: draft.quote, id: draft.id })); clearDraft() }} />
        </div>
      )}
      {!list.length && !draft && (
        <div className="inbox-empty"><MessageSquare size={32} strokeWidth={1.2} />
          <div>{tab === 'open' ? 'No open comments yet' : 'No resolved comments'}</div>
          <div className="muted small">Open comments on this page will appear here</div></div>
      )}
      {list.map(t => <Discussion key={t.root.id} t={t} page={page} setAll={setAll} compact />)}
    </aside>
  )
}
