// Bloki server: one SQLite file, a JSON API, uploaded files and the built app.
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, createReadStream, existsSync, statSync, writeFileSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { createCollab } from './collab.mjs'

const ROOT = import.meta.dirname
const DATA = process.env.BLOKI_DATA || join(ROOT, 'data')
const FILES = join(DATA, 'files')
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.PORT || 4321)
const HOST = process.env.HOST || '127.0.0.1'
const SECURE_COOKIE = process.env.BLOKI_SECURE_COOKIE === '1'
const SESSION_DAYS = 30
const INVITE_DAYS = 7
const MAX_JSON = 5 * 1024 * 1024
const MAX_UPLOAD = 50 * 1024 * 1024
mkdirSync(FILES, { recursive: true })

export const db = new DatabaseSync(process.env.BLOKI_DB || join(DATA, 'bloki.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    kind TEXT NOT NULL DEFAULT 'page',
    title TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '[]',
    schema TEXT NOT NULL DEFAULT '{}',
    props TEXT NOT NULL DEFAULT '{}',
    favorite INTEGER NOT NULL DEFAULT 0,
    trashed INTEGER NOT NULL DEFAULT 0,
    full_width INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pages_parent ON pages(parent_id);
  CREATE TABLE IF NOT EXISTS history (page_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS history_page ON history(page_id, at);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    pass TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT,
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'guest')),
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS grants (
    page_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    PRIMARY KEY (page_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS favorites (user_id TEXT NOT NULL, page_id TEXT NOT NULL, PRIMARY KEY (user_id, page_id));
  CREATE TABLE IF NOT EXISTS invites (
    token_hash TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    page_id TEXT,
    level TEXT,
    created_by TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS comments_page ON comments(page_id, created);
  -- Synced blocks: one copy of content shared by every page that shows it. page_id is the original's page.
  CREATE TABLE IF NOT EXISTS synced (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '[]',
    updated INTEGER NOT NULL,
    updated_by TEXT
  );
  -- "Notify me" on a page: 'all' comments, or only 'replies' (threads you're in) and @mentions.
  CREATE TABLE IF NOT EXISTS watches (
    user_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    PRIMARY KEY (user_id, page_id)
  );
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    page_id TEXT,
    actor_id TEXT,
    text TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, workspace_id, created);
`)
// Columns added after the first release.
const addColumns = (table, cols) => {
  for (const [col, def] of cols)
    if (!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
}
addColumns('pages', [['workspace_id', 'TEXT'], ['workspace_access', 'TEXT'], ['public', 'INTEGER NOT NULL DEFAULT 0'], ['created_by', 'TEXT'], ['updated_by', 'TEXT'],
  ['trashed_at', 'INTEGER'], ['font', "TEXT NOT NULL DEFAULT 'default'"], ['small_text', 'INTEGER NOT NULL DEFAULT 0'], ['cover_y', 'REAL NOT NULL DEFAULT 50']])
addColumns('comments', [['thread_id', 'TEXT'], ['block_id', 'TEXT'], ['quote', 'TEXT'], ['reactions', 'TEXT']])
addColumns('history', [['user_id', 'TEXT']])
addColumns('users', [['prefs', "TEXT NOT NULL DEFAULT '{}'"]])

// Full-text search index (FTS5), kept in step with pages by triggers so every write path is covered.
// The body is the text of the page's blocks, pulled out of the BlockNote JSON by SQLite itself.
const BODY_TEXT = col => `(SELECT group_concat(value, ' ') FROM json_tree(CASE WHEN json_valid(${col}) THEN ${col} ELSE '[]' END) WHERE key = 'text' AND type = 'text')`
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS search_idx USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');
  CREATE TRIGGER IF NOT EXISTS pages_search_ai AFTER INSERT ON pages BEGIN
    INSERT INTO search_idx (rowid, title, body) VALUES (NEW.rowid, NEW.title, ${BODY_TEXT('NEW.content')});
  END;
  CREATE TRIGGER IF NOT EXISTS pages_search_ad AFTER DELETE ON pages BEGIN
    DELETE FROM search_idx WHERE rowid = OLD.rowid;
  END;
  CREATE TRIGGER IF NOT EXISTS pages_search_au AFTER UPDATE OF title, content ON pages BEGIN
    DELETE FROM search_idx WHERE rowid = OLD.rowid;
    INSERT INTO search_idx (rowid, title, body) VALUES (NEW.rowid, NEW.title, ${BODY_TEXT('NEW.content')});
  END;
`)
// Pages written before the index existed are indexed once.
if (db.prepare('SELECT COUNT(*) AS n FROM search_idx').get().n !== db.prepare('SELECT COUNT(*) AS n FROM pages').get().n) {
  db.exec(`DELETE FROM search_idx; INSERT INTO search_idx (rowid, title, body) SELECT rowid, title, ${BODY_TEXT('content')} FROM pages`)
}

/* ---------- Access levels (same ladder as Notion) ---------- */

export const LEVELS = ['none', 'view', 'comment', 'edit_content', 'edit', 'full']
const rank = l => LEVELS.indexOf(l ?? 'none')
const maxLevel = (a, b) => (rank(a) >= rank(b) ? a : b)
export const atLeast = (have, need) => rank(have) >= rank(need)
const ROLES = ['owner', 'member', 'guest']

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const deny = (msg = 'You do not have access to this page.') => { throw new HttpError(403, msg) }

export const roleOf = (wsId, userId) => db.prepare('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?').get(wsId, userId)?.role

/**
 * Effective level of every page in a workspace for one user.
 * - "Everyone at workspace" access is the nearest `workspace_access` up the tree (root default: full).
 *   Members get it; owners get full wherever it isn't "none"; guests never get it.
 * - Personal grants: the nearest grant for this user up the tree.
 * - Effective = the higher of the two. "Can edit content" applies to databases; inside one it means edit.
 */
// ponytail: recomputes the whole workspace per request, cache per request if workspaces reach ~50k pages
export function accessMap(userId, wsId) {
  const role = roleOf(wsId, userId)
  const out = new Map()
  if (!role) return out
  const pages = db.prepare('SELECT id, parent_id, kind, workspace_access FROM pages WHERE workspace_id = ?').all(wsId)
  const grants = new Map(db.prepare('SELECT g.page_id, g.level FROM grants g JOIN pages p ON p.id = g.page_id WHERE g.user_id = ? AND p.workspace_id = ?').all(userId, wsId).map(g => [g.page_id, g.level]))
  const byId = new Map(pages.map(p => [p.id, p]))
  const memo = new Map()
  const resolve = id => {
    if (memo.has(id)) return memo.get(id)
    const p = byId.get(id)
    const up = p.parent_id && byId.has(p.parent_id) ? resolve(p.parent_id) : { ws: 'full', grant: 'none', inDb: false }
    const r = { ws: p.workspace_access ?? up.ws, grant: grants.get(id) ?? up.grant, inDb: up.inDb || byId.get(p.parent_id)?.kind === 'db' }
    memo.set(id, r)
    return r
  }
  for (const p of pages) {
    const r = resolve(p.id)
    const ws = role === 'guest' ? 'none' : role === 'owner' && r.ws !== 'none' ? 'full' : r.ws
    let level = maxLevel(ws, r.grant)
    if (level === 'edit_content' && r.inDb) level = 'edit'
    out.set(p.id, level)
  }
  return out
}

export function pageAccess(userId, pageId) {
  const p = db.prepare('SELECT workspace_id FROM pages WHERE id = ?').get(pageId)
  if (!p) throw new HttpError(404, 'Page not found.')
  return accessMap(userId, p.workspace_id).get(pageId) ?? 'none'
}

function need(userId, pageId, level) {
  const have = pageAccess(userId, pageId)
  if (!atLeast(have, level)) deny()
  return have
}

/* ---------- Users, sessions, workspaces ---------- */

const sha = s => createHash('sha256').update(s).digest('hex')
const token = () => randomBytes(32).toString('base64url')

export function hashPassword(password) {
  const salt = randomBytes(16)
  return salt.toString('hex') + ':' + scryptSync(password, salt, 64).toString('hex')
}
export function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const got = scryptSync(password, Buffer.from(salt, 'hex'), 64)
  return timingSafeEqual(got, Buffer.from(hash, 'hex'))
}

const cleanEmail = e => String(e ?? '').trim().toLowerCase()
function validateCredentials({ email, password, name }, needName = true) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email))) throw new HttpError(400, 'Enter a valid email address.')
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.')
  if (password.length > 200) throw new HttpError(400, 'Password is too long.')
  if (needName && !String(name ?? '').trim()) throw new HttpError(400, 'Enter your name.')
}

