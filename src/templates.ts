import { COLORS, uid, type Page, type Prop, type Schema } from './api'

type Block = Record<string, unknown>
type Row = { title: string; icon?: string; props: Record<string, unknown> }
export type Template = {
  id: string
  name: string
  icon: string
  category: 'Personal' | 'Work' | 'Projects' | 'School'
  description: string
  page: Partial<Page>
  rows?: (props: Prop[]) => Row[]
}

const h = (level: 1 | 2 | 3, text: string): Block => ({ type: 'heading', props: { level }, content: text })
const p = (text = ''): Block => ({ type: 'paragraph', content: text })
const todo = (text: string, checked = false): Block => ({ type: 'checkListItem', props: { checked }, content: text })
const bullet = (text: string): Block => ({ type: 'bulletListItem', content: text })
const callout = (icon: string, text: string): Block => ({ type: 'callout', props: { icon }, content: text })
const divider = (): Block => ({ type: 'divider' })
const opt = (name: string, i: number) => ({ id: uid(), name, color: COLORS[i % COLORS.length] })
const options = (...names: [string, number][]) => names.map(([n, c]) => opt(n, c))

const status = (): Prop => ({ id: uid(), name: 'Status', type: 'status', options: [{ ...opt('Not started', 0), group: 'todo' }, { ...opt('In progress', 5), group: 'progress' }, { ...opt('Done', 4), group: 'done' }] })
const isoIn = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10)

function db(props: Prop[], views: (ids: Record<string, string>) => Schema['views']): Schema {
  const ids = Object.fromEntries(props.map(p => [p.name, p.id]))
  return { props, views: views(ids) }
}

const optionId = (props: Prop[], prop: string, name: string) => props.find(p => p.name === prop)?.options?.find(o => o.name === name)?.id
const propId = (props: Prop[], name: string) => props.find(p => p.name === name)!.id

