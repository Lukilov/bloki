import { useEffect, useState } from 'react'
import { Globe, Lock, Users, X } from 'lucide-react'
import { api, type Team, type TeamAccess, type TeamMember } from './api'
import { useStore } from './store'
import { Avatar } from './Comments'

const ACCESS: { id: TeamAccess; icon: React.ReactNode; label: string; desc: string }[] = [
  { id: 'open', icon: <Globe size={16} />, label: 'Open', desc: 'Anyone in the workspace can see and join this teamspace' },
  { id: 'closed', icon: <Users size={16} />, label: 'Closed', desc: 'Anyone can see this teamspace, but only owners can add members' },
  { id: 'private', icon: <Lock size={16} />, label: 'Private', desc: 'Only members can see that this teamspace exists' },
]

export function TeamIcon({ team, size = 20 }: { team: Pick<Team, 'icon' | 'name'>; size?: number }) {
  return team.icon
    ? <span className="team-icon" style={{ width: size, height: size, fontSize: size * 0.8 }}>{team.icon}</span>
    : <span className="team-icon letter" style={{ width: size, height: size, fontSize: size * 0.6 }}>{team.name.trim()[0]?.toUpperCase() ?? 'T'}</span>
}

/** Create a teamspace, or a teamspace's settings and members (Notion's Teamspace settings). */
export function TeamDialog({ team, close }: { team?: Team; close: () => void }) {
  const store = useStore()
  const [name, setName] = useState(team?.name ?? '')
  const [icon, setIcon] = useState(team?.icon ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [access, setAccess] = useState<TeamAccess>(team?.access ?? 'open')
  const [members, setMembers] = useState<TeamMember[]>([])
  const owner = !team || team.role === 'owner' || (store.me?.role === 'owner' && team.access !== 'private')
  useEffect(() => { if (team) api.teamMembers(team.id).then(setMembers).catch(e => store.setError(e.message)) }, [team, store])
  const run = async (f: () => Promise<unknown>) => { try { await f(); await store.reload() } catch (e) { store.setError((e as Error).message) } }
  const save = () => run(async () => {
    if (team) await api.updateTeam(team.id, { name, icon, description, access })
    else await api.createTeam({ name, icon, description, access })
    close()
  })
  const setRole = (userId: string, role: 'owner' | 'member' | null) => run(async () => {
    const r = await api.setTeamMember(team!.id, userId, role)
    if (Array.isArray(r)) setMembers(r)
    else close() // left the teamspace
  })
  const addable = [...store.people.values()].filter(p => p.role !== 'guest' && !members.some(m => m.id === p.id))
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog team-dialog" onClick={e => e.stopPropagation()} role="dialog" aria-label={team ? 'Teamspace settings' : 'Create a teamspace'}>
        <header><h2>{team ? 'Teamspace settings' : 'Create a new teamspace'}</h2><button className="icon-btn" onClick={close} title="Close"><X size={16} /></button></header>
        {!team && <p className="muted small">Teamspaces are where your team organizes pages, permissions and members.</p>}
        <label className="team-field">Icon & name
          <span className="team-name-row">
            <input className="team-emoji" value={icon} maxLength={4} placeholder="🙂" disabled={!owner} onChange={e => setIcon(e.target.value)} aria-label="Icon" />
            <input autoFocus value={name} placeholder="Acme Labs" disabled={!owner} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && name.trim() && save()} />
          </span>
        </label>
        <label className="team-field">Description
          <textarea value={description} rows={2} placeholder="Details about your teamspace" disabled={!owner} onChange={e => setDescription(e.target.value)} />
        </label>
        <div className="team-field">Permissions
          {ACCESS.map(a => (
            <button key={a.id} className={'team-access' + (access === a.id ? ' on' : '')} disabled={!owner} onClick={() => setAccess(a.id)}>
              {a.icon}<span><b>{a.label}</b><small>{a.desc}</small></span>
            </button>
          ))}
        </div>
        {team && <div className="team-field">Members
          {members.map(m => (
            <div key={m.id} className="team-member">
              <Avatar name={m.name} size={24} /><span className="team-member-name">{m.name}<small>{m.email}</small></span>
              {owner
                ? <select value={m.role} onChange={e => setRole(m.id, e.target.value === 'remove' ? null : e.target.value as 'owner' | 'member')}>
                    <option value="owner">Teamspace owner</option><option value="member">Teamspace member</option><option value="remove">Remove from teamspace</option>
                  </select>
                : <span className="muted small">{m.role === 'owner' ? 'Teamspace owner' : 'Teamspace member'}</span>}
            </div>
          ))}
          {owner && addable.length > 0 && (
            <select className="team-add" value="" onChange={e => e.target.value && setRole(e.target.value, 'member')}>
              <option value="">Add members…</option>
              {addable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>}
        <footer>
          {team?.role && <button className="ghost" onClick={() => setRole(store.me!.user.id, null)}>Leave teamspace</button>}
          {team && owner && <button className="ghost danger" onClick={() => confirm(`Delete ${team.name}?`) && run(async () => { await api.deleteTeam(team.id); close() })}>Delete teamspace</button>}
          <span className="spacer" />
          {owner && <button className="primary" disabled={!name.trim()} onClick={save}>{team ? 'Save' : 'Create teamspace'}</button>}
        </footer>
      </div>
    </div>
  )
}

/** Browse teamspaces: every open and closed teamspace, with Join for open ones. */
export function TeamBrowser({ close, open }: { close: () => void; open: (t: Team) => void }) {
  const store = useStore()
  const join = (t: Team) => api.joinTeam(t.id).then(() => store.reload()).catch(e => store.setError(e.message))
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog team-dialog" onClick={e => e.stopPropagation()} role="dialog" aria-label="Browse teamspaces">
        <header><h2>Teamspaces</h2><button className="icon-btn" onClick={close} title="Close"><X size={16} /></button></header>
        {!store.teams.length && <p className="muted">No teamspaces yet.</p>}
        {store.teams.map(t => (
          <div key={t.id} className="team-row">
            <TeamIcon team={t} size={28} />
            <span className="team-member-name">{t.name}<small>{t.members} member{t.members === 1 ? '' : 's'} · {ACCESS.find(a => a.id === t.access)?.label}</small></span>
            {t.role ? <button className="ghost" onClick={() => open(t)}>Settings</button>
              : t.access === 'open' ? <button className="primary" onClick={() => join(t)}>Join</button>
              : <span className="muted small">Ask an owner to join</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