export function createWorkspace(userId, name) {
  const id = randomUUID()
  db.prepare('INSERT INTO workspaces (id, name, created) VALUES (?, ?, ?)').run(id, String(name).trim().slice(0, 100) || 'Workspace', Date.now())
  db.prepare("INSERT INTO members VALUES (?, ?, 'owner')").run(id, userId)
  return id
}

function useInvite(rawToken, userId) {
  const inv = db.prepare('SELECT * FROM invites WHERE token_hash = ? AND expires > ?').get(sha(rawToken), Date.now())
  if (!inv) throw new HttpError(400, 'This invite link is invalid or has expired.')
  const role = roleOf(inv.workspace_id, userId)
  // Never downgrade someone who is already in the workspace.
  if (!role) db.prepare('INSERT INTO members VALUES (?, ?, ?)').run(inv.workspace_id, userId, inv.role)
  else if (role === 'guest' && inv.role === 'member') db.prepare("UPDATE members SET role = 'member' WHERE workspace_id = ? AND user_id = ?").run(inv.workspace_id, userId)
  if (inv.page_id) {
    const cur = db.prepare('SELECT level FROM grants WHERE page_id = ? AND user_id = ?').get(inv.page_id, userId)?.level
    db.prepare('INSERT OR REPLACE INTO grants VALUES (?, ?, ?)').run(inv.page_id, userId, maxLevel(cur, inv.level))
  }
  db.prepare('DELETE FROM invites WHERE token_hash = ?').run(inv.token_hash)
  return inv
}

export function register({ email, name, password, invite }) {
  validateCredentials({ email, password, name })
  const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get()
  if (!first && !invite) throw new HttpError(403, 'Sign-up needs an invite link from a workspace owner.')
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail(email))) throw new HttpError(409, 'An account with this email already exists. Log in instead.')
  if (invite && !db.prepare('SELECT 1 FROM invites WHERE token_hash = ? AND expires > ?').get(sha(invite), Date.now()))
    throw new HttpError(400, 'This invite link is invalid or has expired.')
  const id = randomUUID()
  db.prepare('INSERT INTO users (id, email, name, pass, created) VALUES (?, ?, ?, ?, ?)').run(id, cleanEmail(email), String(name).trim().slice(0, 100), hashPassword(password), Date.now())
  let ws, page = null
  if (first) {
    // The first account owns everything created before accounts existed.
    ws = createWorkspace(id, `${String(name).trim()}'s workspace`)
    db.prepare('UPDATE pages SET workspace_id = ?, created_by = COALESCE(created_by, ?) WHERE workspace_id IS NULL').run(ws, id)
    db.prepare('INSERT OR IGNORE INTO favorites SELECT ?, id FROM pages WHERE favorite = 1').run(id)
  } else {
    const inv = useInvite(invite, id)
    ws = inv.workspace_id
    page = inv.page_id
  }
  return { userId: id, workspaceId: ws, pageId: page }
}

// ponytail: in-memory throttle, resets on restart; fine for one process
const failures = new Map()
export function login({ email, password }, ip = '') {
  const key = ip + '|' + cleanEmail(email)
  const f = failures.get(key)
  if (f && f.count >= 10 && f.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.')
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail(email))
  if (!user || typeof password !== 'string' || !checkPassword(password, user.pass)) {
    const n = f && f.until > Date.now() ? f.count + 1 : 1
    failures.set(key, { count: n, until: Date.now() + 15 * 60 * 1000 })
    throw new HttpError(401, 'Wrong email or password.')
  }
  failures.delete(key)
  return user.id
}

export function startSession(userId, workspaceId) {
  const t = token()
  const ws = workspaceId ?? db.prepare("SELECT workspace_id FROM members WHERE user_id = ? ORDER BY role = 'guest', rowid LIMIT 1").get(userId)?.workspace_id
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(sha(t), userId, ws ?? null, Date.now() + SESSION_DAYS * 864e5)
  return t
}

export function sessionUser(rawToken) {
  if (!rawToken) return null
  const s = db.prepare('SELECT s.token_hash, s.workspace_id, u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?').get(sha(rawToken), Date.now())
  if (!s) return null
  // A session whose workspace was left or deleted falls back to another one.
  if (s.workspace_id && !roleOf(s.workspace_id, s.id)) s.workspace_id = null
  if (!s.workspace_id) {
    s.workspace_id = db.prepare("SELECT workspace_id FROM members WHERE user_id = ? ORDER BY role = 'guest', rowid LIMIT 1").get(s.id)?.workspace_id ?? null
    db.prepare('UPDATE sessions SET workspace_id = ? WHERE token_hash = ?').run(s.workspace_id, s.token_hash)
  }
  return { id: s.id, email: s.email, name: s.name, workspaceId: s.workspace_id, tokenHash: s.token_hash }
}

export function me(user) {
  const prefs = JSON.parse(db.prepare('SELECT prefs FROM users WHERE id = ?').get(user.id)?.prefs ?? '{}')
  const workspaces = db.prepare('SELECT w.id, w.name, w.icon, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.created').all(user.id)
  return { user: { id: user.id, email: user.email, name: user.name }, prefs, workspaceId: user.workspaceId, role: user.workspaceId ? roleOf(user.workspaceId, user.id) : null, workspaces }
}

export function people(user, wsId) {
  const role = roleOf(wsId, user.id)
  if (!role) deny('You are not in this workspace.')
  // Guests see names only, like in Notion.
  return db.prepare("SELECT u.id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.name").all(wsId)
    .map(p => (role === 'guest' && p.id !== user.id ? { id: p.id, name: p.name, role: p.role } : p))
}

function needOwner(user, wsId) {
  if (roleOf(wsId, user.id) !== 'owner') deny('Only workspace owners can do this.')
}

export function setRole(user, wsId, targetId, role) {
  needOwner(user, wsId)
  if (!ROLES.includes(role)) throw new HttpError(400, 'Unknown role.')
  if (!roleOf(wsId, targetId)) throw new HttpError(404, 'Not a member.')
  if (role !== 'owner' && roleOf(wsId, targetId) === 'owner' && ownerCount(wsId) === 1) throw new HttpError(400, 'A workspace needs at least one owner.')
  db.prepare('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?').run(role, wsId, targetId)
}

const ownerCount = wsId => db.prepare("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'").get(wsId).n

export function removeMember(user, wsId, targetId) {
  // Anyone may leave; only owners may remove others.
  if (targetId !== user.id) needOwner(user, wsId)
  if (roleOf(wsId, targetId) === 'owner' && ownerCount(wsId) === 1) throw new HttpError(400, 'A workspace needs at least one owner.')
  db.prepare('DELETE FROM members WHERE workspace_id = ? AND user_id = ?').run(wsId, targetId)
  db.prepare('DELETE FROM grants WHERE user_id = ? AND page_id IN (SELECT id FROM pages WHERE workspace_id = ?)').run(targetId, wsId)
}

export function createInvite(user, wsId, { role = 'member', page_id = null, level = null } = {}) {
  if (!ROLES.includes(role) || role === 'owner') throw new HttpError(400, 'Invites are for members or guests.')
  if (page_id) {
    // Page invites (guests) need full access to that page, like Notion's Share menu.
    if (db.prepare('SELECT workspace_id FROM pages WHERE id = ?').get(page_id)?.workspace_id !== wsId) throw new HttpError(404, 'Page not found.')
    need(user.id, page_id, 'full')
    if (!LEVELS.includes(level) || level === 'none') throw new HttpError(400, 'Unknown access level.')
  } else needOwner(user, wsId)
  const t = token()
  db.prepare('INSERT INTO invites VALUES (?, ?, ?, ?, ?, ?, ?)').run(sha(t), wsId, role, page_id, level, user.id, Date.now() + INVITE_DAYS * 864e5)
  return t
}

export function inviteInfo(rawToken) {
  const inv = db.prepare('SELECT i.role, i.level, w.name AS workspace, p.title AS page, u.name AS inviter FROM invites i JOIN workspaces w ON w.id = i.workspace_id JOIN users u ON u.id = i.created_by LEFT JOIN pages p ON p.id = i.page_id WHERE i.token_hash = ? AND i.expires > ?').get(sha(rawToken), Date.now())
  if (!inv) throw new HttpError(404, 'This invite link is invalid or has expired.')
  return inv
}

