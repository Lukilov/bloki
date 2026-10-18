import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  BlockNoteEditor, BlockNoteSchema, createCodeBlockSpec, createHeadingBlockSpec, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs, filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { en } from '@blocknote/core/locales'
import {
  BasicTextStyleButton, BlockTypeSelect, blockTypeSelectItems, ColorStyleButton, CreateLinkButton, DragHandleMenu, FileCaptionButton, FileReplaceButton,
  FormattingToolbar, FormattingToolbarController, getDefaultReactSlashMenuItems, RemoveBlockItem, SideMenu, SideMenuController, SuggestionMenuController,
  createReactBlockSpec, useBlockNoteEditor, useComponentsContext, useCreateBlockNote, useExtensionState, type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { withCollaboration } from '@blocknote/core/yjs'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { removeAwarenessStates } from 'y-protocols/awareness'
import { codeBlockOptions, syntaxHighlighter } from '@blocknote/code-block'
import { getMultiColumnSlashMenuItems, locales as multiColumnLocales, multiColumnDropCursor, withMultiColumn } from '@blocknote/xl-multi-column'
import {
  AtSign, Bookmark, CalendarDays, RefreshCw, ChevronRightSquare, Columns2, Columns3, Columns4, Copy, CornerUpRight, FileText, Globe, Heading1, Heading2, Heading3, Heading4, Link2,
  ListTree, MessageSquare, Navigation, Sigma, Smile, StickyNote, Table, LayoutGrid, Kanban, List as ListIcon, Calendar, Repeat2, Trash2, Type,
  ListTodo, List, ListOrdered, ChevronRight, Code2, Quote, Palette, GanttChart, RemoveFormatting, ClipboardPen, MousePointerClick, BarChart3, Newspaper, LayoutDashboard,
} from 'lucide-react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { api, can, type Comment, type Page, type Synced, type ViewType } from './api'
import { ancestors, iconText, label, useStore } from './store'
import { newDatabase } from './Database'
import { Breadcrumb, Callout, CommentMark, DateMention, InlineEquation, Embed, Equation, InlineDatabase, Mention, PageLink, PersonMention, TableOfContents, formatMentionDate, setMentionDateFormat } from './blocks'
import { copyText, isMac, mod, Popover, shift } from './ui'
import { pageUrl } from './pageActions'
import { ButtonBlock } from './ButtonBlock'

// Blocks a synced block may hold (no databases or nested synced blocks).
const innerSpecs = {
  // Notion has four heading levels.
  ...defaultBlockSpecs, heading: createHeadingBlockSpec({ levels: [1, 2, 3, 4] }), codeBlock: createCodeBlockSpec(codeBlockOptions), callout: Callout(), page: PageLink(),
  embed: Embed(), equation: Equation(), button: ButtonBlock(),
}
const inlineSpecs = { ...defaultInlineContentSpecs, mention: Mention, person: PersonMention, date: DateMention, inlineEquation: InlineEquation }
const innerSchema = BlockNoteSchema.create({ blockSpecs: innerSpecs, inlineContentSpecs: inlineSpecs, styleSpecs: defaultStyleSpecs })

/** One editor's worth of content, stored once on the server and shown live on every page that pastes it. */
function SyncedEditor({ id, initial, editable, original, pageId, copies }: { id: string; initial: unknown[]; editable: boolean; original: string; pageId: string; copies: number }) {
  const store = useStore()
  // Copies edit one shared Yjs document (room "synced-<id>"), so simultaneous edits merge instead of overwriting.
  const live = useCollab(`synced-${id}`, true)
  const ed = useCreateBlockNote(withCollaboration({
    schema: innerSchema, dictionary: dictionary as never,
    collaboration: {
      fragment: live!.doc.getXmlFragment('document-store'), provider: live!.provider,
      user: { name: store.me?.user.name ?? 'Guest', color: colorFor(store.me?.user.id ?? 'guest') }, showCursorLabels: 'activity',
    },
  } as never) as never, [live]) as unknown as { document: unknown[]; replaceBlocks: (a: unknown[], b: unknown[]) => void }
  // The server asks one editor to fill a brand-new shared doc from the saved blocks.
  useEffect(() => {
    const onSync = (ok: boolean) => {
      if (ok && live!.state.seed && !live!.doc.getXmlFragment('document-store').length && initial.length) { live!.state.seed = false; ed.replaceBlocks(ed.document, initial) }
    }
    if (live!.provider.synced) onSync(true)
    live!.provider.on('sync', onSync)
    return () => live!.provider.off('sync', onSync)
  }, [live, ed]) // eslint-disable-line react-hooks/exhaustive-deps
  // A plain JSON copy is still kept on the server for export, offline reading and Unsync.
  const sent = useRef(JSON.stringify(initial))
  const timer = useRef<number | undefined>(undefined)
  const save = () => {
    if (!editable) return
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const json = JSON.stringify(ed.document)
      if (json === sent.current) return
      sent.current = json
      api.updateSynced(id, ed.document as never).catch(e => store.setError(e.message))
    }, 1000)
  }
  // Keys, clicks and pastes inside belong to this editor, not to the page around it.
  const isolate = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.isolated) return
    el.dataset.isolated = '1'
    for (const t of ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'paste', 'cut', 'copy', 'drop', 'dragstart', 'dragover', 'mousedown', 'compositionstart', 'compositionend']) el.addEventListener(t, e => e.stopPropagation())
  }
  const dark = document.documentElement.dataset.theme === 'dark'
  const atOrigin = original === pageId
  return (
    <div className="synced" contentEditable={false} ref={isolate}>
      <div className="synced-bar">
        <button className="synced-label" onClick={() => !atOrigin && store.go(original)} title={atOrigin ? 'This is the original' : 'Open the original'}>
          {atOrigin ? (copies > 1 ? `Editing in ${copies - 1} other page${copies > 2 ? 's' : ''}` : 'Editing original') : `Original in ${label(store.byId.get(original)) || 'another page'}`}
        </button>
        <span className="synced-sep" />
        <button className="synced-copy" title="Copy and sync" onClick={() => { copyText(`bloki-synced:${id}`); store.toast('Copied. Paste it in another page to sync.') }}><Copy size={16} /></button>
      </div>
      <BlockNoteView editor={ed as never} editable={editable} theme={dark ? darkTheme : lightTheme} onChange={save} sideMenu={false} />
      {editable && <div className="synced-empty">Click or type here, then copy and paste it in another page to sync content.</div>}
    </div>
  )
}

function SyncedView({ id, editable }: { id: string; editable: boolean }) {
  const store = useStore()
  const ctx = useContext(EditorCtx)
  const [data, setData] = useState<Synced | 'gone' | null>(null)
  useEffect(() => { api.getSynced(id).then(setData).catch(() => setData('gone')) }, [id])
  if (!data) return <div className="synced loading" contentEditable={false} />
  if (data === 'gone') return <div className="synced gone" contentEditable={false}>This synced block was deleted, or you don't have access to its original page.</div>
  return <SyncedEditor id={id} initial={data.content} editable={editable && data.canEdit} original={data.page_id} pageId={ctx?.page.id ?? store.current ?? ''} copies={data.copies} />
}

const SyncedBlock = createReactBlockSpec(
  { type: 'synced', propSchema: { syncId: { default: '' } }, content: 'none' },
  { render: ({ block, editor }) => <SyncedView id={block.props.syncId} editable={editor.isEditable} /> },
)

