import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authorizeRedirect, endpointsOf, pkce } from '../src/oauth.ts'

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
