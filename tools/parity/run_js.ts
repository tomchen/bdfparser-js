/**
 * Parity harness — TypeScript runner (mirror of run_py.py).
 *
 * Executes every case of a JSONL case file with the TypeScript bdfparser
 * (imported from ../../src, i.e. the current sources, not dist/) and writes
 * one JSONL result line per case, serialised with `canon()` exactly like the
 * Python runner.
 *
 * Usage (from the bdfparser-js repository root):
 *   bun tools/parity/run_js.ts CASES.jsonl OUT.jsonl [--full] [--only id1,id2]
 *   bun tools/parity/run_js.ts --tables TABLES_SPEC.json OUT.json
 * or under Node (bundled first, see README.md):
 *   bun build tools/parity/run_js.ts --target=node --outfile=/tmp/run_js.mjs && node /tmp/run_js.mjs ...
 */

import { createHash } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  openSync,
  writeSync,
  closeSync,
} from 'node:fs'
// exact multi-byte charset tables (SPEC-v3 §11.1): parity with Python's
// codecs is only expected with the sub-module loaded
import '../../src/cjk'
import {
  Bitmap,
  Font,
  Glyph,
  bitmapContours,
  canonicalCharset,
  charsetProps,
  getCodec,
  rasterize,
  readPcf,
  readTtf,
  sanitizeCharset,
  setWarningHandler,
} from '../../src/index'
import { propEntries } from '../../src/props'

setWarningHandler(null)

const LIMIT = 600
let FULL = false

type Json = unknown

// ---------------------------------------------------------------------------
// canonical serialisation (must match run_py.py `canon`)

const canonStr = (s: string): string => {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i)
    if (u === 0x22) out += '\\"'
    else if (u === 0x5c) out += '\\\\'
    else if (u >= 0x20 && u < 0x7f) out += s[i]
    else out += '\\u' + u.toString(16).padStart(4, '0')
  }
  return out + '"'
}

const sha256 = (b: Uint8Array | string): string =>
  createHash('sha256').update(b).digest('hex')

const b64 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}

const canon = (v: Json): string => {
  if (v === null || v === undefined) return 'null'
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (typeof v === 'number') return Object.is(v, -0) ? '0' : String(v)
  if (typeof v === 'bigint') return String(v)
  if (typeof v === 'string') return canonStr(v)
  if (v instanceof Uint8Array) {
    const d: Record<string, unknown> = { $bytes: v.length, sha256: sha256(v) }
    if (FULL) d.b64 = b64(v)
    return canon(d)
  }
  if (v instanceof Bitmap) return canon({ $bitmap: [...v.bindata] })
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (typeof v === 'object') {
    return (
      '{' +
      Object.entries(v as Record<string, unknown>)
        .map(([k, x]) => canonStr(k) + ':' + canon(x))
        .join(',') +
      '}'
    )
  }
  if (typeof v === 'function') return '"<function>"'
  throw new TypeError('cannot canon ' + typeof v)
}

const shrink = (text: string): string =>
  FULL || text.length <= LIMIT
    ? text
    : canon({ $sha256: sha256(text), n: text.length })

// ---------------------------------------------------------------------------
// model

const META_KEYS = [
  'glyphname',
  'codepoint',
  'bbw',
  'bbh',
  'bbxoff',
  'bbyoff',
  'swx0',
  'swy0',
  'dwx0',
  'dwy0',
  'swx1',
  'swy1',
  'dwx1',
  'dwy1',
  'vvectorx',
  'vvectory',
  'hexdata',
] as const

const meta17 = (l: unknown[]): unknown[] =>
  Array.from({ length: 17 }, (_, i) => l[i])

const model = (font: Font): Json => ({
  headers: Object.entries(font.headers).map(([k, v]) => [k, v]),
  // property order = the library's output order (SPEC-v3 §11.3: an ordered
  // key list, not Object.keys); the comment list separately (its position
  // among the keys has no meaning)
  props: propEntries(font.props, font._propnames).map(([k, v]) => [k, v]),
  comment: font.props.comment ?? null,
  propnames: [...font._propnames.entries()],
  glyphs: [...font.glyphs.entries()].map(([cp, m]) => [cp, meta17(m)]),
  unencoded: font.unencoded.map((e) => [e.altcode, meta17(e.meta)]),
  charset: font.charset,
})

