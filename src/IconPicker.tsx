import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, Airplay, AlarmClock, Album, Anchor, Aperture, Archive, Award, Baby, Backpack, BadgeCheck, Banknote, BarChart3, Bath, Battery, Bed, Beer, Bell, Bike,
  Bird, Bitcoin, Bolt, Bomb, Book, BookOpen, Bookmark, Bot, Box, Brain, Briefcase, Brush, Bug, Building2, Bus, Cake, Calculator, Calendar, Camera, Car, Cat, ChartPie,
  CheckCircle2, ChefHat, Cherry, Circle, Clapperboard, Clipboard, Clock, Cloud, Code2, Coffee, Coins, Compass, Cookie, Cpu, CreditCard, Crown, Database, Diamond, Dog,
  DollarSign, Dumbbell, Earth, Eye, Feather, FileText, Film, Fingerprint, Fish, Flag, Flame, FlaskConical, Flower2, Folder, Gamepad2, Gem, Gift, GitBranch, Globe,
  GraduationCap, Hammer, Hand, Headphones, Heart, Home, Hourglass, IceCream, Image, Inbox, Infinity as InfinityIcon, Key, Lamp, Laptop, Leaf, Lightbulb, Link, List, Lock,
  Mail, Map, MapPin, Medal, Megaphone, MessageCircle, Mic, Moon, Mountain, Music, Newspaper, Package, Paintbrush, Palette, Paperclip, PartyPopper, PawPrint, Pen,
  Pencil, Phone, PieChart, Pill, Pizza, Plane, Plug, Puzzle, Rocket, Ruler, Save, School, Scissors, Shield, ShoppingBag, ShoppingCart, Smile, Snowflake, Sparkles,
  Sprout, Star, Sun, Swords, Tag, Target, Tent, Terminal, ThumbsUp, Timer, Train, Trash2, TreePine, Trophy, Truck, Tv, Umbrella, User, Users, Utensils, Wallet,
  Wand2, Watch, Wifi, Wine, Wrench, Zap, type LucideIcon,
} from 'lucide-react'
import { api } from './api'

export const ICONS: Record<string, LucideIcon> = {
  Activity, Airplay, AlarmClock, Album, Anchor, Aperture, Archive, Award, Baby, Backpack, BadgeCheck, Banknote, BarChart3, Bath, Battery, Bed, Beer, Bell, Bike,
  Bird, Bitcoin, Bolt, Bomb, Book, BookOpen, Bookmark, Bot, Box, Brain, Briefcase, Brush, Bug, Building2, Bus, Cake, Calculator, Calendar, Camera, Car, Cat, ChartPie,
  CheckCircle2, ChefHat, Cherry, Circle, Clapperboard, Clipboard, Clock, Cloud, Code2, Coffee, Coins, Compass, Cookie, Cpu, CreditCard, Crown, Database, Diamond, Dog,
  DollarSign, Dumbbell, Earth, Eye, Feather, FileText, Film, Fingerprint, Fish, Flag, Flame, FlaskConical, Flower2, Folder, Gamepad2, Gem, Gift, GitBranch, Globe,
  GraduationCap, Hammer, Hand, Headphones, Heart, Home, Hourglass, IceCream, Image, Inbox, Infinity: InfinityIcon, Key, Lamp, Laptop, Leaf, Lightbulb, Link, List, Lock,
  Mail, Map, MapPin, Medal, Megaphone, MessageCircle, Mic, Moon, Mountain, Music, Newspaper, Package, Paintbrush, Palette, Paperclip, PartyPopper, PawPrint, Pen,
  Pencil, Phone, PieChart, Pill, Pizza, Plane, Plug, Puzzle, Rocket, Ruler, Save, School, Scissors, Shield, ShoppingBag, ShoppingCart, Smile, Snowflake, Sparkles,
  Sprout, Star, Sun, Swords, Tag, Target, Tent, Terminal, ThumbsUp, Timer, Train, Trash2, TreePine, Trophy, Truck, Tv, Umbrella, User, Users, Utensils, Wallet,
  Wand2, Watch, Wifi, Wine, Wrench, Zap,
}
export const ICON_COLORS: Record<string, string> = {
  gray: '#91918e', brown: '#a27763', orange: '#d9730d', yellow: '#cb912f', green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47',
}

