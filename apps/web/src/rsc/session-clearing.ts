// A render reads through the API on behalf of a request already in flight.
// Its Set-Cookie headers cannot be applied conditionally to the cookie the
// browser holds when this response arrives. Keep them out of the response,
// including clearings emitted by an older server during a rolling release.

export interface Forwarded {
  /** the lines for the document's response, as the api wrote them, each once */
  readonly forwarded: readonly string[]
  /** the cookie names left behind, for the log; never their values */
  readonly dropped: readonly string[]
}

const nameOf = (line: string) => {
  const pair = line.split(';', 1)[0] ?? ''
  const at = pair.indexOf('=')
  return (at < 0 ? pair : pair.slice(0, at)).trim()
}

/**
 * Of the `Set-Cookie` lines the api answered a render's reads with, the
 * ones the reader's browser is sent.
 */
export const sessionClearings = (
  lines: readonly string[],
  _cookieHeader: string | undefined,
): Forwarded => ({ forwarded: [], dropped: lines.map(nameOf) })

/** `response`, carrying `lines` too; one the host made, whose headers can still change */
export const withCookies = (response: Response, lines: readonly string[]): Response => {
  if (lines.length === 0) return response
  const headers = new Headers(response.headers)
  const already = new Set(headers.getSetCookie())
  for (const line of lines) if (!already.has(line)) headers.append('set-cookie', line)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
