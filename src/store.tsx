import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileText, Table2 } from 'lucide-react'
import { api, publicRoot, type Me, type Page, type Person } from './api'
import { Icon } from './IconPicker'

type Store = {
  pages: Page[]
  byId: Map<string, Page>
  /** Children of a page, or top-level pages (including ones whose parent this user can't see). */
  children: (parent: string | null) => Page[]
  reload: () => Promise<void>
  patch: (id: string, p: Partial<Page>) => Promise<void>
  create: (p: Partial<Page> & { section?: 'workspace' | 'private' }, open?: boolean) => Promise<Page>
  current: string | null
  go: (id: string | null) => void
  me: Me | null
  reloadMe: () => Promise<void>
  people: Map<string, Person>
  published: boolean
  error: string | null
  setError: (e: string | null) => void
  toast: (text: string) => void
  toastText: string | null
}

const Ctx = createContext<Store>(null!)
export const useStore = () => useContext(Ctx)

/** Routes: #/<page>, #/public/<root>/<page>, #/invite/<token>, #/quick-search (the desktop app's Command Search) */
export function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'public') return { public: parts[1], page: parts[2] ?? parts[1] }
  if (parts[0] === 'invite') return { invite: parts[1] }
  if (parts[0] === 'quick-search') return { quickSearch: true, page: null }
  return { page: parts[0] ?? null }
}

export function StoreProvider({ me: initialMe, children }: { me: Me | null; children: ReactNode }) {
  const [pages, setPages] = useState<Page[]>([])
  const [current, setCurrent] = useState(() => parseHash().page ?? null)
  const [me, setMe] = useState(initialMe)
  const [people, setPeople] = useState<Person[]>([])
  const [error, setError] = useState<string | null>(null)
  const [toastText, setToast] = useState<string | null>(null)

  const reload = useCallback(async () => setPages(await api.list()), [])
  const reloadMe = useCallback(async () => { setMe(await api.me()); await reload() }, [reload])
  useEffect(() => { reload().catch(e => setError(e.message)) }, [reload])
  useEffect(() => {
    if (me?.workspaceId) api.people(me.workspaceId).then(setPeople).catch(() => setPeople([]))
  }, [me?.workspaceId])
  useEffect(() => {
    const on = () => setCurrent(parseHash().page ?? null)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  const value = useMemo<Store>(() => {
    const byId = new Map(pages.map(p => [p.id, p]))
    const fail = (e: unknown) => { setError(e instanceof Error ? e.message : String(e)); reload() }
    return {
      pages,
      byId,
      children: parent => pages.filter(p => !p.trashed && (parent === null ? !p.parent_id || !byId.has(p.parent_id) : p.parent_id === parent)),
      reload,
      current,
      me,
      reloadMe,
      people: new Map(people.map(p => [p.id, p])),
      published: !!publicRoot,
      error,
      setError,
      toastText,
      toast: t => setToast(t),
      go: id => { location.hash = publicRoot ? `/public/${publicRoot}/${id ?? publicRoot}` : id ? '/' + id : '' },
      patch: async (id, p) => {
        setPages(ps => ps.map(x => (x.id === id ? { ...x, ...p, updated: Date.now() } : x)))
        try {
          await api.update(id, p)
          // Trash and moves change what's visible around the page, so pull the list back.
          await reload()
        } catch (e) { fail(e) }
      },
      create: async (p, open = true) => {
        try {
          const page = await api.create(p)
          await reload()
          if (open) location.hash = '/' + page.id
          return page
        } catch (e) { fail(e); throw e }
      },
    }
  }, [pages, current, reload, me, reloadMe, people, error, toastText])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function ancestors(byId: Map<string, Page>, id: string | null): Page[] {
  const out: Page[] = []
  for (let p = id ? byId.get(id) : undefined; p; p = p.parent_id ? byId.get(p.parent_id) : undefined) out.unshift(p)
  return out
}

export const label = (p?: Pick<Page, 'title'>) => p?.title || 'Untitled'
/** The page's icon as an element (emoji, image or vector icon). */
export const iconOf = (p?: Pick<Page, 'icon' | 'kind'>, size = 18) => p?.icon ? <Icon value={p.icon} size={size} /> : p?.kind === 'db' ? <Table2 size={size} className="default-icon" /> : <FileText size={size} className="default-icon" />
/** The page's icon as text, for places that only take strings. */
export const iconText = (p?: Pick<Page, 'icon' | 'kind'>) => (p?.icon && !p.icon.startsWith('icon:') && !p.icon.includes('/') ? p.icon : p?.kind === 'db' ? '🗂️' : '📄')
