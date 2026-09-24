import { createHash } from 'node:crypto'
import { createServer as createPlainServer, type Server } from 'node:http'
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
import { apiHandlers as githubApiHandlers, driver as githubDriver } from '@qualy/plugin-auth-github'
import { authGithubApiGroup } from '@qualy/plugin-auth-github/api'
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

// Signing in with a GitHub account and binding one, all the way through,
// against a GitHub that lives in this file.
//
// The fake does what GitHub does for this flow and checks what GitHub
// checks: a code is issued for one redirect address and one PKCE challenge,
// traded once, and only by the verifier whose digest is that challenge; the
// token it hands back answers one question, who it belongs to. Every account
// is made up.

const port = 3221
const origin = `http://127.0.0.1:${port}`
const base = `${origin}${QUALY_API_PREFIX}`

const api = Api.local(sessionApiGroup, authGithubApiGroup)

interface Grant {
  readonly redirectUri: string
  readonly challenge: string
  readonly account: { id: number; login: string }
}

const github = {
  server: undefined as Server | undefined,
  url: '',
  codes: new Map<string, Grant>(),
  tokens: new Map<string, { id: number; login: string }>(),
  seen: [] as string[],
  mode: 'normal' as 'normal' | 'token-down' | 'user-down',
  next: 1,
  /** what the person's browser would bring back from the authorize page */
  authorize(away: URL, account: { id: number; login: string }) {
    const code = `code-${github.next++}`
    github.codes.set(code, {
      redirectUri: away.searchParams.get('redirect_uri')!,
      challenge: away.searchParams.get('code_challenge')!,
      account,
    })
    const back = new URL(away.searchParams.get('redirect_uri')!)
    back.searchParams.set('code', code)
    back.searchParams.set('state', away.searchParams.get('state')!)
    return back.toString()
  },
}