const base = BlockNoteSchema.create({
  blockSpecs: { ...innerSpecs, database: InlineDatabase(), toc: TableOfContents(), breadcrumb: Breadcrumb(), synced: SyncedBlock() },
  inlineContentSpecs: inlineSpecs,
  styleSpecs: { ...defaultStyleSpecs, comment: CommentMark },
})
export const schema = withMultiColumn(base)
type Editor = typeof schema.BlockNoteEditor
type AnyBlock = { id: string; type: string; props: Record<string, unknown>; content?: unknown; children: AnyBlock[] }

/* Notion's names, groups and descriptions for the built-in blocks. */
const sm = en.slash_menu
const notionSlash = {
  ...sm,
  paragraph: { ...sm.paragraph, title: 'Text', subtext: 'Just start writing with plain text.', group: 'Basic blocks' },
  check_list: { ...sm.check_list, title: 'To-do list', subtext: 'Track tasks with a to-do list.', aliases: ['todo', 'checkbox', 'task', '[]'], group: 'Basic blocks' },
  heading: { ...sm.heading, subtext: 'Big section heading.', group: 'Basic blocks', aliases: ['h1', '#'] },
  heading_2: { ...sm.heading_2, subtext: 'Medium section heading.', group: 'Basic blocks', aliases: ['h2', '##'] },
  heading_3: { ...sm.heading_3, subtext: 'Small section heading.', group: 'Basic blocks', aliases: ['h3', '###'] },
  table: { ...sm.table, title: 'Table', subtext: 'Add simple tabular content to your page.', group: 'Basic blocks' },
  bullet_list: { ...sm.bullet_list, title: 'Bulleted list', subtext: 'Create a simple bulleted list.', group: 'Basic blocks', aliases: ['ul', '-'] },
  numbered_list: { ...sm.numbered_list, title: 'Numbered list', subtext: 'Create a list with numbering.', group: 'Basic blocks', aliases: ['ol', '1.'] },
  toggle_list: { ...sm.toggle_list, title: 'Toggle list', subtext: 'Toggles can hide and show content inside.', group: 'Basic blocks', aliases: ['>'] },
  quote: { ...sm.quote, subtext: 'Capture a quote.', group: 'Basic blocks', aliases: ['"', 'blockquote'] },
  divider: { ...sm.divider, subtext: 'Visually divide blocks.', group: 'Basic blocks', aliases: ['---', 'hr', 'line'] },
  image: { ...sm.image, subtext: 'Upload or embed with a link.', group: 'Media' },
  video: { ...sm.video, subtext: 'Embed from YouTube, Vimeo, or upload.', group: 'Media' },
  audio: { ...sm.audio, subtext: 'Embed audio or upload.', group: 'Media' },
  code_block: { ...sm.code_block, title: 'Code', subtext: 'Capture a code snippet.', group: 'Media', aliases: ['```', 'snippet'] },
  file: { ...sm.file, subtext: 'Upload or embed with a link.', group: 'Media' },
  toggle_heading: { ...sm.toggle_heading, title: 'Toggle heading 1', subtext: 'Hide content inside a large heading.', group: 'Advanced blocks' },
  toggle_heading_2: { ...sm.toggle_heading_2, title: 'Toggle heading 2', subtext: 'Hide content inside a medium heading.', group: 'Advanced blocks' },
  toggle_heading_3: { ...sm.toggle_heading_3, title: 'Toggle heading 3', subtext: 'Hide content inside a small heading.', group: 'Advanced blocks' },
  emoji: { ...sm.emoji, subtext: 'Search for an emoji to place in text.', group: 'Inline' },
}
const dictionary = {
  ...en,
  slash_menu: notionSlash,
  multi_column: multiColumnLocales.en,
  placeholders: { ...en.placeholders, default: "Write something, or press '/' for commands…", heading: 'Heading', toggleListItem: 'Toggle', bulletListItem: 'List', numberedListItem: 'List', checkListItem: 'To-do', quote: 'Empty quote' },
}
const GROUPS = ['Basic blocks', 'Media', 'Database', 'Advanced blocks', 'Inline']
const ORDER = ['Text', 'Page', 'To-do list', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Table', 'Bulleted list', 'Numbered list', 'Toggle list', 'Quote', 'Divider', 'Link to page', 'Callout',
  'Image', 'Bookmark', 'Video', 'Audio', 'Code', 'File', 'Embed']
/* Notion shows the markdown shortcut next to each block. */
const HINTS: Record<string, string> = {
  'Heading 1': '#', 'Heading 2': '##', 'Heading 3': '###', 'To-do list': '[]', 'Bulleted list': '-', 'Numbered list': '1.', 'Toggle list': '>', Quote: '"', Divider: '---',
  Code: '```', 'Toggle heading 1': '>#', 'Toggle heading 2': '>##', 'Toggle heading 3': '>###', 'Heading 4': '####', 'Toggle heading 4': '>####', 'Mention a person': '@', 'Mention a page': '[[', 'Block equation': '$$',
}
const DROP = new Set(['Heading 4', 'Heading 5', 'Heading 6', 'Page Break'])

/** What the editor needs from the page around it. */
type Ctx = { page: Page; onComment?: (blockId: string, quote: string, id: string) => void; moveBlock: (block: AnyBlock, anchor: HTMLElement, mode?: 'move' | 'pagein') => void }
const EditorCtx = createContext<Ctx | null>(null)

const TURN_INTO: { label: string; icon: React.ReactNode; type: string; props?: Record<string, unknown> }[] = [
  { label: 'Text', icon: <Type size={16} />, type: 'paragraph' },
  { label: 'Heading 1', icon: <Heading1 size={16} />, type: 'heading', props: { level: 1, isToggleable: false } },
  { label: 'Heading 2', icon: <Heading2 size={16} />, type: 'heading', props: { level: 2, isToggleable: false } },
  { label: 'Heading 3', icon: <Heading3 size={16} />, type: 'heading', props: { level: 3, isToggleable: false } },
  { label: 'Heading 4', icon: <Heading4 size={16} />, type: 'heading', props: { level: 4, isToggleable: false } },
  { label: 'Page', icon: <FileText size={16} />, type: 'page' },
  { label: 'Page in…', icon: <CornerUpRight size={16} />, type: 'pagein' },
  { label: 'To-do list', icon: <ListTodo size={16} />, type: 'checkListItem' },
  { label: 'Bulleted list', icon: <List size={16} />, type: 'bulletListItem' },
  { label: 'Numbered list', icon: <ListOrdered size={16} />, type: 'numberedListItem' },
  { label: 'Toggle list', icon: <ChevronRight size={16} />, type: 'toggleListItem' },
  { label: 'Code', icon: <Code2 size={16} />, type: 'codeBlock' },
  { label: 'Quote', icon: <Quote size={16} />, type: 'quote' },
  { label: 'Callout', icon: <StickyNote size={16} />, type: 'callout' },
  { label: 'Block equation', icon: <Sigma size={16} />, type: 'equation' },
  { label: 'Toggle heading 1', icon: <ChevronRightSquare size={16} />, type: 'heading', props: { level: 1, isToggleable: true } },
  { label: 'Toggle heading 2', icon: <ChevronRightSquare size={16} />, type: 'heading', props: { level: 2, isToggleable: true } },
  { label: 'Toggle heading 3', icon: <ChevronRightSquare size={16} />, type: 'heading', props: { level: 3, isToggleable: true } },
  { label: 'Toggle heading 4', icon: <ChevronRightSquare size={16} />, type: 'heading', props: { level: 4, isToggleable: true } },
  { label: 'Synced block', icon: <RefreshCw size={16} />, type: 'synced' },
  { label: '2 columns', icon: <Columns2 size={16} />, type: 'columnList' },
]

const stripIds = (b: AnyBlock): AnyBlock => ({ ...b, id: undefined as never, children: (b.children ?? []).map(stripIds) })
function duplicateBlock(editor: Editor, block: AnyBlock) {
  editor.insertBlocks([stripIds(block) as never], block.id, 'after')
}
const plain = (content: unknown) => Array.isArray(content) ? content.map(c => (c as { text?: string }).text ?? '').join('') : ''

