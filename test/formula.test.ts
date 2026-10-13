import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run, FormulaError, toText } from '../src/db/formula.ts'

const props: Record<string, unknown> = { Price: 12.5, Qty: 3, Name: 'Bloki', Done: true, Due: new Date('2026-10-20T00:00'), Tags: ['a', 'b'] }
const ctx = { prop: (n: string) => { if (!(n in props)) throw new FormulaError(`No property “${n}”`); return props[n] as never } }
const r = (src: string) => run(src, ctx)

test('arithmetic, precedence and power', () => {
  assert.equal(r('prop("Price") * prop("Qty")'), 37.5)
  assert.equal(r('1 + 2 * 3 ^ 2'), 19)
  assert.equal(r('2 ^ 3 ^ 2'), 512)
  assert.equal(r('-(4 - 6)'), 2)
  assert.equal(r('round(10 / 3, 2)'), 3.33)
})

test('text, conditions and method calls', () => {
  assert.equal(r('"Hi " + prop("Name")'), 'Hi Bloki')
  assert.equal(r('if(prop("Done"), "✅", "⏳")'), '✅')
  assert.equal(r('prop("Qty") > 2 ? "many" : "few"'), 'many')
  assert.equal(r('ifs(prop("Qty") > 5, "a", prop("Qty") > 2, "b", "c")'), 'b')
  assert.equal(r('prop("Name").lower().length()'), 5)
  assert.equal(r('prop("Tags").join("-")'), 'a-b')
  assert.equal(r('not prop("Done") or prop("Qty") == 3'), true)
  assert.equal(r('contains(prop("Tags"), "b")'), true)
})

test('dates', () => {
  assert.equal(r('formatDate(dateAdd(prop("Due"), 2, "days"), "YYYY-MM-DD")'), '2026-10-22')
  assert.equal(r('dateBetween(dateAdd(prop("Due"), 3, "weeks"), prop("Due"), "days")'), 21)
  assert.equal(r('year(prop("Due"))'), 2026)
})

test('errors are values, not exceptions, and never run code', () => {
  assert.ok(r('prop("Missing")') instanceof FormulaError)
  assert.ok(r('alert(1)') instanceof FormulaError)
  assert.ok(r('constructor') instanceof FormulaError)
  assert.ok(r('toString(1)') instanceof FormulaError)
  assert.ok(r('1 +') instanceof FormulaError)
  assert.ok(r('"open') instanceof FormulaError)
  assert.equal(toText(r('[1, 2, 3].sum()') as never), '6')
})
