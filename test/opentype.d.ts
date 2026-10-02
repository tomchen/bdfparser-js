// Minimal typings for the parts of opentype.js used by the tests.
declare module 'opentype.js' {
  export interface OtPoint {
    x: number
    y: number
    onCurve: boolean
    lastPointOfContour?: boolean
  }
  export interface OtGlyph {
    index: number
    name: string | null
    unicode?: number
    unicodes: number[]
    advanceWidth?: number
    xMin?: number
    yMin?: number
    xMax?: number
    yMax?: number
    getContours(): OtPoint[][]
  }
  export interface OtFont {
    numGlyphs: number
    unitsPerEm: number
    ascender: number
    descender: number
    names: Record<string, Record<string, Record<string, string>>>
    glyphs: { get(index: number): OtGlyph; length: number }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tables: Record<string, any>
  }
  export function parse(buffer: ArrayBuffer): OtFont
  const opentype: { parse: typeof parse }
  export default opentype
}
