import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Bell, ChevronDown, Download, FileArchive, FileCode, FileText, Globe, Link2, LogOut, Plug, Plus, ScrollText, Server, Settings, SlidersHorizontal, Table2, UserPlus, Users, WifiOff, X } from 'lucide-react'

/** Present when running inside the Bloki desktop app. */
const desktopApp = (window as { blokiDesktop?: { platform: string; changeServer: () => void; offline?: { mine: () => Promise<{ id: string; title: string; icon: string; saved: number }[]>; set: (id: string, on: boolean) => Promise<boolean> } } }).blokiDesktop
import { Menu, Popover, usePopover } from './ui'
import { api, ApiError, can, inviteLink, LEVEL_NAMES, publicLink, type Level, type Page, type Person, type Role, type Share, type ApiToken, type Webhook, type Group, type AuditEntry } from './api'
import { iconOf, label, useStore } from './store'

const ROLE_NAMES: Record<Role, string> = { owner: 'Workspace owner', member: 'Member', guest: 'Guest' }

function useAction() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    setError(''); setBusy(true)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return { error, busy, run }
}

/** Notion's "Copy link" button at the foot of the Share menu. */
function CopyLinkButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return <button className="share-copy" onClick={() => { navigator.clipboard?.writeText(text); setDone(true) }}><Link2 size={16} />{done ? 'Copied' : 'Copy link'}</button>
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="copy-row">
      <input readOnly value={text} onFocus={e => e.target.select()} />
      <button onClick={() => { navigator.clipboard?.writeText(text); setDone(true) }}>{done ? 'Copied' : 'Copy link'}</button>
    </div>
  )
}

/* ---------- Log in / sign up ---------- */

/** #/reset/<token>: the link from a password reset email. */
export function ResetScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const { error, busy, run } = useAction()
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={e => { e.preventDefault(); run(async () => { await api.resetPassword(token, password); setDone(true) }) }}>
        <div className="brand big">▤ Bloki</div>
        <h2>Choose a new password</h2>
        {done ? <>
          <p className="muted">Your password is changed. Log in with it on each of your devices.</p>
          <button type="button" className="primary" onClick={() => { location.hash = ''; onDone() }}>Log in</button>
        </> : <>
          <label>New password<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
          {error && <p className="danger">{error}</p>}
          <button className="primary" disabled={busy}>Set password</button>
        </>}
      </form>
    </div>
  )
}

/** `stay`: logging in from a shared form returns to that form instead of the start page. */
export function AuthScreen({ invite, onDone, stay }: { invite?: string; onDone: () => void; stay?: boolean }) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [hasUsers, setHasUsers] = useState(true)
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.inviteInfo>> | null>(null)
  const [form, setForm] = useState({ email: '', name: '', password: '', code: '' })
  const [needCode, setNeedCode] = useState(false)
  const [canMail, setCanMail] = useState(false)
  const [canSso, setCanSso] = useState<'oidc' | 'saml' | false>(false)
  // A failed single sign-on comes back as #/sso-error/<message>.
  const [ssoError] = useState(() => location.hash.startsWith('#/sso-error/') ? decodeURIComponent(location.hash.slice(12)) : '')
  const [sent, setSent] = useState(false)
  const { error, busy, run } = useAction()

  useEffect(() => {
    api.status().then(s => { setHasUsers(s.hasUsers); setCanMail(!!s.mail); setCanSso(s.sso || false); if (!s.hasUsers) setMode('register') })
    if (invite) api.inviteInfo(invite).then(i => { setInfo(i); setMode('register') }).catch(() => setInfo(null))
  }, [invite])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      let page: string | null = null
      if (mode === 'forgot') { await api.forgotPassword(form.email); setSent(true); return }
      if (mode === 'login') {
        // Accounts with two-step verification answer the first try with a request for the code.
        await api.login(form.email, form.password, needCode ? form.code : undefined).catch(e => { if (e instanceof ApiError && e.data.twoFactor) setNeedCode(true); throw e })
        if (invite) page = (await api.acceptInvite(invite)).page_id
      } else {
        page = (await api.register({ ...form, invite })).page_id
      }
      // Land on the page that was shared, like following a Notion invite.
      if (!stay) location.hash = page ? '/' + page : ''
      onDone()
    })
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))
  const canRegister = !hasUsers || !!invite

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand big">▤ Bloki</div>
        {info && <p className="muted">{info.inviter} invited you to {info.page ? <>the page <b>{info.page || 'Untitled'}</b> in </> : null}<b>{info.workspace}</b> as {info.page ? LEVEL_NAMES[info.level!] : ROLE_NAMES[info.role]}.</p>}
        {invite && !info && <p className="danger">This invite link is invalid or has expired.</p>}
        {!hasUsers && <p className="muted">Create the first account. You will own this workspace and everything already in it.</p>}
        <h2>{mode === 'login' ? 'Log in' : mode === 'forgot' ? 'Reset your password' : 'Create your account'}</h2>
        <label>Email<input type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></label>
        {mode === 'forgot' && <>
          {sent ? <p className="muted">If an account uses that email, a link to choose a new password is on its way.</p> : <button className="primary" disabled={busy}>Send reset link</button>}
          {error && <p className="danger">{error}</p>}
          <button type="button" className="ghost link" onClick={() => { setMode('login'); setSent(false) }}>Back to log in</button>
        </>}
        {mode !== 'forgot' && <>
        {mode === 'register' && <label>Name<input autoComplete="name" required value={form.name} onChange={set('name')} /></label>}
        <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : undefined} value={form.password} onChange={set('password')} /></label>
        {mode === 'login' && canMail && <button type="button" className="ghost link forgot-link" onClick={() => setMode('forgot')}>Forgot password?</button>}
        {ssoError && <p className="danger">{ssoError}</p>}
        {needCode && mode === 'login' && <label>Verification code<input autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code or a recovery code" required value={form.code} onChange={set('code')} /></label>}
        {error && <p className="danger">{error}</p>}
        <button className="primary" disabled={busy}>{mode === 'login' ? 'Continue' : 'Sign up'}</button>
        {canSso && mode === 'login' && <>
          <div className="auth-or"><span>or</span></div>
          <a className="button wide sso-button" href={`/api/auth/${canSso}/start`}>Continue with SSO</a>
        </>}
        {canRegister && hasUsers && (
          <button type="button" className="ghost link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
          </button>
        )}
        {!canRegister && <p className="muted small">New accounts need an invite link from a workspace owner.</p>}
        </>}
        {desktopApp && <button type="button" className="ghost link" onClick={() => desktopApp.changeServer()}>Connect to a different server</button>}
      </form>
    </div>
  )
}

