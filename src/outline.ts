/**
 * Outline generation from bitmaps (SPEC-v3 §7.1, §7.2) and the inverse
 * rasterizer (SPEC-v3 §7.4).
 *
 * Coordinates are font units, y grows upward. A pixel is `ppu × ppu` units.
 *
 * Implementation choices where the spec leaves room (identical to the Python
 * implementation `bdfparser/outline.py`; golden tests assert equal output):
 *
 * - §7.1 tracing stops when the start vertex is reached again. The first unused
 *   edge (emission order) never starts at a vertex its contour visits twice,
 *   so this equals "until the start edge is reached again".
 * - §7.1 rotation: ties of the minimal `(y, x)` vertex are broken by the first
 *   occurrence in traced order (after removal of collinear vertices).
 * - §7.2 evaluation order (IEEE double): `cx = (xoff + c + 0.5) * ppu`,
 *   `s = dotsize * ppu / 2`, square `round(cx - s)` / `round(cx + s)`, circle
 *   `R = (dotsize * ppu / 2) * K` and `round(cx + R * dx)`, with
 *   `round(v) = floor(v + 0.5)`.
 * - `bindata` rows of different lengths are tolerated (a missing character is
 *   not ink); `ppu` must be a positive integer, `dotsize` in (0, 1.5], `shape`
 *   `'square'` or `'circle'`.
 * - §7.4: ray from the pixel centre `(X, Y)` towards +x; an edge with
 *   `min(y0, y1) <= Y < max(y0, y1)` is crossed iff
 *   `x0 + (Y - y0) * (x1 - x0) / (y1 - y0) > X`; upward edges count +1,
 *   downward −1. Quadratic segments are flattened into 16 chords between
 *   `B(i/16)`, `B(t) = mt*mt*p0 + 2*mt*t*p1 + t*t*p2` (`mt = 1 - t`, end point
 *   exactly `p2`). An all-off-curve contour starts at the midpoint of its last
 *   and first points. Contours with fewer than 2 points are ignored.
 *
 * @module
 */

/** A contour point: `[x, y, oncurve]` */
export type ContourPoint = [x: number, y: number, oncurve: boolean]
/** A closed contour */
export type Contour = ContourPoint[]

export type DotShape = 'square' | 'circle'

export type BitmapContoursOptions = {
  /** `'square'` (default) or `'circle'` */
  shape?: DotShape
  /** dot size relative to the pixel, in (0, 1.5], default 1 */
  dotsize?: number
  /** font units per pixel, default 1 */
  ppu?: number
  /** x of the bitmap's bottom-left corner, in pixels, default 0 */
  xoff?: number
  /** y of the bitmap's bottom-left corner, in pixels, default 0 */
  yoff?: number
}

/** `round(v) = floor(v + 0.5)` (spec rounding rule) */
const rnd = (v: number): number => Math.floor(v + 0.5)

/** 1 / cos(22.5°) */
const K = 1.082392200292394
/** cos(45°) */
const D = 0.7071067811865476
/** Circle control point directions, clockwise from the top */
const CIRCLE_DIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [D, D],
  [1, 0],
  [D, -D],
  [0, -1],
  [-D, -D],
  [-1, 0],
  [-D, D],
]

/**
 * Converts a bitmap into TrueType-style contours (SPEC-v3 §7.1 / §7.2).
 *
 * - `shape='square'` and `dotsize=1`: all ink pixels merged into the minimal
 *   outline of their union (outer contours clockwise, holes counter-clockwise).
 * - otherwise: one contour per ink pixel (square: 4 on-curve points; circle: 8
 *   off-curve points).
 *
 * @param bindata - bitmap rows (top row first) of `'0'`, `'1'`, `'2'`; any char other than `'0'` is ink
 * @param options - see {@link BitmapContoursOptions}
 *
 * @returns list of contours, each a list of `[x, y, oncurve]` with integer `x`, `y`
 */
