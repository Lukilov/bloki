import { useEffect, useState } from 'react'
import { ChevronsUpDown, Eye, Globe, Lock, MoreHorizontal, Plus, X } from 'lucide-react'
import { api, ApiError, type FormDef, type FormQuestion, type Page, type PropType, type View } from '../api'
import { useStore } from '../store'
import { Avatar } from '../Comments'
import { copyText, Menu, Popover, usePopover } from '../ui'
import { newProp, TYPE_ICONS, typeIcon } from './Cells'
import { TYPE_NAMES } from './model'
import type { ViewProps } from './Views'

// What a form can ask for; the server accepts the same list.
const FORM_TYPES: PropType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone']

/** The questions a form view asks, from its saved list and the database's current properties. */
export function questionsOf(db: Page, view: View): FormQuestion[] {
  return (view.form?.questions ?? []).flatMap((q): FormQuestion[] => {
    if (q.prop === 'title') return [{ prop: 'title', name: q.name || db.schema.titleName || 'Name', type: 'text', required: !!q.required }]
    const p = db.schema.props?.find(x => x.id === q.prop)
    return p && FORM_TYPES.includes(p.type) ? [{ prop: p.id, name: q.name || p.name, type: p.type, required: !!q.required, options: p.options }] : []
  })
}

/** A new Form view starts with a question for the name and every property a form can ask for, as Notion offers. */
export const defaultForm = (db: Page): View['form'] => ({ questions: [{ prop: 'title' }, ...(db.schema.props ?? []).filter(p => FORM_TYPES.includes(p.type)).map(p => ({ prop: p.id }))] })

export const formUrl = (db: string, view: string) => `${location.origin}${location.pathname}#/form/${db}/${view}`