const digest = (font: Font): Json => {
  if (FULL) return model(font)
  return {
    model: sha256(canon(model(font))),
    n: font.glyphs.size,
    u: font.unencoded.length,
  }
}

const glyphMeta = (g: Glyph | null): Json =>
  g === null
    ? null
    : META_KEYS.map((k) => (g.meta as Record<string, unknown>)[k])

// ---------------------------------------------------------------------------
// helpers

const bm = (rows: string[]): Bitmap => new Bitmap([...rows])
const NOTHING = Symbol('nothing')

/** Deterministic pseudo-random '0'/'1'/'2' rows (same in run_py.py) */
const lcgRows = (seed: number, w: number, h: number): string[] => {
  let x = seed % 65537
  const rows: string[] = []
  for (let i = 0; i < h; i++) {
    let r = ''
    for (let j = 0; j < w; j++) {
      x = (x * 75 + 74) % 65537
      const v = x % 7
      r += v < 2 ? '1' : v === 2 ? '2' : '0'
    }
    rows.push(r)
  }
  return rows
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any[]

const applyBop = (B: Bitmap, m: string, a: A): [Bitmap, unknown] => {
  switch (m) {
    case 'crop':
      return [B.crop(a[0], a[1], a[2], a[3]), NOTHING]
    case 'overlay':
      return [B.overlay(bm(a[0])), NOTHING]
    case 'overlay_same':
      return [B.overlay(bm(lcgRows(a[0], B.width(), B.height()))), NOTHING]
    case 'concat':
      return [
        B.concat(bm(a[0]), { direction: a[1], align: a[2], offset: a[3] }),
        NOTHING,
      ]
    case 'concatall':
      return [
        Bitmap.concatall((a[0] as string[][]).map(bm), {
          direction: a[1],
          align: a[2],
          offsetlist: a[3],
        }),
        NOTHING,
      ]
    case 'enlarge':
    case 'replace':
    case 'shadow':
    case 'glow':
    case 'bytepad':
    case 'setpixel':
    case 'rotate':
    case 'shift':
    case 'bold':
    case 'italic':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [(B as any)[m](...a), NOTHING]
    case 'fliph':
    case 'flipv':
    case 'invert':
    case 'trim':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [(B as any)[m](), NOTHING]
    case 'paste':
      return [B.paste(bm(a[0]), a[1], a[2]), NOTHING]
    case 'clone':
      return [B.clone(), NOTHING]
    case 'fromstring':
      return [Bitmap.fromstring(a[0]), NOTHING]
    case 'blank':
      return [Bitmap.blank(a[0], a[1]), NOTHING]
    case 'todata':
      return [B, B.todata(a[0])]
    case 'getpixel':
      return [B, B.getpixel(a[0], a[1])]
    case 'bbox':
      return [B, B.bbox()]
    case 'width':
      return [B, B.width()]
    case 'height':
      return [B, B.height()]
    case 'str':
      return [B, B.toString()]
    case 'equals':
      return [B, B.equals(bm(a[0]))]
    case 'tosvg':
      return [B, B.tosvg(a[0], a[1], a[2], { x: a[3], y: a[4] }, a[5])]
    case 'contours':
      return [
        B,
        bitmapContours(B.bindata, {
          shape: a[0],
          dotsize: a[1],
          ppu: a[2],
          xoff: a[3],
          yoff: a[4],
        }),
      ]
    case 'raster': {
      const cs = bitmapContours(B.bindata, {
        shape: a[0],
        dotsize: a[1],
        ppu: a[2],
        xoff: 0,
        yoff: 0,
      })
      return [B, rasterize(cs, a[2], 0, 0, B.width(), B.height())]
    }
  }
  throw new Error('unknown bitmap op ' + m)
}

const makeFn =
  (fnops: A[]) =>
  (b: Bitmap): Bitmap => {
    for (const step of fnops) {
      b = applyBop(b, step[0], step.slice(1))[0]
    }
    return b
  }

const drawKw = (kw: Record<string, unknown> = {}): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(kw)) {
    out[k === 'ucgs' ? 'usecurrentglyphspacing' : k] = v
  }
  return out
}

