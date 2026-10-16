import { createHash } from 'node:crypto'
import { Effect, Redacted } from 'effect'
import {
  AuthOutbound,
  OutboundFailed,
  OutboundRefused,
  type OutboundRequest,
  type OutboundResponse,
} from '@qualy/auth-contract/outbound'
import { describe, expect, it } from 'vitest'
import { authorizeRedirect, endpointsOf, identify, pkce } from '../src/oauth.ts'

// The parts of the flow that are arithmetic rather than conversation: where
// GitHub answers, what the challenge is, and what the authorize page is told.

describe('the GitHub flow', () => {
  it('knows where github.com answers, and where an enterprise server does', () => {
    expect(endpointsOf(undefined)).toEqual({
      authorize: 'https://github.com/login/oauth/authorize',
      token: 'https://github.com/login/oauth/access_token',
      user: 'https://api.github.com/user',
    })
    expect(endpointsOf('https://git.school.edu/')).toEqual({
      authorize: 'https://git.school.edu/login/oauth/authorize',
      token: 'https://git.school.edu/login/oauth/access_token',
      user: 'https://git.school.edu/api/v3/user',
    })
  })

  it('makes a fresh S256 challenge from a fresh verifier every time', () => {
    const first = pkce()
    const second = pkce()
    expect(first.verifier).not.toBe(second.verifier)
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.challenge).toBe(createHash('sha256').update(first.verifier).digest('base64url'))
  })

  it('asks for no scope and offers no sign-up', () => {
    const away = new URL(
      authorizeRedirect(endpointsOf(undefined), {
        clientId: 'client-1',
        callback: 'https://qualy.example.edu/api/auth/github/hub/callback',
        state: 'st4te',
        challenge: 'ch4llenge',
      }),
    )
    expect(Object.fromEntries(away.searchParams)).toEqual({
      client_id: 'client-1',
      redirect_uri: 'https://qualy.example.edu/api/auth/github/hub/callback',
      state: 'st4te',
      code_challenge: 'ch4llenge',
      code_challenge_method: 'S256',
      allow_signup: 'false',
    })
  })
})

const response = (body: unknown, status = 200): OutboundResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: new TextEncoder().encode(JSON.stringify(body)),
})

/** No network or database: the driver receives exactly the scripted outbound answers. */
const identifyWith = async (
  ...answers: (OutboundResponse | OutboundFailed | OutboundRefused)[]
) => {
  const requests: OutboundRequest[] = []
  const outbound = AuthOutbound.of({
    fetch: (request) => {
      const answer = answers[requests.length]
      requests.push(request)
      if (answer === undefined) throw new Error('unexpected outbound request')
      return answer instanceof OutboundFailed || answer instanceof OutboundRefused
        ? Effect.fail(answer)
        : Effect.succeed(answer)
    },
    asFetch: async () => {
      throw new Error('the GitHub driver must use the Effect outbound port')
    },
  })
  const answer = await Effect.runPromise(
    identify(endpointsOf(undefined), {
      clientId: 'client-1',
      clientSecret: Redacted.make('client-secret-for-test'),
      code: 'authorization-code-for-test',
      verifier: 'pkce-verifier-for-test',
      callback: 'https://qualy.example.edu/api/auth/github/hub/callback',
    }).pipe(Effect.provideService(AuthOutbound, outbound)),
  )
  return { answer, requests }
}

describe('GitHub identification diagnostics', () => {
  it.each(['token', 'user'] as const)(
    'names the %s stage when the network times out',
    async (stage) => {
      const failed = new OutboundFailed({ reason: 'timeout' })
      const { answer, requests } = await identifyWith(
        ...(stage === 'user' ? [response({ access_token: 'access-token-for-test' })] : []),
        failed,
      )
      expect(answer).toEqual({ kind: 'unavailable', stage, reason: 'failed:timeout' })
      expect(requests).toHaveLength(stage === 'token' ? 1 : 2)
    },
  )

  it.each(['token', 'user'] as const)(
    'names the %s stage when outbound policy refuses it',
    async (stage) => {
      const { answer } = await identifyWith(
        ...(stage === 'user' ? [response({ access_token: 'access-token-for-test' })] : []),
        new OutboundRefused({ reason: 'unresolvable' }),
      )
      expect(answer).toEqual({ kind: 'unavailable', stage, reason: 'refused:unresolvable' })
    },
  )

  it.each([
    { stage: 'token', status: 503 },
    { stage: 'user', status: 401 },
  ] as const)(
    'keeps $stage HTTP $status separate from a network failure',
    async ({ stage, status }) => {
      const { answer } = await identifyWith(
        ...(stage === 'user' ? [response({ access_token: 'access-token-for-test' })] : []),
        response({ message: 'sensitive upstream detail' }, status),
      )
      expect(answer).toEqual({ kind: 'unavailable', stage, reason: `${stage}-status:${status}` })
    },
  )

  it.each([
    'incorrect_client_credentials',
    'redirect_uri_mismatch',
    'bad_verification_code',
    'unverified_user_email',
  ])('keeps the documented token error %s without upstream descriptions', async (error) => {
    const { answer, requests } = await identifyWith(
      response({ error, error_description: 'client_secret=do-not-log' }),
    )
    expect(answer).toEqual({ kind: 'rejected', stage: 'token', reason: error })
    expect(requests).toHaveLength(1)
  })

  it.each([
    'client_secret=client-secret-for-test&code=authorization-code-for-test',
    'bad_verification_code\naccess_token=access-token-for-test',
    { access_token: 'access-token-for-test' },
    null,
  ])('does not copy an untrusted token error into the failure answer (%j)', async (error) => {
    const { answer } = await identifyWith(response({ error }))
    expect(answer).toEqual({ kind: 'rejected', stage: 'token', reason: 'unknown-token-error' })
    for (const secret of [
      'client-secret-for-test',
      'authorization-code-for-test',
      'access-token-for-test',
    ]) {
      expect(JSON.stringify(answer)).not.toContain(secret)
    }
  })

  it('names the token stage when no token or error was provided', async () => {
    const { answer } = await identifyWith(response({}))
    expect(answer).toEqual({ kind: 'rejected', stage: 'token', reason: 'no-token' })
  })

  it('names the user stage when a successful response does not identify an account', async () => {
    const { answer } = await identifyWith(
      response({ access_token: 'access-token-for-test' }),
      response({ id: '123', error: 'access_token=do-not-log' }),
    )
    expect(answer).toEqual({ kind: 'rejected', stage: 'user', reason: 'no-id' })
  })

  it('still returns only the public account identity on success', async () => {
    const { answer, requests } = await identifyWith(
      response({ access_token: 'access-token-for-test' }),
      response({ id: 123, login: 'octocat' }),
    )
    expect(answer).toEqual({ kind: 'account', subject: '123', login: 'octocat' })
    expect(requests.map(({ method }) => method)).toEqual(['POST', 'GET'])
  })
})
