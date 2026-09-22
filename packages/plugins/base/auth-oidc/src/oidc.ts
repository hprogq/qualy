import * as client from 'openid-client'
import type { Context } from 'effect'
import type { AuthOutbound } from '@qualy/auth-contract/outbound'

// What this driver asks of the openid-client library, and what it keeps out
// of it.
//
// The library does the protocol: discovery, the authorization code grant
// with PKCE, and every check an ID Token has to pass - its signature against
// the provider's keys, the issuer, the audience, the nonce, its times. What
// it may not do is reach the network on its own: every request it makes,
// discovery and keys included, goes through the auth outbound port, handed
// in as its fetch. The subject is the ID Token's `sub` and nothing else; an
// email or a username can change hands, `sub` cannot.

type Outbound = Context.Service.Shape<typeof AuthOutbound>

export interface OidcSettings {
  readonly issuer: string
  readonly clientId: string
  readonly scope: string
  readonly tokenAuth: 'auto' | 'basic' | 'post'
  readonly clockSkewSeconds: number
  /** endpoints named by hand, for a provider without discovery */
  readonly manual?: {
    readonly authorizationEndpoint: string
    readonly tokenEndpoint: string
    readonly jwksUri: string
    readonly userinfoEndpoint?: string
  }
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/** the scopes asked for: what was typed, with `openid` always among them */
export const scopeOf = (typed: string | undefined) => {
  const scopes = (typed ?? 'openid profile email').split(/\s+/).filter((one) => one !== '')
  return [...new Set(['openid', ...scopes])].join(' ')
}

/** the settings an entrance runs with, or undefined while any is missing */
export const settingsOf = (config: Readonly<Record<string, unknown>>): OidcSettings | undefined => {
  const issuer = text(config['issuer'])
  const clientId = text(config['clientId'])
  if (issuer === undefined || clientId === undefined) return undefined
  const auth = config['tokenAuthMethod']
  const skew = config['clockSkewSeconds']
  const settings = {
    issuer,
    clientId,
    scope: scopeOf(text(config['scopes'])),
    tokenAuth: auth === 'basic' || auth === 'post' ? auth : 'auto',
    clockSkewSeconds: typeof skew === 'number' && Number.isFinite(skew) ? skew : 60,
  } as const
  if (config['discoveryMode'] !== 'manual') return settings
  const authorizationEndpoint = text(config['authorizationEndpoint'])
  const tokenEndpoint = text(config['tokenEndpoint'])
  const jwksUri = text(config['jwksUri'])
  if (authorizationEndpoint === undefined || tokenEndpoint === undefined || jwksUri === undefined) {
    return undefined
  }
  const userinfoEndpoint = text(config['userinfoEndpoint'])
  return {
    ...settings,
    manual: {
      authorizationEndpoint,
      tokenEndpoint,
      jwksUri,
      ...(userinfoEndpoint === undefined ? {} : { userinfoEndpoint }),
    },
  }
}

/** the outbound port in the shape the library takes a fetch in */
const fetchThrough =
  (outbound: Outbound): client.CustomFetch =>
  (url, options) =>
    outbound.asFetch(url, {
      method: options.method,
      headers: options.headers,
      ...(options.body === undefined || options.body === null
        ? {}
        : { body: options.body as RequestInit['body'] }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

const authOf = (settings: OidcSettings, secret: string) =>
  settings.tokenAuth === 'basic'
    ? client.ClientSecretBasic(secret)
    : settings.tokenAuth === 'post'
      ? client.ClientSecretPost(secret)
      : undefined

/**
 * One entrance's configuration, discovered or written out by hand.
 *
 * The ID Token's signature is checked against the provider's published keys
 * even though it arrives straight from the token endpoint, where the
 * protocol would let the connection vouch for it instead: the connection is
 * one this deployment's policy may allow over plain http on a development
 * machine, and a signature is a check that does not depend on how it came.
 *
 * A provider at an http address is reachable only where the outbound policy
 * lets plain http through - a development machine's own test provider - so
 * the library's own https rule is lifted for it and the policy decides.
 */
const configure = async (
  settings: OidcSettings,
  secret: string,
  outbound: Outbound,
): Promise<client.Configuration> => {
  const fetch = fetchThrough(outbound)
  const insecure = new URL(settings.issuer).protocol === 'http:'
  const auth = authOf(settings, secret)
  const metadata: Partial<client.ClientMetadata> = {
    client_secret: secret,
    [client.clockTolerance]: settings.clockSkewSeconds,
  }
  let config: client.Configuration
  if (settings.manual === undefined) {
    config = await client.discovery(new URL(settings.issuer), settings.clientId, metadata, auth, {
      [client.customFetch]: fetch,
      execute: [
        client.enableNonRepudiationChecks,
        ...(insecure ? [client.allowInsecureRequests] : []),
      ],
    })
  } else {
    config = new client.Configuration(
      {
        issuer: settings.issuer,
        authorization_endpoint: settings.manual.authorizationEndpoint,
        token_endpoint: settings.manual.tokenEndpoint,
        jwks_uri: settings.manual.jwksUri,
        ...(settings.manual.userinfoEndpoint === undefined
          ? {}
          : { userinfo_endpoint: settings.manual.userinfoEndpoint }),
      },
      settings.clientId,
      metadata,
      auth,
    )
    config[client.customFetch] = fetch
    client.enableNonRepudiationChecks(config)
    if (insecure) client.allowInsecureRequests(config)
  }
  return config
}

/**
 * Configurations by entrance and version.
 *
 * Discovery is a request per sign-in otherwise. A saved change bumps the
 * entrance's version, so a changed issuer or secret is simply another key;
 * a failed discovery is not kept. Bounded, so a long-running process with
 * many entrances does not grow without end.
 */
const configurations = new Map<string, Promise<client.Configuration>>()
const KEPT = 64

export const configurationFor = (
  key: string,
  settings: OidcSettings,
  secret: string,
  outbound: Outbound,
): Promise<client.Configuration> => {
  const known = configurations.get(key)
  if (known !== undefined) return known
  const made = configure(settings, secret, outbound)
  configurations.set(key, made)
  made.catch(() => configurations.delete(key))
  while (configurations.size > KEPT) {
    configurations.delete(configurations.keys().next().value!)
  }
  return made
}

/**
 * Whether a failure means the provider could not be asked: the outbound
 * port refused or failed, or the provider answered with a server error -
 * found anywhere among the causes the library wraps it in.
 */
const fromNetwork = (error: unknown): string | undefined => {
  let current: unknown = error
  for (let depth = 0; depth < 8 && current !== null && typeof current === 'object'; depth += 1) {
    const tag = (current as { _tag?: unknown })._tag
    if (tag === 'OutboundRefused' || tag === 'OutboundFailed') {
      return `${tag}:${String((current as { reason?: unknown }).reason)}`
    }
    const status = (current as { status?: unknown }).status
    if (typeof status === 'number' && status >= 500) return `status:${status}`
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

export type OidcAnswer =
  | { readonly kind: 'account'; readonly subject: string; readonly label: string | undefined }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }

export type OidcFailure = Exclude<OidcAnswer, { readonly kind: 'account' }>

/** a failure, sorted into whether the provider refused or could not be asked */
export const sortFailure = (error: unknown): OidcFailure => {
  const network = fromNetwork(error)
  if (network !== undefined) return { kind: 'unavailable', reason: network }
  const name = (error as { name?: unknown } | null)?.name
  const code = (error as { code?: unknown } | null)?.code
  return {
    kind: 'rejected',
    reason: `${typeof name === 'string' ? name : 'error'}:${typeof code === 'string' ? code : ''}`,
  }
}

const labelOf = (claims: Readonly<Record<string, unknown>>) => {
  for (const key of ['preferred_username', 'name', 'email']) {
    const value = claims[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, 255)
  }
  return undefined
}

/**
 * The account a callback names: the code traded with the verifier, the ID
 * Token checked against the state and nonce this flow began with, its `sub`
 * taken as the subject. A name for it comes from the ID Token, or failing
 * that from UserInfo - whose failure costs the name, never the sign-in, and
 * whose answer for a different `sub` is not used at all.
 */
export const identify = async (
  config: client.Configuration,
  currentUrl: URL,
  checks: { readonly verifier: string; readonly state: string; readonly nonce: string },
): Promise<OidcAnswer> => {
  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>
  try {
    tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: checks.verifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    })
  } catch (error) {
    return sortFailure(error)
  }
  const claims = tokens.claims()
  const subject = claims?.sub
  if (typeof subject !== 'string' || subject === '') return { kind: 'rejected', reason: 'no-sub' }
  let label = labelOf(claims as Record<string, unknown>)
  if (label === undefined && config.serverMetadata().userinfo_endpoint !== undefined) {
    try {
      const info = await client.fetchUserInfo(config, tokens.access_token, subject)
      label = labelOf(info as Record<string, unknown>)
    } catch {
      // a name is a courtesy; the sign-in stands on the ID Token
    }
  }
  return { kind: 'account', subject, label }
}

/** what a departure carries: a PKCE verifier and its challenge, and a nonce */
export const beginning = async () => {
  const verifier = client.randomPKCECodeVerifier()
  return {
    verifier,
    challenge: await client.calculatePKCECodeChallenge(verifier),
    nonce: client.randomNonce(),
  }
}

export const authorizeRedirect = (
  config: client.Configuration,
  input: {
    callback: string
    scope: string
    state: string
    challenge: string
    nonce: string
  },
): string =>
  client
    .buildAuthorizationUrl(config, {
      redirect_uri: input.callback,
      scope: input.scope,
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.challenge,
      code_challenge_method: 'S256',
    })
    .toString()
