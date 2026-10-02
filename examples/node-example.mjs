// Node.js example: load, query, edit, render and convert a BDF font.
//
//   bun run build            # once, if you use the local build
//   node examples/node-example.mjs
//
// With the npm package installed, import from 'bdfparser' instead.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Bitmap, Font, setWarningHandler } from '../dist/index.js'
// import { Bitmap, Font, setWarningHandler } from 'bdfparser'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out')
mkdirSync(out, { recursive: true })

// collect warnings instead of printing them
const warnings = []
setWarningHandler((message) => warnings.push(message))

// load (BDF, PCF or TTF bytes are auto-detected)
const font = new Font().load_bytes(
  readFileSync(join(here, 'fonts', 'unifont-subset.bdf'))
)
console.log(font.headers.fontname, '-', font.length, 'glyphs,', font.charset)
console.log('FAMILY_NAME:', font.getprop('FAMILY_NAME'))

// render text
console.log(font.draw('Hi 你好').toString())

// edit: bold version of all glyphs, a new glyph, metadata
const bold = font.clone().transform((b) => b.bold())
bold.setprop('WEIGHT_NAME', 'Bold')
bold.newglyph(
  0x2713, // ✓
  Bitmap.fromstring(
    ['.......#', '......#.', '#....#..', '.#..#...', '..##....'].join('\n')
  ),
  { mode: 1, dwidth: 9 }
)
console.log(bold.draw('OK ✓').toString())

// convert
writeFileSync(join(out, 'bold.bdf'), bold.tobdf())
writeFileSync(join(out, 'bold.pcf'), bold.topcf())
writeFileSync(join(out, 'bold-square.ttf'), bold.tottf())
writeFileSync(join(out, 'bold-dots.ttf'), bold.tottf({ shape: 'circle' }))
writeFileSync(join(out, 'bold.svg'), bold.tosvgfont())
writeFileSync(join(out, 'hello.svg'), bold.draw('Hello').tosvg(8))
console.log('written to', out)
if (warnings.length > 0) {
  console.log(warnings.length, 'warning(s), e.g.', warnings[0])
}
