import { createHash, webcrypto } from 'node:crypto'
import { createServer as createPlainServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import { Effect, Exit, Layer, Redacted, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { requestContext } from '@qualy/api-kit/request'
import { Api } from '@qualy/api-kit/plugin'
import { AuthOutbound } from '@qualy/auth-contract/outbound'
import { loginDriversLayer, registerLoginDriver } from '@qualy/auth-contract/login'
import { sessionCookieName } from '@qualy/auth-contract/session'
import { apiHandlers as oidcApiHandlers, driver as oidcDriver } from '@qualy/plugin-auth-oidc'
import { authOidcApiGroup } from '@qualy/plugin-auth-oidc/api'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import { sessionApiGroup } from '../src/api.ts'
import { hashSessionToken } from '../src/session.ts'
import { sessionApiHandlers } from '../src/server/index.ts'
import { makeOutbound } from '../src/server/outbound.ts'
import { entranceSecrets } from '../src/server/readiness.ts'
import { AuthConfig, layer as signInLayer } from '../src/server/sign-in.ts'
import { layer as sessionLayer, viewerLayer } from '../src/server/session.ts'
import { singleTenantLayer } from '../src/server/tenancy.ts'
import { singleOriginLayer } from '../src/server/public-origin.ts'
import { authClosure } from './support/closure.ts'
import { authAuditLayer } from './support/audit.ts'
import { unusedEmailFlows } from './support/email-flows.ts'

// An OpenID Connect sign-in, all the way through, against a provider that
// lives in this file.
//
// The provider publishes its metadata and its key, issues a code for one
// redirect, one challenge and one nonce, trades it once for a token and an ID
// Token it signs itself, and answers UserInfo. What the relying party must
// check about that ID Token - issuer, audience, nonce, time, signature - is
// what the cases below break one at a time. Every account is made up.

const port = 3222
const origin = `http://127.0.0.1:${port}`
const base = `${origin}${QUALY_API_PREFIX}`

const api = Api.local(sessionApiGroup, authOidcApiGroup)

type Claims = Record<string, unknown>

interface Grant {
  readonly redirectUri: string
  readonly challenge: string
  readonly nonce: string
  readonly claims: Claims
}

const b64url = (value: string | Uint8Array) => Buffer.from(value).toString('base64url')

const op = {
  server: undefined as Server | undefined,
  url: '',
  keys: undefined as webcrypto.CryptoKeyPair | undefined,
  /** a key the provider never published, for a token somebody else signed */
  stranger: undefined as webcrypto.CryptoKeyPair | undefined,
  jwk: {} as Record<string, unknown>,
  codes: new Map<string, Grant>(),
  tokens: new Map<string, string>(),
  seen: [] as string[],
  userinfo: 'normal' as 'normal' | 'down',
  token: 'normal' as 'normal' | 'down',
  next: 1,
  async sign(claims: Claims) {
    const { forged, ...rest } = claims
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }))
    const payload = b64url(JSON.stringify(rest))
    const signature = await webcrypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      forged === true ? op.stranger!.privateKey : op.keys!.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    )
    return `${header}.${payload}.${b64url(new Uint8Array(signature))}`
  },
  /**
   * What the person's browser brings back from the authorize page: a code
   * for this departure, and claims the ID Token will carry - the defaults
   * being what an honest provider would say, a case overriding what it breaks.
   */
  authorize(away: URL, claims: Claims, extra: { code?: string; sessionState?: string } = {}) {
    const code = extra.code ?? `code-${op.next++}`
    op.codes.set(code, {
      redirectUri: away.searchParams.get('redirect_uri')!,
      challenge: away.searchParams.get('code_challenge')!,
      nonce: away.searchParams.get('nonce')!,
      claims,
    })
    const back = new URL(away.searchParams.get('redirect_uri')!)
    back.searchParams.set('code', code)
    back.searchParams.set('state', away.searchParams.get('state')!)
    if (extra.sessionState !== undefined) back.searchParams.set('session_state', extra.sessionState)
    return back.toString()
  },
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const answer = async (
  method: string,
  url: URL,
  headers: Record<string, unknown>,
  body: string,
  response: ServerResponse,
) => {
  op.seen.push(`${method} ${url.pathname}`)
  if (url.pathname === '/.well-known/openid-configuration') {
    return json(response, 200, {
      issuer: op.url,
      authorization_endpoint: `${op.url}/authorize`,
      token_endpoint: `${op.url}/token`,
      jwks_uri: `${op.url}/jwks`,
      userinfo_endpoint: `${op.url}/userinfo`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    })
  }
  if (url.pathname === '/jwks') return json(response, 200, { keys: [op.jwk] })
  if (url.pathname === '/token') {
    if (op.token === 'down') return json(response, 503, {})
    const form = new URLSearchParams(body)
    const grant = op.codes.get(form.get('code') ?? '')
    op.codes.delete(form.get('code') ?? '')
    const basic = typeof headers['authorization'] === 'string' ? headers['authorization'] : ''
    const [basicId, basicSecret] = basic.startsWith('Basic ')
      ? Buffer.from(basic.slice(6), 'base64').toString().split(':').map(decodeURIComponent)
      : [form.get('client_id'), form.get('client_secret')]
    const verifier = form.get('code_verifier') ?? ''
    if (
      grant === undefined ||
      basicId !== 'client-1' ||
      basicSecret !== 'op-secret' ||
      form.get('redirect_uri') !== grant.redirectUri ||
      createHash('sha256').update(verifier).digest('base64url') !== grant.challenge
    ) {
      return json(response, 400, { error: 'invalid_grant' })
    }
    const now = Math.floor(Date.now() / 1000)
    const accessToken = `at-${op.next++}`
    const idToken = await op.sign({
      iss: op.url,
      aud: 'client-1',
      iat: now,
      exp: now + 300,
      nonce: grant.nonce,
      ...grant.claims,
    })
    op.tokens.set(accessToken, String(grant.claims['sub'] ?? ''))
    return json(response, 200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 300,
      id_token: idToken,
    })
  }
  if (url.pathname === '/userinfo') {
    if (op.userinfo === 'down') return json(response, 500, {})
    const token = String(headers['authorization'] ?? '').replace(/^Bearer /, '')
    const sub = op.tokens.get(token)
    if (sub === undefined) return json(response, 401, {})
    return json(response, 200, { sub, preferred_username: `${sub}.from-userinfo` })
  }
  json(response, 404, {})
}

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
let ada: string
let providerId: string

