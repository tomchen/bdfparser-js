// Type-check the published declarations (dist/*.d.ts, dist/*.d.cts) from a
// consumer project that has neither the DOM nor the Node.js types:
// `"lib": ["ES2022"]`, `"types": []`, `skipLibCheck: false`, strict, with
// both ESM (`import`) and CommonJS (`require`) resolution of the package
// exports (`bdfparser` and `bdfparser/cjk`).
//
//   bun run build
//   node tools/check-dts.mjs [DIST_DIR]
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(process.argv[2] ?? join(root, 'dist'))
const dir = mkdtempSync(join(tmpdir(), 'bdfparser-dts-'))

const consumer = `
import { $Font, Bitmap, Font, registerCharsetTables, type URLLike } from 'bdfparser'
import { cjkTables } from 'bdfparser/cjk'
const url: URLLike = { href: 'https://example.com/f.bdf' }
export const load = async (): Promise<Font> => {
  const f = await $Font(url)
  await new Font().load_url('https://example.com/f.bdf', { cache: 'no-store' })
  registerCharsetTables(cjkTables)
  const b: Bitmap = f.draw('A')
  const n: number | null = f.char2cp('A')
  return n === null ? f : Font.create({ pixelsize: b.height() })
}
`

try {
  const pkg = join(dir, 'node_modules', 'bdfparser')
  mkdirSync(pkg, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  writeFileSync(join(pkg, 'package.json'), JSON.stringify(manifest))
  mkdirSync(join(pkg, 'dist'))
  for (const f of ['index.d.ts', 'index.d.cts', 'cjk.d.ts', 'cjk.d.cts']) {
    cpSync(join(dist, f), join(pkg, 'dist', f))
  }
  writeFileSync(join(dir, 'esm.mts'), consumer)
  writeFileSync(join(dir, 'cjs.cts'), consumer)
  const program = ts.createProgram(
    [join(dir, 'esm.mts'), join(dir, 'cjs.cts')],
    {
      lib: ['lib.es2022.d.ts'],
      types: [],
      skipLibCheck: false,
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    }
  )
  const diags = ts.getPreEmitDiagnostics(program)
  if (diags.length > 0) {
    console.error(
      ts.formatDiagnostics(diags, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => dir,
        getNewLine: () => '\n',
      })
    )
    console.error(`check-dts: ${diags.length} error(s)`)
    process.exitCode = 1
  } else {
    console.log(
      'check-dts: the type declarations need neither DOM nor Node.js types'
    )
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