/** A page icon is an emoji, an uploaded image URL, or "icon:<Name>:<color>". */
export function Icon({ value, size = 18 }: { value: string; size?: number }) {
  if (value.startsWith('icon:')) {
    const [, name, color] = value.split(':')
    const C = ICONS[name] ?? FileText
    return <C size={size} color={ICON_COLORS[color] ?? ICON_COLORS.gray} strokeWidth={2} className="page-icon-svg" />
  }
  if (value.startsWith('/files/') || /^https?:\/\//.test(value)) return <img src={value} alt="" className="page-icon-img" style={{ width: size, height: size }} />
  return <span className="page-icon-emoji" style={{ fontSize: size * 0.9 }}>{value}</span>
}

type EmojiData = { categories: { id: string; emojis: string[] }[]; emojis: Record<string, { id: string; name: string; keywords: string[]; skins: { native: string }[] }> }
let emojiData: Promise<EmojiData> | null = null
const loadEmoji = () => (emojiData ??= import('@emoji-mart/data/sets/15/native.json').then(m => m.default as unknown as EmojiData))
const CATEGORY_NAMES: Record<string, string> = { people: 'People', nature: 'Animals and nature', foods: 'Food and drink', activity: 'Activity', places: 'Travel and places', objects: 'Objects', symbols: 'Symbols', flags: 'Flags' }

function recent(): string[] {
  try { return JSON.parse(localStorage.getItem('recentIcons') || '[]') } catch { return [] }
}
function pushRecent(v: string) {
  try { localStorage.setItem('recentIcons', JSON.stringify([v, ...recent().filter(r => r !== v)].slice(0, 20))) } catch { /* private mode */ }
}

export function IconPicker({ onPick, onRemove }: { onPick: (v: string) => void; onRemove?: () => void }) {
  const [tab, setTab] = useState<'emoji' | 'icons' | 'upload'>('emoji')
  const [q, setQ] = useState('')
  const [data, setData] = useState<EmojiData | null>(null)
  const [color, setColor] = useState('gray')
  const [link, setLink] = useState('')
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { loadEmoji().then(setData) }, [])

  const pick = (v: string) => { pushRecent(v); onPick(v) }
  const emojis = useMemo(() => {
    if (!data) return []
    const ql = q.toLowerCase()
    return data.categories.map(c => ({
      id: c.id,
      list: c.emojis.map(id => data.emojis[id]).filter(e => e && (!ql || e.name.toLowerCase().includes(ql) || e.keywords.some(k => k.includes(ql)))),
    })).filter(c => c.list.length)
  }, [data, q])
  const icons = Object.keys(ICONS).filter(n => n.toLowerCase().includes(q.toLowerCase()))

  const random = () => {
    if (tab === 'icons') return pick(`icon:${icons[Math.floor(Math.random() * icons.length)]}:${color}`)
    const all = emojis.flatMap(c => c.list)
    if (all.length) pick(all[Math.floor(Math.random() * all.length)].skins[0].native)
  }

  return (
    <div className="icon-picker">
      <div className="picker-tabs">
        {(['emoji', 'icons', 'upload'] as const).map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{{ emoji: 'Emoji', icons: 'Icons', upload: 'Upload' }[t]}</button>)}
        {onRemove && <button className="picker-remove" onClick={onRemove}>Remove</button>}
      </div>
      {tab !== 'upload' && (
        <div className="picker-search">
          <input autoFocus placeholder="Filter…" value={q} onChange={e => setQ(e.target.value)} />
          <button title="Random" onClick={random}>🔀</button>
          {tab === 'icons' && (
            <span className="icon-colors">
              {Object.entries(ICON_COLORS).map(([c, hex]) => <button key={c} title={c} className={color === c ? 'on' : ''} style={{ background: hex }} onClick={() => setColor(c)} />)}
            </span>
          )}
        </div>
      )}
      <div className="picker-body">
        {tab === 'emoji' && <>
          {!q && recent().filter(r => !r.startsWith('icon:') && !r.startsWith('/')).length > 0 && <>
            <div className="menu-heading">Recent</div>
            <div className="emoji-grid">{recent().filter(r => !r.startsWith('icon:') && !r.startsWith('/')).map(r => <button key={r} onClick={() => pick(r)}>{r}</button>)}</div>
          </>}
          {!data && <div className="muted pad">Loading…</div>}
          {emojis.map(c => (
            <div key={c.id}>
              <div className="menu-heading">{CATEGORY_NAMES[c.id] ?? c.id}</div>
              <div className="emoji-grid">{c.list.map(e => <button key={e.id} title={e.name} onClick={() => pick(e.skins[0].native)}>{e.skins[0].native}</button>)}</div>
            </div>
          ))}
        </>}
        {tab === 'icons' && (
          <div className="emoji-grid icons">
            {icons.map(n => { const C = ICONS[n]; return <button key={n} title={n} onClick={() => pick(`icon:${n}:${color}`)}><C size={20} color={ICON_COLORS[color]} /></button> })}
          </div>
        )}
        {tab === 'upload' && (
          <div className="upload-tab">
            <button className="primary wide" onClick={() => file.current?.click()}>Upload file</button>
            <input ref={file} type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) pick(await api.upload(f)) }} />
            <div className="muted small">Recommended size is 280 × 280 pixels.</div>
            <div className="menu-heading">Or paste a link</div>
            <div className="row"><input placeholder="Paste an image link…" value={link} onChange={e => setLink(e.target.value)} />
              <button disabled={!/^https?:\/\//.test(link)} onClick={() => pick(link)}>Submit</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

export const GRADIENTS = [
  'linear-gradient(120deg,#f6d365,#fda085)', 'linear-gradient(120deg,#a1c4fd,#c2e9fb)', 'linear-gradient(120deg,#d4fc79,#96e6a1)', 'linear-gradient(120deg,#fbc2eb,#a6c1ee)',
  'linear-gradient(120deg,#e0c3fc,#8ec5fc)', 'linear-gradient(120deg,#ff9a9e,#fecfef)', 'linear-gradient(120deg,#89f7fe,#66a6ff)', 'linear-gradient(120deg,#434343,#000)',
  'linear-gradient(135deg,#667eea,#764ba2)', 'linear-gradient(135deg,#f093fb,#f5576c)', 'linear-gradient(135deg,#4facfe,#00f2fe)', 'linear-gradient(135deg,#43e97b,#38f9d7)',
]
export const COLORS_SOLID = ['#e03e3e', '#ffa344', '#ffdc49', '#4dab9a', '#529cca', '#9a6dd7', '#e255a1', '#b4876e', '#9b9a97', '#e9e5e3', '#f4dfd0', '#ddebf1']
const PATTERNS = [
  'repeating-linear-gradient(45deg,#f2e8dc 0 12px,#e8d9c7 12px 24px)',
  'radial-gradient(circle at 20% 30%,#ffd8a8 0,transparent 40%),radial-gradient(circle at 80% 70%,#a5d8ff 0,transparent 45%),#fff9db',
  'linear-gradient(0deg,#1c3d5a,#3e6b8a 50%,#f4a261)',
  'radial-gradient(circle at 50% 120%,#ffb703,#fb8500 30%,#023047 75%)',
]

export function CoverPicker({ onPick, onRemove }: { onPick: (v: string) => void; onRemove: () => void }) {
  const [tab, setTab] = useState<'gallery' | 'upload' | 'link'>('gallery')
  const [link, setLink] = useState('')
  const file = useRef<HTMLInputElement>(null)
  return (
    <div className="cover-picker">
      <div className="picker-tabs">
        {(['gallery', 'upload', 'link'] as const).map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{{ gallery: 'Gallery', upload: 'Upload', link: 'Link' }[t]}</button>)}
        <button className="picker-remove" onClick={onRemove}>Remove</button>
      </div>
      <div className="picker-body">
        {tab === 'gallery' && <>
          <div className="menu-heading">Color & Gradient</div>
          <div className="cover-grid">{[...COLORS_SOLID, ...GRADIENTS].map(c => <button key={c} style={{ background: c }} onClick={() => onPick(c)} />)}</div>
          <div className="menu-heading">Patterns</div>
          <div className="cover-grid">{PATTERNS.map(c => <button key={c} style={{ background: c }} onClick={() => onPick(c)} />)}</div>
        </>}
        {tab === 'upload' && (
          <div className="upload-tab">
            <button className="primary wide" onClick={() => file.current?.click()}>Upload file</button>
            <input ref={file} type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) onPick(await api.upload(f)) }} />
            <div className="muted small">Images wider than 1500 pixels work best. The maximum size per file is 50 MB.</div>
          </div>
        )}
        {tab === 'link' && (
          <div className="upload-tab">
            <input autoFocus placeholder="Paste an image link…" value={link} onChange={e => setLink(e.target.value)} />
            <button className="primary wide" disabled={!/^https?:\/\//.test(link)} onClick={() => onPick(link)}>Submit</button>
            <div className="muted small">Works with any image from the web.</div>
          </div>
        )}
      </div>
    </div>
  )
}