const probeInfra = () => databaseFor(db.url, { migrations: 'off', entities: authClosure })
const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

beforeAll(async () => {
  if (!postgresAvailable) return
  op.keys = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  op.stranger = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  op.jwk = {
    ...(await webcrypto.subtle.exportKey('jwk', op.keys.publicKey)),
    kid: 'k1',
    alg: 'RS256',
    use: 'sig',
  }
  op.server = createPlainServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => {
      void answer(
        request.method ?? 'GET',
        new URL(request.url ?? '/', 'http://op.invalid'),
        request.headers,
        body,
        response,
      )
    })
  })
  await new Promise<void>((done) => op.server!.listen(0, '127.0.0.1', done))
  op.url = `http://127.0.0.1:${(op.server.address() as AddressInfo).port}`

  db = await createTestContext('effect-oidc')
  const infra = databaseFor(db.url, { entities: authClosure })
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({
      defaultTenantSlug: 'default',
      sessionTtlSeconds: 3600,
      secureCookies: false,
      sessionCookieName,
      publicUrl: origin,
    }),
  )
  const signIn = signInLayer.pipe(
    Layer.provide(captchaLayer),
    Layer.provide(secretsLayer),
    Layer.provide(Layer.mergeAll(singleTenantLayer, singleOriginLayer)),
    Layer.provide(authAuditLayer),
    Layer.provide(
      Layer.mergeAll(
        infra,
        authConfig,
        registerLoginDriver(oidcDriver, '@qualy/plugin-auth-oidc').pipe(
          Layer.provideMerge(loginDriversLayer),
        ),
      ),
    ),
  )
  const outbound = Layer.succeed(
    AuthOutbound,
    makeOutbound({ requireHttps: false, allowLoopback: true, privateAllowlist: [] }),
  )
  const middleware = Layer.mergeAll(sessionLayer, viewerLayer).pipe(
    Layer.provide(Layer.mergeAll(infra, authConfig)),
  )
  const handlers = Layer.mergeAll(sessionApiHandlers, oidcApiHandlers).pipe(
    Layer.provide(middleware),
  )
  const application = HttpRouter.serve(HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)), {
    middleware: requestContext(),
  }).pipe(
    Layer.provide(signIn),
    Layer.provide(unusedEmailFlows),
    Layer.provide(outbound),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(infra),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))

  const seeded = await Effect.runPromise(
    Effect.gen(function* () {
      const tenant = one<{ id: string }>(
        yield* runSql(
          sql`insert into tenants (slug, name) values ('default','Default') returning id`,
        ),
      ).id
      const orgType = one<{ id: string }>(
        yield* runSql(
          sql`insert into org_types (tenant_id, name) values (${tenant}, 'U') returning id`,
        ),
      ).id
      const node = one<{ id: string }>(
        yield* runSql(sql`
          insert into org_nodes (tenant_id, org_type_id, name, path, depth)
          values (${tenant}, ${orgType}, 'Root', 'r', 0) returning id`),
      ).id
      const type = one<{ id: string }>(
        yield* runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode)
          values (${tenant}, 'staff', 'Staff', 'unrestricted') returning id`),
      ).id
      const adaId = one<{ id: string }>(
        yield* runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
          values (${tenant}, 'Ada', ${type}, ${node}, 'ada@school.edu') returning id`),
      ).id
      const secrets = yield* Secrets
      const door = (code: string, config: Record<string, unknown>) =>
        Effect.gen(function* () {
          const id = one<{ id: string }>(
            yield* runSql(sql`
              insert into auth_providers (tenant_id, code, type, name, enabled, sort_order, config)
              values (${tenant}, ${code}, 'oidc', ${code}, true, 1, ${JSON.stringify(config)}::jsonb)
              returning id`),
          ).id
          yield* secrets.put(
            { ...entranceSecrets(tenant, id), key: 'clientSecret' },
            Redacted.make('op-secret'),
          )
          return id
        })
      const discovered = yield* door('op', { issuer: op.url, clientId: 'client-1' })
      yield* door('op-manual', {
        issuer: op.url,
        clientId: 'client-1',
        discoveryMode: 'manual',
        authorizationEndpoint: `${op.url}/authorize`,
        tokenEndpoint: `${op.url}/token`,
        jwksUri: `${op.url}/jwks`,
        tokenAuthMethod: 'basic',
      })
      yield* door('op-metadata', { issuer: 'http://169.254.169.254', clientId: 'client-1' })
      return { adaId, discovered }
    }).pipe(Effect.provide(secretsLayer.pipe(Layer.provideMerge(probeInfra())))),
  )
  ada = seeded.adaId
  providerId = seeded.discovered
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  op.server?.closeAllConnections()
  await new Promise<void>((done) => op.server?.close(() => done()))
  await db.dispose()
})

