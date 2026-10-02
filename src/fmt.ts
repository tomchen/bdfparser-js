/**
 * Text helpers that must behave exactly like their Python counterparts
 * (SPEC-v3: Python's `fmtnum`, `str.strip()`).
 *
 * @module
 */

/** Python's `str.isspace()` characters (not the same set as JS `trim()`) */
const PY_SPACE =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const RE_PY_STRIP = /* @__PURE__ */ new RegExp(
  `^[${PY_SPACE}]+|[${PY_SPACE}]+$`,
  'g'
)

/**
 * Python's `str.strip()`.
 *
 * @param s - String
 *
 * @returns `s` without leading and trailing (Python) whitespace
 */
export const pyStrip = (s: string): string => s.replace(RE_PY_STRIP, '')

const RE_PY_LEADING_INT = /* @__PURE__ */ new RegExp(
  `^[${PY_SPACE}]*([+-]?[0-9]+)`
)

/**
 * The integer at the start of a string after (Python) whitespace, like the
 * Python library's `_parseint` (`re.match(r'\s*([+-]?[0-9]+)')`).
 *
 * @param s - String
 *
 * @returns The digits (with sign), or `null`
 */
export const pyLeadingInt = (s: string): string | null => {
  const m = RE_PY_LEADING_INT.exec(s)
  return m === null ? null : m[1]
}

/**
 * Format a number for text output (SPEC-v3), exactly like the Python
 * library: the integer string if `n` is integral (all digits, never an
 * exponent: `2 ** 64` → `'18446744073709551616'`), otherwise the shortest
 * round-trip representation in Python's `repr` style (`1e-05`, `0.0001`).
 *
 * @param n - Number (or `bigint`)
 *
 * @returns Formatted number
 */
export const fmtnum = (n: number | bigint): string => {
  if (typeof n === 'bigint') {
    return n.toString()
  }
  if (Number.isInteger(n)) {
    return Number.isSafeInteger(n) ? String(n) : BigInt(n).toString()
  }
  if (!Number.isFinite(n)) {
    return Number.isNaN(n) ? 'nan' : n > 0 ? 'inf' : '-inf'
  }
  // shortest round-trip digits; Python's repr uses the scientific notation
  // when the decimal exponent is < -4 or >= 16
  const [mant, exp] = n.toExponential().split('e')
  const e = parseInt(exp, 10)
  if (e < -4 || e >= 16) {
    return `${mant}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
  }
  return String(n)
}
