# BDF Parser TypeScript (JavaScript) library

BDF (Glyph Bitmap Distribution; [Wikipedia](https://en.wikipedia.org/wiki/Glyph_Bitmap_Distribution_Format); [Spec](https://font.tomchen.org/bdf_spec/)) format bitmap font file parser library in TypeScript (JavaScript). It has [`Font`](https://font.tomchen.org/bdfparser_js/font), [`Glyph`](https://font.tomchen.org/bdfparser_js/glyph) and [`Bitmap`](https://font.tomchen.org/bdfparser_js/bitmap) classes providing more than 30 chainable API methods of parsing BDF fonts, getting their meta information, rendering text in any writing direction, adding special effects and manipulating bitmap images. 0 dependencies and tested in Node.js <img src="https://raw.githubusercontent.com/tomchen/fetchline/main/images/node.svg" title="Node.js" alt="Node.js" width="26px" height="26px">, browsers <img src="https://raw.githubusercontent.com/tomchen/fetchline/main/images/chrome.svg" title="Google Chrome" alt="Google Chrome" width="21px" height="21px"><img src="https://raw.githubusercontent.com/tomchen/fetchline/main/images/firefox.svg" title="Firefox" alt="Firefox" width="21px" height="21px"><img src="https://raw.githubusercontent.com/tomchen/fetchline/main/images/safari.svg" title="Safari" alt="Safari" width="21px" height="21px"><img src="https://raw.githubusercontent.com/tomchen/fetchline/main/images/edge.svg" title="Microsoft Edge" alt="Microsoft Edge" width="21px" height="21px"><img src="https://raw.githubusercontent.com/tomchen/fetchline/main/images/opera.svg" title="Opera" alt="Opera" width="21px" height="21px"><img src="https://raw.githubusercontent.com/tomchen/fetchline/main/images/samsung_internet.svg" title="Samsung Internet" alt="Samsung Internet" width="21px" height="21px"> (so you can use HTML Canvas) and Deno <img src="https://raw.githubusercontent.com/tomchen/fetchline/main/images/deno.svg" title="Deno" alt="Deno" width="26px" height="26px">, it has detailed documentation / tutorials / API reference.

[![npm package](https://img.shields.io/badge/npm%20i-bdfparser-brightgreen)](https://www.npmjs.com/package/bdfparser) [![version number](https://img.shields.io/npm/v/bdfparser?color=green&label=version)](https://github.com/tomchen/bdfparser/releases) [![Actions Status](https://github.com/tomchen/bdfparser/workflows/Test/badge.svg)](https://github.com/tomchen/bdfparser/actions) [![Node.js](https://img.shields.io/badge/node-%3E=12.0-brightgreen.svg?logo=node.js)](https://nodejs.org/) [![Deno](https://img.shields.io/badge/deno-%3E=1.13.0-white.svg?logo=deno)](https://deno.land/x/bdfparser) [![License](https://img.shields.io/github/license/tomchen/bdfparser)](https://github.com/tomchen/bdfparser/blob/main/LICENSE)

**BDF Parser TypeScript (JavaScript) library** ([documentation](https://font.tomchen.org/bdfparser_js/); [GitHub page](https://github.com/tomchen/bdfparser-js); [npm page](https://www.npmjs.com/package/bdfparser); `npm i bdfparser`) is a port of **BDF Parser Python library** ([documentation](https://font.tomchen.org/bdfparser_py/); [GitHub page](https://github.com/tomchen/bdfparser); [PyPI page](https://pypi.org/project/bdfparser/); `pip install bdfparser`). Both are written by [Tom Chen](https://github.com/tomchen/) and under the MIT License.

You can even try the [**Live Demo & Code Editor**](https://font.tomchen.org/bdfparser_js/editor)!

<a href="https://font.tomchen.org/bdfparser_js/editor" title="BDF Parser Live Demo & Code Editor"><img src="https://font.tomchen.org/img/bdfparser_js/bdfparser_live_editor_demo.gif" width="700" alt="BDF Parser Live Demo & Code Editor"></a>

Below I'll show you some quick examples, but it is still strongly recommended you go to [**BDF Parser TypeScript (JavaScript) library's official website to read the detailed documentation / tutorials / API reference**](https://font.tomchen.org/bdfparser_js/).

Install bdfparser TypeScript (JavaScript) library with npm (or `yarn add ...`):

```bash
npm install bdfparser readlineiter
```

`readlineiter` is used for Node.js to read local file. You can instead use `fetchline` for browsers/Deno to fetch remote file. See my [Fetch Line JavaScript packages](https://github.com/tomchen/fetchline).

Non type checked CommonJS example (read [doc](https://font.tomchen.org/bdfparser_js/) for its strict TypeScript ES module code):

```js
const { $Font } = require('bdfparser')
const getline = require('readlineiter')
;(async () => {

const font = await $Font(getline('./test/fonts/unifont-13.0.04.bdf'))
console.log(`This font's global size is \
${font.headers.fbbx} x ${font.headers.fbby} (pixel), \
it contains ${font.length} glyphs.`)

# =================================

const a = font.glyph('a')
const c = font.glyph('c')
const ac = a
  .draw()
  .crop(6, 8, 1, 2)
  .concat(c.draw().crop(6, 8, 1, 2))
  .shadow()
const ac_8x8 = ac.enlarge(8, 8)
ac_8x8.draw2canvas(document.getElementById('mycanvas').getContext('2d'))

# =================================

const hello = font.draw('Hello!', {direction: 'rl'}).glow()
hello.draw2canvas(document.getElementById('mycanvas2').getContext('2d'))

# =================================

const font_preview = font.drawall()
font_preview.draw2canvas(document.getElementById('mycanvas3').getContext('2d'))

})()
```
