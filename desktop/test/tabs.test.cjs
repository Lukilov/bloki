const { test } = require('node:test')
const assert = require('node:assert/strict')
const tabs = require('../tabs.cjs')

const strip = (...ids) => ({ tabs: ids.map(id => ({ id, pinned: id.startsWith('p') })), active: ids[0] })
const ids = s => s.tabs.map(t => t.id).join(' ')

test('adding and closing tabs', () => {
  const s = strip('p1', 'a', 'b')
  tabs.add(s, { id: 'c' })
  assert.equal(ids(s), 'p1 a b c')
  assert.equal(s.active, 'c')
  tabs.add(s, { id: 'd' }, { after: 'p1', activate: false })
  assert.equal(ids(s), 'p1 d a b c', 'an unpinned tab opened from a pinned one goes after the pinned group')
  assert.equal(s.active, 'c')
  tabs.remove(s, 'c')
  assert.equal(s.active, 'b', 'closing the last tab activates its left neighbour')
  s.active = 'a'
  tabs.remove(s, 'a')
  assert.equal(s.active, 'b', 'otherwise the right neighbour')
  assert.equal(tabs.remove(s, 'nope'), null)
})

test('pinning, moving and bulk closing', () => {
  const s = strip('p1', 'a', 'b', 'c')
  tabs.setPinned(s, 'b', true)
  assert.equal(ids(s), 'p1 b a c')
  tabs.setPinned(s, 'p1', false)
  assert.equal(ids(s), 'b p1 a c')
  tabs.move(s, 'c', 0)
  assert.equal(ids(s), 'b c p1 a', 'an unpinned tab cannot move in front of pinned ones')
  tabs.move(s, 'c', 99)
  assert.equal(ids(s), 'b p1 a c')
  assert.deepEqual(tabs.closable(s, 'a', 'others'), ['p1', 'c'])
  assert.deepEqual(tabs.closable(s, 'a', 'left'), ['p1'])
  assert.deepEqual(tabs.closable(s, 'a', 'right'), ['c'])
  assert.deepEqual(tabs.closable(s, 'gone', 'others'), [], 'a tab that already left the window closes nothing')
})

test('keyboard tab selection', () => {
  const s = strip('a', 'b', 'c')
  assert.equal(tabs.nth(s, 2), 'b')
  assert.equal(tabs.nth(s, 9), 'c')
  assert.equal(tabs.nth(s, 5), null)
  assert.equal(tabs.step(s, -1), 'c', 'wraps around')
  assert.equal(tabs.step(s, 1), 'b')
})

test('restoring saved tabs', () => {
  const server = 'https://s.io'
  const session = { windows: [
    { bounds: { x: 1 }, tabs: [{ url: 'https://s.io/#/a', pinned: true }, { url: 'https://evil.io/#/a' }, { url: 'https://s.io.evil.io/' }, { url: 'file:///etc/passwd' }], active: 3 },
    { tabs: [{ url: 'https://other.io/' }] },
  ] }
  assert.deepEqual(tabs.restorable(session, server), [{ bounds: { x: 1 }, tabs: [{ url: 'https://s.io/#/a', pinned: true }], active: 0 }])
  assert.deepEqual(tabs.restorable(null, server), [])
  assert.deepEqual(tabs.restorable(session, null), [])
})
