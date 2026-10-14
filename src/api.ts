export type PropType = 'text' | 'number' | 'select' | 'multi_select' | 'status' | 'date' | 'person' | 'files' | 'checkbox' | 'url' | 'email' | 'phone'
  | 'formula' | 'relation' | 'rollup' | 'created' | 'created_by' | 'updated' | 'updated_by' | 'unique_id'
export type Option = { id: string; name: string; color: string; group?: 'todo' | 'progress' | 'done' }
export type Prop = {
  id: string; name: string; type: PropType; options?: Option[]
  /** number: plain, commas, percent, dollar, euro, pound, yen, rupee, won */
  format?: string
  formula?: string
  relation?: { db: string; synced?: string }
  rollup?: { relation: string; target: string; fn: string }
  prefix?: string
  description?: string
}
export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline'
export type Filter = { prop: string; op: string; value?: string }
export type View = {
  id: string; name: string; type: ViewType
  groupBy?: string; dateProp?: string; endProp?: string
  sort?: { prop: string; dir: 'asc' | 'desc' }[]; filters?: Filter[]; hidden?: string[]
  order?: string[]; widths?: Record<string, number>; calcs?: Record<string, string>; wrap?: boolean
  hiddenGroups?: string[]; collapsedGroups?: string[]; cardSize?: 's' | 'm' | 'l'; cardPreview?: 'cover' | 'none'
  open?: 'peek' | 'center' | 'page'; scale?: 'week' | 'month' | 'quarter'; showEmptyGroups?: boolean
}
export type Schema = { props?: Prop[]; views?: View[]; titleName?: string }

export type Level = 'none' | 'view' | 'comment' | 'edit_content' | 'edit' | 'full'
export const LEVELS: Level[] = ['none', 'view', 'comment', 'edit_content', 'edit', 'full']
export const LEVEL_NAMES: Record<Level, string> = {
  full: 'Full access', edit: 'Can edit', edit_content: 'Can edit content', comment: 'Can comment', view: 'Can view', none: 'No access',
}
export const can = (p: { access?: Level } | undefined, need: Level) => LEVELS.indexOf(p?.access ?? 'none') >= LEVELS.indexOf(need)

export type Role = 'owner' | 'member' | 'guest'
export type Person = { id: string; name: string; email?: string; role: Role }
export type Prefs = { notify?: Partial<Record<'mention' | 'comment' | 'share', boolean>>; startPage?: 'last' | 'home'; weekStart?: 'monday' | 'sunday' }
export type Me = { user: { id: string; email: string; name: string }; prefs: Prefs; workspaceId: string | null; role: Role | null; workspaces: { id: string; name: string; icon: string; role: Role }[] }

export type Page = {
  id: string
  parent_id: string | null
  kind: 'page' | 'db'
  title: string
  icon: string
  cover: string
  schema: Schema
  props: Record<string, unknown>
  favorite: boolean
  trashed: boolean
  full_width: boolean
  locked: boolean
  font: 'default' | 'serif' | 'mono'
  small_text: boolean
  cover_y: number
  trashed_at?: number | null
  position: number
  created: number
  updated: number
  created_by?: string
  updated_by?: string
  workspace_access?: Level | null
  public?: boolean
  access: Level
  section?: 'workspace' | 'shared' | 'private'
  content?: unknown[]
}

export type Share = {
  access: Level
  workspace_access: Level | null
  inherited_workspace_access: Level
  public: boolean
  grants: { user_id: string; level: Level; name: string; email?: string; role: Role | null }[]
  invite?: string
}
export type Comment = { id: string; body: string; resolved: boolean; created: number; user_id: string; name: string; thread_id: string | null; block_id: string | null; quote: string | null }
export type Notice = { id: string; kind: 'mention' | 'comment' | 'share'; page_id: string | null; text: string; created: number; read: boolean; archived: boolean; actor: string | null; page_title: string | null; page_icon: string | null; page_kind: 'page' | 'db' | null }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

