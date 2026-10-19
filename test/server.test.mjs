import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.BLOKI_DATA = mkdtempSync(join(tmpdir(), 'bloki-'))
process.env.BLOKI_DB = ':memory:'
// A pretend mail server on this machine, so email (invites, notifications, password resets) is sent and can be read back.
const smtp = { received: [] }
const { createServer: tcpServer } = await import('node:net')
const smtpServer = tcpServer(sock => {
  let data = false, msg = ''
  sock.write('220 test ESMTP\r\n')
  sock.on('data', chunk => {
    for (const line of String(chunk).split('\r\n').slice(0, -1)) {
      if (data) { if (line === '.') { data = false; smtp.received.push(msg); msg = ''; sock.write('250 queued\r\n') } else msg += line + '\n'; continue }
      const verb = line.slice(0, 4).toUpperCase()
      sock.write(verb === 'EHLO' ? '250-test\r\n250 AUTH PLAIN\r\n' : verb === 'AUTH' ? '235 ok\r\n' : verb === 'DATA' ? '354 go\r\n' : verb === 'QUIT' ? '221 bye\r\n' : '250 ok\r\n')
      if (verb === 'DATA') data = true
    }
  })
}).listen(0, '127.0.0.1')
await new Promise(r => smtpServer.once('listening', r))
smtpServer.unref()
process.env.BLOKI_SMTP_URL = `smtp://u:p@127.0.0.1:${smtpServer.address().port}`
process.env.BLOKI_URL = 'https://bloki.test'
// A pretend OpenID Connect provider: discovery, its signing key, and a token endpoint that signs what each code asks for.
const { generateKeyPairSync, sign: cryptoSign } = await import('node:crypto')
const { createServer: httpServer } = await import('node:http')
const idp = { keys: generateKeyPairSync('rsa', { modulusLength: 2048 }), other: generateKeyPairSync('rsa', { modulusLength: 2048 }), lastNonce: '' }
const idpServer = httpServer((req, res) => {
  const base = `http://127.0.0.1:${idpServer.address().port}`
  const json = v => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
  if (req.url === '/.well-known/openid-configuration') return json({ issuer: base, authorization_endpoint: base + '/auth', token_endpoint: base + '/token', jwks_uri: base + '/jwks' })
  if (req.url === '/jwks') return json({ keys: [{ ...idp.keys.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }] })
  let body = ''; req.on('data', d => (body += d)); req.on('end', () => {
    const q = new URLSearchParams(body), [email, how] = q.get('code').split('|')
    const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url')
    const head = enc({ alg: 'RS256', kid: 'k1' }), claims = enc({ iss: base, aud: process.env.BLOKI_OIDC_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 300, nonce: how === 'nonce' ? 'wrong' : idp.lastNonce, email, email_verified: true, name: 'SSO Person' })
    const sig = cryptoSign('RSA-SHA256', Buffer.from(`${head}.${claims}`), (how === 'forged' ? idp.other : idp.keys).privateKey).toString('base64url')
    json({ id_token: `${head}.${claims}.${sig}` })
  })
}).listen(0, '127.0.0.1')
await new Promise(r => idpServer.once('listening', r))
idpServer.unref()
process.env.BLOKI_OIDC_ISSUER = `http://127.0.0.1:${idpServer.address().port}`
process.env.BLOKI_OIDC_CLIENT_ID = 'bloki-test'
process.env.BLOKI_OIDC_CLIENT_SECRET = 'secret'
const s = await import('../server.mjs')
const { db } = s

// Owner, a member and a guest in one workspace.
const ownerIds = s.register({ email: 'owner@x.si', name: 'Owner', password: 'password1' })
const owner = { id: ownerIds.userId, workspaceId: ownerIds.workspaceId }
const ws = owner.workspaceId
const join_ = (email, role) => {
  const invite = s.createInvite(owner, ws, { role })
  const r = s.register({ email, name: email, password: 'password1', invite })
  return { id: r.userId, workspaceId: r.workspaceId }
}
const member = join_('member@x.si', 'member')
const guest = join_('guest@x.si', 'guest')
const level = (u, p) => s.pageAccess(u.id, p.id)
const throws403 = fn => assert.throws(fn, e => e.status === 403)

test('second sign-up needs an invite; passwords are hashed and checked', () => {
  assert.throws(() => s.register({ email: 'x@x.si', name: 'X', password: 'password1' }), e => e.status === 403)
  assert.notEqual(db.prepare('SELECT pass FROM users WHERE id = ?').get(owner.id).pass, 'password1')
  assert.equal(s.login({ email: 'OWNER@x.si', password: 'password1' }), owner.id)
  assert.throws(() => s.login({ email: 'owner@x.si', password: 'nope-nope' }), e => e.status === 401)
})

test('workspace pages: owner and member get full access, guest gets none', () => {
  const p = s.createPage(owner, { title: 'Team wiki', section: 'workspace' })
  assert.equal(level(owner, p), 'full')
  assert.equal(level(member, p), 'full')
  assert.equal(level(guest, p), 'none')
  throws403(() => s.getPage(guest, p.id))
  assert.ok(!s.listPages(guest).some(x => x.id === p.id))
})

test('private pages are visible only to their creator, even to owners', () => {
  const p = s.createPage(member, { title: 'Diary', section: 'private' })
  assert.equal(level(member, p), 'full')
  assert.equal(level(owner, p), 'none')
  assert.equal(s.listPages(member).find(x => x.id === p.id).section, 'private')
})

