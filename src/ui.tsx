import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Anchor = HTMLElement | { x: number; y: number }

/** Floating panel anchored to an element or a point; closes on outside click or Escape. */
export function Popover({ anchor, onClose, children, align = 'start', side = 'bottom', className = '', width }: {
  anchor: Anchor | null
  onClose: () => void
  children: ReactNode
  align?: 'start' | 'end'
  side?: 'bottom' | 'right'
  className?: string
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }
    const me = ref.current.getBoundingClientRect()
    let left = side === 'right' ? r.right + 4 : align === 'end' ? r.right - me.width : r.left
    let top = side === 'right' ? r.top : r.bottom + 4
    // Keep the panel on screen.
    left = Math.max(8, Math.min(left, innerWidth - me.width - 8))
    if (top + me.height > innerHeight - 8) top = Math.max(8, (side === 'right' ? r.bottom : r.top - 4) - me.height)
    setPos({ left, top })
  }, [anchor, align, side])

  useEffect(() => {
    if (!anchor) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      // Clicks inside a nested popover belong to it.
      if ((t as HTMLElement).closest?.('.popover')) return
      if (anchor instanceof HTMLElement && anchor.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    // Defer so the click that opened the popover doesn't close it. Capture phase, so blocks that keep
    // their clicks from the editor (an inline database) still close menus.
    const t = setTimeout(() => addEventListener('mousedown', down, true), 0)
    addEventListener('keydown', key, true)
    return () => { clearTimeout(t); removeEventListener('mousedown', down, true); removeEventListener('keydown', key, true) }
  }, [anchor, onClose])

  if (!anchor) return null
  return createPortal(
    <div ref={ref} className={'popover ' + className} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }} onClick={e => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  )
}

export type Item =
  | { divider: true }
  | { heading: string }
  | { note: ReactNode }
  | { icon?: ReactNode; label: ReactNode; hint?: string; danger?: boolean; checked?: boolean; disabled?: boolean; onClick?: () => void; submenu?: () => ReactNode }

/** Notion-style command menu: icon, label, right-aligned shortcut hint. */
export function Menu({ items, onClose, filter }: { items: Item[]; onClose: () => void; filter?: boolean }) {
  const [q, setQ] = useState('')
  const [sub, setSub] = useState<{ el: HTMLElement; render: () => ReactNode } | null>(null)
  const shown = items.filter(i => !q || ('label' in i && typeof i.label === 'string' && i.label.toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="menu-list">
      {filter && <input className="menu-filter" autoFocus placeholder="Search actions…" value={q} onChange={e => setQ(e.target.value)} />}
      {shown.map((i, n) => {
        if ('divider' in i) return q ? null : <div key={n} className="menu-divider" />
        if ('heading' in i) return q ? null : <div key={n} className="menu-heading">{i.heading}</div>
        if ('note' in i) return q ? null : <div key={n} className="menu-note">{i.note}</div>
        return (
          <button key={n} className={'menu-item' + (i.danger ? ' danger' : '')} disabled={i.disabled}
            onMouseEnter={e => setSub(i.submenu ? { el: e.currentTarget, render: i.submenu } : null)}
            onClick={e => {
              if (i.submenu) { setSub({ el: e.currentTarget, render: i.submenu }); return }
              i.onClick?.()
              onClose()
            }}>
            <span className="menu-icon">{i.icon}</span>
            <span className="menu-label">{i.label}</span>
            {i.hint && <span className="menu-hint">{i.hint}</span>}
            {i.checked && <span className="menu-check">✓</span>}
            {i.submenu && <span className="menu-hint">›</span>}
          </button>
        )
      })}
      {sub && <Popover anchor={sub.el} side="right" onClose={() => setSub(null)}>{sub.render()}</Popover>}
    </div>
  )
}

/** Small hook: `const [anchor, open, close] = usePopover()` */
export function usePopover<T extends Anchor = HTMLElement>() {
  const [anchor, setAnchor] = useState<T | null>(null)
  return [anchor, (a: T) => setAnchor(cur => (cur === a ? null : a)), () => setAnchor(null)] as const
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const mod = isMac ? '⌘' : 'Ctrl+'
export const shift = isMac ? '⇧' : 'Shift+'
export const alt = isMac ? '⌥' : 'Alt+'

export function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard blocked */ }
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t) }, [text, onDone])
  return createPortal(<div className="toast">{text}</div>, document.body)
}

/** CSS for a page cover: an uploaded or linked image (at a vertical offset), or a colour/gradient. */
export const coverStyle = (c: string, y = 50) => (!c ? {} : c.startsWith('/files/') || /^https?:\/\//.test(c)
  ? { backgroundImage: `url("${c.replace(/["\\]/g, '')}")`, backgroundPosition: `center ${y}%` }
  : { background: c })
