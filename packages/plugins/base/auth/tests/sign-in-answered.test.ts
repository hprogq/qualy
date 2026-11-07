import { describe, expect, it } from 'vitest'
import { Cause, Exit, Schema } from 'effect'
import { HttpClientError, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { AuthRequired, SessionExpired } from '@qualy/auth-contract/session'
import { methodsOf, presenceOf } from '../src/client/sign-in/answered.ts'

// What the sign-in page's server render passes on of its reads: an answer
// as one, a server that could not be asked as undecided - never as "nobody
// is signed in", which would draw the form for somebody who is - and the
// rest as the failures they are.

const request = HttpClientRequest.get('http://api.test/auth/session')
const status = (code: number) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({
      request,
      response: HttpClientResponse.fromWeb(request, new Response(null, { status: code })),
    }),
  })
const unreachable = new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({ request, cause: new Error('ECONNREFUSED') }),
})
const undecodable = new HttpClientError.HttpClientError({
  reason: new HttpClientError.DecodeError({
    request,
    response: HttpClientResponse.fromWeb(request, new Response('{')),
  }),
})

/**
 * A status the contract does not name at all - a proxy's 503 - as the
 * typed client reports it: a response it could not decode
 * (HttpApiClient `statusOrElse`), carrying the status.
 */
const undeclared = (code: number) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.DecodeError({
      request,
      response: HttpClientResponse.fromWeb(request, new Response('busy', { status: code })),
    }),
  })

describe('whether somebody is signed in, as the render passes it on', () => {
  it('is yes on an answer', () => {
    expect(presenceOf(Exit.succeed({ user: {} }))).toBe(true)
  })

  it("is no on the session middleware's own answers", () => {
    expect(presenceOf(Exit.fail(new AuthRequired()))).toBe(false)
    expect(presenceOf(Exit.fail(new SessionExpired()))).toBe(false)
  })

  it('is undecided when the server could not be asked', () => {
    expect(presenceOf(Exit.fail(unreachable))).toBeUndefined()
    expect(presenceOf(Exit.fail(status(502)))).toBeUndefined()
    expect(presenceOf(Exit.fail(status(503)))).toBeUndefined()
    expect(presenceOf(Exit.fail(undeclared(503)))).toBeUndefined()
  })

  it('throws what is a bug rather than calling it undecided', () => {
    expect(() => presenceOf(Exit.fail(undecodable))).toThrow()
    // a status that is the client's to fix, not the server's to recover from
    expect(() => presenceOf(Exit.fail(status(400)))).toThrow()
    // an answer the contract does not describe
    expect(() => presenceOf(Schema.decodeUnknownExit(Schema.String)(1))).toThrow()
    expect(() => presenceOf(Exit.die(new Error('defect')))).toThrow('defect')
  })

  it('ends with a reader who left', () => {
    expect(() => presenceOf(Exit.failCause(Cause.interrupt()))).toThrow()
  })
})

describe('the ways in, as the render passes them on', () => {
  it('passes an answer on', () => {
    expect(methodsOf(Exit.succeed({ methods: [] }))).toEqual({ methods: [] })
  })

  it('leaves them for the page to ask when the server could not be asked', () => {
    expect(methodsOf(Exit.fail(unreachable))).toBeUndefined()
    expect(methodsOf(Exit.fail(status(504)))).toBeUndefined()
    expect(methodsOf(Exit.fail(undeclared(502)))).toBeUndefined()
  })

  it('throws a failure the contract names, and a bug', () => {
    expect(() => methodsOf(Exit.fail(new AuthRequired()))).toThrow()
    expect(() => methodsOf(Exit.fail(undecodable))).toThrow()
  })
})
