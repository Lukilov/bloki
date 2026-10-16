// Pages kept for reading without a connection ("Available offline"), stored as HTML in a small SQLite file.
const { DatabaseSync } = require('node:sqlite')

function openOffline(file) {
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE IF NOT EXISTS pages (
    server TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL, saved INTEGER NOT NULL, PRIMARY KEY (server, id))`)
  // Edits made in the offline reader, waiting to be sent once the server is reachable again.
  db.exec(`CREATE TABLE IF NOT EXISTS pending (
    server TEXT NOT NULL, id TEXT NOT NULL, html TEXT NOT NULL, base INTEGER NOT NULL, edited INTEGER NOT NULL, PRIMARY KEY (server, id))`)
  if (!db.prepare("SELECT 1 FROM pragma_table_info('pages') WHERE name = 'base'").get()) db.exec('ALTER TABLE pages ADD COLUMN base INTEGER NOT NULL DEFAULT 0')
  return {
    /** `base` is the page's server-side update time at the moment of saving, used to spot conflicts later. */
    save(server, id, { title = '', icon = '', html = '', base = 0 }) {
      db.prepare(`INSERT INTO pages (server, id, title, icon, html, saved, base) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(server, id) DO UPDATE SET title = excluded.title, icon = excluded.icon, html = excluded.html, saved = excluded.saved, base = excluded.base`)
        .run(server, id, String(title).slice(0, 500), String(icon).slice(0, 16), String(html), Date.now(), Number(base) || 0)
    },
    /** An offline edit: the reader's copy changes at once, and the edit waits in `pending` until it is sent. */
    edit(server, id, html) {
      const p = db.prepare('SELECT base FROM pages WHERE server = ? AND id = ?').get(server, id)
      if (!p) return false
      db.prepare('UPDATE pages SET html = ? WHERE server = ? AND id = ?').run(String(html), server, id)
      db.prepare(`INSERT INTO pending (server, id, html, base, edited) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(server, id) DO UPDATE SET html = excluded.html, edited = excluded.edited`).run(server, id, String(html), p.base, Date.now())
      return true
    },
    pending: server => db.prepare('SELECT id, html, base, edited FROM pending WHERE server = ? ORDER BY edited').all(server).map(r => ({ ...r })),
    sent: (server, id) => { db.prepare('DELETE FROM pending WHERE server = ? AND id = ?').run(server, id) },
    remove: (server, id) => { db.prepare('DELETE FROM pages WHERE server = ? AND id = ?').run(server, id) },
    has: (server, id) => !!db.prepare('SELECT 1 FROM pages WHERE server = ? AND id = ?').get(server, id),
    list: server => db.prepare('SELECT id, title, icon, saved FROM pages WHERE server = ? ORDER BY title COLLATE NOCASE').all(server).map(r => ({ ...r })),
    get: (server, id) => { const r = db.prepare('SELECT id, title, icon, html, saved, base FROM pages WHERE server = ? AND id = ?').get(server, id); return r ? { ...r } : null },
    close: () => db.close(),
  }
}

module.exports = { openOffline }
