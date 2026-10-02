/**
 * Warning dispatch (SPEC-v3 §2.9).
 *
 * Non-fatal problems (malformed but recoverable input, ignored keywords,
 * missing glyphs, ...) are reported through a single, replaceable handler
 * instead of being printed directly, so applications can collect, redirect or
 * silence them.
 *
 * @module
 */

/** A function receiving the warning message (without the `[bdfparser]` prefix) */
export type WarningHandler = (message: string) => void

/** The default handler: `console.warn('[bdfparser] ' + message)` */
export const defaultWarningHandler: WarningHandler = (message) => {
  console.warn('[bdfparser] ' + message)
}

let currentHandler: WarningHandler | null = defaultWarningHandler

/**
 * Emit a warning through the current handler.
 *
 * @param message - Warning message
 */
export const warn = (message: string): void => {
  if (currentHandler !== null) {
    currentHandler(message)
  }
}

/**
 * Replace the warning handler.
 *
 * @param handler - New handler; `null` silences all warnings; `undefined` restores the default (`console.warn`) handler
 *
 * @returns The previous handler (so it can be restored later)
 *
 * @example
 * const messages: string[] = []
 * const previous = setWarningHandler((m) => messages.push(m))
 * // ... load fonts ...
 * setWarningHandler(previous)
 */
export const setWarningHandler = (
  handler?: WarningHandler | null
): WarningHandler | null => {
  const previous = currentHandler
  currentHandler = handler === undefined ? defaultWarningHandler : handler
  return previous
}