export const bitmapContours = (
  bindata: readonly string[],
  options: BitmapContoursOptions = {}
): Contour[] => {
  const shape = options.shape ?? 'square'
  const dotsize = options.dotsize ?? 1
  const ppu = options.ppu ?? 1
  const xoff = options.xoff ?? 0
  const yoff = options.yoff ?? 0
  if (shape !== 'square' && shape !== 'circle') {
    throw new Error(
      `Invalid shape "${String(shape)}": must be "square" or "circle"`
    )
  }
  if (!(typeof dotsize === 'number' && dotsize > 0 && dotsize <= 1.5)) {
    throw new RangeError(
      `Invalid dotsize ${String(dotsize)}: must be in (0, 1.5]`
    )
  }
  if (!Number.isInteger(ppu) || ppu < 1) {
    throw new RangeError(
      `Invalid ppu ${String(ppu)}: must be a positive integer`
    )
  }
  // ink[r][c], r counted from the bottom; rows of different lengths are
  // tolerated (a missing character is not ink)
  const h = bindata.length
  let w = 0
  const ink: boolean[][] = []
  for (let r = 0; r < h; r++) {
    const row = bindata[h - 1 - r]
    const a: boolean[] = new Array<boolean>(row.length)
    for (let c = 0; c < row.length; c++) {
      a[c] = row[c] !== '0'
    }
    ink.push(a)
    w = Math.max(w, row.length)
  }
  if (w === 0) {
    return []
  }
  if (shape === 'square' && dotsize === 1) {
    return mergedContours(ink, w, h, ppu, xoff, yoff)
  }
  return dotContours(ink, h, shape, dotsize, ppu, xoff, yoff)
}

const dotContours = (
  ink: boolean[][],
  h: number,
  shape: DotShape,
  dotsize: number,
  ppu: number,
  xoff: number,
  yoff: number
): Contour[] => {
  const contours: Contour[] = []
  const s = (dotsize * ppu) / 2
  const R = s * K
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < ink[r].length; c++) {
      if (!ink[r][c]) {
        continue
      }
      const cx = (xoff + c + 0.5) * ppu
      const cy = (yoff + r + 0.5) * ppu
      if (shape === 'square') {
        contours.push([
          [rnd(cx - s), rnd(cy - s), true],
          [rnd(cx - s), rnd(cy + s), true],
          [rnd(cx + s), rnd(cy + s), true],
          [rnd(cx + s), rnd(cy - s), true],
        ])
      } else {
        contours.push(
          CIRCLE_DIRS.map(([dx, dy]): ContourPoint => [
            rnd(cx + R * dx),
            rnd(cy + R * dy),
            false,
          ])
        )
      }
    }
  }
  return contours
}

const mergedContours = (
  ink: boolean[][],
  w: number,
  h: number,
  ppu: number,
  xoff: number,
  yoff: number
): Contour[] => {
  const isInk = (c: number, r: number): boolean =>
    r >= 0 && r < h && c >= 0 && c < ink[r].length && ink[r][c]
  // vertex key: vy * (w + 1) + vx
  const vw = w + 1
  // edges: start vertex (sx, sy), direction (dx, dy)
  const esx: number[] = []
  const esy: number[] = []
  const edx: number[] = []
  const edy: number[] = []
  const outgoing = new Map<number, number[]>()
  const addEdge = (sx: number, sy: number, dx: number, dy: number): void => {
    const i = esx.length
    esx.push(sx)
    esy.push(sy)
    edx.push(dx)
    edy.push(dy)
    const k = sy * vw + sx
    const l = outgoing.get(k)
    if (l === undefined) {
      outgoing.set(k, [i])
    } else {
      l.push(i)
    }
  }
  // 1. edge generation
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < ink[r].length; c++) {
      if (!ink[r][c]) {
        continue
      }
      if (!isInk(c, r - 1)) {
        addEdge(c + 1, r, -1, 0) // bottom
      }
      if (!isInk(c - 1, r)) {
        addEdge(c, r, 0, 1) // left
      }
      if (!isInk(c, r + 1)) {
        addEdge(c, r + 1, 1, 0) // top
      }
      if (!isInk(c + 1, r)) {
        addEdge(c + 1, r + 1, 0, -1) // right
      }
    }
  }
  // 2. tracing
  const n = esx.length
  const used = new Uint8Array(n)
  const contours: Contour[] = []
  let first = 0
  for (;;) {
    while (first < n && used[first]) {
      first++
    }
    if (first >= n) {
      break
    }
    const startx = esx[first]
    const starty = esy[first]
    const path: number[] = [] // edge indices
    let e = first
    for (;;) {
      used[e] = 1
      path.push(e)
      const vx = esx[e] + edx[e]
      const vy = esy[e] + edy[e]
      if (vx === startx && vy === starty) {
        break
      }
      const cands = outgoing.get(vy * vw + vx)
      const dx = edx[e]
      const dy = edy[e]
      let next = -1
      let nextRank = 3
      if (cands !== undefined) {
        for (const o of cands) {
          if (used[o]) {
            continue
          }
          const odx = edx[o]
          const ody = edy[o]
          let rank: number
          if (odx === dy && ody === -dx) {
            rank = 0 // right turn
          } else if (odx === dx && ody === dy) {
            rank = 1 // straight
          } else if (odx === -dy && ody === dx) {
            rank = 2 // left turn
          } else {
            continue // U-turn: impossible for a valid edge set
          }
          if (rank < nextRank) {
            nextRank = rank
            next = o
          }
        }
      }
      if (next < 0) {
        // cannot happen: every vertex has equal in- and out-degree
        throw new Error('Internal error: open contour while tracing bitmap')
      }
      e = next
    }
    // 3. simplification
    const m = path.length
    const pts: [number, number][] = []
    for (let i = 0; i < m; i++) {
      const cur = path[i]
      const prev = path[(i + m - 1) % m]
      if (edx[cur] === edx[prev] && edy[cur] === edy[prev]) {
        continue
      }
      pts.push([esx[cur], esy[cur]])
    }
    // 4. rotation
    let best = 0
    for (let i = 1; i < pts.length; i++) {
      const [bx, by] = pts[best]
      const [x, y] = pts[i]
      if (y < by || (y === by && x < bx)) {
        best = i
      }
    }
    // 5. scale
    const contour: Contour = []
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[(best + i) % pts.length]
      contour.push([(xoff + x) * ppu, (yoff + y) * ppu, true])
    }
    contours.push(contour)
  }
  return contours
}