/** Form view: Notion's form builder. Questions are the database's properties; answers become new rows. */
export function FormView({ db, view, setView, perm }: ViewProps) {
  const store = useStore()
  const form = view.form ?? {}
  const questions = questionsOf(db, view)
  const [picked, setPicked] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [share, openShare, closeShare] = usePopover()
  const [more, openMore, closeMore] = usePopover()
  const [add, openAdd, closeAdd] = usePopover()
  const edit = perm.structure
  const setForm = (f: Partial<NonNullable<View['form']>>) => setView({ form: { ...form, ...f } })
  const setQ = (prop: string, q: { name?: string; required?: boolean } | null) =>
    setForm({ questions: (form.questions ?? []).flatMap(x => x.prop !== prop ? [x] : q ? [{ ...x, ...q }] : []) })
  const asked = new Set(questions.map(q => q.prop))
  const unasked = [...(asked.has('title') ? [] : [{ id: 'title', name: db.schema.titleName || 'Name', type: 'text' as PropType }]), ...(db.schema.props ?? []).filter(p => FORM_TYPES.includes(p.type) && !asked.has(p.id))]
  const ask = (prop: string) => { setForm({ questions: [...(form.questions ?? []), { prop }] }); setPicked(prop); closeAdd() }
  const askNew = (t: PropType) => {
    // A new question is a new property; one change saves both, so neither overwrites the other.
    const p = newProp(t)
    const views = (db.schema.views ?? []).map(v => v.id === view.id ? { ...v, form: { ...form, questions: [...(form.questions ?? []), { prop: p.id }] } } : v)
    store.patch(db.id, { schema: { ...db.schema, props: [...(db.schema.props ?? []), p], views } })
    setPicked(p.id); closeAdd()
  }
  const workspace = store.me?.workspaces.find(w => w.id === store.me?.workspaceId)?.name ?? 'this workspace'
  const q = questions.find(x => x.prop === picked)

  return (
    <div className="form-view">
      <div className="form-bar">
        <button className="form-preview" onClick={() => setPreview(true)}><Eye size={16} /> Preview</button>
        <button className="primary" onClick={e => openShare(e.currentTarget)}>Share form</button>
      </div>
      <div className="form-sheet">
        <input className="form-title" placeholder="Form title" value={form.title ?? ''} readOnly={!edit} onChange={e => setForm({ title: e.target.value })} />
        <input className="form-desc" placeholder="Description (optional)" value={form.description ?? ''} readOnly={!edit} onChange={e => setForm({ description: e.target.value })} />
        <div className="form-access">
          {form.anyone ? <Globe size={14} /> : <Lock size={14} />}
          <span>{form.anyone ? 'Anyone with the link can fill out this form.' : `Only members at ${workspace} can fill out this form.`}</span>
          {edit && <button className="ghost" onClick={e => openShare(e.currentTarget)}>Change</button>}
        </div>
        {questions.map(x => (
          <div key={x.prop} className={'form-q' + (picked === x.prop ? ' on' : '')} onClick={() => setPicked(x.prop)}>
            {edit && picked === x.prop && <button className="icon-btn form-q-more" title="Question options" onClick={e => { e.stopPropagation(); openMore(e.currentTarget) }}><MoreHorizontal size={14} /></button>}
            <div className="form-q-name">
              <input value={x.name} readOnly={!edit} onChange={e => setQ(x.prop, { name: e.target.value })} aria-label="Question" />
              {x.required && <span className="form-required">*</span>}
            </div>
            <div className="form-answer">Respondent’s answer{['select', 'status', 'multi_select', 'date'].includes(x.type) && <ChevronsUpDown size={14} />}</div>
          </div>
        ))}
        {!questions.length && <div className="layout-muted">No questions yet</div>}
        {edit && <button className="form-add" title="Add question" onClick={e => openAdd(e.currentTarget)}><Plus size={18} /></button>}
      </div>

      <Popover anchor={more} onClose={closeMore} className="menu-pop" width={220}>
        {q && <Menu onClose={closeMore} items={[
          { label: 'Required', checked: q.required, onClick: () => setQ(q.prop, { required: !q.required }) },
          { icon: <X size={15} />, label: 'Remove question', danger: true, onClick: () => { setQ(q.prop, null); setPicked(null) } },
        ]} />}
      </Popover>
      <Popover anchor={add} onClose={closeAdd} className="menu-pop" width={290}>
        <div className="menu-list">
          {unasked.length > 0 && <div className="menu-heading">Use an existing property</div>}
          {unasked.map(p => (
            <button key={p.id} className="menu-item tall" onClick={() => ask(p.id)}>
              <span className="menu-icon boxed">{p.id === 'title' ? TYPE_ICONS.title : typeIcon(p as never)}</span>
              <span className="menu-label">{p.name}<small>{p.id === 'title' ? 'Title' : TYPE_NAMES[p.type]}</small></span>
            </button>
          ))}
          <div className="menu-heading">New question</div>
          {FORM_TYPES.map(t => <button key={t} className="menu-item" onClick={() => askNew(t)}><span className="menu-icon">{TYPE_ICONS[t]}</span><span className="menu-label">{TYPE_NAMES[t]}</span></button>)}
        </div>
      </Popover>
      <Popover anchor={share} onClose={closeShare} className="menu-pop" width={340}>
        <div className="menu-list form-share">
          <div className="menu-heading">Who can fill out</div>
          <Menu onClose={() => {}} items={[
            { icon: <Lock size={15} />, label: `Members at ${workspace}`, checked: !form.anyone, disabled: !edit, onClick: () => setForm({ anyone: false }) },
            { icon: <Globe size={15} />, label: 'Anyone with the link', checked: !!form.anyone, disabled: !edit, onClick: () => setForm({ anyone: true }) },
          ]} />
          <div className="menu-divider" />
          <div className="form-link"><input readOnly value={formUrl(db.id, view.id)} onFocus={e => e.target.select()} /><button className="primary" onClick={() => { copyText(formUrl(db.id, view.id)); store.toast('Copied link to form'); closeShare() }}>Copy link</button></div>
        </div>
      </Popover>
      {preview && (
        <div className="form-modal" onClick={e => e.target === e.currentTarget && setPreview(false)}>
          <div className="form-modal-card">
            <button className="icon-btn form-modal-close" title="Close preview" onClick={() => setPreview(false)}><X size={16} /></button>
            <FormFill def={{ title: form.title || '', description: form.description ?? '', anyone: !!form.anyone, questions }} who={store.me?.user.name}
              submit={async a => { await api.submitForm(db.id, view.id, a); await store.reload() }} />
          </div>
        </div>
      )}
    </div>
  )
}

