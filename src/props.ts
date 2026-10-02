/**
 * Property bookkeeping (SPEC-v3 §11.3).
 *
 * `font.props` is a null-prototype object (so a property named `__proto__`
 * is an ordinary key) and its order is kept by `font._propnames`, an
 * insertion-ordered map of the lower-case keys to their original spelling:
 * integer-like names such as `123` keep their file position instead of being
 * enumerated first by `Object.keys`.
 *
 * @module
 */

import type { PropValue, Props } from './types'

/** New, empty (null-prototype) property object */
export const newProps = (): Props => Object.create(null) as Props

/** Null-prototype copy of a property object (the `comment` list copied too) */
export const copyProps = (props: Props): Props => {
  const out = newProps()
  for (const k of Object.keys(props)) {
    const v = (props as Record<string, unknown>)[k]
    ;(out as Record<string, unknown>)[k] = Array.isArray(v) ? [...v] : v
  }
  return out
}

const hasOwn = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k)

/**
 * Property keys (lower case, without `comment`) in output order: the keys of
 * `propnames` (file / insertion order) that are present in `props`, then the
 * keys added directly to `props` (in `Object.keys` order).
 *
 * @param props - `font.props`
 * @param propnames - `font._propnames`
 *
 * @returns Ordered keys
 */
export const propKeys = (
  props: Props,
  propnames: Map<string, string>
): string[] => {
  const keys: string[] = []
  for (const k of propnames.keys()) {
    if (k !== 'comment' && hasOwn(props, k)) {
      keys.push(k)
    }
  }
  for (const k of Object.keys(props)) {
    if (k !== 'comment' && !propnames.has(k)) {
      keys.push(k)
    }
  }
  return keys
}

/**
 * Ordered `[key, value]` pairs of the properties (without `comment`).
 *
 * @param props - `font.props`
 * @param propnames - `font._propnames`
 *
 * @returns Ordered entries
 */
export const propEntries = (
  props: Props,
  propnames: Map<string, string>
): [string, PropValue][] =>
  propKeys(props, propnames).map((k) => [
    k,
    (props as Record<string, PropValue>)[k],
  ])