const b64decode = (s: string): Uint8Array => {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---------------------------------------------------------------------------
// case execution

type Case = Record<string, unknown> & {
  id: string
  ops: Record<string, A | unknown>[]
}

class Ctx {
  fonts = new Map<string, Font>()
  handles: (Glyph | null)[] = []
  B: Bitmap = new Bitmap([])
  constructor(public c: Case) {}
}

const srcText = (c: Case, src: string): string => {
  if (src === 'bdf' || src === 'bdf2') return c[src] as string
  throw new Error('bad src ' + src)
}

const srcBytes = (c: Case, src: string): Uint8Array => {
  if (src === 'file') return new Uint8Array(readFileSync(c.file as string))
  if (typeof c[src + '_b64'] === 'string')
    return b64decode(c[src + '_b64'] as string)
  return new TextEncoder().encode(c[src] as string)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runOp = async (ctx: Ctx, op: Record<string, any>): Promise<unknown> => {
  const name: string = op.op
  const c = ctx.c
  const F = ctx.fonts.get(op.f ?? 'F') as Font

  switch (name) {
    case 'load': {
      const how = op.how ?? 'string'
      const src = op.src ?? 'bdf'
      const f = new Font()
      if (how === 'string') {
        f.load_string(srcText(c, src))
      } else if (how === 'lines') {
        await f.load_filelines(srcText(c, src).split(/(?<=\n)/))
      } else {
        await f.load_bytes_async(
          srcBytes(c, src),
          op.pixelsize == null ? {} : { pixelsize: op.pixelsize }
        )
      }
      ctx.fonts.set(op.to ?? 'F', f)
      return [digest(f), f.charset, f.length]
    }
    case 'create': {
      const f = Font.create(op.kw ?? {})
      ctx.fonts.set(op.to ?? 'F', f)
      return digest(f)
    }
    case 'tobdf':
      return F.tobdf()
    case 'model':
      return model(F)
    case 'digest':
      return digest(F)
    case 'svgfont': {
      const kw = op.kw ?? {}
      return F.tosvgfont({
        pathOffsets: { x: kw.xoff, y: kw.yoff },
        unicodeAttr: { controlCharNoSkip: kw.ccns, format: kw.uf },
      })
    }
    case 'pcf':
      return F.topcf(op.kw ?? {})
    case 'pcfrt': {
      const g = readPcf(F.topcf(op.kw ?? {}))
      ctx.fonts.set(op.to ?? 'P', g)
      return [digest(g), g.tobdf()]
    }
    case 'ttf':
      return F.tottf(op.kw ?? {})
    case 'ttfrt': {
      const g = readTtf(F.tottf(op.kw ?? {}), {
        pixelsize: op.pixelsize ?? undefined,
      })
      ctx.fonts.set(op.to ?? 'T', g)
      return [digest(g), g.tobdf()]
    }
    case 'drawall':
      return F.drawall(drawKw(op.kw))
    case 'draw':
      return F.draw(op.text, drawKw(op.kw))
    case 'drawcps':
      return F.drawcps(op.cps, drawKw(op.kw))
    case 'itercps':
      return F.itercps(op.order ?? 1, op.r ?? null)
    case 'iterglyphs':
      return [...F.iterglyphs(op.order ?? 1, op.r ?? null)].map(glyphMeta)
    case 'gdraw': {
      const g = F.glyphbycp(op.cp)
      return g === null ? null : g.draw(op.mode ?? 0, op.bb ?? null)
    }
    case 'gorigin': {
      const g = F.glyphbycp(op.cp)
      const a = op.a ?? []
      return g === null
        ? null
        : g.origin({ mode: a[0], fromorigin: a[1], xoff: a[2], yoff: a[3] })
    }
    case 'gstr': {
      const g = F.glyphbycp(op.cp)
      return g === null ? null : g.toString()
    }
    case 'gchr':
      return (op.cps as number[]).map((cp) => {
        const g = F.glyphbycp(cp)
        return g === null ? null : g.chr()
      })
    case 'gbychar':
      return (op.chars as string[]).map((ch) => glyphMeta(F.glyph(ch)))
    case 'lacks':
      return F.lacksglyphs(op.text)
    case 'c2p':
      return (op.chars as string[]).map((ch) => F.char2cp(ch))
    case 'p2c':
      return (op.cps as number[]).map((cp) => F.cp2char(cp))
    case 'setprop':
      F.setprop(op.key, op.value)
      return digest(F)
    case 'delprop':
      F.delprop(op.key)
      return digest(F)
    case 'getprop':
      return (op.keys as string[]).map((k) => F.getprop(k))
    case 'addglyph':
      F.addglyph({ ...op.meta }, op.replace ?? true)
      return digest(F)
    case 'removeglyph':
      F.removeglyph(op.cp)
      return digest(F)
    case 'newglyph': {
      const g = F.newglyph(op.cp, op.rows == null ? null : bm(op.rows), {
        mode: op.mode ?? 0,
        name: op.name ?? null,
        dwidth: op.dwidth ?? null,
      })
      ctx.handles.push(g)
      return [ctx.handles.length - 1, glyphMeta(g), digest(F)]
    }
    case 'gget': {
      const g = F.glyphbycp(op.cp)
      ctx.handles.push(g)
      return [ctx.handles.length - 1, glyphMeta(g)]
    }
    case 'updatebbox':
      F.updatebbox()
      return ['fbbx', 'fbby', 'fbbxoff', 'fbbyoff'].map(
        (k) => (F.headers as Record<string, unknown>)[k]
      )
    case 'subset': {
      const g = F.subset(op.r)
      ctx.fonts.set(op.to ?? 'S', g)
      return digest(g)
    }
    case 'merge':
      F.merge(ctx.fonts.get(op.g) as Font, op.replace ?? false)
      return digest(F)
    case 'transform':
      F.transform(makeFn(op.fn), op.r ?? null, op.mode ?? 0)
      return digest(F)
    case 'clone': {
      const g = F.clone()
      ctx.fonts.set(op.to ?? 'C', g)
      return digest(g)
    }
    case 'charsetconvert':
      F.charsetconvert(op.charset)
      return [digest(F), F.charset]
    case 'encoding':
      F.encoding({ charset: op.charset })
      return F.charset
    case 'swidth':
      return (op.dwxs as number[]).map((d) => F.swidth(d))
    case 'length':
      return [F.length, F.charset]
    case 'bset':
      ctx.B = bm(op.rows)
      return null
    case 'bglyph': {
      const g = F.glyphbycp(op.cp)
      ctx.B = g !== null ? g.draw(op.mode ?? 0) : new Bitmap([])
      return ctx.B
    }
    case 'bdrawall':
      ctx.B = F.drawall(drawKw(op.kw))
      return ctx.B
    case 'bop': {
      const [B, val] = applyBop(ctx.B, op.m, op.a ?? [])
      ctx.B = B
      return val === NOTHING ? ctx.B : val
    }
    case 'cs': {
      const codec = getCodec(op.charset, op.gl == null ? {} : { gl: op.gl })
      return [
        canonicalCharset(op.charset),
        ((op.cps ?? []) as number[]).map((cp) => codec.cp2char(cp)),
        ((op.chars ?? []) as string[]).map((ch) => codec.char2cp(ch)),
      ]
    }
    case 'csname':
      return [
        ((op.pairs ?? []) as [string | null, string | null][]).map(([r, e]) =>
          sanitizeCharset(r, e)
        ),
        ((op.names ?? []) as string[]).map((n) => canonicalCharset(n)),
        ((op.names ?? []) as string[]).map((n) =>
          charsetProps(canonicalCharset(n))
        ),
      ]
  }
  if (name.startsWith('h')) {
    const g = ctx.handles[op.h] ?? null
    if (g === null) return 'nohandle'
    switch (name) {
      case 'hsetbitmap':
        g.setbitmap(bm(op.rows), op.mode ?? 0, op.bb ?? null, op.trim ?? true)
        break
      case 'hsetmeta':
        g.setmeta({ ...op.meta })
        break
      case 'hshift':
        g.shift(op.dx ?? 0, op.dy ?? 0)
        break
      case 'htransform':
        g.transform(makeFn(op.fn), op.mode ?? 0)
        break
      case 'hclone':
        ctx.handles.push(g.clone())
        return [ctx.handles.length - 1, glyphMeta(g)]
      case 'haddglyph':
        F.addglyph(g, op.replace ?? true)
        break
      case 'hremove':
        F.removeglyph(g)
        break
      case 'hmeta':
        return glyphMeta(g)
      case 'hdraw':
        return g.draw(op.mode ?? 0)
      default:
        throw new Error('unknown op ' + name)
    }
    return [glyphMeta(g), digest(g.font)]
  }
  throw new Error('unknown op ' + name)
}

const STATEFUL = new Set([
  'setprop',
  'delprop',
  'addglyph',
  'removeglyph',
  'newglyph',
  'updatebbox',
  'merge',
  'transform',
  'charsetconvert',
  'encoding',
  'hsetbitmap',
  'hsetmeta',
  'hshift',
  'htransform',
  'haddglyph',
  'hremove',
])

const runCase = async (c: Case): Promise<unknown[]> => {
  const ctx = new Ctx(c)
  const res: unknown[] = []
  for (let i = 0; i < c.ops.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = c.ops[i] as Record<string, any>
    try {
      const v = await runOp(ctx, op)
      res.push([i, op.op, shrink(canon(v)), null])
    } catch (e) {
      const err = e as Error
      const entry: unknown[] = [
        i,
        op.op,
        null,
        `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`.slice(0, 300),
      ]
      // state of the target font after the exception (see run_py.py)
      const f = ctx.fonts.get(op.f ?? 'F')
      if (f !== undefined && STATEFUL.has(op.op)) {
        try {
          entry.push(shrink(canon(digest(f))))
        } catch {
          entry.push(null)
        }
      }
      res.push(entry)
      if (op.op === 'load') break
    }
  }
  return res
}

// ---------------------------------------------------------------------------
// charset tables

const runTables = (specPath: string, outPath: string): void => {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const cps: number[] = spec.cps
  const chars: string[] = (spec.chars as number[]).map((c) =>
    String.fromCodePoint(c)
  )
  const out: Record<string, unknown> = {}
  for (const ent of spec.charsets) {
    const codec = getCodec(ent.name, ent.gl == null ? {} : { gl: ent.gl })
    const rec: Record<string, unknown> = {
      key: canonicalCharset(ent.name),
      known: codec.known,
    }
    const p2c: [number, unknown][] = []
    for (const cp of [...cps, ...(ent.extra_cps ?? [])]) {
      let ch: unknown
      try {
        ch = codec.cp2char(cp)
      } catch (e) {
        ch = '!' + (e as Error).name
      }
      if (ch !== null && ch !== undefined) p2c.push([cp, ch])
    }
    const c2p: [number, unknown][] = []
    for (const ch of chars) {
      let cp: unknown
      try {
        cp = codec.char2cp(ch)
      } catch (e) {
        cp = '!' + (e as Error).name
      }
      if (cp !== null && cp !== undefined)
        c2p.push([ch.codePointAt(0) as number, cp])
    }
    // the Python runner emits each code once (dict); keep the first occurrence
    const dedupe = (l: [number, unknown][]): [number, unknown][] => {
      const seen = new Set<number>()
      return l.filter(([k]) => (seen.has(k) ? false : (seen.add(k), true)))
    }
    rec.p2c = dedupe(p2c)
    rec.c2p = dedupe(c2p)
    out[ent.id] = rec
  }
  writeFileSync(outPath, canon(out))
}

const main = async (argv: string[]): Promise<void> => {
  if (argv[0] === '--tables') {
    runTables(argv[1], argv[2])
    return
  }
  const [inp, outp] = argv
  FULL = argv.includes('--full')
  const oi = argv.indexOf('--only')
  const only = oi >= 0 ? new Set(argv[oi + 1].split(',')) : null
  const t0 = Date.now()
  const lines = readFileSync(inp, 'utf8').split('\n')
  const fd = openSync(outp, 'w')
  let n = 0
  for (const line of lines) {
    if (!line.trim()) continue
    const c = JSON.parse(line) as Case
    if (only !== null && !only.has(c.id)) continue
    const t = Date.now()
    const res = await runCase(c)
    writeSync(fd, JSON.stringify({ id: c.id, ms: Date.now() - t, res }) + '\n')
    n++
  }
  closeSync(fd)
  process.stderr.write(
    `[js] ${n} cases in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`
  )
}

await main(process.argv.slice(2))