export const TEMPLATES: Template[] = [
  {
    id: 'todo', name: 'To-do list', icon: '✅', category: 'Personal', description: 'A simple checklist for the day.',
    page: { title: 'To-do list', icon: '✅', content: [callout('💡', 'Click a checkbox to mark a task done. Type / to add more blocks.'), h(2, 'Today'), todo('Reply to emails'), todo('Plan the week'), todo('Go for a walk'), h(2, 'Later'), todo('Book dentist appointment'), p()] },
  },
  {
    id: 'meeting', name: 'Meeting notes', icon: '🗒️', category: 'Work', description: 'Agenda, notes and action items in one place.',
    page: { title: 'Meeting notes', icon: '🗒️', content: [p(`Date: ${new Date().toLocaleDateString()}`), p('Attendees: '), divider(), h(2, 'Agenda'), bullet('Updates'), bullet('Discussion'), h(2, 'Notes'), p(), h(2, 'Action items'), todo('Follow up with the team'), p()] },
  },
  {
    id: 'weekly', name: 'Weekly planner', icon: '📅', category: 'Personal', description: 'Plan each day of your week.',
    page: { title: 'Weekly planner', icon: '📅', content: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Weekend'].flatMap(d => [h(3, d), todo('')]) },
  },
  {
    id: 'projects', name: 'Project tracker', icon: '🎯', category: 'Projects', description: 'Track projects by status, owner and due date.',
    page: (() => {
      const st = status()
      const props: Prop[] = [st, { id: uid(), name: 'Owner', type: 'person' }, { id: uid(), name: 'Due date', type: 'date' },
        { id: uid(), name: 'Priority', type: 'select', options: options(['Low', 4], ['Medium', 3], ['High', 8]) }]
      return {
        title: 'Projects', icon: '🎯', kind: 'db' as const,
        schema: db(props, ids => [
          { id: uid(), name: 'By status', type: 'board', groupBy: ids.Status },
          { id: uid(), name: 'All projects', type: 'table' },
          { id: uid(), name: 'Calendar', type: 'calendar', dateProp: ids['Due date'] },
          { id: uid(), name: 'Timeline', type: 'timeline', dateProp: ids['Due date'] },
        ]),
      }
    })(),
    rows: props => [
      { title: 'Website redesign', icon: '🌐', props: { [propId(props, 'Status')]: optionId(props, 'Status', 'In progress'), [propId(props, 'Due date')]: isoIn(14), [propId(props, 'Priority')]: optionId(props, 'Priority', 'High') } },
      { title: 'Team offsite', icon: '🏕️', props: { [propId(props, 'Status')]: optionId(props, 'Status', 'Not started'), [propId(props, 'Due date')]: isoIn(30), [propId(props, 'Priority')]: optionId(props, 'Priority', 'Medium') } },
      { title: 'Quarterly report', icon: '📊', props: { [propId(props, 'Status')]: optionId(props, 'Status', 'Done'), [propId(props, 'Due date')]: isoIn(-3), [propId(props, 'Priority')]: optionId(props, 'Priority', 'Low') } },
    ],
  },
  {
    id: 'tasks', name: 'Task list', icon: '☑️', category: 'Work', description: 'Tasks with assignees, due dates and a board.',
    page: (() => {
      const st = status()
      const props: Prop[] = [st, { id: uid(), name: 'Assignee', type: 'person' }, { id: uid(), name: 'Due', type: 'date' }, { id: uid(), name: 'Tags', type: 'multi_select', options: options(['Bug', 8], ['Feature', 5], ['Chore', 0]) }]
      return { title: 'Tasks', icon: '☑️', kind: 'db' as const, schema: db(props, ids => [{ id: uid(), name: 'Board', type: 'board', groupBy: ids.Status }, { id: uid(), name: 'Table', type: 'table' }, { id: uid(), name: 'Calendar', type: 'calendar', dateProp: ids.Due }]) }
    })(),
    rows: props => [
      { title: 'Write release notes', props: { [propId(props, 'Status')]: optionId(props, 'Status', 'Not started'), [propId(props, 'Due')]: isoIn(2) } },
      { title: 'Fix login bug', props: { [propId(props, 'Status')]: optionId(props, 'Status', 'In progress'), [propId(props, 'Tags')]: [optionId(props, 'Tags', 'Bug')] } },
    ],
  },
  {
    id: 'reading', name: 'Reading list', icon: '📚', category: 'Personal', description: 'Books, articles and podcasts to get to.',
    page: (() => {
      const props: Prop[] = [
        { id: uid(), name: 'Type', type: 'select', options: options(['Book', 5], ['Article', 2], ['Podcast', 6]) },
        { id: uid(), name: 'Author', type: 'text' },
        { id: uid(), name: 'Status', type: 'status', options: options(['Want to read', 0], ['Reading', 5], ['Finished', 4]) },
        { id: uid(), name: 'Rating', type: 'select', options: options(['⭐', 3], ['⭐⭐', 3], ['⭐⭐⭐', 3], ['⭐⭐⭐⭐', 3], ['⭐⭐⭐⭐⭐', 3]) },
      ]
      return { title: 'Reading list', icon: '📚', kind: 'db' as const, schema: db(props, ids => [{ id: uid(), name: 'Gallery', type: 'gallery' }, { id: uid(), name: 'By status', type: 'board', groupBy: ids.Status }, { id: uid(), name: 'Table', type: 'table' }]) }
    })(),
    rows: props => [
      { title: 'Atomic Habits', icon: '📘', props: { [propId(props, 'Type')]: optionId(props, 'Type', 'Book'), [propId(props, 'Author')]: 'James Clear', [propId(props, 'Status')]: optionId(props, 'Status', 'Reading') } },
      { title: 'The Pragmatic Programmer', icon: '📗', props: { [propId(props, 'Type')]: optionId(props, 'Type', 'Book'), [propId(props, 'Author')]: 'Hunt & Thomas', [propId(props, 'Status')]: optionId(props, 'Status', 'Want to read') } },
    ],
  },
  {
    id: 'journal', name: 'Journal', icon: '📔', category: 'Personal', description: 'One entry per day, tagged by mood.',
    page: (() => {
      const props: Prop[] = [{ id: uid(), name: 'Date', type: 'date' }, { id: uid(), name: 'Mood', type: 'select', options: options(['😊 Good', 4], ['😐 Okay', 3], ['😞 Bad', 8]) }, { id: uid(), name: 'Created', type: 'created' }]
      return { title: 'Journal', icon: '📔', kind: 'db' as const, schema: db(props, ids => [{ id: uid(), name: 'Entries', type: 'list' }, { id: uid(), name: 'Calendar', type: 'calendar', dateProp: ids.Date }]) }
    })(),
    rows: props => [{ title: 'First entry', props: { [propId(props, 'Date')]: isoIn(0), [propId(props, 'Mood')]: optionId(props, 'Mood', '😊 Good') } }],
  },
  {
    id: 'habits', name: 'Habit tracker', icon: '🔁', category: 'Personal', description: 'Tick off daily habits.',
    page: (() => {
      const props: Prop[] = [{ id: uid(), name: 'Date', type: 'date' }, ...['Exercise', 'Read', 'Meditate', 'Water'].map(n => ({ id: uid(), name: n, type: 'checkbox' as const }))]
      return { title: 'Habit tracker', icon: '🔁', kind: 'db' as const, schema: db(props, () => [{ id: uid(), name: 'Table', type: 'table', sort: [{ prop: props[0].id, dir: 'desc' }] }]) }
    })(),
    rows: props => [0, -1, -2].map(d => ({ title: new Date(Date.now() + d * 864e5).toLocaleDateString(undefined, { weekday: 'long' }), props: { [propId(props, 'Date')]: isoIn(d) } })),
  },
  {
    id: 'notes', name: 'Class notes', icon: '🎓', category: 'School', description: 'Lecture notes with key takeaways and questions.',
    page: { title: 'Class notes', icon: '🎓', content: [p('Course: '), p(`Date: ${new Date().toLocaleDateString()}`), h(2, 'Key ideas'), bullet(''), h(2, 'Notes'), p(), h(2, 'Questions'), todo('')] },
  },
  {
    id: 'docs', name: 'Team wiki', icon: '📖', category: 'Work', description: 'A home for your team’s knowledge.',
    page: { title: 'Team wiki', icon: '📖', content: [callout('👋', 'Welcome! Start here to find everything about how we work.'), h(2, 'Getting started'), bullet('Who’s who'), bullet('Tools we use'), h(2, 'How we work'), bullet('Meetings'), bullet('Writing docs'), p()] },
  },
]
