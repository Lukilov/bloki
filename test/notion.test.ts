import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planNotion, resolve, unzip } from '../src/notionZip.ts'

const id = (n: number) => String(n).padStart(32, 'a')

test('a Notion export (zip inside a zip) becomes pages, sub-pages, a database and its rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notion-'))
  const put = (p: string, s: string) => { mkdirSync(join(dir, 'x', p, '..'), { recursive: true }); writeFileSync(join(dir, 'x', p), s) }
  put(`Home ${id(1)}.md`, `# Home\n\nHello **world**\n\n[Child](Home%20${id(1)}/Child%20${id(2)}.md)\n\n![](Home%20${id(1)}/pic.png)\n`)
  put(`Home ${id(1)}/Child ${id(2)}.md`, '# Child\n\nČ text')
  put(`Home ${id(1)}/pic.png`, 'PNG')
  put(`Home ${id(1)}/Tasks ${id(3)}.csv`, '﻿Name,Status\nFirst,Done\n')
  put(`Home ${id(1)}/Tasks ${id(3)}_all.csv`, '﻿Name,Status\nFirst,Done\nSecond,"To do, later"\n')
  put(`Home ${id(1)}/Tasks ${id(3)}/First ${id(4)}.md`, '# First\n\nStatus: Done\n\nRow body')
  execFileSync('zip', ['-qr', '../inner.zip', '.'], { cwd: join(dir, 'x') })
  execFileSync('zip', ['-q0', 'outer.zip', 'inner.zip'], { cwd: dir })
  const buf = readFileSync(join(dir, 'outer.zip'))
  const files = await unzip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  assert.equal(new TextDecoder().decode(files.get(`Home ${id(1)}/pic.png`)), 'PNG')

  const [home, ...rest] = planNotion(files)
  assert.equal(rest.length, 0)
  assert.equal(home.title, 'Home')
  assert.match(home.md!, /^Hello \*\*world\*\*/)
  const [child, tasks] = [...home.children].sort((a, b) => a.kind.localeCompare(b.kind)).reverse()
  assert.deepEqual([child.title, child.md], ['Child', 'Č text'])
  assert.equal(tasks.kind, 'db')
  assert.deepEqual(tasks.head, ['Name', 'Status'])
  assert.deepEqual(tasks.children.map(r => [r.title, r.cells, r.md]), [['First', ['Done'], 'Row body'], ['Second', ['To do, later'], undefined]])
  assert.equal(resolve(home.path, `Home%20${id(1)}/Child%20${id(2)}.md`), child.path)
})