function commentOnBlock(editor: Editor, block: AnyBlock, ctx: Ctx) {
  const id = crypto.randomUUID()
  // Mark the whole block's text, as Notion does when commenting from the block menu.
  const content = (block.content as { type: string; styles?: object }[]).map(c => (c.type === 'text' ? { ...c, styles: { ...c.styles, comment: id } } : c))
  editor.updateBlock(block.id, { content } as never)
  ctx.onComment?.(block.id, plain(block.content).slice(0, 300), id)
}

const COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
const cap = (c: string) => c[0].toUpperCase() + c.slice(1)

/** Turn a block into another kind, as Notion's "Turn into" does. */
function turnInto(editor: Editor, block: AnyBlock, t: (typeof TURN_INTO)[number], pageId: string, store: ReturnType<typeof useStore>) {
  if (block.type === t.type && t.type === 'equation') return
  const text = block.type === 'equation' ? String(block.props.latex ?? '') : plain(block.content)
  // Page: the block's text becomes a new sub-page's title, and the block a link to it.
  if (t.type === 'page') return void store.create({ parent_id: pageId, title: text }, false).then(child => editor.updateBlock(block.id, { type: 'page', props: { pageId: child.id }, content: undefined } as never))
  // Synced block: the block's content moves into a new synced block that can be pasted elsewhere.
  if (t.type === 'synced') return void api.createSynced(pageId, [stripIds(block)]).then(b => editor.replaceBlocks([block.id], [{ type: 'synced', props: { syncId: b.id } }] as never)).catch(e => store.setError(e.message))
  // 2 columns: the block moves into the left column; the right one starts empty.
  if (t.type === 'columnList') return void editor.replaceBlocks([block.id], [{ type: 'columnList', children: [{ type: 'column', children: [stripIds(block)] }, { type: 'column', children: [{ type: 'paragraph' }] }] }] as never)
  // Equation: like Notion, the block's text becomes the TeX.
  if (t.type === 'equation') return void editor.updateBlock(block.id, { type: 'equation', props: { latex: text }, content: undefined } as never)
  editor.updateBlock(block.id, { type: t.type, props: t.props ?? {}, ...(block.type === 'equation' ? { content: text } : {}) } as never)
}

/** Notion's Color submenu: last used, then text colours, then backgrounds, each with a 26px "A" swatch. */
function ColorMenu({ block }: { block: AnyBlock }) {
  const C = useComponentsContext()!
  const editor = useBlockNoteEditor() as unknown as Editor
  const Item = C.Generic.Menu.Item
  const last = (() => { try { return JSON.parse(localStorage.getItem('lastColor') ?? 'null') as { kind: 'text' | 'background'; c: string } | null } catch { return null } })()
  const set = (kind: 'text' | 'background', c: string) => {
    editor.updateBlock(block.id, { props: { [kind === 'text' ? 'textColor' : 'backgroundColor']: c } } as never)
    try { localStorage.setItem('lastColor', JSON.stringify({ kind, c })) } catch { /* storage blocked */ }
  }
  const row = (kind: 'text' | 'background', c: string) => (
    <Item key={kind + c} className="bn-menu-item color-item" onClick={() => set(kind, c)}
      checked={(kind === 'text' ? block.props.textColor : block.props.backgroundColor) === c}
      icon={<span className="color-swatch" style={kind === 'text'
        ? { color: c === 'default' ? undefined : `var(--bn-colors-highlights-${c}-text)` }
        : { background: c === 'default' ? undefined : `var(--bn-colors-highlights-${c}-background)` }}>{kind === 'text' ? 'A' : ''}</span>}>
      {cap(c)} {kind}
    </Item>
  )
  return (
    <C.Generic.Menu.Root sub position="right" portalElement={null}>
      <C.Generic.Menu.Trigger sub><Item className="bn-menu-item" subTrigger icon={<Palette size={16} />}>Color</Item></C.Generic.Menu.Trigger>
      <C.Generic.Menu.Dropdown sub className="bn-menu-dropdown color-menu">
        {last && last.c !== 'default' && <><C.Generic.Menu.Label>Last used</C.Generic.Menu.Label>{row(last.kind, last.c)}<C.Generic.Menu.Divider /></>}
        <C.Generic.Menu.Label>Text color</C.Generic.Menu.Label>
        {COLORS.map(c => row('text', c))}
        <C.Generic.Menu.Divider />
        <C.Generic.Menu.Label>Background color</C.Generic.Menu.Label>
        {COLORS.map(c => row('background', c))}
      </C.Generic.Menu.Dropdown>
    </C.Generic.Menu.Root>
  )
}

/** The ⋮⋮ block menu, as in Notion. */
function BlockMenu() {
  const C = useComponentsContext()!
  const editor = useBlockNoteEditor() as unknown as Editor
  const ctx = useContext(EditorCtx)!
  const store = useStore()
  const block = useExtensionState(SideMenuExtension, { editor: editor as never, selector: (s: { block?: unknown } | undefined) => s?.block }) as AnyBlock | undefined
  if (!block) return null
  const Item = C.Generic.Menu.Item
  const hasText = Array.isArray(block.content)
  // Notion heads the menu with the block's kind ("Text", "Heading 1"…).
  const kind = TURN_INTO.find(t => t.type === block.type && (t.type !== 'heading' || (block.props.level === t.props?.level && !!block.props.isToggleable === !!t.props?.isToggleable)))?.label
    ?? block.type.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
  return (
    <DragHandleMenu>
      <C.Generic.Menu.Label>{kind}</C.Generic.Menu.Label>
      {(hasText || block.type === 'equation') && editor.isEditable && (
        <C.Generic.Menu.Root sub position="right" portalElement={null}>
          <C.Generic.Menu.Trigger sub><Item className="bn-menu-item" subTrigger icon={<Repeat2 size={16} />}>Turn into</Item></C.Generic.Menu.Trigger>
          <C.Generic.Menu.Dropdown sub className="bn-menu-dropdown turn-menu">
            {TURN_INTO.map(t => (
              <Item key={t.label} className="bn-menu-item" icon={t.icon}
                checked={block.type === t.type && (t.type !== 'heading' || (block.props.level === t.props?.level && !!block.props.isToggleable === !!t.props?.isToggleable))}
                onClick={() => (t.type === 'pagein'
                  ? ctx.moveBlock(block, document.querySelector(`[data-id="${block.id}"]`) as HTMLElement, 'pagein')
                  : turnInto(editor, block, t, ctx.page.id, store))}>{t.label}</Item>
            ))}
          </C.Generic.Menu.Dropdown>
        </C.Generic.Menu.Root>
      )}
      {editor.isEditable && block.type !== 'synced' && <ColorMenu block={block} />}
      {block.type === 'synced' && <>
        <Item className="bn-menu-item" icon={<Copy size={16} />} onClick={() => { copyText(`bloki-synced:${block.props.syncId}`); store.toast('Copied. Paste it in another page to sync.') }}>Copy and sync</Item>
        {editor.isEditable && <Item className="bn-menu-item" icon={<RefreshCw size={16} />} onClick={() => api.unsyncAll(String(block.props.syncId)).then(r => store.toast(`Unsynced on ${r.pages} page${r.pages === 1 ? '' : 's'}`)).catch(e => store.setError(e.message))}>Unsync all <span className="bn-hint">{mod}{shift}G</span></Item>}
        {editor.isEditable && <Item className="bn-menu-item" icon={<RefreshCw size={16} />} onClick={() => api.getSynced(String(block.props.syncId)).then(d => editor.replaceBlocks([block.id], (d.content.length ? d.content.map(b => stripIds(b as AnyBlock)) : [{ type: 'paragraph' }]) as never)).catch(e => store.setError(e.message))}>Unsync</Item>}
      </>}
      <C.Generic.Menu.Divider />
      <Item className="bn-menu-item" icon={<Link2 size={16} />} onClick={() => copyText(`${pageUrl(ctx.page.id)}/b/${block.id}`)}>Copy link to block <span className="bn-hint">{isMac ? '⌘⌃L' : 'Ctrl+Alt+L'}</span></Item>
      {editor.isEditable && <Item className="bn-menu-item" icon={<Copy size={16} />} onClick={() => duplicateBlock(editor, block)}>Duplicate <span className="bn-hint">{mod}D</span></Item>}
      {editor.isEditable && (
        <Item className="bn-menu-item" icon={<CornerUpRight size={16} />} onClick={() => ctx.moveBlock(block, document.querySelector(`[data-id="${block.id}"]`) as HTMLElement)}>Move to <span className="bn-hint">{mod}{shift}P</span></Item>
      )}
      {editor.isEditable && <RemoveBlockItem><span className="bn-delete"><Trash2 size={16} /> Delete <span className="bn-hint">Del</span></span></RemoveBlockItem>}
      {ctx.onComment && hasText && (
        <>
          <C.Generic.Menu.Divider />
          <Item className="bn-menu-item" icon={<MessageSquare size={16} />} onClick={() => commentOnBlock(editor, block, ctx)}>Comment <span className="bn-hint">{mod}{shift}M</span></Item>
        </>
      )}
    </DragHandleMenu>
  )
}