test('sharing with a guest: levels inherit to sub-pages and are enforced', () => {
  const p = s.createPage(owner, { title: 'Project', section: 'workspace' })
  const child = s.createPage(owner, { title: 'Spec', parent_id: p.id })
  s.setShare(owner, p.id, { grant: { user_id: guest.id, level: 'comment' } })
  assert.equal(level(guest, child), 'comment')
  assert.equal(s.listPages(guest).find(x => x.id === p.id).section, 'shared')
  throws403(() => s.updatePage(guest, child.id, { title: 'hacked' }))
  s.addComment(guest, child.id, 'Looks good')
  assert.equal(s.listComments(owner, child.id)[0].body, 'Looks good')
  // A closer grant overrides the inherited one.
  s.setShare(owner, child.id, { grant: { user_id: guest.id, level: 'edit' } })
  s.updatePage(guest, child.id, { title: 'Spec v2' })
  throws403(() => s.setShare(guest, child.id, { public: true }))
  throws403(() => s.createPage(guest, { title: 'root' }))
})

test('lowering workspace access restricts members but not owners', () => {
  const p = s.createPage(owner, { title: 'HR', section: 'workspace' })
  s.setShare(owner, p.id, { workspace_access: 'view' })
  assert.equal(level(member, p), 'view')
  assert.equal(level(owner, p), 'full')
  throws403(() => s.updatePage(member, p.id, { content: [] }))
  s.setShare(owner, p.id, { workspace_access: 'none' })
  assert.equal(level(member, p), 'none')
})

test('can edit content: rows yes, database structure no', () => {
  const d = s.createPage(owner, { title: 'Tasks', kind: 'db', schema: { props: [] }, section: 'workspace' })
  s.setShare(owner, d.id, { workspace_access: 'edit_content' })
  const row = s.createPage(member, { parent_id: d.id, title: 'Do it' })
  s.updatePage(member, row.id, { props: { a: 1 } })
  throws403(() => s.updatePage(member, d.id, { schema: { props: [{ id: 'x' }] } }))
  assert.equal(level(member, row), 'edit')
})

test('only full access can move, and pages cannot move inside themselves', () => {
  const a = s.createPage(owner, { title: 'A', section: 'workspace' })
  const b = s.createPage(owner, { title: 'B', parent_id: a.id })
  assert.throws(() => s.updatePage(owner, a.id, { parent_id: b.id }), e => e.status === 400)
  s.setShare(owner, a.id, { workspace_access: 'edit' })
  throws403(() => s.updatePage(member, b.id, { parent_id: null }))
})

test('favorites are per person', () => {
  const p = s.createPage(owner, { title: 'Fav', section: 'workspace' })
  s.updatePage(owner, p.id, { favorite: true })
  assert.equal(s.getPage(owner, p.id).favorite, true)
  assert.equal(s.getPage(member, p.id).favorite, false)
})

test('published pages expose only their own subtree', () => {
  const p = s.createPage(owner, { title: 'Blog', section: 'workspace' })
  const post = s.createPage(owner, { title: 'Post', parent_id: p.id })
  const other = s.createPage(owner, { title: 'Secret', section: 'workspace' })
  assert.throws(() => s.publicPages(p.id), e => e.status === 404)
  s.setShare(owner, p.id, { public: true })
  assert.deepEqual(s.publicPages(p.id).map(x => x.title).sort(), ['Blog', 'Post'])
  assert.equal(s.publicPage(p.id, post.id).title, 'Post')
  assert.throws(() => s.publicPage(p.id, other.id), e => e.status === 404)
})

test('search and backlinks hide pages the user cannot see', () => {
  const secret = s.createPage(member, { title: 'Zebra secret', section: 'private' })
  assert.equal(s.search(owner, 'Zebra').length, 0)
  assert.equal(s.search(member, 'Zebra').length, 1)
  s.createPage(member, { title: 'Linker', section: 'private', content: [{ type: 'mention', props: { pageId: secret.id } }] })
  assert.equal(s.backlinks(member, secret.id).length, 1)
})

test('full-text search: whole words or their start, any accents, titles first, kept in step with edits', () => {
  const para = text => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]
  const body = s.createPage(owner, { title: 'Notes', section: 'workspace', content: para('Kvačkanje in pletenje ob večerih') })
  const titled = s.createPage(owner, { title: 'Pletenje', section: 'workspace' })
  const ids = q => s.search(owner, q).map(p => p.id)
  assert.deepEqual(ids('pleten'), [titled.id, body.id], 'prefix match, title before body')
  assert.deepEqual(ids('kvackanje'), [body.id], 'accents are ignored')
  assert.ok(s.search(owner, 'kvačk')[0].snippet.includes('Kvačkanje'))
  assert.deepEqual(s.search(owner, 'pleten', { titleOnly: true }).map(p => p.id), [titled.id])
  assert.deepEqual(ids('pletenje večerih'), [body.id], 'every word must match')
  assert.deepEqual(ids('"%_*'), [], 'punctuation alone finds nothing and does not break the query')
  s.updatePage(owner, body.id, { content: para('Zdaj o vrtnarjenju') })
  assert.deepEqual(ids('kvackanje'), [], 'edited content is re-indexed')
  assert.deepEqual(ids('vrtnar'), [body.id])
  s.updatePage(owner, titled.id, { trashed: true })
  assert.deepEqual(ids('pleten'), [], 'trashed pages are not found')
  s.deletePage(owner, titled.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM search_idx').get().n, db.prepare('SELECT COUNT(*) AS n FROM pages').get().n, 'deleted pages leave the index')
})

