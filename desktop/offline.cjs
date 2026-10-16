// Pages kept for reading without a connection ("Available offline"), stored as HTML in a small SQLite file.
const { DatabaseSync } = require('node:sqlite')

function openOffline(file) {
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE IF NOT EXISTS pages (
    server TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL, saved INTEGER NOT NULL, PRIMARY KEY (server, id))`)
  return {
    save(server, id, { title = '', icon = '', html = '' }) {
      db.prepare(`INSERT INTO pages (server, id, title, icon, html, saved) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(server, id) DO UPDATE SET title = excluded.title, icon = excluded.icon, html = excluded.html, saved = excluded.saved`)
        .run(server, id, String(title).slice(0, 500), String(icon).slice(0, 16), String(html), Date.now())
    },
    remove: (server, id) => { db.prepare('DELETE FROM pages WHERE server = ? AND id = ?').run(server, id) },
    has: (server, id) => !!db.prepare('SELECT 1 FROM pages WHERE server = ? AND id = ?').get(server, id),
    list: server => db.prepare('SELECT id, title, icon, saved FROM pages WHERE server = ? ORDER BY title COLLATE NOCASE').all(server).map(r => ({ ...r })),
    get: (server, id) => { const r = db.prepare('SELECT id, title, icon, html, saved FROM pages WHERE server = ? AND id = ?').get(server, id); return r ? { ...r } : null },
    close: () => db.close(),
  }
}

module.exports = { openOffline }