/** Logged-in user opening an invite link. */
export function AcceptInvite({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.inviteInfo>> | null | undefined>(undefined)
  const { error, busy, run } = useAction()
  useEffect(() => { api.inviteInfo(token).then(setInfo).catch(() => setInfo(null)) }, [token])
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand big">▤ Bloki</div>
        {info === undefined ? '…' : info === null ? <p className="danger">This invite link is invalid or has expired.</p> : (
          <>
            <p>{info.inviter} invited you to {info.page ? <>the page <b>{info.page || 'Untitled'}</b> in </> : null}<b>{info.workspace}</b>.</p>
            <button className="primary" disabled={busy} onClick={() => run(async () => {
              const r = await api.acceptInvite(token)
              location.hash = r.page_id ? '/' + r.page_id : ''
              onDone()
            })}>Join</button>
          </>
        )}
        {error && <p className="danger">{error}</p>}
        <button className="ghost link" onClick={() => { location.hash = ''; onDone() }}>Go to my workspace</button>
      </div>
    </div>
  )
}

/* ---------- Workspace switcher ---------- */

/** Settings → Public pages: everything published to the web from this workspace, with Unpublish. */
function PublicPages() {
  const store = useStore()
  const list = store.pages.filter(p => p.public && !p.trashed)
  return <>
    <h3>Public pages</h3>
    <p className="settings-sub">Manage public content from your workspace</p>
    <Section title="Published pages" desc="Anyone with the link can view these pages and their sub-pages.">
      {!list.length && <p className="muted small">No pages are published yet. Use Share → Publish on a page.</p>}
      {list.map(p => (
        <Row key={p.id} label={<button className="link-row" onClick={() => store.go(p.id)}>{iconOf(p, 16)} {label(p)}</button>} desc={publicLink(p.id)}>
          {can(p, 'full') && <button onClick={() => api.setShare(p.id, { public: false }).then(() => store.reload()).catch(e => store.setError(e.message))}>Unpublish</button>}
        </Row>
      ))}
    </Section>
  </>
}

/** Settings → Offline (desktop app): pages kept for reading without a connection, with Remove. */
function OfflinePages() {
  const [list, setList] = useState<{ id: string; title: string; icon: string; saved: number }[] | null>(null)
  const load = () => desktopApp?.offline?.mine().then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  return <>
    <h3>Offline</h3>
    <p className="settings-sub">See which pages you can use while offline</p>
    <Section title="Offline pages" desc="These pages are available on this computer without a connection. Turn it on from a page’s ⋯ menu.">
      {list && !list.length && <p className="muted small">No pages available</p>}
      {list?.map(p => (
        <Row key={p.id} label={`${p.icon || '📄'} ${p.title || 'Untitled'}`} desc={`Saved ${new Date(p.saved).toLocaleString()}`}>
          <button onClick={() => desktopApp!.offline!.set(p.id, false).then(load)}>Remove</button>
        </Row>
      ))}
    </Section>
  </>
}