/** The form as people answering it see it (Preview, and the shared link). */
export function FormFill({ def, who, submit }: { def: FormDef; who?: string; submit: (answers: Record<string, unknown>) => Promise<void> }) {
  const [a, setA] = useState<Record<string, unknown>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const set = (k: string, v: unknown) => setA(x => ({ ...x, [k]: v }))
  if (done) return (
    <div className="form-fill form-done">
      <h1>{def.title || 'Form'}</h1>
      <p>Thanks, your response was submitted.</p>
      <button className="ghost" onClick={() => { setA({}); setDone(false) }}>Submit another response</button>
    </div>
  )
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try { await submit(a); setDone(true) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <form className="form-fill" onSubmit={send}>
      {def.title && <h1>{def.title}</h1>}
      {def.description && <p className="form-fill-desc">{def.description}</p>}
      {who && <div className="form-who">Submitting response as <Avatar name={who} size={18} /> {who}</div>}
      {def.questions.map(q => {
        const id = 'q-' + q.prop
        const v = a[q.prop]
        return (
          <div key={q.prop} className="form-field">
            <label htmlFor={id}>{q.name}{q.required && <span className="form-required">*</span>}</label>
            {q.type === 'checkbox' ? <input id={id} type="checkbox" checked={v === true} onChange={e => set(q.prop, e.target.checked)} />
              : q.type === 'select' || q.type === 'status' ? (
                <select id={id} required={q.required} value={String(v ?? '')} onChange={e => set(q.prop, e.target.value)}>
                  <option value="">Select an option</option>
                  {q.options?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : q.type === 'multi_select' ? (
                <div className="form-multi" id={id}>{q.options?.map(o => {
                  const list = (v as string[] | undefined) ?? []
                  return <label key={o.id} className={'chip-' + o.color}><input type="checkbox" checked={list.includes(o.id)} onChange={e => set(q.prop, e.target.checked ? [...list, o.id] : list.filter(x => x !== o.id))} /> {o.name}</label>
                })}{!q.options?.length && <span className="muted">No options</span>}</div>
              ) : (
                <input id={id} required={q.required} placeholder="Your answer" value={String(v ?? '')} onChange={e => set(q.prop, e.target.value)}
                  type={{ number: 'number', date: 'date', url: 'url', email: 'email', phone: 'tel' }[q.type as string] ?? 'text'} step={q.type === 'number' ? 'any' : undefined} />
              )}
          </div>
        )
      })}
      {error && <p className="form-error">{error}</p>}
      <button className="form-submit" disabled={busy}>Submit</button>
    </form>
  )
}

/** #/form/<database>/<view>: the shared form on its own page, for members and (when allowed) people without an account. */
export function FormPage({ dbId, viewId, who, login }: { dbId: string; viewId: string; who?: string; login: () => void }) {
  const [def, setDef] = useState<FormDef | null>(null)
  const [error, setError] = useState<{ status: number; message: string } | null>(null)
  useEffect(() => {
    api.formDef(dbId, viewId).then(d => { setDef(d); document.title = d.title }).catch((e: ApiError) => setError({ status: e.status, message: e.message }))
  }, [dbId, viewId])
  return (
    <div className="form-page">
      {def ? <FormFill def={def} who={who} submit={async a => { await api.submitForm(dbId, viewId, a) }} />
        : error ? <div className="form-fill"><h1>{error.status === 401 ? 'Log in to fill out this form' : 'Form unavailable'}</h1><p>{error.message}</p>{error.status === 401 && <button className="primary" onClick={login}>Log in</button>}</div>
        : null}
    </div>
  )
}
