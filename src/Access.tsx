import { useEffect, useState, type FormEvent } from 'react'
import { Bell, ChevronDown, Download, FileArchive, FileCode, FileText, Globe, Link2, LogOut, Plus, Server, Settings, SlidersHorizontal, Table2, UserPlus, Users, WifiOff, X } from 'lucide-react'

/** Present when running inside the Bloki desktop app. */
const desktopApp = (window as { blokiDesktop?: { platform: string; changeServer: () => void; offline?: { mine: () => Promise<{ id: string; title: string; icon: string; saved: number }[]>; set: (id: string, on: boolean) => Promise<boolean> } } }).blokiDesktop
import { Menu, Popover, usePopover } from './ui'
import { api, can, inviteLink, LEVEL_NAMES, publicLink, type Level, type Page, type Person, type Role, type Share } from './api'
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

export function AuthScreen({ invite, onDone }: { invite?: string; onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [hasUsers, setHasUsers] = useState(true)
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.inviteInfo>> | null>(null)
  const [form, setForm] = useState({ email: '', name: '', password: '' })
  const { error, busy, run } = useAction()

  useEffect(() => {
    api.status().then(s => { setHasUsers(s.hasUsers); if (!s.hasUsers) setMode('register') })
    if (invite) api.inviteInfo(invite).then(i => { setInfo(i); setMode('register') }).catch(() => setInfo(null))
  }, [invite])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      let page: string | null = null
      if (mode === 'login') {
        await api.login(form.email, form.password)
        if (invite) page = (await api.acceptInvite(invite)).page_id
      } else {
        page = (await api.register({ ...form, invite })).page_id
      }
      // Land on the page that was shared, like following a Notion invite.
      location.hash = page ? '/' + page : ''
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
        <h2>{mode === 'login' ? 'Log in' : 'Create your account'}</h2>
        <label>Email<input type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></label>
        {mode === 'register' && <label>Name<input autoComplete="name" required value={form.name} onChange={set('name')} /></label>}
        <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : undefined} value={form.password} onChange={set('password')} /></label>
        {error && <p className="danger">{error}</p>}
        <button className="primary" disabled={busy}>{mode === 'login' ? 'Continue' : 'Sign up'}</button>
        {canRegister && hasUsers && (
          <button type="button" className="ghost link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
          </button>
        )}
        {!canRegister && <p className="muted small">New accounts need an invite link from a workspace owner.</p>}
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

type Tab = 'account' | 'settings' | 'notifications' | 'workspace' | 'people' | 'import' | 'public' | 'offline'

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
              {([['mention', 'Mentions', 'When someone @mentions you in a page'], ['comment', 'Comments', 'Replies and comments on pages you created or discussed'], ['share', 'Invites', 'When a page is shared with you'], ['automation', 'Automations', 'When a database automation notifies you']] as const).map(([k, l, d]) => (
                <Row key={k} label={l} desc={d}><input type="checkbox" checked={prefs.notify?.[k] !== false} onChange={e => savePrefs({ notify: { ...prefs.notify, [k]: e.target.checked } })} /></Row>
              ))}
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
                <button className="import-tile" onClick={() => { close(); dispatchEvent(new CustomEvent('bloki:import-csv')) }}><Table2 size={20} /><span><b>CSV</b><small>Import structured data from spreadsheets</small></span></button>
                <button className="import-tile" onClick={() => { close(); dispatchEvent(new CustomEvent('bloki:import')) }}><FileText size={20} /><span><b>Text & Markdown</b><small>Import plain text and formatted notes</small></span></button>
                <button className="import-tile" onClick={() => { close(); dispatchEvent(new CustomEvent('bloki:import-html')) }}><FileCode size={20} /><span><b>HTML</b><small>Import web pages and structured content</small></span></button>
              </div>
            </Section>
          </>}
          {tab === 'public' && <PublicPages />}
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
  const { error, busy, run } = useAction()
  const full = can(page, 'full')
  const ws = store.me?.workspaces.find(w => w.id === store.me?.workspaceId)

  useEffect(() => { api.share(page.id).then(setShare) }, [page.id])
  const update = (body: object) => run(async () => {
    const s = await api.setShare(page.id, body)
    setShare(s)
    if (s.invite) setInvite(inviteLink(s.invite))
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
            for (const one of email.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)) await update({ invite_email: one, level })
            setEmail('')
          }}>
            <input list="share-people" placeholder="Email or group, separated by commas" value={email} onChange={e => setEmail(e.target.value)} />
            <datalist id="share-people">{members.filter(p => p.email).map(p => <option key={p.id} value={p.email}>{p.name}</option>)}</datalist>
            {email.trim() && <select value={level} onChange={e => setLevel(e.target.value as Level)}>{levels.map(l => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}</select>}
            <button className="primary" disabled={busy}>Invite</button>
          </form>
        )}
        {invite && <div className="invite-box"><div className="muted small">No account uses that email yet. Send them this link; they join as a guest with access to this page.</div><Copy text={invite} /></div>}

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
              <Copy text={publicLink(page.id)} />
              <div className="publish-actions">
                <a className="button" href={publicLink(page.id)} target="_blank" rel="noreferrer">View site</a>
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
