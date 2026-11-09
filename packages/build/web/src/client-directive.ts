/** Whether a module opens with the client directive, past its comments. */
export const opensWithClientDirective = (code: string): boolean => {
  // Each iteration consumes one piece of trivia. A single repeated regex
  // backtracks across comment boundaries on large non-client modules.
  const whitespace = /\s*/y
  const newline = /[\n\r\u2028\u2029]/g
  let at = 0
  for (;;) {
    whitespace.lastIndex = at
    whitespace.exec(code)
    at = whitespace.lastIndex
    if (code.startsWith('//', at)) {
      newline.lastIndex = at + 2
      if (newline.exec(code) === null) return false
      at = newline.lastIndex
    } else if (code.startsWith('/*', at)) {
      const end = code.indexOf('*/', at + 2)
      if (end === -1) return false
      at = end + 2
    } else {
      return code.startsWith("'use client'", at) || code.startsWith('"use client"', at)
    }
  }
}
