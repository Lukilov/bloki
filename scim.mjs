// SCIM 2.0 (RFC 7643/7644) for identity providers: they create, update and deactivate members and groups.
// Each workspace has its own SCIM tokens; deactivating or deleting a user removes them from that workspace only.
import { randomUUID } from 'node:crypto'

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User'
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
const ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error'

export function createScim({ db, sha, token, hashPassword, audit, liveReload }) {
  const fail = (status, detail) => Object.assign(new Error(detail), { scim: { schemas: [ERROR], status: String(status), detail }, status })
  const memberRole = (ws, id) => db.prepare('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?').get(ws, id)?.role

  const userOut = (ws, u) => ({
    schemas: [USER], id: u.id, userName: u.email, displayName: u.name, name: { formatted: u.name },
    emails: [{ value: u.email, primary: true }], active: !!memberRole(ws, u.id), meta: { resourceType: 'User', location: `/scim/v2/Users/${u.id}` },
  })
  const groupOut = g => ({
    schemas: [GROUP], id: g.id, displayName: g.name, meta: { resourceType: 'Group', location: `/scim/v2/Groups/${g.id}` },
    members: db.prepare('SELECT u.id, u.email FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?').all(g.id).map(m => ({ value: m.id, display: m.email })),
  })
  const list = (items, q) => {
    const start = Math.max(1, Number(q.get('startIndex')) || 1), count = Math.min(200, Number(q.get('count') ?? 100))
    return { schemas: [LIST], totalResults: items.length, startIndex: start, itemsPerPage: Math.min(count, Math.max(0, items.length - start + 1)), Resources: items.slice(start - 1, start - 1 + count) }
  }
  // Providers only ever filter by one attribute: userName/displayName/externalId eq "value".
  const eqFilter = q => { const m = /^(\w+)\s+eq\s+"([^"]*)"$/i.exec(q.get('filter') ?? ''); return m ? [m[1].toLowerCase(), m[2]] : null }

  const userIn = ws => id => {
    const u = db.prepare('SELECT u.id, u.email, u.name FROM users u WHERE u.id = ?').get(id)
    // Only people who are (or were provisioned into) this workspace are visible to its SCIM client.
    if (!u || !db.prepare('SELECT 1 FROM members WHERE workspace_id = ? AND user_id = ? UNION SELECT 1 FROM scim_users WHERE workspace_id = ? AND user_id = ?').get(ws, id, ws, id)) throw fail(404, 'User not found')
    return u
  }
  const setActive = (ws, id, active) => {
    if (active && !memberRole(ws, id)) db.prepare("INSERT INTO members VALUES (?, ?, 'member')").run(ws, id)
    if (!active && memberRole(ws, id)) {
      if (memberRole(ws, id) === 'owner' && db.prepare("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'").get(ws).n === 1) throw fail(400, 'The last owner can’t be deactivated')
      db.prepare('DELETE FROM members WHERE workspace_id = ? AND user_id = ?').run(ws, id)
      db.prepare('DELETE FROM grants WHERE user_id = ? AND page_id IN (SELECT id FROM pages WHERE workspace_id = ?)').run(id, ws)
      db.prepare('DELETE FROM group_members WHERE user_id = ? AND group_id IN (SELECT id FROM groups WHERE workspace_id = ?)').run(id, ws)
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND workspace_id = ?').run(id, ws)
    }
    audit(ws, null, active ? 'member.joined' : 'member.removed', id, 'via SCIM')
    liveReload(ws)
  }
  const groupIn = (ws, id) => { const g = db.prepare('SELECT * FROM groups WHERE id = ? AND workspace_id = ?').get(id, ws); if (!g) throw fail(404, 'Group not found'); return g }
  const setMembers = (ws, gid, ids) => {
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(gid)
    for (const id of new Set(ids)) if (memberRole(ws, id)) db.prepare('INSERT INTO group_members VALUES (?, ?)').run(gid, id)
  }

  /** Runs one SCIM request for workspace `ws`; returns [status, body]. */
  async function handle(ws, method, path, q, body) {
    const [, kind, id] = /^\/scim\/v2\/(\w+)(?:\/([\w-]+))?\/?$/.exec(path) ?? []
    if (kind === 'ServiceProviderConfig') return [200, { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'], patch: { supported: true }, filter: { supported: true, maxResults: 200 }, bulk: { supported: false }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', primary: true }] }]
    if (kind === 'Users') {
      const get = userIn(ws)
      if (method === 'GET' && !id) {
        const f = eqFilter(q)
        let rows = db.prepare('SELECT u.id, u.email, u.name FROM users u WHERE u.id IN (SELECT user_id FROM members WHERE workspace_id = ? UNION SELECT user_id FROM scim_users WHERE workspace_id = ?) ORDER BY u.created').all(ws, ws)
        if (f && f[0] === 'username') rows = rows.filter(u => u.email === f[1].trim().toLowerCase())
        return [200, list(rows.map(u => userOut(ws, u)), q)]
      }
      if (method === 'POST') {
        const email = String(body.userName ?? body.emails?.[0]?.value ?? '').trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'userName must be an email address')
        let u = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email)
        if (u && memberRole(ws, u.id)) throw fail(409, 'User already exists')
        if (!u) {
          // A provisioned person signs in with single sign-on (or Forgot password); the random password is never shown.
          const name = String(body.displayName ?? body.name?.formatted ?? [body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ') ?? '').trim() || email.split('@')[0]
          u = { id: randomUUID(), email, name: name.slice(0, 100) }
          db.prepare('INSERT INTO users (id, email, name, pass, created) VALUES (?, ?, ?, ?, ?)').run(u.id, email, u.name, hashPassword(token()), Date.now())
        }
        db.prepare('INSERT OR IGNORE INTO scim_users VALUES (?, ?)').run(ws, u.id)
        if (body.active !== false) setActive(ws, u.id, true)
        return [201, userOut(ws, u)]
      }
      if (!id) throw fail(405, 'Method not allowed')
      const u = get(id)
      if (method === 'GET') return [200, userOut(ws, u)]
      if (method === 'DELETE') { setActive(ws, id, false); db.prepare('DELETE FROM scim_users WHERE workspace_id = ? AND user_id = ?').run(ws, id); return [204, null] }
      if (method === 'PUT' || method === 'PATCH') {
        const changes = method === 'PUT' ? [{ value: body }] : (body.Operations ?? []).map(o => (o.path ? { value: { [o.path]: o.value } } : o))
        for (const { value } of changes) {
          if (!value || typeof value !== 'object') continue
          const name = value.displayName ?? value['name.formatted'] ?? value.name?.formatted
          if (typeof name === 'string' && name.trim()) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim().slice(0, 100), id)
          if ('active' in value) setActive(ws, id, value.active === true || value.active === 'True' || value.active === 'true')
        }
        return [200, userOut(ws, get(id))]
      }
    }
    if (kind === 'Groups') {
      if (method === 'GET' && !id) {
        const f = eqFilter(q)
        let rows = db.prepare('SELECT * FROM groups WHERE workspace_id = ? ORDER BY name').all(ws)
        if (f && f[0] === 'displayname') rows = rows.filter(g => g.name === f[1])
        return [200, list(rows.map(groupOut), q)]
      }
      if (method === 'POST') {
        const name = String(body.displayName ?? '').trim()
        if (!name) throw fail(400, 'displayName is required')
        const gid = randomUUID()
        db.prepare('INSERT INTO groups VALUES (?, ?, ?, ?)').run(gid, ws, name.slice(0, 100), Date.now())
        setMembers(ws, gid, (body.members ?? []).map(m => m.value))
        liveReload(ws)
        return [201, groupOut(groupIn(ws, gid))]
      }
      if (!id) throw fail(405, 'Method not allowed')
      const g = groupIn(ws, id)
      const current = () => db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(id).map(m => m.user_id)
      if (method === 'GET') return [200, groupOut(g)]
      if (method === 'DELETE') { for (const t of ['group_grants', 'group_members']) db.prepare(`DELETE FROM ${t} WHERE group_id = ?`).run(id); db.prepare('DELETE FROM groups WHERE id = ?').run(id); liveReload(ws); return [204, null] }
      if (method === 'PUT') { if (body.displayName) db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(String(body.displayName).slice(0, 100), id); setMembers(ws, id, (body.members ?? []).map(m => m.value)) }
      if (method === 'PATCH') {
        let members = current()
        for (const o of body.Operations ?? []) {
          const op = String(o.op).toLowerCase(), path = o.path ?? ''
          const sel = /^members\[value eq "([^"]+)"\]$/.exec(path)
          const vals = [o.value].flat().filter(Boolean).map(v => v.value ?? v)
          if (op === 'add' && (path === 'members' || !path)) members = [...members, ...(path ? vals : (o.value?.members ?? []).map(m => m.value))]
          else if (op === 'remove' && sel) members = members.filter(m => m !== sel[1])
          else if (op === 'remove' && path === 'members') members = vals.length ? members.filter(m => !vals.includes(m)) : []
          else if (op === 'replace' && path === 'members') members = vals
          else if (op === 'replace' && (path === 'displayName' || o.value?.displayName)) db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(String(path ? o.value : o.value.displayName).slice(0, 100), id)
        }
        setMembers(ws, id, members)
      }
      liveReload(ws)
      return [200, groupOut(groupIn(ws, id))]
    }
    throw fail(404, 'Not found')
  }

  /** The workspace a SCIM bearer token belongs to, or null. */
  const workspaceFor = raw => (raw ? db.prepare('SELECT workspace_id FROM scim_tokens WHERE token_hash = ?').get(sha(raw))?.workspace_id ?? null : null)
  return { handle, workspaceFor, PATCH }
}