function CommentButton() {
  const C = useComponentsContext()!
  const editor = useBlockNoteEditor() as unknown as Editor
  const ctx = useContext(EditorCtx)
  if (!ctx?.onComment || !selectedText(editor)) return null
  return (
    <C.FormattingToolbar.Button mainTooltip="Comment" secondaryTooltip={`${mod}${shift}M`}
      onClick={() => {
        const quote = editor.getSelectedText().slice(0, 300)
        const block = editor.getTextCursorPosition().block
        const id = crypto.randomUUID()
        editor.addStyles({ comment: id } as never)
        ctx.onComment!(block.id, quote, id)
      }}><span className="bn-with-icon"><MessageSquare size={20} /> Comment</span></C.FormattingToolbar.Button>
  )
}

const TYPE_NAMES: Record<string, string> = { Paragraph: 'Text', 'Bullet List': 'Bulleted list', 'Numbered List': 'Numbered list', 'Check List': 'To-do list', 'Toggle List': 'Toggle list', 'Code Block': 'Code' }
/** Text styles and comments only apply when the selection covers blocks with text (not a whole database or image). */
const selectedText = (editor: Editor) => (editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]).some(b => Array.isArray(b.content))

function ClearFormatButton() {
  const C = useComponentsContext()!
  const editor = useBlockNoteEditor() as unknown as Editor
  if (!editor.isEditable || !selectedText(editor)) return null
  return <C.FormattingToolbar.Button mainTooltip="Clear format" label="Clear format" icon={<RemoveFormatting size={20} />}
    onClick={() => editor.removeStyles({ bold: true, italic: true, underline: true, strike: true, code: true, textColor: 'default', backgroundColor: 'default' } as never)} />
}

/** The selection menu, laid out like Notion's: block type, two rows of styles, then Comment, with lines between. */
function Toolbar() {
  const editor = useBlockNoteEditor() as unknown as Editor
  const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
  // A selected database (or other block without text or a file) gets no menu, as in Notion.
  if (!selectedText(editor) && !blocks.some(b => ['image', 'file', 'video', 'audio'].includes(b.type))) return null
  return (
    <FormattingToolbar>
      <BlockTypeSelect key="type" items={blockTypeSelectItems(dictionary as never).filter(i => !['Heading 4', 'Heading 5', 'Heading 6'].includes(i.name)).map(i => ({ ...i, name: TYPE_NAMES[i.name] ?? i.name }))} />
      <FileCaptionButton key="caption" />
      <FileReplaceButton key="replace" />
      <div key="sep1" className="tb-sep" />
      <ColorStyleButton key="color" />
      <BasicTextStyleButton key="bold" basicTextStyle="bold" />
      <BasicTextStyleButton key="italic" basicTextStyle="italic" />
      <BasicTextStyleButton key="underline" basicTextStyle="underline" />
      <ClearFormatButton key="clear" />
      <CreateLinkButton key="link" />
      <BasicTextStyleButton key="strike" basicTextStyle="strike" />
      <BasicTextStyleButton key="code" basicTextStyle="code" />
      <div key="sep2" className="tb-sep" />
      <CommentButton key="comment" />
    </FormattingToolbar>
  )
}

/* Notion's text and background colours for blocks and highlights. */
const lightTheme = {
  fontFamily: 'inherit', borderRadius: 6,
  colors: {
    editor: { text: 'rgb(44, 44, 43)', background: 'transparent' }, menu: { text: 'rgb(44, 44, 43)', background: '#ffffff' },
    tooltip: { text: 'rgb(240, 239, 237)', background: 'rgb(44, 44, 43)' }, hovered: { text: 'rgb(44, 44, 43)', background: 'rgba(33, 27, 23, 0.051)' },
    selected: { text: '#ffffff', background: 'rgb(35, 131, 226)' }, disabled: { text: 'rgba(55, 53, 47, 0.35)', background: 'transparent' },
    shadow: 'rgba(15, 15, 15, 0.1)', border: 'rgba(28, 19, 1, 0.11)', sideMenu: 'rgba(55, 53, 47, 0.35)',
    highlights: {
      // Measured on Notion's light colour menu (2026): text colours match dark; backgrounds are pale.
      gray: { text: 'rgb(125, 122, 117)', background: 'rgb(240, 239, 237)' }, brown: { text: 'rgb(159, 118, 90)', background: 'rgb(245, 237, 233)' }, orange: { text: 'rgb(210, 123, 45)', background: 'rgb(251, 235, 222)' },
      yellow: { text: 'rgb(203, 148, 52)', background: 'rgb(249, 243, 220)' }, green: { text: 'rgb(80, 148, 110)', background: 'rgb(232, 241, 236)' }, blue: { text: 'rgb(56, 125, 201)', background: 'rgb(229, 242, 252)' },
      purple: { text: 'rgb(154, 107, 180)', background: 'rgb(243, 235, 249)' }, pink: { text: 'rgb(193, 76, 138)', background: 'rgb(250, 233, 241)' }, red: { text: 'rgb(207, 81, 72)', background: 'rgb(252, 233, 231)' },
    },
  },
}
const darkTheme = {
  fontFamily: 'inherit', borderRadius: 6,
  colors: {
    editor: { text: 'rgb(240, 239, 237)', background: 'transparent' }, menu: { text: 'rgb(240, 239, 237)', background: '#252525' },
    tooltip: { text: 'rgb(240, 239, 237)', background: 'rgb(44, 44, 43)' }, hovered: { text: 'rgb(240, 239, 237)', background: 'rgba(255, 255, 255, 0.055)' },
    selected: { text: '#ffffff', background: 'rgb(35, 131, 226)' }, disabled: { text: 'rgba(255, 255, 255, 0.28)', background: 'transparent' },
    shadow: 'rgba(0, 0, 0, 0.4)', border: 'rgba(255, 255, 235, 0.1)', sideMenu: 'rgba(255, 255, 255, 0.28)',
    highlights: {
      // Measured on Notion's dark colour menu (2026).
      gray: { text: 'rgb(125, 122, 117)', background: 'rgb(56, 56, 54)' }, brown: { text: 'rgb(159, 118, 90)', background: 'rgb(69, 54, 45)' }, orange: { text: 'rgb(210, 123, 45)', background: 'rgb(83, 54, 31)' },
      yellow: { text: 'rgb(203, 148, 52)', background: 'rgb(80, 68, 37)' }, green: { text: 'rgb(80, 148, 110)', background: 'rgb(38, 61, 48)' }, blue: { text: 'rgb(56, 125, 201)', background: 'rgb(35, 56, 80)' },
      purple: { text: 'rgb(154, 107, 180)', background: 'rgb(60, 45, 71)' }, pink: { text: 'rgb(193, 76, 138)', background: 'rgb(78, 43, 60)' }, red: { text: 'rgb(207, 81, 72)', background: 'rgb(80, 44, 41)' },
    },
  },
}
const viewIcon: Record<ViewType, React.JSX.Element> = { table: <Table size={18} />, board: <Kanban size={18} />, gallery: <LayoutGrid size={18} />, list: <ListIcon size={18} />, calendar: <Calendar size={18} />, timeline: <GanttChart size={18} />, form: <ClipboardPen size={18} />, chart: <BarChart3 size={18} />, feed: <Newspaper size={18} />, dashboard: <LayoutDashboard size={18} /> }

