/**
 * A small interpreter for Notion-style formulas (2.0 syntax): prop("Name"), operators,
 * if/ifs, text/number/date/list functions, and method calls such as prop("Tags").length().
 * It never evaluates JavaScript; unknown names are errors.
 */
export type Value = number | string | boolean | Date | null | Value[]

export class FormulaError extends Error {}

type Node =
  | { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'bool'; v: boolean } | { k: 'list'; items: Node[] }
  | { k: 'call'; name: string; args: Node[] } | { k: 'un'; op: string; a: Node } | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'tern'; c: Node; a: Node; b: Node } | { k: 'id'; name: string }

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'eof'; v: string }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i))!
      out.push({ t: 'num', v: m[0] }); i += m[0].length; continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = ''
      while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) { j++; s += { n: '\n', t: '\t' }[src[j]] ?? src[j] } else s += src[j]; j++ }
      if (j >= src.length) throw new FormulaError('Unterminated string')
      out.push({ t: 'str', v: s }); i = j + 1; continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
      out.push({ t: 'id', v: m[0] }); i += m[0].length; continue
    }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*/%^()<>,?:![].'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue }
    throw new FormulaError(`Unexpected character “${c}”`)
  }
  out.push({ t: 'eof', v: '' })
  return out
}

const BIN: Record<string, number> = { '?': 1, or: 2, '||': 2, and: 3, '&&': 3, '==': 4, '!=': 4, '>': 5, '>=': 5, '<': 5, '<=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 8 }

export function parse(src: string): Node {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const expect = (v: string) => { const t = next(); if (t.v !== v) throw new FormulaError(`Expected “${v}”`); return t }
  const opOf = (t: Tok) => (t.t === 'op' || (t.t === 'id' && (t.v === 'and' || t.v === 'or')) ? t.v : null)

  function args(): Node[] {
    const out: Node[] = []
    if (peek().v === ')') { next(); return out }
    for (;;) { out.push(expr(0)); if (peek().v === ',') { next(); continue } expect(')'); return out }
  }
  function primary(): Node {
    const t = next()
    let node: Node
    if (t.t === 'num') node = { k: 'num', v: Number(t.v) }
    else if (t.t === 'str') node = { k: 'str', v: t.v }
    else if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') node = { k: 'bool', v: t.v === 'true' }
      else if (t.v === 'not') node = { k: 'un', op: '!', a: expr(9) }
      else if (peek().v === '(') { next(); node = { k: 'call', name: t.v, args: args() } }
      else node = { k: 'id', name: t.v }
    } else if (t.v === '(') { node = expr(0); expect(')') }
    else if (t.v === '[') {
      const items: Node[] = []
      if (peek().v !== ']') for (;;) { items.push(expr(0)); if (peek().v === ',') { next(); continue } break }
      expect(']')
      node = { k: 'list', items }
    } else if (t.v === '-' || t.v === '!') node = { k: 'un', op: t.v, a: expr(9) }
    else throw new FormulaError(t.t === 'eof' ? 'Unexpected end of formula' : `Unexpected “${t.v}”`)
    // Method calls: x.fn(args) is fn(x, args).
    while (peek().v === '.') {
      next()
      const name = next()
      if (name.t !== 'id') throw new FormulaError('Expected a function name after “.”')
      expect('(')
      node = { k: 'call', name: name.v, args: [node, ...args()] }
    }
    return node
  }
  function expr(min: number): Node {
    let left = primary()
    for (;;) {
      const op = opOf(peek())
      const prec = op ? BIN[op] : undefined
      if (prec === undefined || prec < min) return left
      next()
      if (op === '?') {
        const a = expr(0); expect(':'); const b = expr(1)
        left = { k: 'tern', c: left, a, b }
        continue
      }
      // ^ is right-associative.
      const right = expr(op === '^' ? prec : prec + 1)
      left = { k: 'bin', op: op!, a: left, b: right }
    }
  }
  const tree = expr(0)
  if (peek().t !== 'eof') throw new FormulaError(`Unexpected “${peek().v}”`)
  return tree
}

/* ---------- values ---------- */