export function WorkspaceMenu({ openSettings }: { openSettings: (tab?: string) => void }) {
  const store = useStore()
  const [anchor, open, close] = usePopover<HTMLElement | { x: number; y: number }>()
  // The desktop tab bar's switcher opens this menu from just above the page's top-left corner.
  useEffect(() => {
    const show = () => open({ x: 8, y: 0 })
    addEventListener('bloki:workspace-menu', show)
    return () => removeEventListener('bloki:workspace-menu', show)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const me = store.me!
  const ws = me.workspaces.find(w => w.id === me.workspaceId)
  const switchTo = async (id: string) => { close(); await api.switchWorkspace(id); location.hash = ''; await store.reloadMe() }
  const wsIcon = (w?: { icon: string; name: string }) => <span className="ws-icon">{w?.icon || w?.name[0]?.toUpperCase() || '?'}</span>
  return (
    <>
      <button className="ws-button" onClick={e => open(e.currentTarget)}>
        {wsIcon(ws)}
        <span className="ws-name">{ws?.name ?? 'No workspace'}</span>
        <ChevronDown size={14} className="muted" />
      </button>
      <Popover anchor={anchor} onClose={close} className="menu-pop ws-pop" width={300}>
        {ws && (
          <div className="ws-head">
            <span className="ws-icon big">{ws.icon || ws.name[0]?.toUpperCase()}</span>
            <div><b>{ws.name}</b><div className="muted small">{ROLE_NAMES[ws.role]} · {store.people.size} {store.people.size === 1 ? 'member' : 'members'}</div></div>
          </div>
        )}
        {ws && (
          <div className="ws-actions">
            <button onClick={() => { close(); openSettings() }}><Settings size={14} /> Settings</button>
            {ws.role === 'owner' && <button onClick={() => { close(); openSettings('people') }}><UserPlus size={14} /> Invite members</button>}
          </div>
        )}
        <div className="menu-divider" />
        <div className="menu-heading">{me.user.email}</div>
        <Menu onClose={close} items={[
          ...me.workspaces.map(w => ({ icon: wsIcon(w), label: w.name, checked: w.id === me.workspaceId, onClick: () => switchTo(w.id) })),
          { icon: <Plus size={16} />, label: 'New workspace', onClick: async () => {
            const name = prompt('Workspace name')
            if (!name) return
            await api.createWorkspace(name)
            location.hash = ''
            await store.reloadMe()
          } },
          { divider: true },
          ...(desktopApp ? [{ icon: <Server size={16} />, label: 'Change server…', onClick: () => desktopApp.changeServer() }] : []),
          { icon: <LogOut size={16} />, label: 'Log out', onClick: async () => { await api.logout(); location.reload() } },
        ]} />
      </Popover>
    </>
  )
}

/* ---------- Settings & members ---------- */

type Tab = 'account' | 'settings' | 'notifications' | 'workspace' | 'people' | 'import' | 'connections' | 'audit' | 'public' | 'offline'

/** The web clipper's landing page: what the bookmarklet sent, saved as a private page only when you say so. */
export function ClipScreen({ clip }: { clip: { u?: string; t?: string; s?: string } }) {
  const store = useStore()
  const url = /^https?:\/\//i.test(clip.u ?? '') ? clip.u! : ''
  const [title, setTitle] = useState(clip.t ?? url)
  const { error, busy, run } = useAction()
  const save = () => run(async () => {
    const content = [
      ...(url ? [{ type: 'embed', props: { url, mode: 'bookmark' } }] : []),
      ...(clip.s ? [{ type: 'quote', content: [{ type: 'text', text: clip.s.slice(0, 5000), styles: {} }] }] : []),
    ]
    const page = await store.create({ title: title.slice(0, 300), section: 'private', content }, false)
    location.hash = '/' + page.id
  })
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand big">▤ Bloki</div>
        <h2>Save to Bloki</h2>
        <label>Title<input autoFocus value={title} onChange={e => setTitle(e.target.value)} /></label>
        {url ? <p className="muted small clip-url">{url}</p> : <p className="danger small">This link can’t be saved.</p>}
        {clip.s && <blockquote className="clip-quote">{clip.s.slice(0, 500)}</blockquote>}
        {error && <p className="danger">{error}</p>}
        <button className="primary" disabled={busy || !url} onClick={save}>Save to Private</button>
        <button className="ghost link" onClick={() => { location.hash = '' }}>Cancel</button>
      </div>
    </div>
  )
}

/** Settings → Connections → Web clipper: a bookmark that sends the page you're on to Bloki. */
function Clipper() {
  const ref = useRef<HTMLAnchorElement>(null)
  // React won't render javascript: links, so the bookmarklet is set on the element directly.
  useEffect(() => {
    const target = `${location.origin}${location.pathname}#/clip?`
    ref.current?.setAttribute('href', `javascript:(()=>{window.open(${JSON.stringify(target)}+new URLSearchParams({u:location.href,t:document.title,s:String(getSelection()||'').slice(0,2000)}),'_blank')})()`)
  }, [])
  return <a ref={ref} className="button clip-bookmarklet" onClick={e => e.preventDefault()}>Save to Bloki</a>
}

const AUDIT_LABELS: Record<string, string> = {
  'user.login': 'Logged in', 'member.joined': 'Joined the workspace', 'member.role': 'Changed a role', 'member.removed': 'Removed a member', 'member.left': 'Left the workspace',
  'invite.created': 'Created an invite', 'page.created': 'Created a page', 'page.trashed': 'Moved a page to Trash', 'page.restored': 'Restored a page',
  'page.deleted_forever': 'Deleted a page forever', 'page.moved': 'Moved a page', 'page.shared': 'Changed sharing', 'token.created': 'Created an API token',
  'token.revoked': 'Revoked an API token', 'webhook.created': 'Added a webhook', 'webhook.deleted': 'Deleted a webhook', 'user.2fa_on': 'Turned on 2-step verification',
  'user.2fa_off': 'Turned off 2-step verification', 'user.password_reset': 'Reset their password', 'group.saved': 'Changed a group', 'group.deleted': 'Deleted a group',
  'teamspace.created': 'Created a teamspace', 'scim.token_created': 'Created a SCIM token', 'scim.token_revoked': 'Revoked a SCIM token', 'teamspace.deleted': 'Deleted a teamspace', 'workspace.exported': 'Exported the workspace',
}

/** Settings → Audit log (owners): who did what in this workspace, newest first, filterable and exportable as CSV. */
function AuditLog() {
  const [items, setItems] = useState<AuditEntry[]>([])
  const [action, setAction] = useState('')
  const [more, setMore] = useState(true)
  const load = useCallback(async (reset: boolean, before?: number) => {
    const page = await api.audit(action, before)
    setItems(x => (reset ? page : [...x, ...page]))
    setMore(page.length === 100)
  }, [action])
  useEffect(() => { load(true) }, [load])
  const csv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [['Time', 'Person', 'Action', 'Target', 'Details', 'IP'], ...items.map(e => [new Date(e.at).toISOString(), e.name ?? '', AUDIT_LABELS[e.action] ?? e.action, e.page_title ?? e.target ?? '', e.detail ?? '', e.ip ?? ''])]
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' })), download: 'bloki-audit-log.csv' })
    a.click()
  }
  return <>
    <h3>Audit log</h3>
    <p className="settings-sub">Who did what in this workspace</p>
    <div className="row audit-tools">
      <select value={action} onChange={e => setAction(e.target.value)}>
        <option value="">All events</option><option value="page.">Pages</option><option value="member.">Members</option><option value="user.">Accounts</option>
        <option value="invite.">Invites</option><option value="token.">API tokens</option><option value="webhook.">Webhooks</option><option value="group.">Groups</option><option value="teamspace.">Teamspaces</option>
      </select>
      <button onClick={csv} disabled={!items.length}><Download size={14} /> Export CSV</button>
    </div>
    <table className="audit-table">
      <thead><tr><th>Time</th><th>Person</th><th>Event</th><th>Target</th></tr></thead>
      <tbody>{items.map(e => (
        <tr key={e.id} title={[e.detail, e.ip].filter(Boolean).join(' · ')}>
          <td className="muted">{new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td>{e.name ?? '—'}</td><td>{AUDIT_LABELS[e.action] ?? e.action}</td><td className="muted">{e.page_title ?? (e.target ? e.target.slice(0, 8) : '')}</td>
        </tr>
      ))}</tbody>
    </table>
    {!items.length && <p className="muted small">Nothing yet.</p>}
    {more && items.length > 0 && <button className="ghost" onClick={() => load(false, items.at(-1)!.id)}>Load more</button>}
  </>
}

/** Settings → People → Groups: named sets of members, to share pages with all of them at once. */
function Groups({ people }: { people: Person[] }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [name, setName] = useState('')
  const { error, busy, run } = useAction()
  const load = useCallback(() => { api.groups().then(setGroups) }, [])
  useEffect(load, [load])
  const save = (id: string | null, body: { name?: string; members?: string[] }) => run(async () => { await (id ? api.saveGroup(id, body) : api.createGroup(body)); load() })
  return (
    <Section title="Groups" desc="Share pages with a group instead of person by person. Type the group’s name in Share.">
      {groups.map(g => (
        <Row key={g.id} label={g.name} desc={g.members.map(m => m.name).join(', ') || 'No members yet'}>
          <span className="row">
            <select value="" onChange={e => e.target.value && save(g.id, { members: [...g.members.map(m => m.id), e.target.value] })}>
              <option value="">Add member…</option>
              {people.filter(p => p.role !== 'guest' && !g.members.some(m => m.id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {g.members.length > 0 && <select value="" onChange={e => e.target.value && save(g.id, { members: g.members.map(m => m.id).filter(id => id !== e.target.value) })}>
              <option value="">Remove…</option>{g.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>}
            <button className="danger" onClick={() => confirm(`Delete the group ${g.name}?`) && run(async () => { await api.deleteGroup(g.id); load() })}>Delete</button>
          </span>
        </Row>
      ))}
      <Row label="New group" desc="For example Marketing or Engineering.">
        <span className="row"><input value={name} placeholder="Group name" onChange={e => setName(e.target.value)} />
          <button disabled={busy || !name.trim()} onClick={() => { save(null, { name, members: [] }); setName('') }}>Create</button></span>
      </Row>
      {error && <p className="danger small">{error}</p>}
    </Section>
  )
}

/** Publish → site settings: a short address (/s/<slug>) and whether search engines may index the site. */
function SiteSettings({ slug, indexed, update }: { slug: string; indexed: boolean; update: (b: object) => void }) {
  const [draft, setDraft] = useState(slug)
  useEffect(() => setDraft(slug), [slug])
  const clean = draft.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return (
    <div className="site-settings">
      <label className="site-address"><span className="muted small">Site address</span>
        <span className="row"><span className="site-prefix">{location.host}/s/</span>
          <input value={draft} placeholder="my-site" onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && update({ site_slug: clean || null })} />
          <button disabled={clean === slug} onClick={() => update({ site_slug: clean || null })}>Save</button></span>
      </label>
      <label className="site-index"><span><b>Search engine indexing</b><small className="muted">Let Google and others list this site</small></span>
        <input type="checkbox" checked={indexed} onChange={e => update({ site_index: e.target.checked })} /></label>
    </div>
  )
}

/** Settings → Connections: personal API tokens (act as you in this workspace) and the workspace's webhooks. */
function Connections({ owner }: { owner: boolean }) {
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [hooks, setHooks] = useState<Webhook[]>([])
  const [scimTokens, setScimTokens] = useState<{ id: string; created: number; last_used: number | null }[]>([])
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null)
  const [name, setName] = useState('')
  const [hook, setHook] = useState({ url: '', events: ['page.created', 'page.updated'] as string[] })
  const { error, busy, run } = useAction()
  const load = useCallback(() => { api.tokens().then(setTokens); if (owner) { api.webhooks().then(setHooks); api.scimTokens().then(setScimTokens) } }, [owner])
  useEffect(load, [load])
  const EVENTS = ['page.created', 'page.updated', 'page.deleted', 'comment.created']
  return <>
    <h3>Connections</h3>
    <p className="settings-sub">Let scripts and other apps read and change your pages through the Bloki API</p>
    {shown && <div className="connection-secret"><b>{shown.label}</b><span className="muted small">Copy it now; it won’t be shown again.</span><code>{shown.value}</code>
      <button onClick={() => { navigator.clipboard?.writeText(shown.value); setShown(null) }}>Copy and close</button></div>}
    <Section title="Web clipper" desc="Drag this button to your browser’s bookmarks bar. On any page, click the bookmark to save it (and any text you selected) to your private pages.">
      <Row label="Bookmarklet" desc="Works in every browser, no extension needed."><Clipper /></Row>
    </Section>
    <Section title="API tokens" desc="A token can do what you can in this workspace. Send it as Authorization: Bearer <token> to the same /api/… URLs the app uses.">
      {tokens.map(t => (
        <Row key={t.id} label={t.name} desc={`Created ${new Date(t.created).toLocaleDateString()} · ${t.last_used ? 'last used ' + new Date(t.last_used).toLocaleDateString() : 'never used'}`}>
          <button className="danger" onClick={() => run(async () => { await api.deleteToken(t.id); load() })}>Revoke</button>
        </Row>
      ))}
      <Row label="New token" desc="Name it after what will use it.">
        <span className="row"><input placeholder="e.g. Backup script" value={name} onChange={e => setName(e.target.value)} />
          <button disabled={busy || !name.trim()} onClick={() => run(async () => { const r = await api.createToken(name); setShown({ label: 'Your new API token', value: r.token }); setName(''); load() })}>Create</button></span>
      </Row>
    </Section>
    {owner && <Section title="Webhooks" desc="Bloki posts JSON to these URLs when things change, signed with X-Bloki-Signature (sha256 HMAC of the body). Only pages the webhook’s creator can see are sent.">
      {hooks.map(h => (
        <Row key={h.id} label={h.url} desc={h.events.join(', ')}>
          <button className="danger" onClick={() => run(async () => { await api.deleteWebhook(h.id); load() })}>Delete</button>
        </Row>
      ))}
      <Row label="New webhook" desc="An https:// URL that accepts POST requests.">
        <span className="col">
          <input placeholder="https://example.com/bloki-hook" value={hook.url} onChange={e => setHook({ ...hook, url: e.target.value })} />
          <span className="webhook-events">{EVENTS.map(ev => (
            <label key={ev}><input type="checkbox" checked={hook.events.includes(ev)} onChange={e => setHook({ ...hook, events: e.target.checked ? [...hook.events, ev] : hook.events.filter(x => x !== ev) })} /> {ev}</label>
          ))}</span>
          <button disabled={busy || !hook.url || !hook.events.length} onClick={() => run(async () => { const r = await api.createWebhook(hook.url, hook.events); setShown({ label: 'Signing secret', value: r.secret }); setHook({ ...hook, url: '' }); load() })}>Add webhook</button>
        </span>
      </Row>
    </Section>}
    {owner && <Section title="SCIM provisioning" desc="Let your identity provider (Okta, Microsoft Entra ID, OneLogin…) add, update and remove members and groups. Deactivated people leave this workspace; their account stays.">
      <Row label="SCIM base URL" desc="Paste this into your identity provider."><Copy text={`${location.origin}/scim/v2`} /></Row>
      {scimTokens.map(t => (
        <Row key={t.id} label="SCIM token" desc={`Created ${new Date(t.created).toLocaleDateString()} · ${t.last_used ? 'last used ' + new Date(t.last_used).toLocaleDateString() : 'never used'}`}>
          <button className="danger" onClick={() => run(async () => { await api.deleteScimToken(t.id); load() })}>Revoke</button>
        </Row>
      ))}
      <Row label="New SCIM token" desc="Your identity provider sends it as a bearer token.">
        <button disabled={busy} onClick={() => run(async () => { const r = await api.createScimToken(); setShown({ label: 'SCIM token', value: r.token }); load() })}>Generate token</button>
      </Row>
    </Section>}
    {error && <p className="danger small">{error}</p>}
  </>
}

/** Settings → Account → 2-step verification: an authenticator app's code on top of the password. */
function TwoStep({ on }: { on: boolean }) {
  const store = useStore()
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [f, setF] = useState({ code: '', password: '' })
  const { error, busy, run } = useAction()
  const finish = async () => { setSetup(null); setF({ code: '', password: '' }); await store.reloadMe() }
  return (
    <Row label="2-step verification" desc={on ? 'On: logging in asks for a code from your authenticator app.' : 'Add a code from an authenticator app (1Password, Google Authenticator, Authy…) to logging in.'}>
      <span className="col two-step">
        {codes ? <>
          <b>Save these recovery codes</b>
          <span className="muted small">Each one logs you in once if you lose your phone. They won’t be shown again.</span>
          <code className="recovery-codes">{codes.join('\n')}</code>
          <button onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); setCodes(null) }}>Copy and close</button>
        </> : setup ? <>
          <span className="muted small">In your authenticator app, add an account with this setup key (or open the link on your phone), then enter the 6-digit code it shows.</span>
          <code className="setup-key">{setup.secret.match(/.{1,4}/g)!.join(' ')}</code>
          <a className="small" href={setup.uri}>Open in authenticator app</a>
          <input inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />
          <span className="row">
            <button className="primary" disabled={busy || f.code.replace(/\s/g, '').length < 6} onClick={() => run(async () => { const r = await api.twoFactorEnable(f.code); setCodes(r.codes); await finish() })}>Turn on</button>
            <button className="ghost" onClick={() => setSetup(null)}>Cancel</button>
          </span>
        </> : on ? <>
          <input type="password" autoComplete="current-password" placeholder="Current password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
          <input inputMode="numeric" autoComplete="one-time-code" placeholder="Code or recovery code" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />
          <button className="danger" disabled={busy || !f.password || !f.code} onClick={() => run(async () => { await api.twoFactorDisable(f.password, f.code); await finish() })}>Turn off</button>
        </> : <button onClick={() => run(async () => setSetup(await api.twoFactorSetup()))}>Add verification method</button>}
        {error && <span className="danger small">{error}</span>}
      </span>
    </Row>
  )
}