const COLLAB_COLORS = ['#e03e3e', '#d9730d', '#cb912f', '#448361', '#337ea9', '#9065b0', '#c14c8a', '#a27763']
const colorFor = (s: string) => COLLAB_COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLLAB_COLORS.length]

/** One shared Yjs document per open page, synced through the server. */
/** Code blocks in Mermaid draw their diagram underneath, as Notion's preview does. Mermaid loads only when a page has one,
 *  and runs in its strict mode (no HTML or links from the diagram text). The diagrams live in a layer over the editor,
 *  outside ProseMirror's DOM (which would drop foreign nodes), with room kept for them under each code block. */
function useMermaid(el: HTMLDivElement | null, dark: boolean) {
  useEffect(() => {
    if (!el) return
    let mermaid: typeof import('mermaid').default | undefined
    let n = 0, timer = 0, live = true
    const layer = Object.assign(document.createElement('div'), { className: 'mermaid-layer' })
    const room = document.createElement('style')
    layer.appendChild(room)
    el.appendChild(layer)
    const boxes = new Map<string, HTMLDivElement>()
    const contentOf = (id: string) => el.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(id)}"] > .bn-block > .bn-block-content`)
    const place = () => {
      const base = el.getBoundingClientRect()
      for (const [id, box] of boxes) {
        const r = contentOf(id)?.getBoundingClientRect()
        if (!r) continue
        Object.assign(box.style, { top: `${r.bottom - base.top + 4}px`, left: `${r.left - base.left}px`, width: `${r.width}px` })
      }
    }
    const render = async () => {
      const blocks = [...el.querySelectorAll<HTMLElement>('[data-content-type="codeBlock"][data-language="mermaid"]')]
      const ids = new Set<string>()
      if (blocks.length && !mermaid) { mermaid = (await import('mermaid')).default; mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' }) }
      for (const b of blocks) {
        const id = b.closest<HTMLElement>('.bn-block-outer[data-id]')?.dataset.id
        if (!id || !mermaid) continue
        ids.add(id)
        let box = boxes.get(id)
        if (!box) { box = Object.assign(document.createElement('div'), { className: 'mermaid-preview' }); layer.appendChild(box); boxes.set(id, box) }
        const code = b.querySelector('code')?.textContent ?? ''
        if (box.dataset.code === code) continue
        box.dataset.code = code
        try { const { svg } = await mermaid.render(`mermaid-${Date.now()}-${n++}`, code); if (live) box.innerHTML = svg }
        catch (e) { if (live) box.textContent = 'Diagram error: ' + String((e as Error).message ?? e).split('\n')[0] }
      }
      for (const [id, box] of boxes) if (!ids.has(id)) { box.remove(); boxes.delete(id) }
      room.textContent = [...boxes].map(([id, box]) => `.bn-block-outer[data-id="${CSS.escape(id)}"] > .bn-block > .bn-block-content { margin-bottom: ${box.offsetHeight + 12}px }`).join('\n')
      requestAnimationFrame(place)
    }
    const later = () => { clearTimeout(timer); timer = window.setTimeout(() => { render().catch(() => {}) }, 300) }
    // Our own layer changes don't count; edits in the editor (and its size) do.
    const mo = new MutationObserver(list => { if (list.some(m => !layer.contains(m.target))) later() })
    mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-language'] })
    const ro = new ResizeObserver(() => requestAnimationFrame(place))
    ro.observe(el)
    later()
    return () => { live = false; mo.disconnect(); ro.disconnect(); clearTimeout(timer); layer.remove() }
  }, [el, dark])
}

