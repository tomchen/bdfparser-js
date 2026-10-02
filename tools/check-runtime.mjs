// Cross-runtime smoke test of the built library (dist/index.js and the
// sub-module dist/cjk.js): run it with Node.js, Bun and Deno to check that
// every runtime produces the same bytes as the Python implementation (TTF
// golden files, some of them non-Unicode fonts), round-trips BDF exactly, and
// converts every charset exactly like Python's codecs (SHA-256 of cp2char /
// char2cp over the whole code space, test/fixtures/charsets.json, generated
// by tools/gen_charsets.py).
//
//   bun run build
//   node tools/check-runtime.mjs
//   bun tools/check-runtime.mjs
//   deno run --allow-read tools/check-runtime.mjs
/* global Bun, Deno */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Font, getCodec, setWarningHandler } from '../dist/index.js'
import '../dist/cjk.js'

const root = new URL('../test/', import.meta.url)
const read = (path) => new Uint8Array(readFileSync(new URL(path, root)))
const readJson = (path) => JSON.parse(new TextDecoder().decode(read(path)))
const runtime =
  typeof Deno !== 'undefined'
    ? `Deno ${Deno.version.deno}`
    : typeof Bun !== 'undefined'
      ? `Bun ${Bun.version}`
      : `Node.js ${process.version}`

setWarningHandler(null)
const failures = []
let n = 0

// ---- golden TTF files and BDF round trips
const manifest = readJson('fixtures/golden/manifest.json')
for (const { file, font, options } of manifest) {
  if (!file.endsWith('.ttf')) continue
  const got = new Font().load_bytes(read(font)).tottf(options)
  const exp = read(`fixtures/golden/${file}`)
  n++
  if (got.length !== exp.length || got.some((v, i) => v !== exp[i])) {
    failures.push(file)
  }
}
for (const name of ['unifont-13.0.04-for-test.bdf', 'HanWangYanKai-26.bdf']) {
  const bytes = read(`fonts/${name}`)
  n++
  if (
    new Font().load_bytes(bytes).tobdf() !== new TextDecoder().decode(bytes)
  ) {
    failures.push(`${name} (BDF round trip)`)
  }
}

// ---- charsets (same dumps as test/charsets.test.ts)
const fx = readJson('fixtures/charsets.json')
const astral = new Set([0x10000, 0x10ffff])
for (let u = 0x10000; u < 0x110000; u += fx.astral_stride) astral.add(u)
for (const [a, b] of fx.astral_tables)
  for (let u = a; u <= b; u++) astral.add(u)
const astralList = [...astral].sort((a, b) => a - b)

const digest = (fn) => {
  const h = createHash('sha256')
  let buf = []
  fn((s) => {
    buf.push(s)
    if (buf.length === 4096) {
      h.update(buf.join(''))
      buf = []
    }
  })
  h.update(buf.join(''))
  return h.digest('hex')
}
const hex = (v) => v.toString(16)
for (const [name, h] of Object.entries(fx.hashes)) {
  const [key, gl] = name.split('/')
  const c = getCodec(key, gl === 'gl' ? { gl: true } : {})
  const p2c = (codes) =>
    digest((out) => {
      for (const code of codes) {
        const ch = c.cp2char(code)
        if (ch !== null) out(`${hex(code)}:${hex(ch.codePointAt(0))}\n`)
      }
    })
  const bmp = Array.from({ length: 0x10000 }, (_, i) => i)
  n++
  if (p2c([...bmp, ...fx.extra_codes]) !== h.cp2char) {
    failures.push(`${name} (cp2char)`)
  }
  n++
  const c2p = digest((out) => {
    for (const u of [...bmp, ...astralList]) {
      const code = c.char2cp(String.fromCodePoint(u))
      if (code !== null) out(`${hex(u)}:${hex(code)}\n`)
    }
  })
  if (c2p !== h.char2cp) {
    failures.push(`${name} (char2cp)`)
  }
  if (h.cp2char4 !== undefined) {
    const codes = []
    for (let b0 = 0x81; b0 <= 0xfe; b0++)
      for (let b1 = 0x30; b1 <= 0x39; b1++)
        for (let b2 = 0x81; b2 <= 0xfe; b2++)
          for (let b3 = 0x30; b3 <= 0x39; b3++)
            codes.push(b0 * 0x1000000 + (b1 << 16) + (b2 << 8) + b3)
    n++
    if (p2c(codes) !== h.cp2char4) {
      failures.push(`${name} (cp2char, 4-byte codes)`)
    }
  }
}

if (failures.length > 0) {
  console.error(`${runtime}: ${failures.length} of ${n} checks failed:`)
  for (const f of failures) console.error(`  ${f}`)
  globalThis.process?.exit?.(1)
  globalThis.Deno?.exit(1)
} else {
  console.log(`${runtime}: all ${n} checks passed`)
}