function Section({ title, children, desc }: { title: string; desc?: string; children: React.ReactNode }) {
  return <section className="set-section"><h4>{title}</h4>{desc && <p className="muted small">{desc}</p>}{children}</section>
}
function Row({ label, desc, children }: { label: React.ReactNode; desc?: string; children: React.ReactNode }) {
  return <div className="set-row"><div><div>{label}</div>{desc && <div className="muted small">{desc}</div>}</div><div className="set-control">{children}</div></div>
}

export function SettingsDialog({ close, initialTab = 'account' }: { close: () => void; initialTab?: string }) {
  const store = useStore()
  const me = store.me!
  const ws = me.workspaces.find(w => w.id === me.workspaceId)
  const owner = me.role === 'owner'
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || 'account')
  const [people, setPeople] = useState<Person[]>([])
  const [peopleTab, setPeopleTab] = useState<'members' | 'guests'>('members')
  const [name, setName] = useState(me.user.name)
  const [pw, setPw] = useState({ password: '', new_password: '' })
  const [wsName, setWsName] = useState(ws?.name ?? '')
  const [wsIcon, setWsIcon] = useState(ws?.icon ?? '')
  const [link, setLink] = useState<{ role: Role; url: string } | null>(null)
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')
  const [theme, setThemeState] = useState(() => { try { return localStorage.getItem('theme') || 'system' } catch { return 'system' } })
  const { error, busy, run } = useAction()
  const prefs = me.prefs ?? {}

  useEffect(() => { if (me.workspaceId) api.people(me.workspaceId).then(setPeople) }, [me.workspaceId])
  const done = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }
  const savePrefs = (p: object) => run(async () => { await api.updateMe({ prefs: { ...prefs, ...p } }); await store.reloadMe() })
  const theme_ = (t: string) => { setThemeState(t); try { localStorage.setItem('theme', t) } catch { /* private mode */ } dispatchEvent(new CustomEvent('bloki:theme')) }
  const nav = (t: Tab, label: string, icon: React.ReactNode) => <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{icon}{label}</button>
  const shownPeople = people.filter(p => (peopleTab === 'guests' ? p.role === 'guest' : p.role !== 'guest') && (p.name + ' ' + (p.email ?? '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="overlay" onClick={close}>
      <div className="dialog settings" onClick={e => e.stopPropagation()}>
        <nav className="settings-tabs">
          {/* Notion's settings navigation: the account row, then Preferences, Notifications; Workspace; Features. */}
          <div className="menu-heading">Account</div>
          {nav('account', me.user.name, <span className="avatar small">{me.user.name[0]}</span>)}
          {nav('settings', 'Preferences', <SlidersHorizontal size={16} />)}
          {nav('notifications', 'Notifications', <Bell size={16} />)}
          {ws && <>
            <div className="menu-heading">Workspace</div>
            {nav('workspace', 'General', <Settings size={16} />)}
            {nav('people', 'People', <Users size={16} />)}
            {nav('import', 'Import', <Download size={16} />)}
            {nav('connections', 'Connections', <Plug size={16} />)}
            {me.role === 'owner' && nav('audit', 'Audit log', <ScrollText size={16} />)}
            <div className="menu-heading">Features</div>
            {nav('public', 'Public pages', <Globe size={16} />)}
            {desktopApp && 'offline' in desktopApp && nav('offline', 'Offline', <WifiOff size={16} />)}
          </>}
        </nav>
        <div className="settings-body">
          {tab === 'account' && <>
            <h3>Account</h3>
            <p className="settings-sub">Manage your profile, login information, and devices</p>
            <Section title="Profile">
              <div className="set-profile">
                <span className="avatar big">{me.user.name[0]}</span>
                <label>Preferred name<span className="row"><input value={name} onChange={e => setName(e.target.value)} />
                  <button disabled={busy || name === me.user.name} onClick={() => run(async () => { await api.updateMe({ name }); await store.reloadMe(); done('Saved') })}>Update</button></span></label>
              </div>
            </Section>
            <Section title="Account security">
              <Row label="Email" desc={me.user.email}><span className="muted small">Used to log in</span></Row>
              <Row label="Password" desc="Change the password you use to log in.">
                <span className="col">
                  <input type="password" autoComplete="current-password" placeholder="Current password" value={pw.password} onChange={e => setPw({ ...pw, password: e.target.value })} />
                  <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={pw.new_password} onChange={e => setPw({ ...pw, new_password: e.target.value })} />
                  <button disabled={busy || !pw.password || pw.new_password.length < 8} onClick={() => run(async () => { await api.updateMe(pw); setPw({ password: '', new_password: '' }); done('Password changed. Other devices were logged out.') })}>Change password</button>
                </span>
              </Row>
              <TwoStep on={!!me.user.twoFactor} />
            </Section>
            <Section title="Support">
              <Row label="Log out of all devices" desc="Log out of all other active sessions on other devices besides this one.">
                <button onClick={() => run(async () => { await api.logoutAll(); location.reload() })}>Log out of all devices</button>
              </Row>
              <Row label="Delete my account" desc="Permanently delete the account and remove access from all workspaces.">
                <button className="danger" onClick={() => run(async () => {
                  const password = prompt('This permanently deletes your account. Enter your password to confirm.')
                  if (!password) return
                  await api.deleteAccount(password); location.reload()
                })}>Delete my account</button>
              </Row>
            </Section>
          </>}

          {tab === 'settings' && <>
            <h3>Preferences</h3>
            <p className="settings-sub">Choose how you want Bloki to look and behave</p>
            <Section title="Appearance">
              <Row label="Theme" desc="Choose a theme for Bloki on this device"><select value={theme} onChange={e => theme_(e.target.value)}><option value="system">Use system setting</option><option value="light">Light</option><option value="dark">Dark</option></select></Row>
            </Section>
            <Section title="Input options">
              <Row label="Use Enter to add a new line" desc="Applies to comments and other input fields. Press Cmd/Ctrl + Enter to send."><input type="checkbox" checked={!!prefs.enterNewline} onChange={e => savePrefs({ enterNewline: e.target.checked })} /></Row>
            </Section>
            <Section title="Language & time">
              <Row label="Start week on Monday" desc="This will affect the way your calendars appear in Bloki"><input type="checkbox" checked={(prefs.weekStart ?? 'monday') === 'monday'} onChange={e => savePrefs({ weekStart: e.target.checked ? 'monday' : 'sunday' })} /></Row>
              <Row label="Date format" desc="Set the default format for new @date mentions">
                <select value={prefs.dateFormat ?? 'relative'} onChange={e => savePrefs({ dateFormat: e.target.value })}><option value="relative">Relative</option><option value="full">Full date</option><option value="iso">Year/Month/Day</option></select>
              </Row>
            </Section>
            <Section title="Startup">
              <Row label="Open on start" desc="Choose what to show when Bloki opens.">
                <select value={prefs.startPage ?? 'last'} onChange={e => savePrefs({ startPage: e.target.value })}><option value="last">Last visited page</option><option value="home">Home</option></select>
              </Row>
            </Section>
          </>}

          {tab === 'notifications' && <>
            <h3>Notifications</h3>
            <p className="settings-sub">Decide when and how you want to be notified</p>
            <Section title="Inbox" desc="Choose what shows up in your Inbox.">
              {([['mention', 'Mentions', 'When someone @mentions you in a page'], ['comment', 'Comments', 'Replies and comments on pages you created or discussed'], ['share', 'Invites', 'When a page is shared with you'], ['automation', 'Automations', 'When a database automation notifies you'], ['reminder', 'Reminders', 'When a reminder you set on a date is due']] as const).map(([k, l, d]) => (
                <Row key={k} label={l} desc={d}><input type="checkbox" checked={prefs.notify?.[k] !== false} onChange={e => savePrefs({ notify: { ...prefs.notify, [k]: e.target.checked } })} /></Row>
              ))}
            </Section>
            <Section title="Email" desc="Only when this Bloki server is set up to send email.">
              <Row label="Email notifications" desc="Get the notifications above by email too"><input type="checkbox" checked={prefs.email !== false} onChange={e => savePrefs({ email: e.target.checked })} /></Row>
            </Section>
          </>}

          {tab === 'workspace' && ws && <>
            <h3>General</h3>
            <p className="settings-sub">Manage your workspace name, icon, export and more</p>
            <Section title="Name"><input className="wide" value={wsName} disabled={!owner} onChange={e => setWsName(e.target.value)} /><p className="muted small">You can use your organization or company name. Keep it simple.</p></Section>
            <Section title="Icon"><input value={wsIcon} disabled={!owner} maxLength={8} placeholder="Emoji" onChange={e => setWsIcon(e.target.value)} /><p className="muted small">Upload an image or pick an emoji. It will show up in your sidebar and notifications.</p></Section>
            {owner && <button className="primary" disabled={busy} onClick={() => run(async () => { await api.updateWorkspace(ws.id, { name: wsName, icon: wsIcon }); await store.reloadMe(); done('Saved') })}>Update</button>}
            {owner && <Section title="Members"><Row label="Export members" desc="Download the members and guests of this workspace as a CSV file.">
              <button onClick={() => { const csv = ['Name,Email,Role', ...people.map(p => [p.name, p.email ?? '', ROLE_NAMES[p.role]].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${ws.name} members.csv`; a.click() }}>Export</button>
            </Row></Section>}
            {owner && <Section title="Export content"><Row label="Export all workspace content" desc="Download every page you can see as a JSON backup.">
              <button onClick={() => run(async () => { const data = await api.exportWorkspace(ws.id); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = `${ws.name}.bloki.json`; a.click() })}>Export</button>
            </Row></Section>}
            <Section title="Danger zone">
              <Row label="Leave workspace" desc="You’ll lose access to its pages unless you’re invited back.">
                <button className="danger" onClick={() => run(async () => { if (!confirm(`Leave ${ws.name}?`)) return; await api.removePerson(ws.id, me.user.id); location.hash = ''; await store.reloadMe(); close() })}>Leave workspace</button>
              </Row>
              {owner && <Row label="Delete entire workspace" desc="Deletes every page in this workspace for everyone.">
                <button className="danger" onClick={() => run(async () => { if (prompt(`Type the workspace name (${ws.name}) to confirm.`) !== ws.name) return; await api.deleteWorkspace(ws.id); location.hash = ''; await store.reloadMe(); close() })}>Delete workspace</button>
              </Row>}
            </Section>
          </>}

          {tab === 'people' && ws && <>
            <h3>People</h3>
            <p className="settings-sub">Manage people in your workspace and their roles</p>
            {owner && <Groups people={people} />}
            {owner && (
              <Section title="Invite link" desc="Single-use links, valid for 7 days. Send one to each person you invite.">
                <div className="row">
                  <button onClick={() => run(async () => setLink({ role: 'member', url: inviteLink((await api.invite(ws.id, 'member')).token) }))}><UserPlus size={14} /> Invite member</button>
                  <button onClick={() => run(async () => setLink({ role: 'guest', url: inviteLink((await api.invite(ws.id, 'guest')).token) }))}><UserPlus size={14} /> Invite guest</button>
                </div>
                {link && <><div className="muted small">Link for one {link.role}:</div><Copy text={link.url} /></>}
              </Section>
            )}
            <div className="people-tabs">
              <button className={peopleTab === 'members' ? 'active' : ''} onClick={() => setPeopleTab('members')}>Members <span className="muted">{people.filter(p => p.role !== 'guest').length}</span></button>
              <button className={peopleTab === 'guests' ? 'active' : ''} onClick={() => setPeopleTab('guests')}>Guests <span className="muted">{people.filter(p => p.role === 'guest').length}</span></button>
              <input placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <table className="people">
              <thead><tr><th>User</th><th>Role</th><th /></tr></thead>
              <tbody>
                {shownPeople.map(p => (
                  <tr key={p.id}>
                    <td><span className="person-pill"><span className="avatar">{p.name[0]}</span><span><b>{p.name}</b>{p.id === me.user.id && ' (you)'}<div className="muted small">{p.email}</div></span></span></td>
                    <td>{owner
                      ? <select value={p.role} onChange={e => run(async () => setPeople(await api.setRole(ws.id, p.id, e.target.value as Role)))}>
                          {(['owner', 'member', 'guest'] as Role[]).map(r => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
                        </select>
                      : ROLE_NAMES[p.role]}</td>
                    <td>{owner && p.id !== me.user.id && <button className="ghost danger" onClick={() => run(async () => {
                      if (!confirm(`Remove ${p.name} from ${ws.name}? They lose access to every page here.`)) return
                      await api.removePerson(ws.id, p.id); setPeople(await api.people(ws.id))
                    })}>Remove</button>}</td>
                  </tr>
                ))}
                {!shownPeople.length && <tr><td colSpan={3} className="muted">No {peopleTab} yet.</td></tr>}
              </tbody>
            </table>
            <p className="muted small">Workspace owners manage settings and people and have full access to workspace pages. Members see and create workspace pages. Guests only see pages shared with them.</p>
          </>}

          {tab === 'import' && <>
            <h3>Import</h3>
            <p className="settings-sub">Import data from other apps and files into Bloki</p>
            <Section title="File-based imports" desc="Imported files become private pages you can then move anywhere.">
              <div className="import-tiles">
                <button className="import-tile" onClick={() => { close(); dispatchEvent(new CustomEvent('bloki:import-notion')) }}><FileArchive size={20} /><span><b>Notion</b><small>Import a Markdown & CSV export (.zip)</small></span></button>
                {([['trello', 'Trello', 'A board exported as JSON'], ['asana', 'Asana', 'A project exported as CSV'], ['evernote', 'Evernote', 'Notes exported as .enex'], ['confluence', 'Confluence', 'A space exported as HTML (.zip)']] as const).map(([k, l, d]) => (
                  <button key={k} className="import-tile" onClick={() => { close(); dispatchEvent(new CustomEvent(`bloki:import-${k}`)) }}><FileArchive size={20} /><span><b>{l}</b><small>{d}</small></span></button>
                ))}
                <button className="import-tile" onClick={() => { close(); dispatchEvent(new CustomEvent('bloki:import-csv')) }}><Table2 size={20} /><span><b>CSV</b><small>Import structured data from spreadsheets</small></span></button>
                <button className="import-tile" onClick={() => { close(); dispatchEvent(new CustomEvent('bloki:import')) }}><FileText size={20} /><span><b>Text & Markdown</b><small>Import plain text and formatted notes</small></span></button>
                <button className="import-tile" onClick={() => { close(); dispatchEvent(new CustomEvent('bloki:import-html')) }}><FileCode size={20} /><span><b>HTML</b><small>Import web pages and structured content</small></span></button>
              </div>
            </Section>
          </>}
          {tab === 'public' && <PublicPages />}
          {tab === 'connections' && <Connections owner={me.role === 'owner'} />}
          {tab === 'audit' && <AuditLog />}
          {tab === 'offline' && <OfflinePages />}
          {error && <p className="danger">{error}</p>}
          {msg && <p className="ok">{msg}</p>}
        </div>
        <button className="ghost settings-close" onClick={close}><X size={18} /></button>
      </div>
    </div>
  )
}

/* ---------- Share menu ---------- */

function levelsFor(page: Page): Level[] {
  // "Can edit content" only exists on databases, like in Notion.
  return (['full', 'edit', 'edit_content', 'comment', 'view'] as Level[]).filter(l => l !== 'edit_content' || page.kind === 'db')
}

export function ShareMenu({ page }: { page: Page; close: () => void }) {
  const store = useStore()
  const [tab, setTab] = useState<'share' | 'publish'>('share')
  const [advanced, setAdvanced] = useState(false)
  const [share, setShare] = useState<Share | null>(null)
  const [email, setEmail] = useState('')
  const [level, setLevel] = useState<Level>('edit')
  const [invite, setInvite] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  useEffect(() => { api.groups().then(setGroups).catch(() => {}) }, [])
  const { error, busy, run } = useAction()
  const full = can(page, 'full')
  const ws = store.me?.workspaces.find(w => w.id === store.me?.workspaceId)

  useEffect(() => { api.share(page.id).then(setShare) }, [page.id])
  const update = (body: object) => run(async () => {
    const s = await api.setShare(page.id, body)
    setShare(s)
    if (s.invite) setInvite(inviteLink(s.invite))
    if (s.emailed) store.toast('Invite sent by email')
    await store.reload()
  })

  if (!share) return <div className="share">…</div>
  const levels = levelsFor(page)
  const wsLevel = share.workspace_access ?? share.inherited_workspace_access
  const members = [...store.people.values()].filter(p => !share.grants.some(g => g.user_id === p.id))

  return (
    <div className="share">
      <div className="share-tabs">
        <button className={tab === 'share' ? 'active' : ''} onClick={() => setTab('share')}>Share</button>
        <button className={tab === 'publish' ? 'active' : ''} onClick={() => setTab('publish')}>Publish</button>
      </div>

      {tab === 'share' && <>
        {full && (
          <form className="row invite-row" onSubmit={async e => {
            e.preventDefault()
            // As in Notion, several addresses can go in at once, separated by commas.
            // Each entry is an email or the name of a group (shared with all its members at once).
            const group = groups.find(g => g.name.toLowerCase() === email.trim().toLowerCase())
            if (group) await update({ group_grant: { group_id: group.id, level } })
            else for (const one of email.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)) await update({ invite_email: one, level })
            setEmail('')
          }}>
            <input list="share-people" placeholder="Email or group, separated by commas" value={email} onChange={e => setEmail(e.target.value)} />
            <datalist id="share-people">{groups.filter(g => !share.groups?.some(x => x.group_id === g.id)).map(g => <option key={g.id} value={g.name}>Group · {g.members.length} members</option>)}{members.filter(p => p.email).map(p => <option key={p.id} value={p.email}>{p.name}</option>)}</datalist>
            {email.trim() && <select value={level} onChange={e => setLevel(e.target.value as Level)}>{levels.map(l => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}</select>}
            <button className="primary" disabled={busy}>Invite</button>
          </form>
        )}
        {invite && <div className="invite-box"><div className="muted small">{share.emailed ? 'No account uses that email yet, so we emailed them this invite link. They join as a guest with access to this page.' : 'No account uses that email yet. Send them this link; they join as a guest with access to this page.'}</div><Copy text={invite} /></div>}

        {share.groups?.map(g => (
          <div className="share-row" key={g.group_id}>
            <span className="share-person"><span className="avatar big group-avatar"><Users size={16} /></span><span>{g.name}<div className="muted small">Group · {g.members} member{g.members === 1 ? '' : 's'}</div></span></span>
            {full ? (
              <select value={g.level} onChange={e => update({ group_grant: { group_id: g.group_id, level: e.target.value === 'remove' ? null : e.target.value } })}>
                {levels.map(l => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
                <option value="remove">Remove</option>
              </select>
            ) : <span className="muted">{LEVEL_NAMES[g.level]}</span>}
          </div>
        ))}
        {share.grants.map(g => (
          <div className="share-row" key={g.user_id}>
            <span className="share-person"><span className="avatar big">{g.name[0]}</span><span>{g.name}{g.user_id === store.me?.user.id && <span className="muted"> (You)</span>} {g.role === 'guest' && <span className="badge">Guest</span>}<div className="muted small">{g.email}</div></span></span>
            {full ? (
              <select value={g.level} onChange={e => update({ grant: { user_id: g.user_id, level: e.target.value === 'remove' ? null : e.target.value } })}>
                {levels.map(l => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
                <option value="remove">Remove</option>
              </select>
            ) : <span className="muted">{LEVEL_NAMES[g.level]}</span>}
          </div>
        ))}

        <div className="muted small section-label">General access</div>
        <div className="share-row">
          <span>
            <span>{wsLevel === 'none' ? 'Only people invited' : `Everyone at ${ws?.name ?? 'workspace'}`}</span>
            <div className="muted small">{share.workspace_access === null ? 'Inherited from the parent page' : wsLevel === 'none' ? 'Only people listed above can open this page' : 'Workspace members (not guests)'}</div>
          </span>
          {full ? (
            <select value={share.workspace_access ?? 'inherit'} onChange={e => update({ workspace_access: e.target.value === 'inherit' ? null : e.target.value })}>
              {page.parent_id && <option value="inherit">Inherit ({LEVEL_NAMES[share.inherited_workspace_access]})</option>}
              {levels.map(l => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
              <option value="none">No access</option>
            </select>
          ) : <span className="muted">{LEVEL_NAMES[wsLevel]}</span>}
        </div>
        {advanced && <>
          <div className="share-row muted small"><span>Workspace owners</span><span>{wsLevel === 'none' ? 'Only if invited' : 'Full access'}</span></div>
          <div className="muted small share-foot">Your access: {LEVEL_NAMES[share.access]}. Sub-pages inherit these settings unless changed.</div>
        </>}
        <div className="share-actions">
          <button className="ghost share-advanced" onClick={() => setAdvanced(a => !a)}><Settings size={16} /> Advanced</button>
          <CopyLinkButton text={`${location.origin}/#/${page.id}`} />
        </div>
      </>}

      {tab === 'publish' && (() => {
        // Notion's Publish tab: a heading, a preview of the page in a browser frame, Publish, and a note.
        const first = ((page.content ?? []) as { content?: { text?: string }[] }[]).map(b => (b.content ?? []).map(c => c.text ?? '').join('')).find(t => t.trim()) ?? ''
        return (
          <div className="publish">
            <div className="publish-head"><b>{share.public ? 'Live on the web' : 'Publish to web'}</b><span>{share.public ? 'Anyone with the link can view this page and its sub-pages.' : 'Create a website with Bloki'}</span></div>
            <div className="publish-preview">
              <div className="publish-bar"><i /><i /><i /></div>
              <div className="publish-top"><span>{label(page)}</span></div>
              <div className="publish-page"><b>{label(page)}</b>{first && <p>{first}</p>}</div>
            </div>
            {share.public ? <>
              <Copy text={publicLink(page.id, share.site_slug)} />
              {full && <SiteSettings slug={share.site_slug ?? ''} indexed={!!share.site_index} update={update} />}
              <div className="publish-actions">
                <a className="button" href={publicLink(page.id, share.site_slug)} target="_blank" rel="noreferrer">View site</a>
                {full && <button className="danger" onClick={() => update({ public: false })}>Unpublish</button>}
              </div>
            </> : full
              ? <button className="primary publish-go" onClick={() => update({ public: true })}>Publish</button>
              : <p className="muted small">Only people with full access can publish.</p>}
            <p className="publish-note">ⓘ When published to web, anyone with the link can view this page’s content and see contributor names.</p>
          </div>
        )
      })()}
      {error && <p className="danger">{error}</p>}
    </div>
  )
}

export const personName = (people: Map<string, Person>, id?: string) => (id && people.get(id)?.name) || (id ? 'Former member' : '')
