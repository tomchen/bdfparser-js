# bdfparser examples

Plain HTML / JavaScript, no build step.

| file                                         | what it shows                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [browser-global.html](browser-global.html)   | classic `<script src>` of the IIFE build (global `bdfparser`), `$Font(URL)`, `draw2canvas` with `x`, `y`, `pixelsize`                              |
| [browser-esm.html](browser-esm.html)         | `<script type="module">` from jsDelivr, glyph editing (`newglyph`, `transform` bold/italic), SVG with round dots, download as BDF / PCF / TTF      |
| [led-matrix.html](led-matrix.html)           | LED dot-matrix display: text at a given `(x, y)`, round LEDs, scrolling marquee, frame packed into bytes for a hardware driver                     |
| [node-example.mjs](node-example.mjs)         | Node.js: load, query, edit and convert (BDF, PCF, TTF, SVG)                                                                                        |
| [fonts/unifont-subset.bdf](fonts/)           | 512-glyph subset of GNU Unifont 13.0.04 (ASCII, Latin-1, arrows, shapes, kana, a few CJK), made with `Font.subset()`                               |

## Running the browser examples

Pages loaded from `file://` cannot fetch the font, so serve the repository with
any static server and open the pages from `/examples/`:

```bash
npx serve .              # or: python3 -m http.server, bunx serve, ...
# then open http://localhost:3000/examples/led-matrix.html
```

The pages import bdfparser from the jsDelivr CDN. To use your local build
instead, run `bun run build` and switch to the commented `../dist/…` lines in
each page.

## Running the Node.js example

```bash
bun run build
node examples/node-example.mjs   # writes examples/out/*
```

## Drawing at a position

```js
// top-left corner of the text at canvas (x, y), 4×4 canvas pixels per font pixel
font.draw('Hello').draw2canvas(ctx, { x: 10, y: 20, pixelsize: 4 })

// or compose a frame first (e.g. an LED matrix of 96×16 LEDs)
const frame = Bitmap.blank(96, 16).paste(font.draw('Hello'), x, y)
```

The font license (SIL OFL 1.1 / GPLv2+ with the GNU font embedding exception)
is stated in the font's `COPYRIGHT` property.