const isDate = (v: Value): v is Date => v instanceof Date
const num = (v: Value): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (isDate(v)) return v.getTime()
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  if (v === null || v === '') return 0
  throw new FormulaError(`Expected a number, got “${toText(v)}”`)
}
const bool = (v: Value): boolean => (Array.isArray(v) ? v.length > 0 : isDate(v) ? true : !!v)
export function toText(v: Value): string {
  if (v === null) return ''
  if (isDate(v)) return v.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  if (Array.isArray(v)) return v.map(toText).join(', ')
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10)
  return String(v)
}
const date = (v: Value): Date => {
  if (isDate(v)) return v
  if (typeof v === 'string' || typeof v === 'number') { const d = new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00' : v); if (!Number.isNaN(d.getTime())) return d }
  throw new FormulaError(`Expected a date, got “${toText(v)}”`)
}
const list = (v: Value): Value[] => (Array.isArray(v) ? v : v === null ? [] : [v])
const equal = (a: Value, b: Value): boolean => {
  if (isDate(a) && isDate(b)) return a.getTime() === b.getTime()
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]))
  return a === b
}
const empty = (v: Value) => v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'number' && Number.isNaN(v))

const UNITS: Record<string, number> = { years: 0, quarters: 0, months: 0, weeks: 7 * 864e5, days: 864e5, hours: 36e5, minutes: 6e4, seconds: 1e3, milliseconds: 1 }
function addTo(d: Date, n: number, unit: string): Date {
  const u = unit.endsWith('s') ? unit : unit + 's'
  if (!(u in UNITS)) throw new FormulaError(`Unknown unit “${unit}”`)
  const r = new Date(d)
  if (u === 'years') r.setFullYear(r.getFullYear() + n)
  else if (u === 'quarters') r.setMonth(r.getMonth() + 3 * n)
  else if (u === 'months') r.setMonth(r.getMonth() + n)
  else r.setTime(r.getTime() + n * UNITS[u])
  return r
}
function between(a: Date, b: Date, unit: string): number {
  const u = unit.endsWith('s') ? unit : unit + 's'
  if (u === 'years') return Math.trunc((a.getFullYear() - b.getFullYear()) + (a.getMonth() - b.getMonth()) / 12)
  if (u === 'quarters') return Math.trunc(((a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth()) / 3)
  if (u === 'months') return (a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth() - (a.getDate() < b.getDate() ? 1 : 0)
  if (!(u in UNITS)) throw new FormulaError(`Unknown unit “${unit}”`)
  return Math.trunc((a.getTime() - b.getTime()) / UNITS[u])
}
const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Moment-style tokens, as Notion's formatDate accepts. */
function formatDate(d: Date, fmt: string): string {
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g, t => ({
    YYYY: String(d.getFullYear()), YY: String(d.getFullYear()).slice(2), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1), M: String(d.getMonth() + 1), DD: pad(d.getDate()), D: String(d.getDate()), dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3),
    HH: pad(d.getHours()), H: String(d.getHours()), hh: pad(d.getHours() % 12 || 12), h: String(d.getHours() % 12 || 12), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
    A: d.getHours() < 12 ? 'AM' : 'PM', a: d.getHours() < 12 ? 'am' : 'pm',
  })[t]!)
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null }
const regex = (pattern: Value) => { try { return new RegExp(toText(pattern), 'g') } catch { throw new FormulaError('Invalid regular expression') } }
const nums = (args: Value[]) => args.flatMap(list).filter(v => !empty(v)).map(num)

