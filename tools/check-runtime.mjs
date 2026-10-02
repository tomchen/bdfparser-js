// Cross-runtime smoke test of the built library (dist/index.js): run it with
// Node.js, Bun and Deno to check that every runtime produces the same bytes
// as the Python implementation (TTF golden files; their non-Unicode fonts
// also exercise the runtime's TextDecoder) and round-trips BDF exactly.
//
//   bun run build
//   node tools/check-runtime.mjs
//   bun tools/check-runtime.mjs
//   deno run --allow-read tools/check-runtime.mjs
/* global Bun, Deno */
import { readFileSync } from 'node:fs'
import { Font, setWarningHandler } from '../dist/index.js'

const root = new URL('../test/', import.meta.url)
const read = (path) => new Uint8Array(readFileSync(new URL(path, root)))
const runtime =
  typeof Deno !== 'undefined'
    ? `Deno ${Deno.version.deno}`
    : typeof Bun !== 'undefined'
      ? `Bun ${Bun.version}`
      : `Node.js ${process.version}`

setWarningHandler(null)
const failures = []
const manifest = JSON.parse(
  new TextDecoder().decode(read('fixtures/golden/manifest.json'))
)
let n = 0
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

if (failures.length > 0) {
  console.error(`${runtime}: ${failures.length} of ${n} checks failed:`)
  for (const f of failures) console.error(`  ${f}`)
  globalThis.process?.exit?.(1)
  globalThis.Deno?.exit(1)
} else {
  console.log(`${runtime}: all ${n} checks passed`)
}