/**
 * Flattens one TrueType contour into the reusable coordinate arrays `PX`,
 * `PY` (closed polyline: the last point equals the first one).
 *
 * @returns number of points written
 */
const flattenInto = (
  contour: readonly ContourPoint[],
  PX: number[],
  PY: number[],
  skipY?: (lo: number, hi: number) => boolean
): number => {
  const n = contour.length
  let len = 0
  if (n === 0) {
    return 0
  }
  // first on-curve point; an all-off-curve contour starts at the implied
  // midpoint of its last and first points
  let s = -1
  for (let i = 0; i < n; i++) {
    if (contour[i][2]) {
      s = i
      break
    }
  }
  let x0: number
  let y0: number
  if (s < 0) {
    const a = contour[n - 1]
    const b = contour[0]
    x0 = (a[0] + b[0]) / 2
    y0 = (a[1] + b[1]) / 2
    s = 0
  } else {
    x0 = contour[s][0]
    y0 = contour[s][1]
    s += 1
  }
  const sx = x0
  const sy = y0
  PX[len] = x0
  PY[len++] = y0
  // walk the remaining points (cyclically), then close at the start point
  let cx = 0
  let cy = 0
  let ctrl = false
  const quad = (x2: number, y2: number): void => {
    // optimisation (rasterizer only): a curve whose control hull spans no
    // sampled y is replaced by its chord, which crosses no sampled y either
    if (
      skipY !== undefined &&
      skipY(Math.min(y0, cy, y2), Math.max(y0, cy, y2))
    ) {
      PX[len] = x2
      PY[len++] = y2
      x0 = x2
      y0 = y2
      return
    }
    for (let k = 1; k < 16; k++) {
      const t = k / 16
      const mt = 1 - t
      const a = mt * mt
      const b = 2 * mt * t
      const c = t * t
      PX[len] = a * x0 + b * cx + c * x2
      PY[len++] = a * y0 + b * cy + c * y2
    }
    PX[len] = x2
    PY[len++] = y2
    x0 = x2
    y0 = y2
  }
  const total = n - (s === 0 && !contour[0][2] ? 0 : 1)
  for (let j = 0; j <= total; j++) {
    let px: number
    let py: number
    let on: boolean
    if (j === total) {
      px = sx
      py = sy
      on = true
    } else {
      const p = contour[(s + j) % n]
      px = p[0]
      py = p[1]
      on = p[2]
    }
    if (on) {
      if (ctrl) {
        quad(px, py)
        ctrl = false
      } else {
        x0 = px
        y0 = py
        PX[len] = px
        PY[len++] = py
      }
    } else {
      if (ctrl) {
        quad((cx + px) / 2, (cy + py) / 2)
      }
      cx = px
      cy = py
      ctrl = true
    }
  }
  return len
}

