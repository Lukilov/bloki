import { createReactBlockSpec } from '@blocknote/react'
import { AlertTriangle, CheckCircle2, ExternalLink, FilePlus2, ListPlus, MousePointerClick, Plus, Settings2, X } from 'lucide-react'
import { label, useStore } from './store'
import { Menu, Popover, usePopover } from './ui'

// The steps a button runs in order, as in Notion's "Do" list (the ones Bloki can carry out).
type Action =
  | { type: 'insert'; md: string }
  | { type: 'addPage'; db: string; title: string; open?: boolean }
  | { type: 'confirm'; text: string }
  | { type: 'open'; target: string }

const ACTIONS: { type: Action['type']; label: string; icon: React.ReactNode; make: () => Action }[] = [
  { type: 'insert', label: 'Insert blocks', icon: <ListPlus size={16} />, make: () => ({ type: 'insert', md: '' }) },
  { type: 'addPage', label: 'Add page to…', icon: <FilePlus2 size={16} />, make: () => ({ type: 'addPage', db: '', title: '' }) },
  { type: 'confirm', label: 'Show confirmation', icon: <CheckCircle2 size={16} />, make: () => ({ type: 'confirm', text: 'Are you sure?' }) },
  { type: 'open', label: 'Open page or URL', icon: <ExternalLink size={16} />, make: () => ({ type: 'open', target: '' }) },
]

const parse = (s: string): Action[] => { try { const a = JSON.parse(s); return Array.isArray(a) ? a : [] } catch { return [] } }

type Ed = { isEditable: boolean; insertBlocks: (b: never[], ref: string, where: 'after') => void; tryParseMarkdownToBlocks: (md: string) => unknown[] | Promise<unknown[]>; updateBlock: (b: unknown, u: unknown) => void }

function ButtonView({ block, editor }: { block: { id: string; props: { label: string; icon: string; actions: string } }; editor: Ed }) {
  const store = useStore()
  const [edit, openEdit, closeEdit] = usePopover()
  const actions = parse(block.props.actions)
  const set = (p: Partial<typeof block.props>) => editor.updateBlock(block, { props: p })
  const run = async (anchor: HTMLElement) => {
    if (!actions.length) return editor.isEditable && openEdit(anchor)
    try {
      for (const a of actions) {
        if (a.type === 'confirm' && !window.confirm(a.text || 'Are you sure?')) return
        if (a.type === 'insert' && a.md.trim() && editor.isEditable) editor.insertBlocks(await editor.tryParseMarkdownToBlocks(a.md) as never[], block.id, 'after')
        if (a.type === 'addPage' && a.db) {
          const page = await store.create({ parent_id: a.db, title: a.title }, !!a.open)
          if (!a.open) store.toast(`Added “${page.title || 'Untitled'}” to ${label(store.byId.get(a.db) ?? page)}`)
        }
        if (a.type === 'open' && a.target.trim()) {
          const t = a.target.trim()
          if (store.byId.has(t)) store.go(t)
          else if (/^https?:\/\//i.test(t)) window.open(t, '_blank', 'noopener')
        }
      }
    } catch (e) { store.setError((e as Error).message) }
  }
  return (
    <div className="button-block" contentEditable={false}>
      <button className="bn-btn" onClick={e => run(e.currentTarget)}>
        {block.props.icon && <span className="bn-btn-icon">{block.props.icon}</span>}
        <span>{block.props.label || 'New button'}</span>
        {!actions.length && <AlertTriangle size={15} className="bn-btn-warn" aria-label="This button has no actions" />}
      </button>
      {editor.isEditable && <button className="icon-btn bn-btn-edit" title="Edit button" onClick={e => openEdit(e.currentTarget.previousElementSibling as HTMLElement)}><Settings2 size={14} /></button>}
      <Popover anchor={edit} onClose={closeEdit} className="button-editor" width={600}>
        <ButtonEditor props={block.props} actions={actions} set={set} done={closeEdit} />
      </Popover>
    </div>
  )
}

function ButtonEditor({ props, actions, set, done }: { props: { label: string; icon: string }; actions: Action[]; set: (p: { label?: string; icon?: string; actions?: string }) => void; done: () => void }) {
  const store = useStore()
  const [add, openAdd, closeAdd] = usePopover()
  const save = (list: Action[]) => set({ actions: JSON.stringify(list) })
  const change = (i: number, a: Partial<Action>) => save(actions.map((x, j) => (j === i ? { ...x, ...a } as Action : x)))
  const dbs = store.pages.filter(p => p.kind === 'db' && !p.trashed && (p.access === 'full' || p.access === 'edit' || p.access === 'edit_content'))
  return (
    <div className="button-editor-body">
      <div className="button-editor-name">
        <input className="button-editor-icon" value={props.icon} maxLength={4} placeholder="🙂" aria-label="Icon" onChange={e => set({ icon: e.target.value })} />
        <input autoFocus value={props.label} placeholder="New button" aria-label="Button name" onChange={e => set({ label: e.target.value })} />
      </div>
      <div className="button-editor-label">When</div>
      <div className="button-step"><MousePointerClick size={16} /> <b>Button is clicked</b></div>
      <div className="button-editor-line" />
      <div className="button-editor-label">Do</div>
      {actions.map((a, i) => (
        <div key={i} className="button-step action">
          <div className="button-step-head">{ACTIONS.find(x => x.type === a.type)?.icon} <b>{ACTIONS.find(x => x.type === a.type)?.label}</b>
            <button className="icon-btn" title="Remove action" onClick={() => save(actions.filter((_, j) => j !== i))}><X size={14} /></button></div>
          {a.type === 'insert' && <textarea rows={3} placeholder="Blocks to insert, in Markdown (- [ ] To-do, ## Heading…)" value={a.md} onChange={e => change(i, { md: e.target.value })} />}
          {a.type === 'confirm' && <input value={a.text} placeholder="Are you sure?" onChange={e => change(i, { text: e.target.value })} />}
          {a.type === 'open' && <input value={a.target} placeholder="https://… or a page link" onChange={e => change(i, { target: e.target.value.replace(/^.*#\/([\w-]{36})$/, '$1') })} />}
          {a.type === 'addPage' && <>
            <select value={a.db} onChange={e => change(i, { db: e.target.value })}>
              <option value="">Select a database</option>
              {dbs.map(d => <option key={d.id} value={d.id}>{label(d)}</option>)}
            </select>
            <input value={a.title} placeholder="Page name" onChange={e => change(i, { title: e.target.value })} />
            <label className="button-check"><input type="checkbox" checked={!!a.open} onChange={e => change(i, { open: e.target.checked })} /> Open the new page</label>
          </>}
        </div>
      ))}
      <button className="button-step add" onClick={e => openAdd(e.currentTarget)}><Plus size={16} /> New action</button>
      <button className="primary button-done" onClick={done}>Done</button>
      <Popover anchor={add} onClose={closeAdd} className="menu-pop" width={260}>
        <Menu onClose={closeAdd} items={ACTIONS.map(x => ({ icon: x.icon, label: x.label, onClick: () => save([...actions, x.make()]) }))} />
      </Popover>
    </div>
  )
}

/** Notion's Button block: a labelled button that runs its steps when clicked. */
export const ButtonBlock = createReactBlockSpec(
  { type: 'button', propSchema: { label: { default: 'New button' }, icon: { default: '' }, actions: { default: '[]' } }, content: 'none' },
  { render: ({ block, editor }) => <ButtonView block={block as never} editor={editor as unknown as Ed} /> },
)