const reply = (response: import('node:http').ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
let providerId: string
let ada: string
let lin: string

const probeInfra = () => databaseFor(db.url, { migrations: 'off', entities: authClosure })
const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

beforeAll(async () => {
  if (!postgresAvailable) return
  github.server = createPlainServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://github.invalid')
      github.seen.push(`${request.method} ${url.pathname}`)
      if (url.pathname === '/login/oauth/access_token') {
        if (github.mode === 'token-down') return reply(response, 500, {})
        const form = new URLSearchParams(body)
        const grant = github.codes.get(form.get('code') ?? '')
        github.codes.delete(form.get('code') ?? '')
        const verifier = form.get('code_verifier') ?? ''
        const digest = createHash('sha256').update(verifier).digest('base64url')
        if (
          grant === undefined ||
          form.get('client_id') !== 'client-1' ||
          form.get('client_secret') !== 'shh-secret' ||
          form.get('redirect_uri') !== grant.redirectUri ||
          digest !== grant.challenge
        ) {
          return reply(response, 200, { error: 'bad_verification_code' })
        }
        const token = `gho_${github.next++}`
        github.tokens.set(token, grant.account)
        return reply(response, 200, { access_token: token, token_type: 'bearer', scope: '' })
      }
      if (url.pathname === '/api/v3/user') {
        if (github.mode === 'user-down') return reply(response, 502, {})
        const token = (request.headers.authorization ?? '').replace(/^Bearer /, '')
        const account = github.tokens.get(token)
        if (account === undefined || request.headers['user-agent'] === undefined) {
          return reply(response, 401, { message: 'Bad credentials' })
        }
        return reply(response, 200, { id: account.id, login: account.login })
      }
      reply(response, 404, {})
    })
  })
  await new Promise<void>((done) => github.server!.listen(0, '127.0.0.1', done))
  github.url = `http://127.0.0.1:${(github.server.address() as AddressInfo).port}`

  db = await createTestContext('effect-github')
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
        registerLoginDriver(githubDriver, '@qualy/plugin-auth-github').pipe(
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
  const handlers = Layer.mergeAll(sessionApiHandlers, githubApiHandlers).pipe(
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
      const person = (name: string, email: string) =>
        Effect.map(
          runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email)
            values (${tenant}, ${name}, ${type}, ${node}, ${email}) returning id`),
          (result) => one<{ id: string }>(result).id,
        )
      const adaId = yield* person('Ada', 'ada@school.edu')
      const linId = yield* person('Lin', 'lin@school.edu')
      const door = one<{ id: string }>(
        yield* runSql(sql`
          insert into auth_providers (tenant_id, code, type, name, enabled, sort_order, config)
          values (${tenant}, 'hub', 'github', 'GitHub', true, 1,
                  ${JSON.stringify({ clientId: 'client-1', enterpriseUrl: github.url })}::jsonb)
          returning id`),
      ).id
      const secrets = yield* Secrets
      yield* secrets.put(
        { ...entranceSecrets(tenant, door), key: 'clientSecret' },
        Redacted.make('shh-secret'),
      )
      return { tenant, door, adaId, linId }
    }).pipe(Effect.provide(secretsLayer.pipe(Layer.provideMerge(probeInfra())))),
  )
  providerId = seeded.door
  ada = seeded.adaId
  lin = seeded.linId
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  github.server?.closeAllConnections()
  await new Promise<void>((done) => github.server?.close(() => done()))
  await db.dispose()
})

beforeEach(async () => {
  if (!postgresAvailable) return
  github.mode = 'normal'
  github.seen.length = 0
  await Effect.runPromise(
    runSql(sql`delete from auth_rate_limit_buckets`).pipe(Effect.provide(probeInfra())),
  )
})

let tokens = 0
/** a session for somebody, as a cookie a browser would send */
const signedIn = async (userId: string) => {
  const token = `test-session-${++tokens}-${userId}`
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

const depart = async (query = '', cookie?: string) => {
  const response = await visit(`${base}/auth/github/hub/start${query}`, cookie)
  return { response, away: new URL(response.headers.get('location') ?? '', origin) }
}

const landing = (response: Response) => {
  const location = new URL(response.headers.get('location') ?? '', origin)
  return { path: location.pathname, code: location.searchParams.get('error') }
}

const bindingsOf = (userId: string) =>
  Effect.runPromise(
    runSql<{ subject: string; display_label: string | null; revoked: boolean }>(sql`
      select subject, display_label, revoked_at is not null as revoked
        from user_auth_bindings where user_id = ${userId} and auth_provider_id = ${providerId}`).pipe(
      Effect.map((result) => result.rows),
      Effect.provide(probeInfra()),
    ),
  )

describe.runIf(postgresAvailable)('a GitHub account', () => {
  it('goes to GitHub with a challenge and no scope, and signs in nobody it does not know', async () => {
    const { response, away } = await depart()
    expect(response.status).toBe(302)
    expect(away.origin + away.pathname).toBe(`${github.url}/login/oauth/authorize`)
    expect(away.searchParams.get('client_id')).toBe('client-1')
    expect(away.searchParams.get('code_challenge_method')).toBe('S256')
    expect(away.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(away.searchParams.get('redirect_uri')).toBe(`${base}/auth/github/hub/callback`)
    expect(away.searchParams.get('scope')).toBeNull()

    const back = await visit(github.authorize(away, { id: 1024, login: 'ada-dev' }))
    expect(landing(back)).toEqual({ path: '/login', code: 'AUTH_EXTERNAL_ACCOUNT_UNBOUND' })
    expect(await bindingsOf(ada)).toEqual([])
  })

  it('is bound by whoever began the bind, and then signs them in under its new name', async () => {
    const cookie = await signedIn(ada)
    const bind = await depart(
      `?intent=bind&returnTo=${encodeURIComponent('/account/logins')}`,
      cookie,
    )
    expect(bind.response.status).toBe(302)
    const bound = await visit(github.authorize(bind.away, { id: 1024, login: 'ada-dev' }))
    expect(bound.status).toBe(303)
    expect(bound.headers.get('location')).toBe('/account/logins')
    expect(await bindingsOf(ada)).toEqual([
      { subject: '1024', display_label: 'ada-dev', revoked: false },
    ])

    const login = await depart('?returnTo=%2Fassessment')
    const back = await visit(github.authorize(login.away, { id: 1024, login: 'ada-renamed' }))
    expect(back.status).toBe(303)
    expect(back.headers.get('location')).toBe('/assessment')
    expect(back.headers.get('set-cookie')).toContain(`${sessionCookieName}=`)
    // the name is whatever the account is called now
    expect((await bindingsOf(ada))[0]!.display_label).toBe('ada-renamed')

    // the same account for somebody else, and a second account for Ada
    const lins = await depart(
      `?intent=bind&returnTo=${encodeURIComponent('/account/logins')}`,
      await signedIn(lin),
    )
    const taken = await visit(github.authorize(lins.away, { id: 1024, login: 'ada-renamed' }))
    expect(landing(taken)).toEqual({ path: '/account/logins', code: 'AUTH_BINDING_SUBJECT_TAKEN' })
    const again = await depart(
      `?intent=bind&returnTo=${encodeURIComponent('/account/logins')}`,
      cookie,
    )
    const second = await visit(github.authorize(again.away, { id: 2048, login: 'ada-alt' }))
    expect(landing(second)).toEqual({ path: '/account/logins', code: 'AUTH_BINDING_ALREADY_BOUND' })
  })

  it('binds nobody for a visitor who is not signed in', async () => {
    const { response } = await depart('?intent=bind')
    expect(landing(response)).toEqual({ path: '/login', code: 'AUTH_REQUIRED' })
    expect(github.seen).toEqual([])
  })

  it('is refused on a verifier that does not match, a state nobody issued, or a person who turned back', async () => {
    const first = await depart()
    const second = await depart()
    // a code issued for the second departure's challenge, brought back on the first
    const crossed = new URL(github.authorize(second.away, { id: 1024, login: 'ada-dev' }))
    crossed.searchParams.set('state', first.away.searchParams.get('state')!)
    expect(landing(await visit(crossed.toString())).code).toBe('AUTH_GITHUB_REJECTED')

    const forged = await visit(`${base}/auth/github/hub/callback?code=x&state=nobody`)
    expect(landing(forged).code).toBe('AUTH_FLOW_REJECTED')
    // however long the values, the person lands on the sign-in page with a reason
    const long = await visit(
      `${base}/auth/github/hub/callback?code=${'c'.repeat(4000)}&state=${'s'.repeat(4000)}`,
    )
    expect(long.status).toBe(303)
    expect(landing(long)).toEqual({ path: '/login', code: 'AUTH_FLOW_REJECTED' })

    const third = await depart()
    const declined = await visit(
      `${base}/auth/github/hub/callback?error=access_denied&state=${third.away.searchParams.get('state')}`,
    )
    expect(landing(declined).code).toBe('AUTH_GITHUB_REJECTED')
  })

  it('says GitHub is away when it cannot trade the code or name the account', async () => {
    github.mode = 'token-down'
    const first = await depart()
    expect(landing(await visit(github.authorize(first.away, { id: 1024, login: 'x' }))).code).toBe(
      'AUTH_GITHUB_UNAVAILABLE',
    )
    github.mode = 'user-down'
    const second = await depart()
    expect(landing(await visit(github.authorize(second.away, { id: 1024, login: 'x' }))).code).toBe(
      'AUTH_GITHUB_UNAVAILABLE',
    )
  })

  it('keeps no token anywhere', async () => {
    const { away } = await depart()
    await visit(github.authorize(away, { id: 1024, login: 'ada-dev' }))
    const kept = await Effect.runPromise(
      runSql<{ found: number }>(sql`
        select (select count(*) from session_auth_grants)
             + (select count(*) from sign_in_events where user_agent like '%gho_%')::int as found`).pipe(
        Effect.provide(probeInfra()),
      ),
    )
    expect(Number(kept.rows[0]!.found)).toBe(0)
  })
})
