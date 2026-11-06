import { describe, expect, it } from 'vitest'
import { sessionClearings, withCookies } from '../src/rsc/session-clearing.ts'

// What a server render passes on of the cookies the api set: the clearing of
// the session cookie the reader presented, scoped as the session cookie is,
// and nothing else.

const clear = (name: string, extra = '') =>
  `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${extra}`

describe("the api's cookies a render passes on", () => {
  it('passes the clearing of the session cookie the reader presented, as written', () => {
    const line = clear('qualy_session')
    expect(sessionClearings([line], 'qualy_session=abc; theme=dark')).toEqual({
      forwarded: [line],
      dropped: [],
    })
  })

  it('passes the secure name the same way', () => {
    const line = clear('__Host-qualy_session', '; Secure')
    expect(sessionClearings([line], '__Host-qualy_session=abc').forwarded).toEqual([line])
  })

  it('passes a clearing by an expiry in the past', () => {
    const line = 'qualy_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/'
    expect(sessionClearings([line], 'qualy_session=abc').forwarded).toEqual([line])
  })

  it('drops a session cookie that is set rather than cleared', () => {
    const line = 'qualy_session=new-token; Path=/; HttpOnly'
    expect(sessionClearings([line], 'qualy_session=abc')).toEqual({
      forwarded: [],
      dropped: ['qualy_session'],
    })
  })

  it('drops the clearing of a session cookie the reader did not present', () => {
    expect(sessionClearings([clear('__Host-qualy_session')], 'qualy_session=abc')).toEqual({
      forwarded: [],
      dropped: ['__Host-qualy_session'],
    })
  })

  it('drops a clearing scoped to a domain or a narrower path', () => {
    const lines = [
      'qualy_session=; Max-Age=0; Path=/; Domain=example.test',
      'qualy_session=; Max-Age=0; Path=/api',
    ]
    expect(sessionClearings(lines, 'qualy_session=abc').forwarded).toEqual([])
  })

  it('drops every other cookie, naming it but never its value', () => {
    const result = sessionClearings(['tracker=secret-value; Path=/'], 'qualy_session=abc')
    expect(result).toEqual({ forwarded: [], dropped: ['tracker'] })
  })

  it('passes a clearing heard twice once', () => {
    const line = clear('qualy_session')
    expect(sessionClearings([line, line], 'qualy_session=abc').forwarded).toEqual([line])
  })
})

describe('a response carrying them', () => {
  it('keeps each line apart and adds none twice', () => {
    const first = clear('qualy_session')
    const response = new Response('body', {
      status: 409,
      headers: [
        ['set-cookie', 'other=1; Path=/'],
        ['set-cookie', first],
      ],
    })
    const carried = withCookies(response, [first])
    expect(carried.status).toBe(409)
    expect(carried.headers.getSetCookie()).toEqual(['other=1; Path=/', first])
  })

  it('leaves a response alone when there is nothing to carry', () => {
    const response = new Response('body')
    expect(withCookies(response, [])).toBe(response)
  })
})