function useCollab(pageId: string, enabled: boolean, onReset?: () => void) {
  const session = useMemo(() => {
    if (!enabled) return null
    const doc = new Y.Doc()
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`
    const provider = new WebsocketProvider(url, pageId, doc, { connect: true })
    const state = { seed: false, synced: false }
    // Message 100: the server asks this editor to fill an empty shared doc from the saved page.
    ;(provider as unknown as { messageHandlers: unknown[] }).messageHandlers[100] = () => { state.seed = true }
    return { doc, provider, state }
  }, [pageId, enabled])
  useEffect(() => {
    if (!session) return
    const onClose = (e: CloseEvent | null) => { if (e?.code === 4000) onReset?.() }
    session.provider.on('connection-close', onClose)
    // Who else has this page open (the editor shares each person's name and colour): the page header shows them.
    const aw = session.provider.awareness
    const presence = () => {
      const people = new Map<string, { name: string; color: string }>()
      aw.getStates().forEach((st, id) => { const u = (st as { user?: { name: string; color: string } }).user; if (id !== aw.clientID && u?.name) people.set(u.name, u) })
      dispatchEvent(new CustomEvent('bloki:presence', { detail: { page: pageId, people: [...people.values()] } }))
    }
    aw.on('change', presence)
    return () => {
      aw.off('change', presence)
      // Say goodbye before the socket closes, so others drop this person at once.
      removeAwarenessStates(aw, [aw.clientID], 'leave')
      dispatchEvent(new CustomEvent('bloki:presence', { detail: { page: pageId, people: [] } }))
      session.provider.off('connection-close', onClose); session.provider.destroy(); session.doc.destroy()
    }
  }, [session, onReset, pageId])
  return session
}

export function PageEditor({ page, dark, editable, onComment, comments = [], openComments, collab = false, onReset, minimalComments = false }: {
  page: Page; dark: boolean; editable: boolean
  onComment?: (blockId: string, quote: string, id: string) => void
  comments?: Comment[]; openComments?: () => void
  collab?: boolean; onReset?: () => void
  /** Notion's "Inline comments: Minimal": no highlight, just an icon at the block's right edge (highlight on hover). */
  minimalComments?: boolean
}) {
  const store = useStore()
  const storeRef = useRef(store)
  storeRef.current = store
  setMentionDateFormat(store.me?.prefs?.dateFormat)
  const timer = useRef<number | undefined>(undefined)
  // A state ref, so the hook runs once the editor's wrapper exists (the editor may first render nothing).
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null)
  useMermaid(wrap, dark)
  const [moving, setMoving] = useState<{ block: AnyBlock; anchor: HTMLElement; mode?: 'move' | 'pagein' } | null>(null)
  const live = useCollab(page.id, collab, onReset)
  const [synced, setSynced] = useState(!live)

  const opts = {
    schema, dictionary, extensions: [syntaxHighlighter], dropCursor: { ...multiColumnDropCursor }, uploadFile: api.upload,
    // "Copy and sync" puts a token on the clipboard; pasting it drops in a live copy of that synced block.
    pasteHandler: ({ event, editor: ed, defaultPasteHandler }: { event: ClipboardEvent; editor: Editor; defaultPasteHandler: () => boolean | undefined }) => {
      const m = /^bloki-synced:([0-9a-f-]{36})$/.exec(event.clipboardData?.getData('text/plain').trim() ?? '')
      if (!m) return defaultPasteHandler()
      ed.insertBlocks([{ type: 'synced', props: { syncId: m[1] } }] as never, ed.getTextCursorPosition().block, 'after')
      return true
    },
  }
  const editor = useCreateBlockNote((live
    ? withCollaboration({
        ...opts,
        collaboration: {
          fragment: live.doc.getXmlFragment('document-store'), provider: live.provider,
          user: { name: store.me?.user.name ?? 'Guest', color: colorFor(store.me?.user.id ?? 'guest') }, showCursorLabels: 'activity',
        },
      } as never)
    : { ...opts, initialContent: page.content?.length ? page.content : undefined }) as never, [page.id, live]) as unknown as Editor

  // Once synced, fill an empty shared doc from the saved page (only the editor the server picked does this).
  useEffect(() => {
    if (!live) return
    const onSync = (isSynced: boolean) => {
      if (!isSynced) return
      setSynced(true)
      if (live.state.seed && !live.doc.getXmlFragment('document-store').length && page.content?.length) {
        live.state.seed = false
        editor.replaceBlocks(editor.document, page.content as never)
      }
    }
    if (live.provider.synced) onSync(true)
    live.provider.on('sync', onSync)
    return () => live.provider.off('sync', onSync)
  }, [live, editor, page.content])

  // Flush the pending save when leaving the page.
  const flush = useRef<() => void>(() => {})
  useEffect(() => () => flush.current(), [page.id])

  // Undo/redo from the page menu, and jumping to a linked block.
  useEffect(() => {
    if (!editable) return
    const undo = () => editor.undo()
    const redo = () => editor.redo()
    addEventListener('bloki:undo', undo)
    addEventListener('bloki:redo', redo)
    return () => { removeEventListener('bloki:undo', undo); removeEventListener('bloki:redo', redo) }
  }, [editor, editable])
  useEffect(() => {
    const blockId = location.hash.split('/b/')[1]
    if (!blockId) return
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-id="${CSS.escape(blockId)}"]`)
      el?.scrollIntoView({ block: 'center' })
      el?.classList.add('flash')
    }, 300)
    return () => clearTimeout(t)
  }, [page.id])

  const onChange = (_: unknown, ctx?: { getChanges: () => { source: { type: string } }[] }) => {
    if (!editable) return
    // In a live session, the person who made a change saves the page; others don't echo it.
    if (live && ctx && ctx.getChanges().every(c => c.source.type === 'yjs-remote')) return
    clearTimeout(timer.current)
    const save = () => {
      clearTimeout(timer.current); flush.current = () => {}
      api.update(page.id, { content: editor.document as unknown[], ...(live ? { fromCollab: true } : {}) } as Partial<Page>).catch(e => storeRef.current.setError(e.message))
    }
    flush.current = save
    timer.current = window.setTimeout(save, live ? 800 : 400)
  }

  const slashItems = useCallback((e: Editor): DefaultReactSuggestionItem[] => {
    const s = storeRef.current
    const insertDb = async (view: ViewType, inline: boolean) => {
      const db = await newDatabase(s, page.id, '', 'private', view)
      if (inline) insertOrUpdateBlockForSlashMenu(e, { type: 'database', props: { dbId: db.id } } as never)
      else { insertOrUpdateBlockForSlashMenu(e, { type: 'page', props: { pageId: db.id } } as never); s.go(db.id) }
    }
    const insert = (block: object) => () => { insertOrUpdateBlockForSlashMenu(e, block as never) }
    const custom: DefaultReactSuggestionItem[] = [
      { title: 'Page', subtext: 'Embed a sub-page inside this page.', group: 'Basic blocks', aliases: ['subpage', 'new page'], icon: <FileText size={18} />,
        onItemClick: async () => { const child = await s.create({ parent_id: page.id }, false); insertOrUpdateBlockForSlashMenu(e, { type: 'page', props: { pageId: child.id } } as never); s.go(child.id) } },
      { title: 'Link to page', subtext: 'Link to an existing page.', group: 'Basic blocks', aliases: ['link', 'page link'], icon: <Link2 size={18} />,
        onItemClick: () => { e.insertInlineContent(['[['] as never) } },
      { title: 'Callout', subtext: 'Make writing stand out.', group: 'Basic blocks', aliases: ['note', 'tip', 'info'], icon: <StickyNote size={18} />, onItemClick: insert({ type: 'callout' }) },
      { title: 'Bookmark', subtext: 'Save a link as a visual bookmark.', group: 'Media', aliases: ['link', 'url'], icon: <Bookmark size={18} />, onItemClick: insert({ type: 'embed', props: { mode: 'bookmark' } }) },
      { title: 'Embed', subtext: 'For YouTube, Vimeo, Figma, Loom, Spotify, Maps and more.', group: 'Media', aliases: ['iframe', 'youtube'], icon: <Globe size={18} />, onItemClick: insert({ type: 'embed', props: { mode: 'embed' } }) },
      ...(['table', 'board', 'gallery', 'list', 'calendar', 'timeline', 'form', 'chart'] as ViewType[]).map(v => ({
        title: `${v[0].toUpperCase() + v.slice(1)} view`, subtext: `Add a database in ${v} view.`, group: 'Database', aliases: ['database', 'db', v === 'board' ? 'kanban' : v], icon: viewIcon[v],
        onItemClick: () => { insertDb(v, true) },
      })),
      { title: 'Database - Full page', subtext: 'Add a database as a sub-page.', group: 'Database', aliases: ['database', 'db', 'full page'], icon: <Table size={18} />, onItemClick: () => { insertDb('table', false) } },
      { title: 'Table of contents', subtext: 'Show an outline of your page.', group: 'Advanced blocks', aliases: ['toc', 'outline'], icon: <ListTree size={18} />, onItemClick: insert({ type: 'toc' }) },
      { title: 'Synced block', subtext: 'Sync content across pages.', group: 'Advanced blocks', aliases: ['sync', 'transclusion'], icon: <RefreshCw size={18} />,
        onItemClick: () => {
          // Remember the block now: the server round trip can outlast the cursor.
          const here = e.getTextCursorPosition().block as unknown as AnyBlock
          api.createSynced(page.id, []).then(b => {
            const blank = Array.isArray(here.content) && !plain(here.content).replace('/', '').trim()
            if (blank) e.updateBlock(here.id, { type: 'synced', props: { syncId: b.id }, content: undefined } as never)
            else e.insertBlocks([{ type: 'synced', props: { syncId: b.id } }] as never, here.id, 'after')
          }).catch(err => s.setError(err.message))
        } },
      { title: 'Heading 4', subtext: 'Smallest section heading.', group: 'Basic blocks', aliases: ['h4', '####'], icon: <Heading4 size={18} />, onItemClick: insert({ type: 'heading', props: { level: 4 } }) },
      { title: 'Toggle heading 4', subtext: 'Hide content inside a small heading.', group: 'Advanced blocks', aliases: ['h4', 'toggle'], icon: <ChevronRightSquare size={18} />, onItemClick: insert({ type: 'heading', props: { level: 4, isToggleable: true } }) },
      { title: 'Button', subtext: 'Run actions with a click.', group: 'Advanced blocks', aliases: ['button', 'action', 'automation'], icon: <MousePointerClick size={18} />, onItemClick: insert({ type: 'button' }) },
      { title: 'Block equation', subtext: 'Display a standalone math equation.', group: 'Advanced blocks', aliases: ['math', 'latex', 'tex', 'formula'], icon: <Sigma size={18} />, onItemClick: insert({ type: 'equation' }) },
      { title: 'Breadcrumb', subtext: 'Show where this page sits.', group: 'Advanced blocks', aliases: ['path', 'location'], icon: <Navigation size={18} />, onItemClick: insert({ type: 'breadcrumb' }) },
      ...getMultiColumnSlashMenuItems(e as never).map((i, n) => ({ ...i, group: 'Advanced blocks', icon: [<Columns2 size={18} />, <Columns3 size={18} />, <Columns4 size={18} />][n] ?? <Columns4 size={18} /> })),
      { title: 'Mention a person', subtext: 'Ping someone so they get a notification.', group: 'Inline', aliases: ['@', 'person', 'user'], icon: <AtSign size={18} />, onItemClick: () => e.insertInlineContent(['@'] as never) },
      { title: 'Mention a page', subtext: 'Link to a page inline.', group: 'Inline', aliases: ['@', 'page'], icon: <FileText size={18} />, onItemClick: () => e.insertInlineContent(['[['] as never) },
      { title: 'Inline equation', subtext: 'Insert mathematical symbols in text.', group: 'Inline', aliases: ['math', 'tex', 'latex', 'formula'], icon: <Sigma size={18} />,
        onItemClick: () => e.insertInlineContent([{ type: 'inlineEquation', props: { latex: '' } }, ' '] as never) },
      { title: 'Date or reminder', subtext: 'Insert a date mention.', group: 'Inline', aliases: ['date', 'today', 'reminder'], icon: <CalendarDays size={18} />,
        onItemClick: () => e.insertInlineContent([{ type: 'date', props: { date: new Date().toISOString().slice(0, 10) } }, ' '] as never) },
    ]
    const defaults = getDefaultReactSlashMenuItems(e as never).filter(i => !DROP.has(i.title))
      .map(i => (i.group === 'Others' ? { ...i, group: 'Inline', icon: i.icon ?? <Smile size={18} /> } : i))
    // Notion's group and item order.
    const rank = (i: DefaultReactSuggestionItem) => { const n = ORDER.indexOf(i.title); return n < 0 ? 999 : n }
    return [...defaults, ...custom]
      .sort((a, b) => GROUPS.indexOf(a.group ?? '') - GROUPS.indexOf(b.group ?? '') || rank(a) - rank(b))
      .map(i => ({ ...i, badge: HINTS[i.title] }))
  }, [page.id])

  const mentionItems = (q: string, pagesOnly = false): DefaultReactSuggestionItem[] => {
    const s = storeRef.current
    const ql = q.toLowerCase()
    const persons = pagesOnly ? [] : [...s.people.values()].filter(p => p.name.toLowerCase().includes(ql)).slice(0, 5)
      .map(p => ({ title: p.name, group: 'People', icon: <span className="avatar">{p.name[0]}</span>, onItemClick: () => editor.insertInlineContent([{ type: 'person', props: { userId: p.id } }, ' '] as never) }))
    const iso = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)
    const parsed = q && !Number.isNaN(Date.parse(q)) ? new Date(Date.parse(q)).toISOString().slice(0, 10) : null
    // Notion offers only Today until you type; then tomorrow/yesterday match too.
    const dates = pagesOnly ? [] : [...(parsed ? [parsed] : []), iso(0), ...(ql ? [iso(1), iso(-1)] : [])]
      .filter((d, i, a) => a.indexOf(d) === i && (parsed === d || !ql || formatMentionDate(d).toLowerCase().includes(ql)))
      .map(d => ({ title: formatMentionDate(d), group: 'Date', icon: <CalendarDays size={16} />, onItemClick: () => editor.insertInlineContent([{ type: 'date', props: { date: d } }, ' '] as never) }))
    const pages = s.pages.filter(p => !p.trashed && p.id !== page.id && label(p).toLowerCase().includes(ql)).slice(0, 8)
      .map(p => ({ title: `${iconText(p)} ${label(p)}`, subtext: ancestors(s.byId, p.parent_id).map(label).join(' / ') || undefined, group: 'Link to page', onItemClick: () => editor.insertInlineContent([{ type: 'mention', props: { pageId: p.id } }, ' '] as never) }))
    const create = can(page, 'edit') ? [{
      title: `New “${q || 'Untitled'}” sub-page`, group: 'New page', icon: <FileText size={16} />,
      onItemClick: async () => { const child = await s.create({ parent_id: page.id, title: q }, false); editor.insertInlineContent([{ type: 'mention', props: { pageId: child.id } }, ' '] as never) },
    }] : []
    return [...dates, ...persons, ...pages, ...create]
  }

  const openThreads = useMemo(() => comments.filter(c => !c.thread_id && !c.resolved && c.block_id).map(c => c.id), [comments])
  const moveBlock = useCallback((block: AnyBlock, anchor: HTMLElement, mode: 'move' | 'pagein' = 'move') => setMoving({ block, anchor, mode }), [])
  const ctx = useMemo<Ctx>(() => ({ page, onComment, moveBlock }), [page, onComment, moveBlock])

  return (
    <EditorCtx.Provider value={ctx}>
      {/* Highlight text with an open discussion; resolved ones fade back to plain text. Ids are server-checked UUIDs. */}
      <style>{openThreads.map(id => minimalComments
        ? `.comment-mark[data-thread="${id}"]{cursor:pointer}.comment-mark[data-thread="${id}"]:hover{background:var(--comment-bg)}.bn-block-content:has(.comment-mark[data-thread="${id}"]){position:relative}.bn-block-content:has(.comment-mark[data-thread="${id}"])::after{content:'';position:absolute;right:-30px;top:50%;width:18px;height:18px;margin-top:-9px;opacity:.55;cursor:pointer;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E") center/contain no-repeat}`
        : `.comment-mark[data-thread="${id}"]{background:var(--comment-bg);border-bottom:2px solid var(--comment-line);cursor:pointer}`).join('\n')}</style>
      <div className="editor-wrap" ref={setWrap} onClick={e => {
        const mark = (e.target as HTMLElement).closest('.comment-mark') as HTMLElement | null
        if (mark && openThreads.includes(mark.dataset.thread ?? '')) return openComments?.()
        // Minimal mode: the icon is the block's ::after past its right edge, so a click there lands on the block itself.
        const content = minimalComments ? (e.target as HTMLElement).closest('.bn-block-content') as HTMLElement | null : null
        if (content && e.clientX > content.getBoundingClientRect().right
          && [...content.querySelectorAll<HTMLElement>('.comment-mark')].some(m => openThreads.includes(m.dataset.thread ?? ''))) openComments?.()
      }} onKeyDown={e => {
        const m = e.metaKey || e.ctrlKey
        if (m && e.shiftKey && e.key.toLowerCase() === 'm' && onComment) {
          e.preventDefault(); e.stopPropagation()
          const block = editor.getTextCursorPosition().block as unknown as AnyBlock
          const quote = editor.getSelectedText()
          if (quote) { const id = crypto.randomUUID(); editor.addStyles({ comment: id } as never); onComment(block.id, quote.slice(0, 300), id) }
          else commentOnBlock(editor, block, ctx)
        }
        // ⌘⇧E: the selected text becomes an inline equation (or an empty one opens), as in Notion.
        if (m && e.shiftKey && e.key.toLowerCase() === 'e' && editable) {
          e.preventDefault(); e.stopPropagation()
          editor.insertInlineContent([{ type: 'inlineEquation', props: { latex: editor.getSelectedText() } }] as never)
        }
        if (m && !e.shiftKey && e.key.toLowerCase() === 'd' && editable) {
          e.preventDefault()
          duplicateBlock(editor, editor.getTextCursorPosition().block as unknown as AnyBlock)
        }
        // Notion's turn-into shortcuts: ⌘⌥0 text, 1–3 headings, 4 to-do, 5 bullets, 6 numbers, 7 toggle, 8 code, 9 page.
        const digit = /^Digit(\d)$/.exec(e.code)?.[1]
        if (m && e.altKey && !e.shiftKey && digit && editable) {
          const label = ['Text', 'Heading 1', 'Heading 2', 'Heading 3', 'To-do list', 'Bulleted list', 'Numbered list', 'Toggle list', 'Code', 'Page'][Number(digit)]
          const t = TURN_INTO.find(x => x.label === label)
          const block = editor.getTextCursorPosition().block as unknown as AnyBlock
          if (t && Array.isArray(block.content)) { e.preventDefault(); e.stopPropagation(); turnInto(editor, block, t, page.id, storeRef.current) }
        }
        // Notion's block-link shortcut: ⌘⌃L on a Mac (⌘⌥L belongs to the desktop app's "copy link with title").
        if (m && (isMac ? e.ctrlKey && e.metaKey : e.altKey) && e.code === 'KeyL') {
          e.preventDefault()
          copyText(`${pageUrl(page.id)}/b/${editor.getTextCursorPosition().block.id}`)
          storeRef.current.toast('Copied link to block')
        }
      }}>
        {live && !synced && <div className="sync-note muted small">Connecting…</div>}
        <BlockNoteView editor={editor as never} theme={dark ? darkTheme : lightTheme} editable={editable && (!live || synced)} onChange={onChange} slashMenu={false} sideMenu={false} formattingToolbar={false}>
          <SideMenuController sideMenu={props => <SideMenu {...props} dragHandleMenu={BlockMenu} />} />
          <FormattingToolbarController formattingToolbar={Toolbar} floatingUIOptions={{ useFloatingOptions: { placement: 'bottom-start' } }} />
          {/* data-suggest lets CSS give the @ / [[ menu Notion's denser mention layout. */}
          <SuggestionMenuController triggerCharacter="/" getItems={async q => { document.documentElement.dataset.suggest = 'slash'; return filterSuggestionItems(slashItems(editor), q) }} />
          <SuggestionMenuController triggerCharacter="@" getItems={async q => { document.documentElement.dataset.suggest = 'mention'; return mentionItems(q) }} />
          <SuggestionMenuController triggerCharacter="[[" getItems={async q => { document.documentElement.dataset.suggest = 'mention'; return mentionItems(q, true) }} />
        </BlockNoteView>
      </div>
      {moving && (
        <Popover anchor={moving.anchor} onClose={() => setMoving(null)} className="menu-pop" width={320}>
          <BlockMoveTo page={page} placeholder={moving.mode === 'pagein' ? 'Turn into page in…' : 'Move block to…'} close={() => setMoving(null)} onPick={async target => {
            if (moving.mode === 'pagein') {
              // "Page in…": the block's text becomes a new page under the chosen one, and leaves this page.
              const child = await storeRef.current.create({ parent_id: target, title: plain(moving.block.content) }, false)
              editor.removeBlocks([moving.block.id])
              storeRef.current.toast(`Moved to ${label(storeRef.current.byId.get(target))}`)
              setMoving(null)
              return void child
            }
            // Append the block to the other page, then remove it here.
            const dest = await api.get(target)
            await api.update(target, { content: [...(dest.content ?? []), stripIds(moving.block)] })
            editor.removeBlocks([moving.block.id])
            storeRef.current.toast(`Moved to ${label(dest)}`)
            setMoving(null)
          }} />
        </Popover>
      )}
    </EditorCtx.Provider>
  )
}

