// Settings the desktop app keeps between launches: the server address and the window's size and place.
const fs = require('node:fs')
const path = require('node:path')

function load(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) } catch { return {} }
}
function save(dir, config) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2))
}

/** Accept "bloki.example.com", "localhost:4321" or a full URL; return the origin or null. */
function normalizeServer(input) {
  let raw = String(input ?? '').trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) raw = (/^(localhost|127\.|\[::1\])/.test(raw) ? 'http://' : 'https://') + raw
  try {
    const u = new URL(raw)
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) return null
    return u.origin
  } catch { return null }
}

/** Plain http is only for this computer; anything over the network must use https. */
function isAllowedServer(origin) {
  const u = new URL(origin)
  return u.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
}

/** "bloki://<page id>[/b/<block id>]" opens that page on the configured server. */
function deepLinkTarget(link, server) {
  const m = /^bloki:\/\/([\w-]+)(?:\/b\/([\w-]+))?\/?$/i.exec(String(link ?? ''))
  if (!m || !server) return null
  return `${server}/#/${m[1]}${m[2] ? `/b/${m[2]}` : ''}`
}

module.exports = { load, save, normalizeServer, isAllowedServer, deepLinkTarget }
