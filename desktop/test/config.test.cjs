const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeServer, isAllowedServer, deepLinkTarget } = require('../config.cjs')

test('server addresses', () => {
  assert.equal(normalizeServer('bloki.example.com'), 'https://bloki.example.com')
  assert.equal(normalizeServer('localhost:4321'), 'http://localhost:4321')
  assert.equal(normalizeServer('https://bloki.example.com/some/page#x'), 'https://bloki.example.com')
  assert.equal(normalizeServer('javascript:alert(1)'), null)
  assert.equal(normalizeServer('  '), null)
  assert.ok(isAllowedServer('https://bloki.example.com'))
  assert.ok(isAllowedServer('http://localhost:4321'))
  assert.ok(!isAllowedServer('http://bloki.example.com'), 'plain http over the network is refused')
})

test('deep links', () => {
  assert.equal(deepLinkTarget('bloki://abc-123', 'https://s.io'), 'https://s.io/#/abc-123')
  assert.equal(deepLinkTarget('bloki://abc/b/blk', 'https://s.io'), 'https://s.io/#/abc/b/blk')
  assert.equal(deepLinkTarget('bloki://../../etc', 'https://s.io'), null)
  assert.equal(deepLinkTarget('bloki://abc', null), null)
})
