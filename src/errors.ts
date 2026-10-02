/**
 * Error classes (SPEC-v3 §2.9).
 *
 * @module
 */

/**
 * Fatal BDF parse error (unexpected end of file inside the headers or the
 * properties block, malformed numbers in required fields, glyph without
 * `BBX`, ...). The message starts with the 1-based line number when known
 * (`"line 12: ..."`).
 */
export class BDFParseError extends Error {
  /** 1-based line number where the error was detected, or `null` */
  public readonly lineno: number | null
  /** The message without the line number prefix */
  public readonly msg: string

  /**
   * @param message - Error description (without line number)
   * @param lineno - 1-based line number, if known
   */
  constructor(message: string, lineno: number | null = null) {
    super(lineno === null ? message : `line ${lineno}: ${message}`)
    this.name = 'BDFParseError'
    this.lineno = lineno
    this.msg = message
  }
}