beforeEach(async () => {
  if (!postgresAvailable) return
  op.userinfo = 'normal'
  op.token = 'normal'
  op.seen.length = 0
  await Effect.runPromise(
    runSql(sql`delete from auth_rate_limit_buckets`).pipe(Effect.provide(probeInfra())),
  )
})

let sessions = 0
const signedIn = async (userId: string) => {
  const token = `test-session-${++sessions}`
  await Effect.runPromise(
    runSql(sql`
      insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
      select tenant_id, id, ${providerId}, ${hashSessionToken(token)}, now() + interval '1 day'
        from users where id = ${userId}`).pipe(Effect.provide(probeInfra())),
  )
  return `${sessionCookieName}=${token}`
}

const visit = (url: string, cookie?: string) =>
  fetch(url, { redirect: 'manual', ...(cookie === undefined ? {} : { headers: { cookie } }) })

const depart = async (code = 'op', query = '', cookie?: string) => {
  const response = await visit(`${base}/auth/oidc/${code}/start${query}`, cookie)
  return { response, away: new URL(response.headers.get('location') ?? '', origin) }
}

const landing = (response: Response) => {
  const location = new URL(response.headers.get('location') ?? '', origin)
  return { path: location.pathname, code: location.searchParams.get('error') }
}

const labelOf = () =>
  Effect.runPromise(
    runSql<{ display_label: string | null }>(sql`
      select display_label from user_auth_bindings
       where user_id = ${ada} and auth_provider_id = ${providerId} and revoked_at is null`).pipe(
      Effect.map((result) => result.rows[0]?.display_label),
      Effect.provide(probeInfra()),
    ),
  )

const now = () => Math.floor(Date.now() / 1000)