function BlockMoveTo({ page, onPick, close, placeholder }: { page: Page; onPick: (id: string) => void; close: () => void; placeholder: string }) {
  const store = useStore()
  const [q, setQ] = useState('')
  const targets = store.pages.filter(p => p.id !== page.id && p.kind === 'page' && !p.trashed && can(p, 'edit') && label(p).toLowerCase().includes(q.toLowerCase())).slice(0, 30)
  return (
    <div className="move-to">
      <input autoFocus className="menu-filter" placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && close()} />
      {targets.map(p => <button key={p.id} className="menu-item" onClick={() => onPick(p.id)}><span className="menu-icon">{iconText(p)}</span><span className="menu-label">{label(p)}</span></button>)}
      {!targets.length && <div className="menu-note">No results</div>}
    </div>
  )
}

/* ---------- Export / import ---------- */

type Lookup = (id: string) => string
/** Replace blocks and inline content that only make sense inside the app with plain equivalents. */
function exportable(blocks: AnyBlock[], title: Lookup): AnyBlock[] {
  const inline = (content: unknown) => Array.isArray(content) ? content.map((c: { type?: string; props?: Record<string, string>; text?: string; styles?: Record<string, unknown> }) =>
    c.type === 'mention' ? { type: 'text', text: title(c.props!.pageId), styles: {} }
      : c.type === 'person' ? { type: 'text', text: '@person', styles: {} }
      : c.type === 'date' ? { type: 'text', text: `@${formatMentionDate(c.props!.date)}`, styles: {} }
      : c.type === 'text' ? { ...c, styles: Object.fromEntries(Object.entries(c.styles ?? {}).filter(([k]) => k !== 'comment')) }
      : c) : content
  return blocks.flatMap((b): AnyBlock[] => {
    const kids = exportable(b.children ?? [], title)
    const p = (text: string): AnyBlock => ({ id: b.id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: kids })
    switch (b.type) {
      case 'page': case 'database': return [p(`📄 ${title(String(b.props.pageId ?? b.props.dbId))}`)]
      case 'toc': case 'breadcrumb': return []
      case 'synced': return [p('⟳ Synced block')]
      case 'embed': return b.props.url ? [p(String(b.props.url))] : []
      case 'equation': return [{ id: b.id, type: 'codeBlock', props: { language: 'latex' }, content: [{ type: 'text', text: String(b.props.latex), styles: {} }], children: [] }]
      case 'callout': return [{ ...b, type: 'quote', props: {}, content: [{ type: 'text', text: `${b.props.icon} `, styles: {} }, ...(inline(b.content) as unknown[])], children: kids }]
      case 'columnList': return (b.children ?? []).flatMap(col => exportable(col.children ?? [], title))
      default: return [{ ...b, content: inline(b.content), children: kids }]
    }
  })
}

let detached: BlockNoteEditor | undefined
const converter = () => (detached ??= BlockNoteEditor.create())
const noTitles: Lookup = () => 'Page'

/** HTML (e.g. edited in the desktop app's offline reader) back into blocks. */
export async function htmlToBlocks(html: string) {
  const ed = BlockNoteEditor.create({ schema } as never) as unknown as { tryParseHTMLToBlocks: (h: string) => unknown[] | Promise<unknown[]> }
  return ed.tryParseHTMLToBlocks(html)
}

export function toMarkdown(page: Page, title: Lookup = noTitles) {
  return `# ${label(page)}\n\n` + converter().blocksToMarkdownLossy(exportable((page.content ?? []) as AnyBlock[], title) as never)
}
export function toHTML(page: Page, title: Lookup = noTitles) {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<h1>${esc(label(page))}</h1>` + converter().blocksToHTMLLossy(exportable((page.content ?? []) as AnyBlock[], title) as never)
}
export function fromMarkdown(md: string) {
  return converter().tryParseMarkdownToBlocks(md)
}