type Fn = (args: Value[]) => Value
const FNS: Record<string, Fn> = {
  // Logic
  not: ([a]) => !bool(a), and: a => a.every(bool), or: a => a.some(bool), empty: ([a]) => empty(a),
  equal: ([a, b]) => equal(a, b), unequal: ([a, b]) => !equal(a, b),
  // Text
  concat: a => (a.some(Array.isArray) ? a.flatMap(list) : a.map(toText).join('')),
  join: ([l, sep = '']) => list(l).map(toText).join(toText(sep)), length: ([a]) => (Array.isArray(a) ? a.length : toText(a).length),
  contains: ([a, b]) => (Array.isArray(a) ? a.some(x => equal(x, b) || toText(x) === toText(b)) : toText(a).includes(toText(b))),
  test: ([a, p]) => regex(p).test(toText(a)), match: ([a, p]) => toText(a).match(regex(p)) ?? [],
  replace: ([a, p, r]) => toText(a).replace(new RegExp(regex(p).source), toText(r)), replaceAll: ([a, p, r]) => toText(a).replace(regex(p), toText(r)),
  lower: ([a]) => toText(a).toLowerCase(), upper: ([a]) => toText(a).toUpperCase(), trim: ([a]) => toText(a).trim(),
  repeat: ([a, n]) => toText(a).repeat(Math.max(0, Math.min(1000, num(n)))),
  substring: ([a, s, e]) => toText(a).substring(num(s), e === undefined ? undefined : num(e)),
  slice: ([a, s, e]) => (Array.isArray(a) ? a.slice(num(s), e === undefined ? undefined : num(e)) : toText(a).slice(num(s), e === undefined ? undefined : num(e))),
  split: ([a, sep = '']) => toText(a).split(toText(sep)), format: ([a]) => toText(a), startsWith: ([a, b]) => toText(a).startsWith(toText(b)),
  endsWith: ([a, b]) => toText(a).endsWith(toText(b)), padStart: ([a, n, c = ' ']) => toText(a).padStart(num(n), toText(c)),
  // Numbers
  add: ([a, b]) => num(a) + num(b), subtract: ([a, b]) => num(a) - num(b), multiply: ([a, b]) => num(a) * num(b),
  divide: ([a, b]) => num(a) / num(b), mod: ([a, b]) => num(a) % num(b), pow: ([a, b]) => num(a) ** num(b),
  abs: ([a]) => Math.abs(num(a)), ceil: ([a]) => Math.ceil(num(a)), floor: ([a]) => Math.floor(num(a)),
  round: ([a, places = 0]) => { const f = 10 ** num(places); return Math.round(num(a) * f) / f },
  sqrt: ([a]) => Math.sqrt(num(a)), cbrt: ([a]) => Math.cbrt(num(a)), exp: ([a]) => Math.exp(num(a)), ln: ([a]) => Math.log(num(a)),
  log10: ([a]) => Math.log10(num(a)), log2: ([a]) => Math.log2(num(a)), sign: ([a]) => Math.sign(num(a)), pi: () => Math.PI, e: () => Math.E,
  max: a => (nums(a).length ? Math.max(...nums(a)) : null), min: a => (nums(a).length ? Math.min(...nums(a)) : null),
  sum: a => nums(a).reduce((x, y) => x + y, 0), mean: a => (nums(a).length ? nums(a).reduce((x, y) => x + y, 0) / nums(a).length : null),
  average: a => FNS.mean(a), median: a => median(nums(a)), toNumber: ([a]) => (isDate(a) ? a.getTime() : empty(a) ? null : Number(toText(a)) || 0),
  // Dates
  now: () => new Date(), today: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d },
  dateAdd: ([d, n, u]) => addTo(date(d), num(n), toText(u)), dateSubtract: ([d, n, u]) => addTo(date(d), -num(n), toText(u)),
  dateBetween: ([a, b, u]) => between(date(a), date(b), toText(u)), formatDate: ([d, f = 'MMMM D, YYYY']) => formatDate(date(d), toText(f)),
  parseDate: ([s]) => date(toText(s)), year: ([d]) => date(d).getFullYear(), month: ([d]) => date(d).getMonth() + 1, date: ([d]) => date(d).getDate(),
  day: ([d]) => date(d).getDay() || 7, week: ([d]) => { const x = date(d); const j = new Date(x.getFullYear(), 0, 1); return Math.ceil(((x.getTime() - j.getTime()) / 864e5 + j.getDay() + 1) / 7) },
  hour: ([d]) => date(d).getHours(), minute: ([d]) => date(d).getMinutes(), timestamp: ([d]) => date(d).getTime(), fromTimestamp: ([n]) => new Date(num(n)),
  // Lists
  at: ([l, i]) => list(l).at(num(i)) ?? null, first: ([l]) => list(l)[0] ?? null, last: ([l]) => list(l).at(-1) ?? null,
  sort: ([l]) => [...list(l)].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : toText(a).localeCompare(toText(b)))),
  reverse: ([l]) => [...list(l)].reverse(), unique: ([l]) => list(l).filter((x, i, a) => a.findIndex(y => equal(x, y)) === i),
  includes: ([l, v]) => list(l).some(x => equal(x, v)), flat: ([l]) => list(l).flatMap(list), count: ([l]) => list(l).filter(v => !empty(v)).length,
  // Misc
  toText: ([a]) => toText(a), id: () => null,
}

