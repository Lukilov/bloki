import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregate, applyView, groupRows, matches, newRowDefaults, value, visibleRange, type Ctx } from '../src/db/model.ts'
import type { Page, Prop, Schema } from '../src/api.ts'

const page = (id: string, parent: string | null, props: Record<string, unknown> = {}, extra: Partial<Page> = {}): Page => ({
  id, parent_id: parent, kind: 'page', title: id, icon: '', cover: '', schema: {}, props, favorite: false, trashed: false, full_width: false, locked: false,
  font: 'default', small_text: false, cover_y: 50, position: 0, created: 0, updated: 0, access: 'full', ...extra,
})

const price: Prop = { id: 'price', name: 'Price', type: 'number' }
const productsSchema: Schema = { props: [price] }
const products = page('products', null, {}, { kind: 'db', schema: productsSchema })
const apple = page('apple', 'products', { price: 2 })
const pear = page('pear', 'products', { price: 3 })

const items: Prop = { id: 'items', name: 'Items', type: 'relation', relation: { db: 'products' } }
const total: Prop = { id: 'total', name: 'Total', type: 'rollup', rollup: { relation: 'items', target: 'price', fn: 'sum' } }
const label: Prop = { id: 'label', name: 'Label', type: 'formula', formula: 'prop("Name") + ": " + format(prop("Total"))' }
const loop: Prop = { id: 'loop', name: 'Loop', type: 'formula', formula: 'prop("Loop")' }
const status: Prop = { id: 'st', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'To do', color: 'gray' }, { id: 'done', name: 'Done', color: 'green' }] }
const due: Prop = { id: 'due', name: 'Due', type: 'date' }
const ordersSchema: Schema = { props: [items, total, label, loop, status, due] }
const orders = page('orders', null, {}, { kind: 'db', schema: ordersSchema })
const o1 = page('o1', 'orders', { items: ['apple', 'pear'], st: 'done', due: '2026-01-05' }, { position: 2 })
const o2 = page('o2', 'orders', { items: ['apple'], st: 'todo' }, { position: 1 })

const ctx: Ctx = { byId: new Map([products, apple, pear, orders, o1, o2].map(p => [p.id, p])), people: new Map() }

test('relations and rollups', () => {
  assert.deepEqual(value(o1, items, ordersSchema, ctx), ['apple', 'pear'])
  assert.equal(value(o1, total, ordersSchema, ctx), 5)
  assert.equal(value(o2, total, ordersSchema, ctx), 2)
})

test('formulas read other properties, including rollups, and catch self-reference', () => {
  assert.equal(value(o1, label, ordersSchema, ctx), 'o1: 5')
  assert.ok(String(value(o1, loop, ordersSchema, ctx)).includes('itself'))
})

test('filters, sorting and grouping', () => {
  assert.ok(matches(o1, { prop: 'st', op: 'is', value: 'done' }, ordersSchema, ctx))
  assert.ok(!matches(o2, { prop: 'due', op: 'not_empty' }, ordersSchema, ctx))
  assert.ok(matches(o1, { prop: 'due', op: 'before', value: '2026-02-01' }, ordersSchema, ctx))
  assert.ok(matches(o1, { prop: 'items', op: 'contains', value: 'pear' }, ordersSchema, ctx))
  // Without sorts, manual order (position) wins; empty values sort last.
  assert.deepEqual(applyView([o1, o2], ordersSchema, { id: 'v', name: '', type: 'table' }, ctx).map(r => r.id), ['o2', 'o1'])
  assert.deepEqual(applyView([o2, o1], ordersSchema, { id: 'v', name: '', type: 'table', sort: [{ prop: 'due', dir: 'desc' }] }, ctx).map(r => r.id), ['o1', 'o2'])
  const groups = groupRows([o1, o2], status, ordersSchema, ctx)
  assert.deepEqual(groups.map(g => [g.key, g.rows.length]), [['', 0], ['todo', 1], ['done', 1]])
})

test('calculations', () => {
  assert.equal(aggregate('average', [1, 2, 3, 4], price, ctx), 2.5)
  assert.equal(aggregate('percent_not_empty', [1, null, '', 4], price, ctx), '50%')
  assert.equal(aggregate('unique', ['a', 'a', 'b', null], price, ctx), 2)
})

test('new rows start at the first to-do status', () => {
  const schema = { props: [
    { id: 's', name: 'Status', type: 'status', options: [{ id: 'done', name: 'Done', color: 'green', group: 'done' }, { id: 'todo', name: 'Not started', color: 'gray', group: 'todo' }] },
    { id: 't', name: 'Tags', type: 'multi_select', options: [{ id: 'x', name: 'X', color: 'red' }] },
    { id: 'e', name: 'Empty', type: 'status', options: [] },
  ] } as unknown as Schema
  assert.deepEqual(newRowDefaults(schema), { s: 'todo' })
  assert.deepEqual(newRowDefaults({} as Schema), {})
})

test('long tables render only the rows near the screen', () => {
  assert.deepEqual(visibleRange(0, 800, 50, 36), [0, 50], 'short lists render whole')
  assert.deepEqual(visibleRange(0, 720, 1000, 36, 10), [0, 30], 'list at the top: 20 visible + 10 below')
  assert.deepEqual(visibleRange(-3600, 720, 1000, 36, 10), [90, 130], 'scrolled 100 rows down')
  assert.deepEqual(visibleRange(-40000, 720, 1000, 36, 10), [1000, 1000], 'scrolled past the end')
  assert.deepEqual(visibleRange(2000, 720, 1000, 36, 10), [0, 0], 'list still below the screen')
})
