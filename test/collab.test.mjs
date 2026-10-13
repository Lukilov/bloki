import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

process.env.BLOKI_DATA = mkdtempSync(join(tmpdir(), 'bloki-collab-'))
process.env.BLOKI_DB = ':memory:'
const s = await import('../server.mjs')

const o = s.register({ email: 'o@x.si', name: 'O', password: 'password1' })
const owner = { id: o.userId, workspaceId: o.workspaceId }
const viewer = s.register({ email: 'v@x.si', name: 'V', password: 'password1', invite: s.createInvite(owner, owner.workspaceId, { role: 'member' }) })
const outsider = s.register({ email: 'x@x.si', name: 'X', password: 'password1' , invite: s.createInvite(owner, s.createWorkspace(owner.id, 'Other'), { role: 'member' }) })
const page = s.createPage(owner, { title: 'Live', section: 'workspace' })
s.setShare(owner, page.id, { workspace_access: 'view' })

await new Promise(r => s.server.listen(0, '127.0.0.1', r))
const base = `127.0.0.1:${s.server.address().port}`
const cookieFor = async email => {
  const r = await fetch(`http://${base}/api/auth/login`, { method: 'POST', headers: { 'x-requested-with': 'bloki', 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password1' }) })
  return r.headers.get('set-cookie').split(';')[0]
}

/** A minimal Yjs client: keeps a local doc in sync with the server. */
function client(cookie) {
  const doc = new Y.Doc()
  const ws = new WebSocket(`ws://${base}/collab/${page.id}`, { headers: { cookie, origin: `http://${base}` } })
  const seeded = { value: false }
  ws.binaryType = 'arraybuffer'
  ws.on('message', data => {
    const dec = decoding.createDecoder(new Uint8Array(data))
    const type = decoding.readVarUint(dec)
    if (type === 100) seeded.value = true
    if (type !== 0) return
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, 0)
    sync.readSyncMessage(dec, enc, doc, 'server')
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc))
  })
  doc.on('update', (u, origin) => {
    if (origin === 'server' || ws.readyState !== 1) return
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, 0)
    sync.writeUpdate(enc, u)
    ws.send(encoding.toUint8Array(enc))
  })
  const open = new Promise((ok, fail) => { ws.on('open', () => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); sync.writeSyncStep1(e, doc); ws.send(encoding.toUint8Array(e)); ok() }); ws.on('error', fail); ws.on('unexpected-response', (_, res) => fail(new Error(String(res.statusCode)))) })
  return { doc, ws, open, seeded, text: () => doc.getText('t').toString() }
}
const wait = ms => new Promise(r => setTimeout(r, ms))

test('editors sync, view-only edits are dropped, outsiders are refused, content survives restarts', async () => {
  const a = client(await cookieFor('o@x.si'))
  const b = client(await cookieFor('v@x.si'))
  await Promise.all([a.open, b.open])
  await wait(100)
  assert.equal(a.seeded.value, true, 'the first editor is asked to seed the empty doc')
  assert.equal(b.seeded.value, false)

  a.doc.getText('t').insert(0, 'hello')
  await wait(150)
  assert.equal(b.text(), 'hello')

  b.doc.getText('t').insert(0, 'HACK ')
  await wait(150)
  assert.equal(a.text(), 'hello', 'a viewer cannot change the shared doc')

  await assert.rejects(client(await cookieFor('x@x.si')).open, /403/)
  const noCookie = client('')
  await assert.rejects(noCookie.open, /403/)

  a.ws.close(); b.ws.close()
  await wait(150)
  const c = client(await cookieFor('o@x.si'))
  await c.open
  await wait(150)
  assert.equal(c.text(), 'hello', 'the doc is saved and reloaded')

  // Restoring content outside the live session resets it.
  const closed = new Promise(r => c.ws.on('close', code => r(code)))
  s.updatePage(owner, page.id, { content: [] })
  assert.equal(await closed, 4000)
  s.server.close()
})