/** Set when viewing a published page: reads go to the public endpoints. */
export let publicRoot: string | null = null
export const setPublicRoot = (id: string | null) => { publicRoot = id }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api/' + path, {
    method,
    headers: { 'x-requested-with': 'bloki', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // A session that expired mid-use: start over at the login screen.
    if (res.status === 401 && path !== 'me' && !path.startsWith('auth/')) location.reload()
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`)
  }
  return data
}

export const api = {
  list: () => call<Page[]>('GET', publicRoot ? `public/${publicRoot}/pages` : 'pages'),
  get: (id: string) => call<Page>('GET', publicRoot ? `public/${publicRoot}/pages/${id}` : `pages/${id}`),
  /** A page without its blocks: what the sidebar and databases need. */
  meta: (id: string) => call<Page>('GET', `pages/${id}?meta=1`),
  create: (p: Partial<Page> & { section?: 'workspace' | 'private' }) => call<Page>('POST', 'pages', p),
  update: (id: string, p: Partial<Page>) => call<Page>('PATCH', `pages/${id}`, p),
  remove: (id: string) => call('DELETE', `pages/${id}`),
  duplicate: (id: string) => call<Page>('POST', `pages/${id}/duplicate`),
  history: (id: string) => call<{ title: string; content: unknown[]; at: number; user_id: string | null; name: string | null }[]>('GET', `pages/${id}/history`),
  backlinks: (id: string) => (publicRoot ? Promise.resolve([]) : call<Pick<Page, 'id' | 'title' | 'icon'>[]>('GET', `pages/${id}/backlinks`)),
  search: (q: string, f: { title?: boolean; mine?: boolean } = {}) => call<(Pick<Page, 'id' | 'parent_id' | 'kind' | 'title' | 'icon' | 'updated'> & { snippet: string })[]>('GET', `search?q=${encodeURIComponent(q)}${f.title ? '&title=1' : ''}${f.mine ? '&mine=1' : ''}`),
  upload: async (file: File) => {
    const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'x-requested-with': 'bloki' } })
    const data = await res.json()
    if (!res.ok) throw new ApiError(res.status, data.error)
    return data.url as string
  },

  share: (id: string) => call<Share>('GET', `pages/${id}/share`),
  setShare: (id: string, body: object) => call<Share>('PATCH', `pages/${id}/share`, body),
  comments: (id: string) => (publicRoot ? Promise.resolve([]) : call<Comment[]>('GET', `pages/${id}/comments`)),
  addComment: (id: string, body: string, extra: { thread_id?: string; block_id?: string; quote?: string; id?: string } = {}) => call<Comment[]>('POST', `pages/${id}/comments`, { body, ...extra }),
  updateComment: (id: string, body: { resolved?: boolean; delete?: boolean; body?: string }) => call<Comment[]>('PATCH', `comments/${id}`, body),
  inbox: () => call<{ items: Notice[]; unread: number }>('GET', 'inbox'),
  updateInbox: (b: { ids?: string[]; all?: boolean; read?: boolean; archived?: boolean }) => call<{ items: Notice[]; unread: number }>('PATCH', 'inbox', b),

  status: () => call<{ hasUsers: boolean }>('GET', 'auth/status'),
  login: (email: string, password: string) => call<{ ok: boolean }>('POST', 'auth/login', { email, password }),
  register: (b: { email: string; name: string; password: string; invite?: string }) => call<{ page_id: string | null }>('POST', 'auth/register', b),
  logout: () => call('POST', 'auth/logout', {}),
  me: () => call<Me>('GET', 'me'),
  updateMe: (b: { name?: string; password?: string; new_password?: string; prefs?: Prefs }) => call<Me>('PATCH', 'me', b),
  logoutAll: () => call('POST', 'me/logout-all', {}),
  deleteAccount: (password: string) => call('DELETE', 'me', { password }),
  exportWorkspace: (ws: string) => call<object>('GET', `workspaces/${ws}/export`),

  createWorkspace: (name: string) => call<{ id: string }>('POST', 'workspaces', { name }),
  switchWorkspace: (id: string) => call('POST', `workspaces/${id}/switch`, {}),
  updateWorkspace: (id: string, b: { name?: string; icon?: string }) => call('PATCH', `workspaces/${id}`, b),
  deleteWorkspace: (id: string) => call('DELETE', `workspaces/${id}`),
  people: (ws: string) => call<Person[]>('GET', `workspaces/${ws}/people`),
  setRole: (ws: string, user: string, role: Role) => call<Person[]>('PATCH', `workspaces/${ws}/people/${user}`, { role }),
  removePerson: (ws: string, user: string) => call('DELETE', `workspaces/${ws}/people/${user}`),
  invite: (ws: string, role: Role) => call<{ token: string }>('POST', `workspaces/${ws}/invites`, { role }),
  inviteInfo: (token: string) => call<{ role: Role; level: Level | null; workspace: string; page: string | null; inviter: string }>('GET', `invites/${token}`),
  acceptInvite: (token: string) => call<{ workspace_id: string; page_id: string | null }>('POST', `invites/${token}/accept`, {}),
}

export const inviteLink = (token: string) => `${location.origin}/#/invite/${token}`
export const publicLink = (id: string) => `${location.origin}/#/public/${id}`
export const uid = () => crypto.randomUUID().slice(0, 8)
export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
