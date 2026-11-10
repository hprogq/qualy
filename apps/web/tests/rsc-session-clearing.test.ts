import { describe, expect, it } from 'vitest'
import { sessionClearings, withCookies } from '../src/rsc/session-clearing.ts'

describe('cookies from API reads during a render', () => {
  it('does not forward session clearing from an older server', () => {
    const lines = [
      'qualy_session=; Max-Age=0; Path=/; HttpOnly',
      '__Host-qualy_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure',
      'other=secret; Path=/',
    ]
    expect(sessionClearings(lines, 'qualy_session=old')).toEqual({
      forwarded: [],
      dropped: ['qualy_session', '__Host-qualy_session', 'other'],
    })
  })

  it('leaves the response untouched when no cookies are forwarded', () => {
    const response = new Response('body', { status: 409 })
    const result = sessionClearings(['qualy_session=; Max-Age=0; Path=/'], 'qualy_session=old')
    expect(withCookies(response, result.forwarded)).toBe(response)
    expect(response.headers.getSetCookie()).toEqual([])
  })
})
