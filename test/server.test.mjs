import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.BLOKI_DATA = mkdtempSync(join(tmpdir(), 'bloki-'))
process.env.BLOKI_DB = ':memory:'
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
