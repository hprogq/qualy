import { createHash, randomBytes } from 'node:crypto'
import { Effect, Redacted } from 'effect'
import { AuthOutbound, type OutboundResponse } from '@qualy/auth-contract/outbound'

// The three things this driver asks of GitHub, and nothing more: send the
// person to authorize, trade the code for a token, and ask who the token is
// for. The token is used for that one question and dropped - signing in to
// Qualy with a GitHub account is not Qualy acting on GitHub for anybody.
//
// No scope is requested: the public profile, which is all an account's id and
// login are, needs none. An enterprise server answers at its own address,
// with its api under /api/v3; github.com keeps its api on another host.

export interface GithubEndpoints {
  readonly authorize: string
  readonly token: string
  readonly user: string
}

export const endpointsOf = (enterpriseUrl: string | undefined): GithubEndpoints => {
  if (enterpriseUrl === undefined) {
    return {
      authorize: 'https://github.com/login/oauth/authorize',
      token: 'https://github.com/login/oauth/access_token',
      user: 'https://api.github.com/user',
    }
  }
  const base = enterpriseUrl.replace(/\/+$/, '')
  return {
    authorize: `${base}/login/oauth/authorize`,
    token: `${base}/login/oauth/access_token`,
    user: `${base}/api/v3/user`,
  }
}

/** a PKCE verifier, and the S256 challenge that goes to the authorize page */
export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export const authorizeRedirect = (
  endpoints: GithubEndpoints,
  input: { clientId: string; callback: string; state: string; challenge: string },
): string => {
  const url = new URL(endpoints.authorize)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.callback)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // signing in here is for people the directory already has
  url.searchParams.set('allow_signup', 'false')
  return url.toString()
}

/** who GitHub says the code was for, or why it could not say */
export type GithubAnswer =
  | { readonly kind: 'account'; readonly subject: string; readonly login: string }
  /** GitHub refused the code, or answered in a way that names nobody */
  | { readonly kind: 'rejected'; readonly reason: string }
  /** GitHub could not be asked */
  | { readonly kind: 'unavailable'; readonly reason: string }

const json = (response: OutboundResponse): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(response.body))
  } catch {
    return undefined
  }
}

/** a reason for the log: the rule an outbound refusal names, or the status */
const outboundReason = (error: { readonly _tag: string; readonly reason: string }) =>
  `${error._tag === 'OutboundRefused' ? 'refused' : 'failed'}:${error.reason}`

export const identify = Effect.fn('authGithub.identify')(function* (
  endpoints: GithubEndpoints,
  input: {
    clientId: string
    clientSecret: Redacted.Redacted<string>
    code: string
    verifier: string
    callback: string
  },
) {
  const outbound = yield* AuthOutbound
  const exchanged = yield* outbound
    .fetch({
      url: endpoints.token,
      method: 'POST',
      headers: { accept: 'application/json' },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: Redacted.value(input.clientSecret),
        code: input.code,
        redirect_uri: input.callback,
        code_verifier: input.verifier,
      }),
      maxBytes: 64 * 1024,
    })
    .pipe(Effect.result)
  if (exchanged._tag === 'Failure') {
    return { kind: 'unavailable', reason: outboundReason(exchanged.failure) } satisfies GithubAnswer
  }
  if (exchanged.success.status !== 200) {
    return {
      kind: 'unavailable',
      reason: `token-status:${exchanged.success.status}`,
    } satisfies GithubAnswer
  }
  const granted = json(exchanged.success) as { access_token?: unknown; error?: unknown } | undefined
  if (typeof granted?.access_token !== 'string' || granted.access_token === '') {
    return {
      kind: 'rejected',
      reason: typeof granted?.error === 'string' ? granted.error : 'no-token',
    } satisfies GithubAnswer
  }
  // held for the next request only, and never anywhere else
  const token = Redacted.make(granted.access_token)
  const asked = yield* outbound
    .fetch({
      url: endpoints.user,
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${Redacted.value(token)}`,
        'user-agent': 'Qualy',
        'x-github-api-version': '2022-11-28',
      },
      maxBytes: 256 * 1024,
    })
    .pipe(Effect.result)
  if (asked._tag === 'Failure') {
    return { kind: 'unavailable', reason: outboundReason(asked.failure) } satisfies GithubAnswer
  }
  if (asked.success.status !== 200) {
    return { kind: 'unavailable', reason: `user-status:${asked.success.status}` } satisfies GithubAnswer
  }
  const user = json(asked.success) as { id?: unknown; login?: unknown } | undefined
  // the id is the account; the login can be changed by its owner any day
  if (typeof user?.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) {
    return { kind: 'rejected', reason: 'no-id' } satisfies GithubAnswer
  }
  return {
    kind: 'account',
    subject: String(user.id),
    login: typeof user.login === 'string' ? user.login.slice(0, 255) : String(user.id),
  } satisfies GithubAnswer
})
