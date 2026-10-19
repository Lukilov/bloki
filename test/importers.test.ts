import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planAsana, planTrello } from '../src/importers.ts'

let n = 0
const id = () => 'id' + n++

test('a Trello board becomes a database: lists, labels, due dates, descriptions and checklists; archived cards stay out', () => {
  const plan = planTrello({
    name: 'Launch',
    lists: [{ id: 'l1', name: 'To do' }, { id: 'l2', name: 'Done' }, { id: 'l3', name: 'Old', closed: true }],
    labels: [{ id: 'b1', name: 'Urgent', color: 'red' }, { id: 'b2', name: '', color: 'sky' }],
    cards: [
      { id: 'c1', name: 'Write post', desc: 'Draft **first**', idList: 'l1', due: '2026-11-02T12:00:00.000Z', idLabels: ['b1', 'b2'] },
      { id: 'c2', name: 'Archived', idList: 'l1', closed: true },
      { id: 'c3', name: 'In closed list', idList: 'l3' },
    ],
    checklists: [{ idCard: 'c1', name: 'Steps', checkItems: [{ name: 'Outline', state: 'complete' }, { name: 'Edit', state: 'incomplete' }] }],
  }, id)
  assert.equal(plan.title, 'Launch')
  assert.deepEqual(plan.props.map(p => p.name), ['List', 'Labels', 'Due'])
  assert.deepEqual(plan.props[1].options!.map(o => [o.name, o.color]), [['Urgent', 'red'], ['sky', 'blue']])
  assert.equal(plan.rows.length, 1)
  const [row] = plan.rows
  assert.equal(row.props[plan.props[0].id], plan.props[0].options![0].id)
  assert.deepEqual(row.props[plan.props[2].id], { start: '2026-11-02' })
  assert.match(row.md, /Draft \*\*first\*\*[\s\S]*### Steps[\s\S]*- \[x\] Outline\n- \[ \] Edit/)
})

test('an Asana CSV becomes a database with typed columns, Notes as text and Done from Completed At', () => {
  const csv = 'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Due Date,Notes\n1,2026-10-01,2026-10-05,2026-10-05,Plan,Doing,Ana,2026-10-10,Line one\n2,2026-10-02,,2026-10-02,Ship,Doing,Ana,2026-10-20,\n3,2026-10-03,,2026-10-03,Review,Later,Bor,,'
  const plan = planAsana(csv, 'Project', id)
  assert.deepEqual(plan.props.map(p => `${p.name}:${p.type}`), ['Created At:date', 'Completed At:date', 'Section/Column:select', 'Assignee:select', 'Due Date:date', 'Done:checkbox'])
  assert.deepEqual(plan.rows.map(r => [r.title, r.props[plan.props[5].id], r.md]), [['Plan', true, 'Line one'], ['Ship', false, ''], ['Review', false, '']])
})
