import { sessionCookieNames } from '@qualy/auth-contract/session'

// Which of the api's cookies a server render passes on to the reader
// (docs/adr/0012-rsc-data-mode.md).
//
// A render reads as the reader, but its responses are not the reader's to
// receive wholesale: whatever an api read sets was set for the render's own
// request. One thing has to reach the browser all the same. A session the
// api found lapsed is cleared in the same answer that says so, and a
// document drawn from that answer without the clearing leaves the browser
// presenting a token the server already refused, to every read the page
// makes next.
//
// So exactly that passes: the clearing of the session cookie this request
// presented, scoped as the session cookie is - the whole host, no domain -
// each line as the api wrote it. Anything else is dropped and said to be.

export interface Forwarded {
  /** the lines for the document's response, as the api wrote them, each once */
  readonly forwarded: readonly string[]
  /** the cookie names left behind, for the log; never their values */
  readonly dropped: readonly string[]
}

const presentedNames = (cookieHeader: string | undefined): ReadonlySet<string> =>
  new Set(
    (cookieHeader ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.includes('='))
      .map((part) => part.slice(0, part.indexOf('='))),
  )

/** a `Set-Cookie` line that deletes the cookie it names, on the whole host */
const clearingOf = (line: string): string | undefined => {
  const [pair = '', ...attributes] = line.split(';').map((part) => part.trim())
  const at = pair.indexOf('=')
  if (at <= 0) return undefined
  const name = pair.slice(0, at)
  if (pair.slice(at + 1) !== '') return undefined
  let gone = false
  let path: string | undefined
  for (const attribute of attributes) {
    const eq = attribute.indexOf('=')
    const key = (eq < 0 ? attribute : attribute.slice(0, eq)).toLowerCase()
    const value = eq < 0 ? '' : attribute.slice(eq + 1)
    if (key === 'domain') return undefined
    if (key === 'path') path = value
    if (key === 'max-age' && Number(value) <= 0) gone = true
    if (key === 'expires' && Date.parse(value) <= Date.now()) gone = true
  }
  return gone && path === '/' ? name : undefined
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
  cookieHeader: string | undefined,
): Forwarded => {
  const presented = presentedNames(cookieHeader)
  const forwarded = new Set<string>()
  const dropped: string[] = []
  for (const line of lines) {
    const cleared = clearingOf(line)
    if (cleared !== undefined && sessionCookieNames.includes(cleared) && presented.has(cleared)) {
      forwarded.add(line)
    } else {
      dropped.push(nameOf(line))
    }
  }
  return { forwarded: [...forwarded], dropped }
}

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