export type Context = { prop: (name: string) => Value }

export function evaluate(node: Node, ctx: Context, depth = 0): Value {
  if (depth > 200) throw new FormulaError('Formula is nested too deeply')
  const ev = (n: Node) => evaluate(n, ctx, depth + 1)
  switch (node.k) {
    case 'num': return node.v
    case 'str': return node.v
    case 'bool': return node.v
    case 'list': return node.items.map(ev)
    case 'id': throw new FormulaError(`Unknown name “${node.name}”. Use prop("${node.name}") for properties.`)
    case 'tern': return bool(ev(node.c)) ? ev(node.a) : ev(node.b)
    case 'un': { const a = ev(node.a); return node.op === '-' ? -num(a) : !bool(a) }
    case 'call': {
      // Lazy forms first, so untaken branches don't run.
      if (node.name === 'prop') { if (node.args.length !== 1) throw new FormulaError('prop() takes one property name'); return ctx.prop(toText(ev(node.args[0]))) }
      if (node.name === 'if') { if (node.args.length !== 3) throw new FormulaError('if() takes a condition and two values'); return bool(ev(node.args[0])) ? ev(node.args[1]) : ev(node.args[2]) }
      if (node.name === 'ifs') {
        for (let i = 0; i + 1 < node.args.length; i += 2) if (bool(ev(node.args[i]))) return ev(node.args[i + 1])
        return node.args.length % 2 ? ev(node.args[node.args.length - 1]) : null
      }
      const fn = Object.prototype.hasOwnProperty.call(FNS, node.name) ? FNS[node.name] : undefined
      if (!fn) throw new FormulaError(`Unknown function “${node.name}”`)
      return fn(node.args.map(ev))
    }
    case 'bin': {
      if (node.op === 'and' || node.op === '&&') return bool(ev(node.a)) && bool(ev(node.b))
      if (node.op === 'or' || node.op === '||') return bool(ev(node.a)) || bool(ev(node.b))
      const a = ev(node.a), b = ev(node.b)
      switch (node.op) {
        case '+': return typeof a === 'string' || typeof b === 'string' ? toText(a) + toText(b) : num(a) + num(b)
        case '-': return num(a) - num(b)
        case '*': return num(a) * num(b)
        case '/': return num(a) / num(b)
        case '%': return num(a) % num(b)
        case '^': return num(a) ** num(b)
        case '==': return equal(a, b)
        case '!=': return !equal(a, b)
        case '>': return isDate(a) || isDate(b) ? date(a) > date(b) : typeof a === 'string' ? a > toText(b) : num(a) > num(b)
        case '>=': return isDate(a) || isDate(b) ? date(a) >= date(b) : typeof a === 'string' ? a >= toText(b) : num(a) >= num(b)
        case '<': return isDate(a) || isDate(b) ? date(a) < date(b) : typeof a === 'string' ? a < toText(b) : num(a) < num(b)
        case '<=': return isDate(a) || isDate(b) ? date(a) <= date(b) : typeof a === 'string' ? a <= toText(b) : num(a) <= num(b)
      }
      throw new FormulaError(`Unknown operator “${node.op}”`)
    }
  }
}

const cache = new Map<string, Node | FormulaError>()
/** Parse (cached) and run a formula; errors come back as a FormulaError value. */
export function run(src: string, ctx: Context): Value | FormulaError {
  if (!src.trim()) return null
  let tree = cache.get(src)
  if (!tree) {
    try { tree = parse(src) } catch (e) { tree = e instanceof FormulaError ? e : new FormulaError(String(e)) }
    if (cache.size > 500) cache.clear()
    cache.set(src, tree)
  }
  if (tree instanceof FormulaError) return tree
  try { return evaluate(tree, ctx) } catch (e) { return e instanceof FormulaError ? e : new FormulaError(String(e)) }
}

export const FUNCTION_NAMES = ['prop', 'if', 'ifs', ...Object.keys(FNS)].sort()