describe.runIf(postgresAvailable)('an OpenID Connect account', () => {
  it('goes to the provider with PKCE and a nonce, and signs in nobody it does not know', async () => {
    const { response, away } = await depart()
    expect(response.status).toBe(302)
    expect(away.origin + away.pathname).toBe(`${op.url}/authorize`)
    expect(away.searchParams.get('scope')).toBe('openid profile email')
    expect(away.searchParams.get('code_challenge_method')).toBe('S256')
    expect(away.searchParams.get('nonce')).not.toBeNull()
    expect(away.searchParams.get('redirect_uri')).toBe(`${base}/auth/oidc/op/callback`)
    const back = await visit(op.authorize(away, { sub: 'sub-ada', preferred_username: 'ada.l' }))
    expect(landing(back)).toEqual({ path: '/login', code: 'AUTH_EXTERNAL_ACCOUNT_UNBOUND' })
    // discovery and keys went through the port like everything else
    expect(op.seen).toEqual(
      expect.arrayContaining(['GET /.well-known/openid-configuration', 'POST /token', 'GET /jwks']),
    )
  })

  it('is bound by whoever began the bind, and signs them in by its sub', async () => {
    const cookie = await signedIn(ada)
    const bind = await depart(
      'op',
      `?intent=bind&returnTo=${encodeURIComponent('/account/logins')}`,
      cookie,
    )
    const bound = await visit(
      op.authorize(bind.away, { sub: 'sub-ada', preferred_username: 'ada.l' }),
    )
    expect(bound.status).toBe(303)
    expect(bound.headers.get('location')).toBe('/account/logins')
    expect(await labelOf()).toBe('ada.l')

    const login = await depart('op', '?returnTo=%2Fassessment')
    // the same sub under a new username: the account is the sub
    const back = await visit(
      op.authorize(login.away, { sub: 'sub-ada', preferred_username: 'ada.renamed' }),
    )
    expect(back.status).toBe(303)
    expect(back.headers.get('location')).toBe('/assessment')
    expect(back.headers.get('set-cookie')).toContain(`${sessionCookieName}=`)
    expect(await labelOf()).toBe('ada.renamed')
  })

  it('refuses an ID Token that is for another client, from another issuer, for another nonce, long expired, or signed by anybody else', async () => {
    for (const claims of [
      { sub: 'sub-ada', forged: true },
      { sub: 'sub-ada', aud: 'someone-else' },
      { sub: 'sub-ada', iss: 'http://elsewhere.example' },
      { sub: 'sub-ada', nonce: 'not-the-nonce' },
      { sub: 'sub-ada', iat: now() - 3600, exp: now() - 600 },
    ]) {
      const { away } = await depart()
      const back = await visit(op.authorize(away, claims))
      expect(landing(back).code, JSON.stringify(claims)).toBe('AUTH_OIDC_REJECTED')
    }
  })

  it('tolerates a clock a little behind, and takes a name from UserInfo when the token has none', async () => {
    // expired half a minute ago: inside the entrance's sixty seconds
    const late = await depart()
    const accepted = await visit(
      op.authorize(late.away, { sub: 'sub-ada', iat: now() - 400, exp: now() - 30 }),
    )
    expect(accepted.status).toBe(303)
    expect(accepted.headers.get('location')).toBe('/')
    expect(await labelOf()).toBe('sub-ada.from-userinfo')

    // and UserInfo failing costs the name, not the sign-in
    op.userinfo = 'down'
    const quiet = await depart()
    const still = await visit(op.authorize(quiet.away, { sub: 'sub-ada' }))
    expect(still.status).toBe(303)
    expect(still.headers.get('location')).toBe('/')
    expect(await labelOf()).toBe('sub-ada.from-userinfo')
  })

  it('works from endpoints entered by hand, with the client authenticating by Basic', async () => {
    const { away } = await depart('op-manual')
    expect(away.origin + away.pathname).toBe(`${op.url}/authorize`)
    const back = await visit(op.authorize(away, { sub: 'sub-somebody' }))
    // the whole grant went through; nobody bound that account here
    expect(landing(back).code).toBe('AUTH_EXTERNAL_ACCOUNT_UNBOUND')
    expect(op.seen).not.toContain('GET /.well-known/openid-configuration')
  })

  it('never reaches a provider on an address no entrance may reach, and says a failing one is away', async () => {
    const { response } = await depart('op-metadata')
    expect(landing(response).code).toBe('AUTH_OIDC_UNAVAILABLE')
    expect(op.seen).toEqual([])

    op.token = 'down'
    const { away } = await depart()
    expect(landing(await visit(op.authorize(away, { sub: 'sub-ada' }))).code).toBe(
      'AUTH_OIDC_UNAVAILABLE',
    )
    const forged = await visit(`${base}/auth/oidc/op/callback?code=x&state=nobody`)
    expect(landing(forged).code).toBe('AUTH_FLOW_REJECTED')
  })

  it('takes a code as long as the provider makes it, and sends anything it cannot use back to sign in', async () => {
    // Microsoft's codes run to thousands of characters, with a session marker beside them
    const { away } = await depart()
    const long = await visit(
      op.authorize(
        away,
        { sub: 'sub-somebody' },
        {
          code: `c${'x'.repeat(4000)}`,
          sessionState: '008cde9a-2e51-bdf4-ad65-bb981e0872cb',
        },
      ),
    )
    // through the whole exchange: nobody bound that account here
    expect(long.status).toBe(303)
    expect(landing(long)).toEqual({ path: '/login', code: 'AUTH_EXTERNAL_ACCOUNT_UNBOUND' })
    // a state that is no state of ours, however long, is a refused flow and not a page of JSON
    const odd = await visit(`${base}/auth/oidc/op/callback?code=x&state=${'s'.repeat(5000)}`)
    expect(odd.status).toBe(303)
    expect(landing(odd)).toEqual({ path: '/login', code: 'AUTH_FLOW_REJECTED' })
  })
})