export { useInvite as acceptInvite }

/** Deleting an account keeps the pages it made; it can't leave a shared workspace without an owner. */
export function deleteAccount(user, password) {
  const u = db.prepare('SELECT pass FROM users WHERE id = ?').get(user.id)
  if (typeof password !== 'string' || !checkPassword(password, u.pass)) throw new HttpError(400, 'Password is wrong.')
  for (const m of db.prepare("SELECT workspace_id FROM members WHERE user_id = ? AND role = 'owner'").all(user.id)) {
    const others = db.prepare('SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND user_id != ?').get(m.workspace_id, user.id).n
    if (others && ownerCount(m.workspace_id) === 1) throw new HttpError(400, 'Make someone else an owner of your shared workspaces first.')
  }
  // Workspaces only this person was in go with them.
  for (const m of db.prepare('SELECT workspace_id FROM members WHERE user_id = ?').all(user.id)) {
    if (db.prepare('SELECT COUNT(*) AS n FROM members WHERE workspace_id = ?').get(m.workspace_id).n === 1) {
      for (const t of ['history', 'grants', 'favorites', 'comments', 'notifications', 'watches', 'synced']) db.prepare(`DELETE FROM ${t} WHERE page_id IN (SELECT id FROM pages WHERE workspace_id = ?)`).run(m.workspace_id)
      db.prepare('DELETE FROM pages WHERE workspace_id = ?').run(m.workspace_id)
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(m.workspace_id)
    }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
}

/** Everything in a workspace the owner can see, as one JSON backup. */
export function exportWorkspace(user, wsId) {
  needOwner(user, wsId)
  const access = accessMap(user.id, wsId)
  const pages = db.prepare('SELECT * FROM pages WHERE workspace_id = ? AND trashed = 0').all(wsId).filter(p => atLeast(access.get(p.id), 'view')).map(decode)
  const comments = db.prepare(`SELECT * FROM comments WHERE page_id IN (${pages.map(() => '?').join(',') || "''"})`).all(...pages.map(p => p.id))
  return { format: 'bloki-export-1', exported: Date.now(), workspace: db.prepare('SELECT name FROM workspaces WHERE id = ?').get(wsId).name, pages, comments }
}

/* ---------- Pages ---------- */

const META = 'id, parent_id, kind, title, icon, cover, cover_y, schema, props, trashed, trashed_at, full_width, locked, font, small_text, position, created, updated, workspace_access, public, created_by, updated_by'
const CONTENT_FIELDS = ['title', 'icon', 'cover', 'cover_y', 'content', 'props', 'full_width', 'locked', 'font', 'small_text']
const JSON_COLS = ['content', 'schema', 'props']
const SNAPSHOT_EVERY = 10 * 60 * 1000

function decode(row) {
  if (!row) return row
  for (const c of JSON_COLS) if (c in row) row[c] = JSON.parse(row[c])
  for (const c of ['trashed', 'full_width', 'locked', 'public', 'small_text']) if (c in row) row[c] = !!row[c]
  return row
}

function encode(body, fields) {
  const out = {}
  for (const k of fields) {
    if (!(k in body)) continue
    const v = body[k]
    out[k] = JSON_COLS.includes(k) ? JSON.stringify(v) : typeof v === 'boolean' ? Number(v) : v
  }
  return out
}

function descendants(id) {
  return db.prepare(`
    WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT p.id FROM pages p JOIN t ON p.parent_id = t.id)
    SELECT id FROM t`).all(id).map(r => r.id)
}

const isFavorite = (userId, pageId) => !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND page_id = ?').get(userId, pageId)

function canCreateIn(user, wsId, parentId) {
  if (parentId) {
    const parent = db.prepare('SELECT kind, workspace_id FROM pages WHERE id = ?').get(parentId)
    if (!parent || parent.workspace_id !== wsId) throw new HttpError(404, 'Parent page not found.')
    need(user.id, parentId, parent.kind === 'db' ? 'edit_content' : 'edit')
  } else if (!['owner', 'member'].includes(roleOf(wsId, user.id))) deny('Guests can only add pages inside pages shared with them.')
}

/** `section`: 'workspace' or 'private' for top-level pages. Private pages start visible only to their creator. */
export function createPage(user, body) {
  const wsId = body.parent_id ? db.prepare('SELECT workspace_id FROM pages WHERE id = ?').get(body.parent_id)?.workspace_id : user.workspaceId
  if (!wsId) throw new HttpError(400, 'No workspace selected.')
  canCreateIn(user, wsId, body.parent_id)
  const parent = body.parent_id ? db.prepare('SELECT kind FROM pages WHERE id = ?').get(body.parent_id) : null
  // Only full editors of a database may change its structure, so rows can't carry a schema in.
  const fields = ['title', 'icon', 'cover', 'content', 'props', 'full_width', ...(parent?.kind === 'db' ? [] : ['kind', 'schema'])]
  const now = Date.now()
  const id = randomUUID()
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM pages WHERE parent_id IS ? AND workspace_id = ?').get(body.parent_id ?? null, wsId).p
  const priv = !body.parent_id && body.section === 'private'
  // Database rows get the next number for every ID property, as Notion's unique IDs.
  if (parent?.kind === 'db') {
    const schema = JSON.parse(db.prepare('SELECT schema FROM pages WHERE id = ?').get(body.parent_id).schema)
    const props = { ...(body.props ?? {}) }
    for (const p of schema.props ?? []) {
      if (p.type !== 'unique_id') continue
      const max = db.prepare("SELECT MAX(CAST(json_extract(props, '$.' || ?) AS INTEGER)) AS m FROM pages WHERE parent_id = ?").get(p.id, body.parent_id).m ?? 0
      props[p.id] = max + 1
    }
    body = { ...body, props }
  }
  const row = {
    position: pos, ...encode(body, fields), id, parent_id: body.parent_id ?? null, workspace_id: wsId,
    workspace_access: body.parent_id ? null : priv ? 'none' : 'full', created_by: user.id, updated_by: user.id, created: now, updated: now,
  }
  if (row.kind && !['page', 'db'].includes(row.kind)) throw new HttpError(400, 'Unknown page kind.')
  const cols = Object.keys(row)
  db.prepare(`INSERT INTO pages (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row))
  if (priv) db.prepare("INSERT INTO grants VALUES (?, ?, 'full')").run(id, user.id)
  liveReload(wsId)
  if (parent?.kind === 'db') runAutomations(user, id, 'added')
  return getPage(user, id)
}

export function getPage(user, id, { meta = false } = {}) {
  const level = need(user.id, id, 'view')
  // `meta`: just what the sidebar and databases show, without the page's blocks.
  return { ...decode(db.prepare(`SELECT ${meta ? META : '*'} FROM pages WHERE id = ?`).get(id)), access: level, favorite: isFavorite(user.id, id) }
}

export function listPages(user) {
  if (!user.workspaceId) return []
  const access = accessMap(user.id, user.workspaceId)
  const role = roleOf(user.workspaceId, user.id)
  const favs = new Set(db.prepare('SELECT page_id FROM favorites WHERE user_id = ?').all(user.id).map(f => f.page_id))
  const rows = db.prepare(`SELECT ${META} FROM pages WHERE workspace_id = ? ORDER BY position`).all(user.workspaceId)
    .filter(p => atLeast(access.get(p.id), 'view'))
  const visible = new Set(rows.map(r => r.id))
  // Who besides me has personal access to each top-level page decides Private vs Shared.
  const others = new Set(db.prepare('SELECT DISTINCT page_id FROM grants WHERE user_id != ?').all(user.id).map(g => g.page_id))
  return rows.map(p => {
    const top = !p.parent_id || !visible.has(p.parent_id)
    const section = !top ? undefined
      : p.parent_id ? 'shared'
      : p.workspace_access !== 'none' && role !== 'guest' ? 'workspace'
      : others.has(p.id) || !atLeast(access.get(p.id), 'full') ? 'shared' : 'private'
    return { ...decode(p), access: access.get(p.id), favorite: favs.has(p.id), section }
  })
}

/* ---------- Automations ---------- */
// A database's automations run here when a row is added or one of its properties changes. Their own edits don't
// trigger further automations, so they can't loop.
const sameVal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const matchesValue = (v, want) => want === undefined || want === '' || (Array.isArray(v) ? v.map(String).includes(String(want)) : String(v ?? '') === String(want))
export function runAutomations(user, rowId, event, prevProps = {}) {
  const r = db.prepare('SELECT id, parent_id, props, workspace_id FROM pages WHERE id = ?').get(rowId)
  const parent = r?.parent_id && db.prepare('SELECT kind, schema FROM pages WHERE id = ?').get(r.parent_id)
  if (parent?.kind !== 'db') return
  const schema = JSON.parse(parent.schema || '{}')
  const props = JSON.parse(r.props || '{}')
  if (props._template) return
  const known = new Set((schema.props ?? []).map(p => p.id))
  const next = { ...props }
  let changed = false
  for (const a of (schema.automations ?? []).slice(0, 50)) {
    if (!a?.enabled) continue
    const t = a.trigger ?? {}
    const fire = event === 'added' ? t.type === 'added' : t.type === 'edited' && !sameVal(prevProps[t.prop], props[t.prop]) && matchesValue(props[t.prop], t.value)
    if (!fire) continue
    for (const act of (a.actions ?? []).slice(0, 20)) {
      if (act?.type === 'set' && known.has(act.prop)) { next[act.prop] = act.value; changed = true }
      if (act?.type === 'notify' && typeof act.user === 'string') {
        let ok = false
        try { ok = atLeast(pageAccess(act.user, rowId), 'view') } catch { /* unknown person */ }
        if (ok) notify(act.user, r.workspace_id, 'automation', rowId, user.id, String(a.name || 'Automation').slice(0, 100))
      }
    }
  }
  if (changed) { db.prepare('UPDATE pages SET props = ? WHERE id = ?').run(JSON.stringify(next), rowId); livePages(r.workspace_id, [rowId]) }
}

export function updatePage(user, id, body) {
  const prev = db.prepare('SELECT * FROM pages WHERE id = ?').get(id)
  if (!prev) throw new HttpError(404, 'Page not found.')
  const level = need(user.id, id, 'view')

  if ('favorite' in body) {
    if (body.favorite) db.prepare('INSERT OR IGNORE INTO favorites VALUES (?, ?)').run(user.id, id)
    else db.prepare('DELETE FROM favorites WHERE user_id = ? AND page_id = ?').run(user.id, id)
  }

  const row = {}
  const wantsContent = CONTENT_FIELDS.some(f => f in body)
  if (wantsContent) {
    if (!atLeast(level, 'edit')) deny('You don’t have edit access to this page.')
    if (prev.locked && !('locked' in body) && ['title', 'content'].some(f => f in body)) throw new HttpError(423, 'This page is locked.')
    Object.assign(row, encode(body, CONTENT_FIELDS))
  }
  if ('schema' in body) {
    if (!atLeast(level, 'edit')) deny('You can edit rows here, but not the database structure.')
    row.schema = JSON.stringify(body.schema)
  }
  if ('trashed' in body) {
    if (!atLeast(level, 'edit')) deny()
    row.trashed = Number(!!body.trashed)
    row.trashed_at = body.trashed ? Date.now() : null
  }
  if ('position' in body && !('parent_id' in body)) {
    // Reordering within the same parent is an edit, like dragging rows in a database.
    if (!atLeast(level, 'edit')) deny()
    row.position = Number(body.position)
  }
  if ('parent_id' in body) {
    if (!atLeast(level, 'full')) deny('You need full access to move this page.')
    if ('parent_id' in body && body.parent_id !== prev.parent_id) {
      if (body.parent_id && descendants(id).includes(body.parent_id)) throw new HttpError(400, 'A page cannot move inside itself.')
      canCreateIn(user, prev.workspace_id, body.parent_id)
      row.parent_id = body.parent_id ?? null
      // Moving to the top level keeps the page's current audience explicit.
      if (!body.parent_id && prev.workspace_access == null) row.workspace_access = 'full'
    }
    if ('position' in body) row.position = Number(body.position)
  }
  if (!Object.keys(row).length) return getPage(user, id)

  // Content written outside the live session replaces the shared document.
  if ('content' in body && !body.fromCollab) collab.reset(id)
  if ('content' in row && row.content !== prev.content) {
    const last = db.prepare('SELECT MAX(at) AS at FROM history WHERE page_id = ?').get(id).at ?? 0
    if (body.snapshot || Date.now() - last > SNAPSHOT_EVERY) db.prepare('INSERT INTO history (page_id, title, content, at, user_id) VALUES (?, ?, ?, ?, ?)').run(id, prev.title, prev.content, prev.updated, prev.updated_by)
  }
  row.updated = Date.now()
  row.updated_by = user.id
  // Trashing or restoring a page carries its whole subtree with it.
  if ('trashed' in row) {
    const ids = descendants(id)
    db.prepare(`UPDATE pages SET trashed = ?, trashed_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(row.trashed, row.trashed_at, ...ids)
  }
  if ('content' in row) notifyMentions(user, prev, row.content)
  const cols = Object.keys(row)
  db.prepare(`UPDATE pages SET ${cols.map(c => `${c} = ?`).join(',')} WHERE id = ?`).run(...Object.values(row), id)
  // Trash and moves reshape the tree; anything else changes just this page.
  if ('trashed' in row || 'parent_id' in row || 'workspace_access' in row) liveReload(prev.workspace_id)
  else livePages(prev.workspace_id, [id])
  if ('props' in row && row.props !== prev.props) runAutomations(user, id, 'edited', JSON.parse(prev.props || '{}'))
  return getPage(user, id)
}

export function deletePage(user, id) {
  need(user.id, id, 'full')
  const wsId = db.prepare('SELECT workspace_id FROM pages WHERE id = ?').get(id)?.workspace_id
  const ids = descendants(id)
  for (const pid of ids) collab.reset(pid)
  const marks = ids.map(() => '?').join(',')
  for (const t of ['history', 'grants', 'favorites', 'comments', 'notifications', 'watches', 'synced']) db.prepare(`DELETE FROM ${t} WHERE page_id IN (${marks})`).run(...ids)
  db.prepare(`DELETE FROM invites WHERE page_id IN (${marks})`).run(...ids)
  db.prepare(`DELETE FROM pages WHERE id IN (${marks})`).run(...ids)
  liveReload(wsId)
}

export function duplicatePage(user, id, parent_id, suffix = ' (copy)') {
  const src = getPage(user, id)
  if (parent_id === undefined) parent_id = src.parent_id
  // Copying into a parent the user can't add to falls back to their private pages.
  let target = parent_id
  try { if (target) canCreateIn(user, src.workspace_id, target) } catch { target = null }
  const copy = createPage({ ...user, workspaceId: src.workspace_id }, { ...src, parent_id: target, title: src.title + suffix, section: target || src.workspace_access !== 'none' ? 'workspace' : 'private' })
  for (const child of db.prepare('SELECT id FROM pages WHERE parent_id = ? AND trashed = 0 ORDER BY position').all(id))
    if (atLeast(pageAccess(user.id, child.id), 'view')) duplicatePage(user, child.id, copy.id, '')
  return getPage(user, copy.id)
}

export function history(user, id) {
  need(user.id, id, 'view')
  return db.prepare('SELECT h.title, h.content, h.at, h.user_id, u.name FROM history h LEFT JOIN users u ON u.id = h.user_id WHERE h.page_id = ? ORDER BY h.at DESC LIMIT 100').all(id).map(decode)
}

/** Plain text of a page's blocks, for search snippets. */
function blockText(json) {
  return [...String(json).matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map(m => { try { return JSON.parse(`"${m[1]}"`) } catch { return m[1] } }).join(' ')
}

/** Words of a query as an FTS5 expression: every word must match, the last one may be unfinished (prefix). */
export function ftsQuery(q, titleOnly = false) {
  const words = String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  if (!words.length) return null
  const expr = words.map(w => `"${w}"*`).join(' ')
  return titleOnly ? `title : (${expr})` : expr
}

export function search(user, q, { titleOnly = false, mine = false } = {}) {
  if (!user.workspaceId) return []
  const match = ftsQuery(q, titleOnly)
  if (!match) return []
  const access = accessMap(user.id, user.workspaceId)
  // Ranked by FTS5's bm25 with title matches weighing ten times body matches, newest first on ties.
  const words = String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu)
  return db.prepare(`
    SELECT p.id, p.parent_id, p.kind, p.title, p.icon, p.updated, p.created_by, p.content FROM search_idx s JOIN pages p ON p.rowid = s.rowid
    WHERE search_idx MATCH ? AND p.workspace_id = ? AND p.trashed = 0 AND (? = 0 OR p.created_by = ? OR p.updated_by = ?)
    ORDER BY bm25(search_idx, 10.0, 1.0), p.updated DESC LIMIT 500`).all(match, user.workspaceId, Number(mine), user.id, user.id)
    .filter(p => atLeast(access.get(p.id), 'view')).slice(0, 50)
    .map(({ content, ...p }) => {
      const text = blockText(content)
      const lower = text.toLowerCase()
      const at = words.map(w => lower.indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? -1
      return { ...p, snippet: at < 0 ? '' : (at > 40 ? '…' : '') + text.slice(Math.max(0, at - 40), at + 120) }
    })
}

export function backlinks(user, id) {
  const p = db.prepare('SELECT workspace_id FROM pages WHERE id = ?').get(id)
  need(user.id, id, 'view')
  const access = accessMap(user.id, p.workspace_id)
  return db.prepare(`SELECT id, title, icon FROM pages WHERE workspace_id = ? AND trashed = 0 AND id != ? AND content LIKE ?`)
    .all(p.workspace_id, id, `%"pageId":"${id}"%`).filter(b => atLeast(access.get(b.id), 'view'))
}

/* ---------- Sharing ---------- */

export function getShare(user, id) {
  const level = need(user.id, id, 'view')
  const p = db.prepare('SELECT workspace_id, workspace_access, public, parent_id FROM pages WHERE id = ?').get(id)
  // What the page inherits when it has no override of its own.
  let inherited = 'full'
  for (let a = p.parent_id && db.prepare('SELECT parent_id, workspace_access FROM pages WHERE id = ?').get(p.parent_id); a; a = a.parent_id && db.prepare('SELECT parent_id, workspace_access FROM pages WHERE id = ?').get(a.parent_id)) {
    if (a.workspace_access) { inherited = a.workspace_access; break }
  }
  const grants = db.prepare('SELECT g.user_id, g.level, u.name, u.email, m.role FROM grants g JOIN users u ON u.id = g.user_id LEFT JOIN members m ON m.user_id = g.user_id AND m.workspace_id = ? WHERE g.page_id = ? ORDER BY u.name').all(p.workspace_id, id)
  const guestView = roleOf(p.workspace_id, user.id) === 'guest'
  return {
    access: level,
    workspace_access: p.workspace_access,
    inherited_workspace_access: inherited,
    public: !!p.public,
    grants: grants.map(g => (guestView && g.user_id !== user.id ? { ...g, email: undefined } : g)),
  }
}

export function setShare(user, id, body) {
  need(user.id, id, 'full')
  const p = db.prepare('SELECT workspace_id, parent_id FROM pages WHERE id = ?').get(id)
  if ('workspace_access' in body) {
    const v = body.workspace_access
    if (v !== null && !LEVELS.includes(v)) throw new HttpError(400, 'Unknown access level.')
    // Top-level pages always state their audience; sub-pages may inherit (null).
    db.prepare('UPDATE pages SET workspace_access = ? WHERE id = ?').run(v ?? (p.parent_id ? null : 'full'), id)
    // Like Notion, whoever restricts a page keeps full access to it.
    if (!atLeast(pageAccess(user.id, id), 'full')) db.prepare("INSERT OR REPLACE INTO grants VALUES (?, ?, 'full')").run(id, user.id)
  }
  if ('public' in body) db.prepare('UPDATE pages SET public = ? WHERE id = ?').run(Number(!!body.public), id)
  if ('grant' in body) {
    const { user_id, level } = body.grant
    if (!roleOf(p.workspace_id, user_id)) throw new HttpError(400, 'That person is not in this workspace. Invite them first.')
    if (level === null) db.prepare('DELETE FROM grants WHERE page_id = ? AND user_id = ?').run(id, user_id)
    else if (!LEVELS.includes(level)) throw new HttpError(400, 'Unknown access level.')
    else {
      const had = db.prepare('SELECT 1 FROM grants WHERE page_id = ? AND user_id = ?').get(id, user_id)
      db.prepare('INSERT OR REPLACE INTO grants VALUES (?, ?, ?)').run(id, user_id, level)
      if (!had) notify(user_id, p.workspace_id, 'share', id, user.id, LEVEL_LABELS[level])
    }
  }
  if ('invite_email' in body) {
    // Existing accounts join as guests straight away; anyone else gets an invite link to pass on.
    const email = cleanEmail(body.invite_email)
    const level = body.level ?? 'view'
    if (!LEVELS.includes(level) || level === 'none') throw new HttpError(400, 'Unknown access level.')
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
    if (existing) {
      if (!roleOf(p.workspace_id, existing.id)) db.prepare("INSERT INTO members VALUES (?, ?, 'guest')").run(p.workspace_id, existing.id)
      db.prepare('INSERT OR REPLACE INTO grants VALUES (?, ?, ?)').run(id, existing.id, level)
      notify(existing.id, p.workspace_id, 'share', id, user.id, LEVEL_LABELS[level])
    } else {
      return { ...getShare(user, id), invite: createInvite(user, p.workspace_id, { role: 'guest', page_id: id, level }) }
    }
  }
  // Who can see what may have changed.
  liveReload(p.workspace_id)
  return getShare(user, id)
}

/* ---------- Inbox ---------- */

const LEVEL_LABELS = { full: 'Full access', edit: 'Can edit', edit_content: 'Can edit content', comment: 'Can comment', view: 'Can view' }

export function notify(userId, wsId, kind, pageId, actorId, text = '') {
  if (userId === actorId) return
  // People can turn off each kind of notification in Settings > My notifications.
  const prefs = JSON.parse(db.prepare('SELECT prefs FROM users WHERE id = ?').get(userId)?.prefs ?? '{}')
  if (prefs.notify?.[kind] === false) return
  db.prepare('INSERT INTO notifications (id, user_id, workspace_id, kind, page_id, actor_id, text, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), userId, wsId, kind, pageId, actorId, String(text).slice(0, 300), Date.now())
}

const personMentions = json => new Set([...String(json).matchAll(/"type":"person","props":\{"userId":"([\w-]+)"/g)].map(m => m[1]))

/** People newly @-mentioned in a page hear about it, if they can open the page. */
function notifyMentions(user, prev, content) {
  const before = personMentions(prev.content)
  for (const uid of personMentions(content)) {
    if (before.has(uid) || !atLeast(pageAccess(uid, prev.id), 'view')) continue
    notify(uid, prev.workspace_id, 'mention', prev.id, user.id)
  }
}

export function inbox(user) {
  const items = db.prepare(`
    SELECT n.id, n.kind, n.page_id, n.text, n.created, n.read, n.archived, u.name AS actor, p.title AS page_title, p.icon AS page_icon, p.kind AS page_kind
    FROM notifications n LEFT JOIN users u ON u.id = n.actor_id LEFT JOIN pages p ON p.id = n.page_id
    WHERE n.user_id = ? AND n.workspace_id = ? ORDER BY n.created DESC LIMIT 200`).all(user.id, user.workspaceId)
    // Drop notices about pages the user has since lost access to.
    .filter(n => !n.page_id || atLeast(pageAccess(user.id, n.page_id), 'view'))
    .map(n => ({ ...n, read: !!n.read, archived: !!n.archived }))
  return { items, unread: items.filter(n => !n.read && !n.archived).length }
}

export function updateInbox(user, { ids, all, read, archived }) {
  const where = all ? 'user_id = ? AND workspace_id = ?' : `user_id = ? AND id IN (${(ids ?? []).map(() => '?').join(',') || "''"})`
  const args = all ? [user.id, user.workspaceId] : [user.id, ...(ids ?? [])]
  if (read !== undefined) db.prepare(`UPDATE notifications SET read = ? WHERE ${where}`).run(Number(!!read), ...args)
  if (archived !== undefined) db.prepare(`UPDATE notifications SET archived = ? WHERE ${where}`).run(Number(!!archived), ...args)
  return inbox(user)
}

/** Pages in the trash for over 30 days are deleted for good, as in Notion. */
export function purgeTrash(now = Date.now()) {
  for (const p of db.prepare('SELECT id FROM pages WHERE trashed = 1 AND trashed_at < ? AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM pages WHERE trashed = 1))').all(now - 30 * 864e5)) {
    const ids = descendants(p.id)
    const marks = ids.map(() => '?').join(',')
    for (const t of ['history', 'grants', 'favorites', 'comments', 'notifications', 'watches', 'synced']) db.prepare(`DELETE FROM ${t} WHERE page_id IN (${marks})`).run(...ids)
    db.prepare(`DELETE FROM pages WHERE id IN (${marks})`).run(...ids)
  }
}

/* ---------- Comments ---------- */

export function listComments(user, pageId) {
  need(user.id, pageId, 'view')
  return db.prepare('SELECT c.id, c.body, c.resolved, c.created, c.user_id, c.thread_id, c.block_id, c.quote, c.reactions, u.name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.page_id = ? ORDER BY c.created').all(pageId)
    .map(c => ({ ...c, resolved: !!c.resolved, reactions: c.reactions ? JSON.parse(c.reactions) : {} }))
}

/** `thread_id` replies to a discussion; `block_id` + `quote` anchor a new discussion to text in the page. */
export function addComment(user, pageId, body, { thread_id = null, block_id = null, quote = null, id = null, mentions = [] } = {}) {
  need(user.id, pageId, 'comment')
  const text = String(body ?? '').trim()
  if (!text) throw new HttpError(400, 'Write something first.')
  if (thread_id && !db.prepare('SELECT 1 FROM comments WHERE id = ? AND page_id = ?').get(thread_id, pageId)) throw new HttpError(404, 'Discussion not found.')
  // The editor may pick a new discussion's id up front, so it can mark the commented text before saving.
  const newId = !thread_id && typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) && !db.prepare('SELECT 1 FROM comments WHERE id = ?').get(id) ? id : randomUUID()
  db.prepare('INSERT INTO comments (id, page_id, user_id, body, resolved, created, thread_id, block_id, quote) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)')
    .run(newId, pageId, user.id, text.slice(0, 10000), Date.now(), thread_id, block_id ? String(block_id).slice(0, 64) : null, quote ? String(quote).slice(0, 500) : null)
  // Everyone already in the discussion hears about it, plus whoever follows all comments on the page
  // (the page's creator by default, unless they chose "Replies and @mentions").
  const page = db.prepare('SELECT created_by, workspace_id FROM pages WHERE id = ?').get(pageId)
  const people = new Set(db.prepare('SELECT DISTINCT user_id FROM comments WHERE page_id = ? AND (? IS NULL OR id = ? OR thread_id = ?)').all(pageId, thread_id, thread_id, thread_id).map(r => r.user_id))
  if (watchMode(page.created_by, pageId, page.created_by) === 'all') people.add(page.created_by)
  for (const r of db.prepare("SELECT user_id FROM watches WHERE page_id = ? AND mode = 'all'").all(pageId)) people.add(r.user_id)
  for (const uid of people) if (uid && atLeast(pageAccess(uid, pageId), 'view')) notify(uid, page.workspace_id, 'comment', pageId, user.id, text)
  // @-mentioned people who can open the page get a mention, unless they were already told about the comment.
  for (const uid of new Set(Array.isArray(mentions) ? mentions.slice(0, 50).map(String) : [])) {
    if (uid !== user.id && !people.has(uid) && atLeast(pageAccess(uid, pageId), 'view')) notify(uid, page.workspace_id, 'mention', pageId, user.id, text)
  }
  return listComments(user, pageId)
}

/* ---------- Synced blocks ---------- */
// Anyone who can see the original's page can see a synced block; editing it needs edit access to that page.
// Pages showing a synced block, found by its id in their saved content.
const syncedPages = id => db.prepare("SELECT id FROM pages WHERE trashed = 0 AND content LIKE ?").all(`%"syncId":"${id}"%`).map(r => r.id)
const syncedOut = (user, r) => ({ id: r.id, page_id: r.page_id, content: JSON.parse(r.content), updated: r.updated, canEdit: atLeast(pageAccess(user.id, r.page_id), 'edit'), copies: syncedPages(r.id).length })
const checkBlocks = content => {
  if (!Array.isArray(content)) throw new HttpError(400, 'Content must be a list of blocks.')
  const json = JSON.stringify(content)
  if (json.length > 500_000) throw new HttpError(413, 'This synced block is too large.')
  return json
}
export function createSynced(user, pageId, content = []) {
  need(user.id, pageId, 'edit')
  const id = randomUUID()
  db.prepare('INSERT INTO synced (id, page_id, content, updated, updated_by) VALUES (?, ?, ?, ?, ?)').run(id, pageId, checkBlocks(content), Date.now(), user.id)
  return getSynced(user, id)
}
export function getSynced(user, id) {
  const r = db.prepare('SELECT * FROM synced WHERE id = ?').get(String(id))
  if (!r) throw new HttpError(404, 'Synced block not found.')
  need(user.id, r.page_id, 'view')
  return syncedOut(user, r)
}
/** Unsync all: every copy (on pages this person can edit) becomes ordinary blocks holding the synced content. */
export function unsyncAll(user, id) {
  const r = db.prepare('SELECT * FROM synced WHERE id = ?').get(String(id))
  if (!r) throw new HttpError(404, 'Synced block not found.')
  need(user.id, r.page_id, 'edit')
  const fresh = b => ({ ...b, id: randomUUID(), children: (b.children ?? []).map(fresh) })
  const inner = JSON.parse(r.content)
  const swap = blocks => blocks.flatMap(b => (b?.type === 'synced' && b.props?.syncId === r.id ? inner.map(fresh) : [{ ...b, children: swap(b.children ?? []) }]))
  const done = []
  for (const pid of syncedPages(r.id)) {
    if (!atLeast(pageAccess(user.id, pid), 'edit')) continue
    const p = db.prepare('SELECT content, workspace_id FROM pages WHERE id = ?').get(pid)
    db.prepare('UPDATE pages SET content = ?, updated = ?, updated_by = ? WHERE id = ?').run(JSON.stringify(swap(JSON.parse(p.content || '[]'))), Date.now(), user.id, pid)
    collab.reset(pid)
    livePages(p.workspace_id, [pid])
    done.push(pid)
  }
  return { pages: done.length }
}

export function updateSynced(user, id, content) {
  const r = db.prepare('SELECT * FROM synced WHERE id = ?').get(String(id))
  if (!r) throw new HttpError(404, 'Synced block not found.')
  need(user.id, r.page_id, 'edit')
  db.prepare('UPDATE synced SET content = ?, updated = ?, updated_by = ? WHERE id = ?').run(checkBlocks(content), Date.now(), user.id, r.id)
  // Every open copy refreshes; only people who can see the original are told.
  const ws = db.prepare('SELECT workspace_id FROM pages WHERE id = ?').get(r.page_id)?.workspace_id
  for (const c of liveConns) if (c.workspaceId === ws) { try { if (atLeast(pageAccess(c.userId, r.page_id), 'view')) liveSend(c, { type: 'synced', id: r.id, by: user.id }) } catch { /* no access */ } }
  return getSynced(user, r.id)
}

/** A person's "Notify me" choice on a page; the creator follows all comments unless they said otherwise. */
export function watchMode(userId, pageId, createdBy = db.prepare('SELECT created_by FROM pages WHERE id = ?').get(pageId)?.created_by) {
  return db.prepare('SELECT mode FROM watches WHERE user_id = ? AND page_id = ?').get(userId, pageId)?.mode ?? (userId === createdBy ? 'all' : 'replies')
}

export function setWatch(user, pageId, mode) {
  need(user.id, pageId, 'view')
  if (!['all', 'replies'].includes(mode)) throw new HttpError(400, 'Choose all or replies.')
  db.prepare('INSERT INTO watches (user_id, page_id, mode) VALUES (?, ?, ?) ON CONFLICT(user_id, page_id) DO UPDATE SET mode = excluded.mode').run(user.id, pageId, mode)
  return { mode }
}

export function updateComment(user, commentId, body) {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId)
  if (!c) throw new HttpError(404, 'Comment not found.')
  const level = need(user.id, c.page_id, 'comment')
  if (body.delete) {
    if (c.user_id !== user.id && !atLeast(level, 'full')) deny('You can only delete your own comments.')
    db.prepare('DELETE FROM comments WHERE id = ? OR thread_id = ?').run(commentId, commentId)
  } else if ('react' in body) {
    // Toggle this user's emoji reaction. Only a short, letter-free string is accepted as an emoji.
    const emoji = String(body.react ?? '')
    if (!emoji || emoji.length > 16 || /[\x00-\x7f]/.test(emoji)) throw new HttpError(400, 'Pick an emoji.')
    const r = c.reactions ? JSON.parse(c.reactions) : {}
    const who = new Set(r[emoji] ?? [])
    if (who.has(user.id)) who.delete(user.id); else who.add(user.id)
    if (who.size) r[emoji] = [...who]; else delete r[emoji]
    if (Object.keys(r).length > 50) throw new HttpError(400, 'Too many reactions.')
    db.prepare('UPDATE comments SET reactions = ? WHERE id = ?').run(JSON.stringify(r), commentId)
  } else if ('resolved' in body) {
    db.prepare('UPDATE comments SET resolved = ? WHERE id = ? OR thread_id = ?').run(Number(!!body.resolved), commentId, commentId)
  } else if ('body' in body) {
    if (c.user_id !== user.id) deny('You can only edit your own comments.')
    const text = String(body.body ?? '').trim()
    if (!text) throw new HttpError(400, 'Write something first.')
    db.prepare('UPDATE comments SET body = ? WHERE id = ?').run(text.slice(0, 10000), commentId)
  }
  return listComments(user, c.page_id)
}

/* ---------- Published pages (Share to web) ---------- */

function publicRoot(rootId) {
  const root = db.prepare('SELECT id, public, trashed FROM pages WHERE id = ?').get(rootId)
  if (!root || !root.public || root.trashed) throw new HttpError(404, 'This page is not published.')
  return descendants(rootId)
}

export function publicPages(rootId) {
  const ids = new Set(publicRoot(rootId))
  return db.prepare(`SELECT ${META} FROM pages WHERE id IN (${[...ids].map(() => '?').join(',')}) AND trashed = 0 ORDER BY position`).all(...ids)
    .map(p => ({ ...decode(p), access: 'view', favorite: false, section: p.id === rootId ? 'workspace' : undefined, parent_id: p.id === rootId ? null : p.parent_id }))
}

export function publicPage(rootId, id) {
  if (!publicRoot(rootId).includes(id)) throw new HttpError(404, 'This page is not published.')
  const p = decode(db.prepare('SELECT * FROM pages WHERE id = ? AND trashed = 0').get(id))
  if (!p) throw new HttpError(404, 'Page not found.')
  return { ...p, access: 'view', favorite: false, parent_id: id === rootId ? null : p.parent_id }
}

/* ---------- HTTP ---------- */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.json': 'application/json' }

function sendFile(res, path, extra = {}) {
  const type = MIME[extname(path).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', ...extra })
  createReadStream(path).pipe(res)
}

function readBody(req, limit) {
  return new Promise((ok, fail) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > limit) { fail(new HttpError(413, 'Too large.')); req.destroy() } else chunks.push(c)
    }).on('end', () => ok(Buffer.concat(chunks))).on('error', fail)
  })
}

