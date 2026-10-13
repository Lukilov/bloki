// Live co-editing: the Yjs sync and awareness protocol over WebSockets, one shared document per page.
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MSG_SYNC = 0, MSG_AWARENESS = 1, MSG_QUERY_AWARENESS = 3
/** Custom: tells one editor to fill an empty shared document from the saved page. */
const MSG_SEED = 100
/** Close code that tells clients the page was replaced outside the live session. */
export const RESET_CODE = 4000
const FRAGMENT = 'document-store'

/**
 * @param {{ db: any, authorize: (req: any, pageId: string) => { userId: string, canEdit: boolean } | null }} deps
 */
export function createCollab({ db, authorize }) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('pages') WHERE name = 'ydoc'").get()) db.exec('ALTER TABLE pages ADD COLUMN ydoc BLOB')
  const rooms = new Map()

  function room(pageId) {
    let r = rooms.get(pageId)
    if (r) return r
    const doc = new Y.Doc()
    const saved = db.prepare('SELECT ydoc FROM pages WHERE id = ?').get(pageId)?.ydoc
    if (saved) Y.applyUpdate(doc, new Uint8Array(saved))
    const awareness = new awarenessProtocol.Awareness(doc)
    awareness.setLocalState(null)
    r = { doc, awareness, conns: new Map(), timer: null, seeding: false }
    const save = () => db.prepare('UPDATE pages SET ydoc = ? WHERE id = ?').run(Buffer.from(Y.encodeStateAsUpdate(doc)), pageId)
    r.save = save
    doc.on('update', (update, origin) => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      sync.writeUpdate(enc, update)
      const msg = encoding.toUint8Array(enc)
      for (const ws of r.conns.keys()) if (ws !== origin) send(ws, msg)
      clearTimeout(r.timer)
      r.timer = setTimeout(save, 1000)
    })
    awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = [...added, ...updated, ...removed]
      const conn = r.conns.get(origin)
      if (conn) { for (const id of added) conn.ids.add(id); for (const id of removed) conn.ids.delete(id) }
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
      const msg = encoding.toUint8Array(enc)
      for (const ws of r.conns.keys()) send(ws, msg)
    })
    rooms.set(pageId, r)
    return r
  }

  function send(ws, msg) {
    if (ws.readyState === 1) ws.send(msg, err => err && ws.close())
  }

  function maybeSeed(r, ws) {
    // An empty shared doc is filled once, by one editor, from the page's saved blocks.
    if (r.seeding || r.doc.getXmlFragment(FRAGMENT).length) return
    const conn = r.conns.get(ws)
    if (!conn?.canEdit) return
    r.seeding = true
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SEED)
    send(ws, encoding.toUint8Array(enc))
  }

  function onMessage(r, ws, data) {
    const conn = r.conns.get(ws)
    const dec = decoding.createDecoder(new Uint8Array(data))
    const type = decoding.readVarUint(dec)
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      const st = decoding.readVarUint(dec)
      if (st === sync.messageYjsSyncStep1) sync.readSyncStep1(dec, enc, r.doc)
      // People who can only view or comment receive changes but never send them.
      else if (conn.canEdit && st === sync.messageYjsSyncStep2) sync.readSyncStep2(dec, r.doc, ws)
      else if (conn.canEdit && st === sync.messageYjsUpdate) sync.readUpdate(dec, r.doc, ws)
      if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc))
      if (st === sync.messageYjsSyncStep2 || st === sync.messageYjsUpdate) { if (r.doc.getXmlFragment(FRAGMENT).length) r.seeding = false }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(r.awareness, decoding.readVarUint8Array(dec), ws)
    } else if (type === MSG_QUERY_AWARENESS) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(r.awareness, [...r.awareness.getStates().keys()]))
      send(ws, encoding.toUint8Array(enc))
    }
  }

  function close(pageId, r, ws) {
    const conn = r.conns.get(ws)
    if (!conn) return
    r.conns.delete(ws)
    clearInterval(conn.recheck)
    awarenessProtocol.removeAwarenessStates(r.awareness, [...conn.ids], null)
    if (conn.seeder && !r.doc.getXmlFragment(FRAGMENT).length) r.seeding = false
    if (!r.conns.size) {
      clearTimeout(r.timer)
      r.save()
      r.doc.destroy()
      if (rooms.get(pageId) === r) rooms.delete(pageId)
    }
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 })

  /** Hook for the HTTP server's 'upgrade' event. */
  function upgrade(req, socket, head) {
    const m = /^\/collab\/([\w-]+)$/.exec(new URL(req.url, 'http://x').pathname)
    // Only same-origin pages may open a live session (cookies alone don't prove where a WebSocket came from).
    const origin = req.headers.origin && new URL(req.headers.origin).host
    if (!m || (origin && origin !== req.headers.host)) { socket.destroy(); return }
    const pageId = m[1]
    const auth = authorize(req, pageId)
    if (!auth) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => {
      const r = room(pageId)
      const conn = { ids: new Set(), canEdit: auth.canEdit, userId: auth.userId, seeder: false }
      r.conns.set(ws, conn)
      // Access can change while a page is open; re-check it now and then.
      // ponytail: 30s polling of permissions; push revocations if that delay matters
      conn.recheck = setInterval(() => {
        const a = authorize(req, pageId)
        if (!a) ws.close(4003, 'No access')
        else conn.canEdit = a.canEdit
      }, 30000)
      conn.recheck.unref?.()
      ws.on('message', data => { try { onMessage(r, ws, data) } catch (e) { console.error(e); ws.close() } })
      ws.on('close', () => close(pageId, r, ws))
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      sync.writeSyncStep1(enc, r.doc)
      send(ws, encoding.toUint8Array(enc))
      const states = [...r.awareness.getStates().keys()]
      if (states.length) {
        const a = encoding.createEncoder()
        encoding.writeVarUint(a, MSG_AWARENESS)
        encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(r.awareness, states))
        send(ws, encoding.toUint8Array(a))
      }
      if (!r.seeding && !r.doc.getXmlFragment(FRAGMENT).length && conn.canEdit) { conn.seeder = true; maybeSeed(r, ws) }
    })
  }

  /** The page was replaced outside the live session (restore, move, import): start the shared doc over. */
  function reset(pageId) {
    db.prepare('UPDATE pages SET ydoc = NULL WHERE id = ?').run(pageId)
    const r = rooms.get(pageId)
    if (!r) return
    clearTimeout(r.timer)
    r.save = () => {}
    // New connections start from the replaced content, not this stale doc.
    rooms.delete(pageId)
    for (const ws of [...r.conns.keys()]) ws.close(RESET_CODE, 'reset')
  }

  return { upgrade, reset, rooms }
}
