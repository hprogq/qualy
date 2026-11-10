/** Decode cookie values independently so an unrelated malformed cookie cannot break a document. */
export const documentCookies = (header: string | null): Record<string, string> =>
  Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.includes('='))
      .map((part) => {
        const at = part.indexOf('=')
        const value = part.slice(at + 1)
        try {
          return [part.slice(0, at), decodeURIComponent(value)]
        } catch {
          return [part.slice(0, at), value]
        }
      }),
  )