const cookie = (name, value, maxAge) =>
  `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
}

// Each route: [method, pattern, handler(ctx, ...params), public?]
const routes = [
  ['POST', /^\/api\/auth\/register$/, async c => {
    const { userId, workspaceId, pageId } = register(await c.body())
    c.setSession(startSession(userId, workspaceId))
    return { page_id: pageId }
  }, true],
  ['POST', /^\/api\/auth\/login$/, async c => {
    const b = await c.body()
    const userId = login(b, c.ip)
    c.setSession(startSession(userId))
    return { ok: true }
  }, true],
  ['POST', /^\/api\/auth\/logout$/, c => {
    if (c.user) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(c.user.tokenHash)
    c.setSession('', 0)
    return { ok: true }
  }, true],
  ['GET', /^\/api\/auth\/status$/, () => ({ hasUsers: !!db.prepare('SELECT 1 FROM users LIMIT 1').get() }), true],
  ['GET', /^\/api\/invites\/([\w-]+)$/, (c, t) => inviteInfo(t), true],
  ['POST', /^\/api\/invites\/([\w-]+)\/accept$/, (c, t) => {
    const inv = useInvite(t, c.user.id)
    db.prepare('UPDATE sessions SET workspace_id = ? WHERE token_hash = ?').run(inv.workspace_id, c.user.tokenHash)
    return { workspace_id: inv.workspace_id, page_id: inv.page_id }
  }],
  ['GET', /^\/api\/public\/([\w-]+)\/pages$/, (c, root) => publicPages(root), true],
  ['GET', /^\/api\/public\/([\w-]+)\/pages\/([\w-]+)$/, (c, root, id) => publicPage(root, id), true],

  ['GET', /^\/api\/me$/, c => me(c.user)],
  ['PATCH', /^\/api\/me$/, async c => {
    const b = await c.body()
    if (b.name !== undefined) {
      if (!String(b.name).trim()) throw new HttpError(400, 'Enter your name.')
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(b.name).trim().slice(0, 100), c.user.id)
    }
    if (b.prefs !== undefined) {
      if (typeof b.prefs !== 'object' || JSON.stringify(b.prefs).length > 10000) throw new HttpError(400, 'Invalid preferences.')
      const cur = JSON.parse(db.prepare('SELECT prefs FROM users WHERE id = ?').get(c.user.id).prefs)
      db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify({ ...cur, ...b.prefs }), c.user.id)
    }
    if (b.new_password !== undefined) {
      const u = db.prepare('SELECT pass FROM users WHERE id = ?').get(c.user.id)
      if (typeof b.password !== 'string' || !checkPassword(b.password, u.pass)) throw new HttpError(400, 'Current password is wrong.')
      validateCredentials({ email: c.user.email, password: b.new_password }, false)
      db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(b.new_password), c.user.id)
      // Changing the password signs out every other device.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(c.user.id, c.user.tokenHash)
    }
    return me({ ...c.user, ...db.prepare('SELECT name FROM users WHERE id = ?').get(c.user.id) })
  }],
  ['POST', /^\/api\/me\/logout-all$/, c => { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(c.user.id); c.setSession('', 0); return { ok: true } }],
  ['DELETE', /^\/api\/me$/, async c => { deleteAccount(c.user, (await c.body()).password); c.setSession('', 0); return { ok: true } }],
  ['GET', /^\/api\/workspaces\/([\w-]+)\/export$/, (c, id) => exportWorkspace(c.user, id)],
  ['POST', /^\/api\/workspaces$/, async c => {
    const id = createWorkspace(c.user.id, (await c.body()).name)
    db.prepare('UPDATE sessions SET workspace_id = ? WHERE token_hash = ?').run(id, c.user.tokenHash)
    return { id }
  }],
  ['POST', /^\/api\/workspaces\/([\w-]+)\/switch$/, (c, id) => {
    if (!roleOf(id, c.user.id)) deny('You are not in this workspace.')
    db.prepare('UPDATE sessions SET workspace_id = ? WHERE token_hash = ?').run(id, c.user.tokenHash)
    return { ok: true }
  }],
  ['PATCH', /^\/api\/workspaces\/([\w-]+)$/, async (c, id) => {
    needOwner(c.user, id)
    const b = await c.body()
    if (b.name !== undefined) db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(String(b.name).trim().slice(0, 100) || 'Workspace', id)
    if (b.icon !== undefined) db.prepare('UPDATE workspaces SET icon = ? WHERE id = ?').run(String(b.icon).slice(0, 8), id)
    return { ok: true }
  }],
  ['DELETE', /^\/api\/workspaces\/([\w-]+)$/, (c, id) => {
    needOwner(c.user, id)
    for (const t of ['history', 'grants', 'favorites', 'comments', 'notifications', 'watches', 'synced']) db.prepare(`DELETE FROM ${t} WHERE page_id IN (SELECT id FROM pages WHERE workspace_id = ?)`).run(id)
    db.prepare('DELETE FROM pages WHERE workspace_id = ?').run(id)
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
    return { ok: true }
  }],
  ['GET', /^\/api\/workspaces\/([\w-]+)\/people$/, (c, id) => people(c.user, id)],
  ['PATCH', /^\/api\/workspaces\/([\w-]+)\/people\/([\w-]+)$/, async (c, id, uid) => { setRole(c.user, id, uid, (await c.body()).role); return people(c.user, id) }],
  ['DELETE', /^\/api\/workspaces\/([\w-]+)\/people\/([\w-]+)$/, (c, id, uid) => { removeMember(c.user, id, uid); return { ok: true } }],
  ['POST', /^\/api\/workspaces\/([\w-]+)\/invites$/, async (c, id) => ({ token: createInvite(c.user, id, await c.body()) })],

  ['GET', /^\/api\/pages$/, c => listPages(c.user)],
  ['POST', /^\/api\/pages$/, async c => createPage(c.user, await c.body())],
  ['GET', /^\/api\/pages\/([\w-]+)$/, (c, id) => getPage(c.user, id, { meta: c.url.searchParams.get('meta') === '1' })],
  ['PATCH', /^\/api\/pages\/([\w-]+)$/, async (c, id) => updatePage(c.user, id, await c.body())],
  ['DELETE', /^\/api\/pages\/([\w-]+)$/, (c, id) => { deletePage(c.user, id); return { ok: true } }],
  ['POST', /^\/api\/pages\/([\w-]+)\/duplicate$/, (c, id) => duplicatePage(c.user, id)],
  ['GET', /^\/api\/pages\/([\w-]+)\/history$/, (c, id) => history(c.user, id)],
  ['GET', /^\/api\/pages\/([\w-]+)\/backlinks$/, (c, id) => backlinks(c.user, id)],
  ['GET', /^\/api\/pages\/([\w-]+)\/share$/, (c, id) => getShare(c.user, id)],
  ['PATCH', /^\/api\/pages\/([\w-]+)\/share$/, async (c, id) => setShare(c.user, id, await c.body())],
  ['GET', /^\/api\/pages\/([\w-]+)\/comments$/, (c, id) => listComments(c.user, id)],
  ['POST', /^\/api\/synced$/, async c => { const b = await c.body(); return createSynced(c.user, String(b.page_id ?? ''), b.content ?? []) }],
  ['GET', /^\/api\/synced\/([\w-]+)$/, (c, id) => getSynced(c.user, id)],
  ['POST', /^\/api\/synced\/([\w-]+)\/unsync$/, (c, id) => unsyncAll(c.user, id)],
  ['PUT', /^\/api\/synced\/([\w-]+)$/, async (c, id) => updateSynced(c.user, id, (await c.body()).content)],
  ['GET', /^\/api\/pages\/([\w-]+)\/watch$/, (c, id) => { need(c.user.id, id, 'view'); return { mode: watchMode(c.user.id, id) } }],
  ['PUT', /^\/api\/pages\/([\w-]+)\/watch$/, async (c, id) => setWatch(c.user, id, (await c.body()).mode)],
  ['POST', /^\/api\/pages\/([\w-]+)\/comments$/, async (c, id) => { const b = await c.body(); return addComment(c.user, id, b.body, b) }],
  ['GET', /^\/api\/inbox$/, c => inbox(c.user)],
  ['PATCH', /^\/api\/inbox$/, async c => updateInbox(c.user, await c.body())],
  ['PATCH', /^\/api\/comments\/([\w-]+)$/, async (c, id) => updateComment(c.user, id, await c.body())],
  ['GET', /^\/api\/search$/, c => search(c.user, c.url.searchParams.get('q') || '', { titleOnly: c.url.searchParams.get('title') === '1', mine: c.url.searchParams.get('mine') === '1' })],
  ['POST', /^\/api\/upload$/, async c => {
    if (!c.user.workspaceId || roleOf(c.user.workspaceId, c.user.id) === undefined) deny()
    const ext = extname(c.url.searchParams.get('name') || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10)
    const name = randomUUID() + ext
    writeFileSync(join(FILES, name), await readBody(c.req, MAX_UPLOAD))
    return { url: '/files/' + name }
  }],
]

async function handle(req, res) {
  const url = new URL(req.url, 'http://x')
  const send = (data, status = 200, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(data)) }

  if (url.pathname.startsWith('/api/')) {
    // Cross-site pages can't set custom headers without a CORS preflight, which this server never allows.
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'bloki') return send({ error: 'Missing request header.' }, 403)
    const user = sessionUser(readCookie(req, 'bloki_session'))
    const headers = {}
    const ctx = {
      req, url, user, ip: req.socket.remoteAddress ?? '',
      body: async () => { try { return JSON.parse((await readBody(req, MAX_JSON)).toString() || '{}') } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, 'Invalid JSON.') } },
      setSession: (t, maxAge = SESSION_DAYS * 86400) => { headers['set-cookie'] = cookie('bloki_session', t, maxAge) },
    }
    for (const [method, pattern, fn, open] of routes) {
      const m = req.method === method && url.pathname.match(pattern)
      if (!m) continue
      if (!open && !user) return send({ error: 'Please log in.' }, 401)
      try {
        return send(await fn(ctx, ...m.slice(1)), 200, headers)
      } catch (e) {
        if (e instanceof HttpError) return send({ error: e.message }, e.status, headers)
        throw e
      }
    }
    return send({ error: 'Not found.' }, 404)
  }

  // Uploaded files are served by unguessable name, so published pages can show their images.
  // ponytail: capability URLs; switch to per-page checks if links to files must be revocable
  if (/^\/files\/[\w-]+(\.[a-z0-9]+)?$/.test(url.pathname)) {
    const p = join(FILES, url.pathname.slice(7))
    if (!existsSync(p)) { res.writeHead(404); return res.end() }
    // Files are shown inline only when they can't run script in this origin.
    const safe = /\.(png|jpe?g|gif|webp|pdf|mp4|webm|mp3|wav)$/i.test(p)
    return sendFile(res, p, safe ? {} : { 'content-disposition': 'attachment', 'content-type': 'application/octet-stream' })
  }

  const p = normalize(join(DIST, url.pathname))
  if (p.startsWith(DIST) && existsSync(p) && statSync(p).isFile()) return sendFile(res, p)
  if (existsSync(join(DIST, 'index.html'))) return sendFile(res, join(DIST, 'index.html'))
  res.writeHead(404); res.end('Run `npm run build` first, or use `npm run dev`.')
}

export const collab = createCollab({
  db,
  authorize(req, pageId) {
    const user = sessionUser(readCookie(req, 'bloki_session'))
    if (!user) return null
    // A synced block's room follows its original page's access.
    if (pageId.startsWith('synced-')) pageId = db.prepare('SELECT page_id FROM synced WHERE id = ?').get(pageId.slice(7))?.page_id ?? ''
    if (!pageId) return null
    let level
    try { level = pageAccess(user.id, pageId) } catch { return null }
    if (!atLeast(level, 'view')) return null
    const locked = !!db.prepare('SELECT locked FROM pages WHERE id = ?').get(pageId)?.locked
    return { userId: user.id, canEdit: atLeast(level, 'edit') && !locked }
  },
})

export const server = createServer((req, res) => handle(req, res).catch(e => {
  console.error(e)
  if (!res.headersSent) res.writeHead(e instanceof HttpError ? e.status : 500, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: e instanceof HttpError ? e.message : 'Server error.' }))
}))
/* ---------- Live updates for the sidebar and databases ---------- */
// One socket per open app. An edited page's id goes only to people who can see it; changes that reshape the
// tree (new page, trash, move, sharing, delete) just ask everyone in the workspace to refresh, revealing nothing.
export const liveConns = new Set() // { ws, userId, workspaceId }
const liveSend = (c, msg) => { try { c.ws.send(JSON.stringify(msg)) } catch { /* closing */ } }
function livePages(workspaceId, ids) {
  for (const c of liveConns) {
    if (c.workspaceId !== workspaceId) continue
    const visible = ids.filter(id => { try { return atLeast(pageAccess(c.userId, id), 'view') } catch { return false } })
    if (visible.length) liveSend(c, { type: 'pages', ids: visible })
  }
}
function liveReload(workspaceId) {
  for (const c of liveConns) if (c.workspaceId === workspaceId) liveSend(c, { type: 'reload' })
}
const liveWss = new WebSocketServer({ noServer: true, maxPayload: 1024 })
function liveUpgrade(req, socket, head) {
  // Same checks as the editing sockets: same-origin pages with a valid session only.
  const origin = req.headers.origin && new URL(req.headers.origin).host
  const user = sessionUser(readCookie(req, 'bloki_session'))
  if ((origin && origin !== req.headers.host) || !user?.workspaceId) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return }
  liveWss.handleUpgrade(req, socket, head, ws => {
    const c = { ws, userId: user.id, workspaceId: user.workspaceId }
    liveConns.add(c)
    ws.on('close', () => liveConns.delete(c))
    ws.on('message', () => {}) // clients only listen
  })
}
server.on('upgrade', (req, socket, head) => (new URL(req.url, 'http://x').pathname === '/live' ? liveUpgrade : collab.upgrade)(req, socket, head))

if (process.argv[1] === import.meta.filename) {
  // Localhost by default. Set HOST=0.0.0.0 (behind HTTPS, with BLOKI_SECURE_COOKIE=1) to let others in.
  purgeTrash()
  setInterval(() => purgeTrash(), 6 * 3600 * 1000).unref()
  server.listen(PORT, HOST, () => console.log(`Bloki on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`))
}