test('live updates: edited pages go only to people who can see them; tree changes ask everyone to refresh', () => {
  const inbox = new Map()
  const listen = u => { const msgs = []; const c = { ws: { send: m => msgs.push(JSON.parse(m)) }, userId: u.id, workspaceId: ws }; s.liveConns.add(c); inbox.set(u, { c, msgs }); return msgs }
  const [o, m, g] = [listen(owner), listen(member), listen(guest)]
  const priv = s.createPage(owner, { title: 'Owner only', section: 'private' })
  assert.deepEqual([o, m, g].map(x => x.at(-1)?.type), ['reload', 'reload', 'reload'], 'a new page: everyone refreshes, no ids sent')
  for (const x of [o, m, g]) x.length = 0
  s.updatePage(owner, priv.id, { title: 'Still owner only' })
  assert.deepEqual(o, [{ type: 'pages', ids: [priv.id] }])
  assert.deepEqual([m.length, g.length], [0, 0], 'others never learn the id of a page they cannot see')
  assert.equal(s.getPage(owner, priv.id, { meta: true }).content, undefined, 'meta reads leave the blocks out')
  for (const { c } of inbox.values()) s.liveConns.delete(c)
})

test('trash cascades; history snapshots; duplicate copies rows', () => {
  const a = s.createPage(owner, { title: 'T', section: 'workspace', content: [] })
  const c = s.createPage(owner, { title: 'C', parent_id: a.id })
  s.updatePage(owner, a.id, { trashed: true })
  assert.equal(s.getPage(owner, c.id).trashed, true)
  s.updatePage(owner, a.id, { trashed: false })
  s.updatePage(owner, a.id, { content: [1] })
  s.updatePage(owner, a.id, { content: [2] })
  s.updatePage(owner, a.id, { content: [3], snapshot: true })
  assert.equal(s.history(owner, a.id).length, 2)
  const copy = s.duplicatePage(owner, a.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pages WHERE parent_id = ?').get(copy.id).n, 1)
  s.deletePage(owner, a.id)
  assert.throws(() => s.getPage(owner, c.id), e => e.status === 404)
})

test('the last owner cannot be demoted or removed', () => {
  assert.throws(() => s.setRole(owner, ws, owner.id, 'member'), e => e.status === 400)
  throws403(() => s.setRole(member, ws, guest.id, 'member'))
  s.setRole(owner, ws, guest.id, 'member')
  assert.equal(s.roleOf(ws, guest.id), 'member')
  s.setRole(owner, ws, guest.id, 'guest')
})

test('HTTP: mutations need the custom header and a session', async () => {
  await new Promise(r => s.server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${s.server.address().port}`
  const noHeader = await fetch(base + '/api/auth/login', { method: 'POST', body: '{}' })
  assert.equal(noHeader.status, 403)
  assert.equal((await fetch(base + '/api/pages')).status, 401)
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'x-requested-with': 'bloki', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@x.si', password: 'password1' }) })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  assert.match(login.headers.get('set-cookie'), /HttpOnly/)
  const pages = await fetch(base + '/api/pages', { headers: { cookie } })
  assert.equal(pages.status, 200)
  s.server.close()
})

test('inbox: mentions, comments and shares notify the right people', () => {
  const p = s.createPage(owner, { title: 'Plan', section: 'workspace' })
  const before = s.inbox(member).items.length
  s.updatePage(owner, p.id, { content: [{ type: 'paragraph', content: [{ type: 'person', props: { userId: member.id } }] }] })
  // Saving again with the same mention doesn't notify twice.
  s.updatePage(owner, p.id, { content: [{ type: 'paragraph', content: [{ type: 'person', props: { userId: member.id } }, 'x'] }] })
  assert.equal(s.inbox(member).items.length, before + 1)
  assert.equal(s.inbox(member).items[0].kind, 'mention')
  // A mention of someone who can't open the page is not delivered.
  const g0 = s.inbox(guest).items.length
  s.updatePage(owner, p.id, { content: [{ type: 'paragraph', content: [{ type: 'person', props: { userId: guest.id } }] }] })
  assert.equal(s.inbox(guest).items.length, g0)
  s.setShare(owner, p.id, { grant: { user_id: guest.id, level: 'view' } })
  assert.equal(s.inbox(guest).items[0].kind, 'share')
  s.addComment(member, p.id, 'Nice plan')
  assert.equal(s.inbox(owner).items[0].kind, 'comment')
  const r = s.updateInbox(owner, { all: true, read: true })
  assert.equal(r.unread, 0)
})

test('comment @-mentions notify only people who can see the page', () => {
  const p = s.createPage(owner, { title: 'Mentions', section: 'private' })
  const before = s.inbox(member).items.length
  s.addComment(owner, p.id, 'Hey @member', { mentions: [member.id, 'nobody'] })
  assert.equal(s.inbox(member).items.length, before)
  s.setShare(owner, p.id, { grant: { user_id: member.id, level: 'view' } })
  s.addComment(owner, p.id, 'Now @member', { mentions: [member.id] })
  assert.equal(s.inbox(member).items[0].kind, 'mention')
})

test('Notify me: all comments or only replies and mentions', () => {
  const p = s.createPage(owner, { title: 'Watched', section: 'workspace' })
  const count = u => s.inbox(u).items.length
  assert.equal(s.watchMode(owner.id, p.id), 'all')
  assert.equal(s.watchMode(member.id, p.id), 'replies')
  const o0 = count(owner), m0 = count(member)
  s.setWatch(owner, p.id, 'replies')
  s.setWatch(member, p.id, 'all')
  const third = join_('watcher@x.si', 'member')
  const [c] = s.addComment(third, p.id, 'First')
  assert.equal(count(owner), o0)
  assert.equal(count(member), m0 + 1)
  assert.throws(() => s.setWatch(member, p.id, 'loud'), e => e.status === 400)
  assert.ok(c)
})

test('synced blocks: shared content, edit needs edit access to the original page', () => {
  const p = s.createPage(owner, { title: 'Origin', section: 'workspace' })
  const b = s.createSynced(owner, p.id, [{ type: 'paragraph', content: 'hi' }])
  assert.equal(b.canEdit, true)
  const seen = s.getSynced(member, b.id)
  assert.equal(seen.content[0].content, 'hi')
  s.setShare(owner, p.id, { workspace_access: 'view' })
  assert.equal(s.getSynced(member, b.id).canEdit, false)
  throws403(() => s.updateSynced(member, b.id, []))
  s.updateSynced(owner, b.id, [{ type: 'paragraph', content: 'bye' }])
  assert.equal(s.getSynced(member, b.id).content[0].content, 'bye')
  assert.throws(() => s.updateSynced(owner, b.id, 'nope'), e => e.status === 400)
  assert.throws(() => s.getSynced(guest, b.id), e => e.status === 403 || e.status === 404)
  // Copies are counted from page content; Unsync all turns every copy into ordinary blocks.
  const other = s.createPage(owner, { title: 'Copy', section: 'workspace', content: [{ id: 'x', type: 'synced', props: { syncId: b.id }, children: [] }] })
  s.updatePage(owner, p.id, { content: [{ id: 'y', type: 'synced', props: { syncId: b.id }, children: [] }] })
  assert.equal(s.getSynced(owner, b.id).copies, 2)
  assert.equal(s.unsyncAll(owner, b.id).pages, 2)
  const c = s.getPage(owner, other.id).content
  assert.equal(c[0].type, 'paragraph')
  assert.equal(c[0].content, 'bye')
  assert.equal(s.getSynced(owner, b.id).copies, 0)
})

test('automations: set properties when rows are added or edited, notify people, never loop', () => {
  const d = s.createPage(owner, { title: 'Tasks', kind: 'db', section: 'workspace', schema: { props: [{ id: 'st', name: 'Status', type: 'select' }, { id: 'done', name: 'Done', type: 'checkbox' }], automations: [
    { id: 'a1', name: 'New → To do', enabled: true, trigger: { type: 'added' }, actions: [{ type: 'set', prop: 'st', value: 'todo' }] },
    { id: 'a2', name: 'Done → checked', enabled: true, trigger: { type: 'edited', prop: 'st', value: 'done' }, actions: [{ type: 'set', prop: 'done', value: true }, { type: 'notify', user: member.id }, { type: 'set', prop: 'st', value: 'archived' }] },
    { id: 'a3', name: 'Off', enabled: false, trigger: { type: 'added' }, actions: [{ type: 'set', prop: 'done', value: true }] },
  ] } })
  const r = s.createPage(owner, { parent_id: d.id, title: 'One' })
  assert.equal(s.getPage(owner, r.id).props.st, 'todo')
  assert.equal(s.getPage(owner, r.id).props.done, undefined)
  const before = s.inbox(member).items.length
  s.updatePage(owner, r.id, { props: { st: 'done' } })
  const after = s.getPage(owner, r.id).props
  assert.equal(after.done, true)
  assert.equal(after.st, 'archived')
  assert.equal(s.inbox(member).items.length, before + 1)
})

test('comment threads: replies, resolve and delete apply to the whole discussion', () => {
  const p = s.createPage(owner, { title: 'Thread', section: 'workspace' })
  const [root] = s.addComment(owner, p.id, 'Question?', { block_id: 'b1', quote: 'some text' })
  s.addComment(member, p.id, 'Answer', { thread_id: root.id })
  s.updateComment(owner, root.id, { resolved: true })
  assert.ok(s.listComments(owner, p.id).every(c => c.resolved))
  throws403(() => s.updateComment(member, root.id, { body: 'edited' }))
  s.updateComment(member, root.id, { react: '👍' })
  s.updateComment(owner, root.id, { react: '👍' })
  assert.deepEqual(s.listComments(owner, p.id)[0].reactions, { '👍': [member.id, owner.id] })
  s.updateComment(member, root.id, { react: '👍' })
  assert.deepEqual(s.listComments(owner, p.id)[0].reactions, { '👍': [owner.id] })
  assert.throws(() => s.updateComment(owner, root.id, { react: 'x' }), e => e.status === 400)
  s.updateComment(owner, root.id, { delete: true })
  assert.equal(s.listComments(owner, p.id).length, 0)
})

test('trash older than 30 days is purged', () => {
  const p = s.createPage(owner, { title: 'Old', section: 'workspace' })
  const c = s.createPage(owner, { title: 'Old child', parent_id: p.id })
  s.updatePage(owner, p.id, { trashed: true })
  s.purgeTrash(Date.now() + 29 * 864e5)
  assert.ok(s.getPage(owner, c.id))
  s.purgeTrash(Date.now() + 31 * 864e5)
  assert.throws(() => s.getPage(owner, c.id), e => e.status === 404)
})

test('database rows get sequential IDs and editors can reorder rows', () => {
  const d = s.createPage(owner, { title: 'Bugs', kind: 'db', section: 'workspace', schema: { props: [{ id: 'num', name: 'ID', type: 'unique_id', prefix: 'BUG' }] } })
  const a = s.createPage(member, { parent_id: d.id, title: 'a' })
  const b = s.createPage(member, { parent_id: d.id, title: 'b' })
  assert.equal(a.props.num, 1)
  assert.equal(b.props.num, 2)
  s.setShare(owner, d.id, { workspace_access: 'edit_content' })
  s.updatePage(member, b.id, { position: 0.5 })
  assert.equal(s.getPage(member, b.id).position, 0.5)
  throws403(() => s.updatePage(member, b.id, { parent_id: null }))
})

test('notification preferences are respected; accounts can be deleted safely', () => {
  db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify({ notify: { comment: false } }), owner.id)
  const p = s.createPage(owner, { title: 'Quiet', section: 'workspace' })
  const n0 = s.inbox(owner).items.length
  s.addComment(member, p.id, 'hello')
  assert.equal(s.inbox(owner).items.length, n0)
  db.prepare("UPDATE users SET prefs = '{}' WHERE id = ?").run(owner.id)
  // The only owner of a shared workspace can't delete their account.
  assert.throws(() => s.deleteAccount(owner, 'password1'), e => e.status === 400)
  assert.throws(() => s.deleteAccount(guest, 'wrong-password'), e => e.status === 400)
  const exp = s.exportWorkspace(owner, ws)
  assert.equal(exp.format, 'bloki-export-1')
  assert.ok(exp.pages.length > 5)
  throws403(() => s.exportWorkspace(member, ws))
})

test('backups are readable copies and only the newest are kept', async () => {
  const { mkdirSync, readdirSync, writeFileSync } = await import('node:fs')
  const { DatabaseSync } = await import('node:sqlite')
  const dir = join(process.env.BLOKI_DATA, 'backups')
  mkdirSync(dir, { recursive: true })
  for (const d of ['2020-01-01', '2020-01-02', '2020-01-03']) writeFileSync(join(dir, `bloki-${d}.db`), '')
  const file = s.backup(dir, 2)
  assert.deepEqual(readdirSync(dir).sort(), ['bloki-2020-01-03.db', file.split('/').at(-1)])
  assert.ok(new DatabaseSync(file).prepare('SELECT COUNT(*) AS n FROM users').get().n >= 1)
})

test('forms: members answer, the link opens it to anyone, answers are checked against the questions', () => {
  const opts = [{ id: 'o1', name: 'Bug', color: 'red' }]
  const status = [{ id: 's1', name: 'Not started', color: 'gray', group: 'todo' }]
  const view = { id: 'f', name: 'Form', type: 'form', form: { title: 'Report', questions: [{ prop: 'title', required: true }, { prop: 'kind' }, { prop: 'when' }, { prop: 'who' }] } }
  const d = s.createPage(owner, { title: 'Issues', kind: 'db', section: 'workspace', schema: { props: [{ id: 'kind', name: 'Kind', type: 'select', options: opts }, { id: 'when', name: 'When', type: 'date' }, { id: 'who', name: 'Who', type: 'person' }, { id: 'st', name: 'Status', type: 'status', options: status }], views: [view] } })
  assert.deepEqual(s.formDef(d.id, 'f', member).questions.map(q => q.name), ['Name', 'Kind', 'When']) // people aren't asked for
  assert.throws(() => s.formDef(d.id, 'f', null), e => e.status === 401)
  throws403(() => s.formDef(d.id, 'f', guest))
  assert.throws(() => s.submitForm(d.id, 'f', member, { kind: 'o1' }), e => e.status === 400) // name is required
  assert.throws(() => s.submitForm(d.id, 'f', member, { title: 'x', kind: 'nope' }), e => e.status === 400)
  assert.throws(() => s.submitForm(d.id, 'f', member, { title: 'x', when: 'tomorrow' }), e => e.status === 400)
  const r = s.submitForm(d.id, 'f', member, { title: 'Crash', kind: 'o1', when: '2026-10-17', who: owner.id, st: 'other' })
  const row = s.getPage(owner, r.id)
  assert.deepEqual([row.title, row.props.kind, row.props.when, row.props.who, row.props.st], ['Crash', 'o1', { start: '2026-10-17' }, undefined, 's1'])
  // Turning on "Anyone with the link" lets people without an account answer.
  s.updatePage(owner, d.id, { schema: { ...s.getPage(owner, d.id).schema, views: [{ ...view, form: { ...view.form, anyone: true } }] } })
  const anon = s.submitForm(d.id, 'f', null, { title: 'From outside' }, '203.0.113.9')
  assert.equal(s.getPage(owner, anon.id).created_by, null)
})

test('teamspaces: members see and add pages, open ones can be joined, private ones stay hidden', () => {
  const open = s.createTeam(member, { name: 'Design', icon: '🎨' })
  assert.equal(open.role, 'owner')
  const p = s.createPage(member, { title: 'Brand', team_id: open.id })
  const sub = s.createPage(member, { title: 'Logo', parent_id: p.id })
  assert.equal(s.listPages(member).find(x => x.id === p.id).section, 'team')
  assert.equal(level(owner, sub), 'full') // workspace owners keep access to open teamspaces
  assert.equal(level(guest, p), 'none')
  const third = join_('third@x.si', 'member')
  assert.equal(level(third, p), 'none')
  throws403(() => s.createPage(third, { title: 'Nope', team_id: open.id }))
  s.joinTeam(third, open.id)
  assert.equal(level(third, sub), 'full')
  throws403(() => s.updateTeam(third, open.id, { name: 'Mine' }))
  throws403(() => s.joinTeam(guest, open.id))
  // The last owner can't leave or be demoted; leaving drops access.
  assert.throws(() => s.setTeamMember(member, open.id, { user_id: member.id, role: null }), e => e.status === 400)
  s.setTeamMember(third, open.id, { user_id: third.id, role: null })
  assert.equal(level(third, p), 'none')

  const secret = s.createTeam(member, { name: 'Board', access: 'private' })
  const hidden = s.createPage(member, { title: 'Salaries', team_id: secret.id })
  assert.ok(!s.listTeams(owner).some(t => t.id === secret.id))
  assert.equal(level(owner, hidden), 'none') // not even workspace owners see private teamspaces
  throws403(() => s.joinTeam(third, secret.id))
  s.setTeamMember(member, secret.id, { user_id: third.id, role: 'member' })
  assert.equal(level(third, hidden), 'full')
  // Moving a page out to the workspace, or deleting a teamspace that still has pages.
  assert.throws(() => s.deleteTeam(member, secret.id), e => e.status === 400)
  // A sub-page moved straight into a teamspace lands at its top level.
  const nested = s.createPage(member, { title: 'Draft', parent_id: hidden.id })
  s.updatePage(member, nested.id, { parent_id: null, team_id: open.id })
  assert.equal(s.listPages(member).find(x => x.id === nested.id).section, 'team')
  s.updatePage(member, nested.id, { parent_id: hidden.id })
  s.updatePage(member, hidden.id, { team_id: null })
  assert.equal(level(owner, hidden), 'full')
  s.deleteTeam(member, secret.id)
  assert.ok(!s.listTeams(member).some(t => t.id === secret.id))
})

test('two-step verification: RFC 6238 codes, login needs the code, each code and recovery code works once', () => {
  assert.equal(s.totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082') // RFC 6238 test vector at T = 59s, last 6 digits
  const u = join_('twofa@x.si', 'member')
  const user = { ...u, email: 'twofa@x.si' }
  const { secret, uri } = s.setupTwoFactor(user)
  assert.match(uri, /^otpauth:\/\/totp\/Bloki:twofa%40x\.si\?secret=[A-Z2-7]{32}&issuer=Bloki$/)
  const now = Math.floor(Date.now() / 30000)
  assert.throws(() => s.enableTwoFactor(user, '000000'), e => e.status === 400)
  const { codes } = s.enableTwoFactor(user, s.totp(secret, now))
  assert.equal(codes.length, 8)
  const creds = { email: 'twofa@x.si', password: 'password1' }
  assert.throws(() => s.login(creds), e => e.status === 401 && e.extra.twoFactor)
  assert.throws(() => s.login({ ...creds, code: s.totp(secret, now) }), e => e.status === 401) // already used
  assert.equal(s.login({ ...creds, code: s.totp(secret, now + 1) }), u.id)
  assert.equal(s.login({ ...creds, code: codes[0].toUpperCase() }), u.id)
  assert.throws(() => s.login({ ...creds, code: codes[0] }), e => e.status === 401) // recovery codes work once
  assert.ok(s.me(user).user.twoFactor)
  assert.throws(() => s.disableTwoFactor(user, { password: 'nope-nope', code: codes[1] }), e => e.status === 400)
  s.disableTwoFactor(user, { password: 'password1', code: codes[1] })
  assert.equal(s.login(creds), u.id)
})

test('API tokens act as their owner; webhooks are signed and only carry pages their creator can see', async () => {
  const { createServer: http } = await import('node:http')
  const { createHmac } = await import('node:crypto')
  const got = []
  const sink = http((req, res) => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => { got.push({ headers: req.headers, body: b }); res.end() }) })
  await new Promise(r => sink.listen(0, '127.0.0.1', r))
  try {
    const { token } = s.createToken(member, 'Script')
    assert.match(token, /^bloki_/)
    assert.equal(s.tokenUser(token).id, member.id)
    assert.equal(s.tokenUser('bloki_nope'), null)
    assert.ok(s.listTokens(member).some(t => t.name === 'Script' && t.last_used))
    s.deleteToken(member, s.listTokens(member)[0].id)
    assert.equal(s.tokenUser(token), null)

    throws403(() => s.createWebhook(member, { url: 'https://x.test', events: ['page.created'] }))
    const { secret } = s.createWebhook(owner, { url: `http://127.0.0.1:${sink.address().port}/hook`, events: ['page.created'] })
    s.createPage(member, { title: 'Only mine', section: 'private' }) // the owner can't see it, so it isn't sent
    s.createPage(member, { title: 'For everyone', section: 'workspace' })
    for (let i = 0; i < 50 && !got.length; i++) await new Promise(r => setTimeout(r, 20))
    await new Promise(r => setTimeout(r, 100))
    assert.equal(got.length, 1)
    const { headers, body } = got[0]
    assert.equal(JSON.parse(body).data.title, 'For everyone')
    assert.equal(headers['x-bloki-event'], 'page.created')
    assert.equal(headers['x-bloki-signature'], 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'))
    s.deleteWebhook(owner, s.listWebhooks(owner)[0].id)
  } finally { sink.close() }
})

test('sites: a published page gets an address with its title and description in the page head', () => {
  const p = s.createPage(owner, { title: 'My <site>', section: 'workspace', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello & welcome' }] }] })
  const sub = s.createPage(owner, { title: 'About', parent_id: p.id })
  const html = '<html><head><title>Bloki</title></head><body></body></html>'
  s.setShare(owner, p.id, { site_slug: 'my-site' })
  assert.equal(s.sitePage('my-site', undefined, html), null) // not published yet
  s.setShare(owner, p.id, { public: true })
  const page = s.sitePage('my-site', undefined, html)
  assert.match(page, /<title>My &lt;site&gt;<\/title>/)
  assert.match(page, /name="description" content="Hello &amp; welcome"/)
  assert.match(page, /name="robots" content="noindex"/)
  s.setShare(owner, p.id, { site_index: true })
  assert.match(s.sitePage('my-site', sub.id, html), /<title>About<\/title>.*content="index, follow"/)
  assert.equal(s.sitePage('my-site', s.createPage(owner, { title: 'Elsewhere', section: 'workspace' }).id, html), null)
  assert.throws(() => s.setShare(owner, sub.id, { site_slug: 'my-site' }), e => e.status === 400) // taken
  assert.throws(() => s.setShare(owner, sub.id, { site_slug: 'Bad Slug!' }), e => e.status === 400)
  assert.equal(s.getShare(owner, p.id).site_slug, 'my-site')
  // Crawlers: robots.txt opens only indexed sites, whose sitemap lists every published page.
  assert.match(s.robots('https://b.test'), /Allow: \/s\/my-site\nDisallow: \/\n\nSitemap: https:\/\/b\.test\/s\/my-site\/sitemap\.xml/)
  const xml = s.sitemap('my-site', 'https://b.test')
  assert.ok(xml.includes('<loc>https://b.test/s/my-site</loc>') && xml.includes(`<loc>https://b.test/s/my-site/${sub.id}</loc>`))
  s.setShare(owner, p.id, { site_index: false })
  assert.equal(s.sitemap('my-site', 'https://b.test'), null)
  assert.ok(!s.robots('https://b.test').includes('my-site'))
})

test('email: invites to new people, notifications (unless turned off), and password resets', async () => {
  const until = async f => { for (let i = 0; i < 100 && !f(); i++) await new Promise(r => setTimeout(r, 20)) }
  const before = smtp.received.length
  const p = s.createPage(owner, { title: 'Plans', section: 'workspace' })
  const r = s.setShare(owner, p.id, { invite_email: 'newcomer@x.si', level: 'comment' })
  assert.ok(r.emailed)
  await until(() => smtp.received.length > before)
  assert.match(smtp.received.at(-1), /To: newcomer@x\.si[\s\S]*Subject: Owner invited you to Plans[\s\S]*https:\/\/bloki\.test\/#\/invite\//)
  s.addComment(member, p.id, 'Looks good')
  await until(() => smtp.received.some(m => m.includes('commented in Plans')))
  assert.ok(smtp.received.some(m => m.includes('To: owner@x.si') && m.includes('commented in Plans') && m.includes('Looks good')))

  // Password reset: the emailed link sets a new password and signs every device out.
  const n = smtp.received.length
  assert.deepEqual(s.forgotPassword('nobody@x.si'), { ok: true }) // same answer, no email
  s.forgotPassword('MEMBER@x.si')
  await until(() => smtp.received.length > n)
  const link = /#\/reset\/([\w-]+)/.exec(smtp.received.at(-1))[1]
  assert.throws(() => s.resetPassword('nope', 'newpassword1'), e => e.status === 400)
  s.resetPassword(link, 'newpassword1')
  assert.equal(s.login({ email: 'member@x.si', password: 'newpassword1' }), member.id)
  assert.throws(() => s.resetPassword(link, 'another-pass'), e => e.status === 400) // used up
})

test('button notifications reach people who can open the page', () => {
  const p = s.createPage(owner, { title: 'Release', section: 'workspace' })
  const before = s.inbox(member).items.length
  s.notifyFromButton(owner, p.id, { user_id: member.id, text: 'Ready for review' })
  assert.equal(s.inbox(member).items.length, before + 1)
  assert.throws(() => s.notifyFromButton(owner, p.id, { user_id: guest.id, text: 'x' }), e => e.status === 400) // guest can't open it
  throws403(() => s.notifyFromButton(guest, p.id, { user_id: member.id, text: 'x' }))
})

test('reminders on date mentions fire once, to the person who set them, while they can open the page', () => {
  const p = s.createPage(member, { title: 'Dentist', section: 'workspace' })
  const mention = (at, extra = {}) => ({ type: 'date', props: { date: '2026-10-20T15:00', remind: 'at', at: String(at), by: member.id, ...extra } })
  const now = Date.now()
  s.updatePage(member, p.id, { content: [{ type: 'paragraph', content: [mention(now - 1000), { type: 'text', text: ' and ' }, mention(now + 3600e3, { date: '2026-10-21' }), mention(now - 3 * 864e5, { date: '2026-10-10' })] }] })
  const before = s.inbox(member).items.length
  assert.equal(s.sendReminders(now), 1) // the future one waits, the stale one is skipped
  assert.equal(s.sendReminders(now), 0) // and nothing fires twice
  const n = s.inbox(member).items
  assert.equal(n.length, before + 1)
  assert.equal(n[0].kind, 'reminder')
  assert.equal(s.sendReminders(now + 3601e3), 1)
})

test('repeating templates add a page when due, then wait for the next time', () => {
  const d = s.createPage(member, { title: 'Meetings', kind: 'db', section: 'workspace', schema: { props: [{ id: 'k', name: 'Kind', type: 'text' }] } })
  const now = Date.now()
  const t = s.createPage(member, { parent_id: d.id, title: 'Weekly sync', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Agenda' }] }], props: { _template: true, k: 'sync', _repeat: { every: 'week', next: now - 1000 } } })
  const rows = () => s.listPages(member).filter(p => p.parent_id === d.id && !p.props?._template)
  assert.equal(s.runRepeats(now), 1)
  const [row] = rows()
  assert.match(row.title, /^Weekly sync \w{3} \d+$/)
  assert.equal(row.props.k, 'sync')
  assert.equal(row.props._repeat, undefined)
  assert.equal(s.getPage(member, row.id).content[0].content[0].text, 'Agenda')
  assert.equal(s.runRepeats(now), 0) // next is a week on
  assert.ok(s.getPage(member, t.id).props._repeat.next > now + 6 * 864e5)
})

test('permission groups: sharing a page with a group gives its members that access', () => {
  const p = s.createPage(owner, { title: 'Payroll', section: 'private' })
  const a = join_('groupa@x.si', 'member'), b = join_('groupb@x.si', 'member')
  throws403(() => s.saveGroup(member, null, { name: 'Finance' }))
  const g = s.saveGroup(owner, null, { name: 'Finance', members: [a.id, 'not-in-workspace'] })
  assert.deepEqual(g.members.map(m => m.id), [a.id])
  assert.equal(level(a, p), 'none')
  s.setShare(owner, p.id, { group_grant: { group_id: g.id, level: 'edit' } })
  assert.equal(level(a, p), 'edit')
  assert.equal(level(b, p), 'none')
  assert.equal(s.getShare(owner, p.id).groups[0].name, 'Finance')
  s.saveGroup(owner, g.id, { members: [a.id, b.id] })
  assert.equal(level(b, p), 'edit')
  s.setShare(owner, p.id, { grant: { user_id: b.id, level: 'full' } }) // the higher of personal and group access wins
  assert.equal(level(b, p), 'full')
  s.deleteGroup(owner, g.id)
  assert.equal(level(a, p), 'none')
})

test('page analytics count a view per person per half hour, by day, with the latest viewers', () => {
  const p = s.createPage(owner, { title: 'Handbook', section: 'workspace' })
  const now = Date.now()
  s.recordView(owner, p.id, now); s.recordView(owner, p.id, now + 60e3) // same half hour
  s.recordView(member, p.id, now + 120e3)
  s.recordView(owner, p.id, now + 31 * 60e3)
  throws403(() => s.recordView(guest, p.id))
  const a = s.pageAnalytics(owner, p.id, now + 32 * 60e3)
  assert.deepEqual([a.total, a.unique], [3, 2])
  assert.equal(a.days.length, 28)
  assert.equal(a.days.reduce((n, d) => n + d.views, 0), 3)
  assert.equal(a.viewers[0].id, owner.id)
  assert.equal(a.viewers.find(v => v.id === owner.id).views, 2)
})

test('audit log records who did what, for owners only', () => {
  const p = s.createPage(member, { title: 'Audited', section: 'workspace' })
  s.updatePage(member, p.id, { trashed: true })
  s.updatePage(member, p.id, { trashed: false })
  s.setShare(member, p.id, { public: true })
  const log = s.auditLog(owner, {})
  const mine = log.filter(e => e.target === p.id).map(e => e.action)
  assert.deepEqual(mine.slice(0, 4), ['page.shared', 'page.restored', 'page.trashed', 'page.created'])
  assert.equal(log.find(e => e.target === p.id).name, 'member@x.si')
  assert.ok(s.auditLog(owner, { action: 'page.' }).every(e => e.action.startsWith('page.')))
  throws403(() => s.auditLog(member, {}))
})

test('single sign-on: OIDC code flow with PKCE, signature, nonce and audience checks', async () => {
  const start = async () => { const { url, state } = await s.oidcStart(); const q = new URL(url).searchParams; idp.lastNonce = q.get('nonce'); assert.equal(q.get('code_challenge_method'), 'S256'); return state }
  let state = await start()
  assert.equal(await s.oidcCallback({ code: 'owner@x.si', state, cookieState: state }), owner.id)
  state = await start()
  await assert.rejects(s.oidcCallback({ code: 'owner@x.si', state, cookieState: 'other-browser' }), e => e.status === 400) // state must come back to the same browser
  state = await start()
  await assert.rejects(s.oidcCallback({ code: 'owner@x.si|forged', state, cookieState: state }), e => e.status === 401)
  state = await start()
  await assert.rejects(s.oidcCallback({ code: 'owner@x.si|nonce', state, cookieState: state }), e => e.status === 401)
  state = await start()
  await assert.rejects(s.oidcCallback({ code: 'stranger@x.si', state, cookieState: state }), e => e.status === 403) // no auto-join
  await assert.rejects(s.oidcCallback({ code: 'owner@x.si', state, cookieState: state }), e => e.status === 400) // a state works once
})

test('SCIM: providers create, find, deactivate users and manage groups in their own workspace', async () => {
  const { token } = s.createScimToken(owner)
  const ws = s.scim.workspaceFor(token)
  assert.equal(ws, owner.workspaceId)
  const call = (m, path, body = {}, q = '') => s.scim.handle(ws, m, path, new URLSearchParams(q), body)
  const [st, u] = await call('POST', '/scim/v2/Users', { userName: 'New.Person@x.si', name: { givenName: 'New', familyName: 'Person' }, active: true })
  assert.equal(st, 201)
  assert.equal(u.userName, 'new.person@x.si')
  assert.equal(s.roleOf(ws, u.id), 'member')
  await assert.rejects(call('POST', '/scim/v2/Users', { userName: 'new.person@x.si' }), e => e.status === 409)
  const [, found] = await call('GET', '/scim/v2/Users', {}, 'filter=userName eq "new.person@x.si"')
  assert.equal(found.totalResults, 1)
  const [, g] = await call('POST', '/scim/v2/Groups', { displayName: 'Engineering', members: [{ value: u.id }] })
  assert.equal(g.members.length, 1)
  await call('PATCH', `/scim/v2/Groups/${g.id}`, { Operations: [{ op: 'remove', path: `members[value eq "${u.id}"]` }] })
  assert.equal((await call('GET', `/scim/v2/Groups/${g.id}`))[1].members.length, 0)
  await call('PATCH', `/scim/v2/Groups/${g.id}`, { Operations: [{ op: 'add', path: 'members', value: [{ value: u.id }] }] })
  // Deactivating removes them from the workspace (and its groups) but keeps the account; reactivating brings them back.
  const [, off] = await call('PATCH', `/scim/v2/Users/${u.id}`, { Operations: [{ op: 'replace', value: { active: false } }] })
  assert.equal(off.active, false)
  assert.equal(s.roleOf(ws, u.id), undefined)
  assert.equal((await call('GET', `/scim/v2/Groups/${g.id}`))[1].members.length, 0)
  await call('PATCH', `/scim/v2/Users/${u.id}`, { Operations: [{ op: 'replace', path: 'active', value: true }] })
  assert.equal(s.roleOf(ws, u.id), 'member')
  await assert.rejects(call('GET', `/scim/v2/Users/${guest.id}xx`), e => e.status === 404)
  assert.equal((await call('DELETE', `/scim/v2/Users/${u.id}`))[0], 204)
  assert.equal(s.roleOf(ws, u.id), undefined)
  throws403(() => s.createScimToken(member))
  assert.equal(s.scim.workspaceFor('scim_wrong'), null)
})