/**
 * Flattens a TrueType quadratic contour (on/off-curve points, implied
 * midpoints) into a closed polyline; each quadratic segment becomes 16 lines.
 *
 * @internal
 */
export const flattenContour = (
  contour: readonly ContourPoint[]
): [number, number][] => {
  const PX: number[] = []
  const PY: number[] = []
  const len = flattenInto(contour, PX, PY)
  const out: [number, number][] = []
  for (let i = 0; i < len; i++) out.push([PX[i], PY[i]])
  return out
}

/**
 * Rasterizes TrueType quadratic contours into a bitmap (SPEC-v3 §7.4), using
 * the non-zero winding rule sampled at pixel centres.
 *
 * @param contours - contours (font units)
 * @param ppu - font units per pixel
 * @param xminPx - x of the bitmap's left edge, in pixels
 * @param yminPx - y of the bitmap's bottom edge, in pixels
 * @param wPx - bitmap width in pixels
 * @param hPx - bitmap height in pixels
 *
 * @returns bindata (top row first) of `'0'` / `'1'`
 */
export const rasterize = (
  contours: readonly (readonly ContourPoint[])[],
  ppu: number,
  xminPx: number,
  yminPx: number,
  wPx: number,
  hPx: number
): string[] => {
  if (wPx <= 0 || hPx <= 0) {
    return hPx > 0 ? new Array<string>(hPx).fill('') : []
  }
  // pixel centre coordinates
  const ys: number[] = []
  for (let r = 0; r < hPx; r++) ys.push((yminPx + r + 0.5) * ppu)
  const xs: number[] = []
  for (let c = 0; c < wPx; c++) xs.push((xminPx + c + 0.5) * ppu)
  // crossings per row (r counted from the bottom): x and direction ±1
  const cx: number[][] = []
  const cd: number[][] = []
  for (let r = 0; r < hPx; r++) {
    cx.push([])
    cd.push([])
  }
  /** first row r with ys[r] >= lo (hPx if none) */
  const firstRow = (lo: number): number => {
    let r = Math.ceil(lo / ppu - yminPx - 0.5)
    if (r < 0) r = 0
    if (r > hPx) r = hPx
    while (r > 0 && ys[r - 1] >= lo) r--
    while (r < hPx && ys[r] < lo) r++
    return r
  }
  const skipY = (lo: number, hi: number): boolean => {
    const eps = 1e-9 * (Math.abs(lo) + Math.abs(hi) + 1)
    const r = firstRow(lo - eps)
    return r >= hPx || ys[r] > hi + eps
  }
  const PX: number[] = []
  const PY: number[] = []
  for (const contour of contours) {
    if (contour.length < 2) {
      continue
    }
    const len = flattenInto(contour, PX, PY, skipY)
    for (let i = 0; i + 1 < len; i++) {
      const x0 = PX[i]
      const y0 = PY[i]
      const x1 = PX[i + 1]
      const y1 = PY[i + 1]
      if (y0 === y1) {
        continue // horizontal: never crossed with the half-open rule
      }
      const up = y0 < y1
      const lo = up ? y0 : y1
      const hi = up ? y1 : y0
      for (let r = firstRow(lo); r < hPx; r++) {
        const Y = ys[r]
        if (!(Y < hi)) break
        cx[r].push(x0 + ((Y - y0) * (x1 - x0)) / (y1 - y0))
        cd[r].push(up ? 1 : -1)
      }
    }
  }
  const rows: string[] = []
  for (let r = hPx - 1; r >= 0; r--) {
    const X = cx[r]
    const Dd = cd[r]
    const nc = X.length
    if (nc === 0) {
      rows.push('0'.repeat(wPx))
      continue
    }
    // insertion sort by x (parallel arrays)
    for (let i = 1; i < nc; i++) {
      const vx = X[i]
      const vd = Dd[i]
      let j = i - 1
      while (j >= 0 && X[j] > vx) {
        X[j + 1] = X[j]
        Dd[j + 1] = Dd[j]
        j--
      }
      X[j + 1] = vx
      Dd[j + 1] = vd
    }
    // winding(X) = sum of directions of crossings with x > X
    let acc = 0
    for (let i = 0; i < nc; i++) acc += Dd[i]
    let k = 0
    let row = ''
    for (let c = 0; c < wPx; c++) {
      const xc = xs[c]
      while (k < nc && X[k] <= xc) {
        acc -= Dd[k]
        k++
      }
      row += acc !== 0 ? '1' : '0'
    }
    rows.push(row)
  }
  return rows
}
