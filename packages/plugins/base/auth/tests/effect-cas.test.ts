import { createServer as createPlainServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { NodeHttpServer } from '@effect/platform-node'
import { sql } from 'kysely'
import { Effect, Exit, Layer, Scope } from 'effect'
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
import { apiHandlers as casApiHandlers, driver as casDriver } from '@qualy/plugin-auth-cas'
import { authCasApiGroup } from '@qualy/plugin-auth-cas/api'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { sessionApiGroup } from '../src/api.ts'
import { sessionApiHandlers } from '../src/server/index.ts'
import { makeOutbound } from '../src/server/outbound.ts'
import { AuthConfig, layer as signInLayer } from '../src/server/sign-in.ts'
import { layer as sessionLayer } from '../src/server/session.ts'
import { singleTenantLayer } from '../src/server/tenancy.ts'
import { singleOriginLayer } from '../src/server/public-origin.ts'
import { authClosure } from './support/closure.ts'
import { authAuditLayer } from './support/audit.ts'
import { unusedEmailFlows } from './support/email-flows.ts'

// A CAS sign-in, all the way through, against a CAS server that lives in this
// file.
//
// The server here does what a real one does and nothing more: it issues a
// service ticket for the service it was sent, answers one validation of it -
// only for the exact service string it was issued to - and forgets it. Every
// person, number and attribute is made up.

const port = 3220
const origin = `http://127.0.0.1:${port}`
const base = `${origin}${QUALY_API_PREFIX}`

const api = Api.local(sessionApiGroup, authCasApiGroup)

interface Issued {
  readonly service: string
  readonly user: string
  readonly attributes: Record<string, string[]>
}

/** the CAS server: tickets it issued, what it was asked, and how it answers */
const cas = {
  server: undefined as Server | undefined,
  url: '',
  issued: new Map<string, Issued>(),
  validations: [] as { method: string; path: string; service: string | null }[],
  mode: 'normal' as 'normal' | 'down' | 'garbage',
  next: 1,
  issue(service: string, user: string, attributes: Record<string, string[]> = {}) {
    const ticket = `ST-${cas.next++}-synthetic`
    cas.issued.set(ticket, { service, user, attributes })
    return ticket
  },
}

const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const answerXml = (form: URLSearchParams) => {
  const ticket = form.get('ticket') ?? ''
  const issued = cas.issued.get(ticket)
  // one validation per ticket, whatever came of it
  cas.issued.delete(ticket)
  if (issued === undefined) {
    return `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="INVALID_TICKET">not recognized</cas:authenticationFailure></cas:serviceResponse>`
  }
  if (issued.service !== form.get('service')) {
    return `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="INVALID_SERVICE">service mismatch</cas:authenticationFailure></cas:serviceResponse>`
  }
  const attributes = Object.entries(issued.attributes)
    .flatMap(([name, values]) => values.map((value) => `<cas:${name}>${xmlEscape(value)}</cas:${name}>`))
    .join('')
  return `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>${xmlEscape(issued.user)}</cas:user><cas:attributes>${attributes}</cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`
}

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
let tenant: string
let userId: string

const probeInfra = () => databaseFor(db.url, { migrations: 'off', entities: authClosure })
const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

beforeAll(async () => {
  if (!postgresAvailable) return
  cas.server = createPlainServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://cas.invalid')
      const form = request.method === 'POST' ? new URLSearchParams(body) : url.searchParams
      cas.validations.push({ method: request.method ?? '', path: url.pathname, service: form.get('service') })
      if (cas.mode === 'down') {
        response.writeHead(503)
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' })
      response.end(cas.mode === 'garbage' ? '<cas:serviceResponse><unclosed>' : answerXml(form))
    })
  })
  await new Promise<void>((done) => cas.server!.listen(0, '127.0.0.1', done))
  cas.url = `http://127.0.0.1:${(cas.server.address() as AddressInfo).port}/cas`

  db = await createTestContext('effect-cas')
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
    Layer.provide(secretsLayer),
    Layer.provide(Layer.mergeAll(singleTenantLayer, singleOriginLayer)),
    Layer.provide(authAuditLayer),
    Layer.provide(
      Layer.mergeAll(
        infra,
        authConfig,
        registerLoginDriver(casDriver, '@qualy/plugin-auth-cas').pipe(
          Layer.provideMerge(loginDriversLayer),
        ),
      ),
    ),
  )
  // a development deployment's policy: this machine is reachable, so the CAS
  // server on loopback is; production's refusals are outbound.test's to show
  const outbound = Layer.succeed(
    AuthOutbound,
    makeOutbound({ requireHttps: false, allowLoopback: true, privateAllowlist: [] }),
  )
  const handlers = Layer.mergeAll(sessionApiHandlers, casApiHandlers).pipe(
    Layer.provide(sessionLayer.pipe(Layer.provide(Layer.mergeAll(infra, authConfig)))),
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
      const tenantId = one<{ id: string }>(
        yield* runSql(sql`insert into tenants (slug, name) values ('default','Default') returning id`),
      ).id
      const orgType = one<{ id: string }>(
        yield* runSql(sql`insert into org_types (tenant_id, name) values (${tenantId}, 'U') returning id`),
      ).id
      const node = one<{ id: string }>(
        yield* runSql(sql`
          insert into org_nodes (tenant_id, org_type_id, name, path, depth)
          values (${tenantId}, ${orgType}, 'Root', 'r', 0) returning id`),
      ).id
      const type = one<{ id: string }>(
        yield* runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode)
          values (${tenantId}, 'student', 'Student', 'unrestricted') returning id`),
      ).id
      const user = one<{ id: string }>(
        yield* runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, email, business_no)
          values (${tenantId}, 'Test Student', ${type}, ${node}, 'student@school.edu', '20990001')
          returning id`),
      ).id
      const door = (code: string, config: Record<string, unknown>, sortOrder: number) =>
        runSql(sql`
          insert into auth_providers (tenant_id, code, type, name, enabled, sort_order, config)
          values (${tenantId}, ${code}, 'cas', ${code}, true, ${sortOrder},
                  ${JSON.stringify(config)}::jsonb)`)
      // the standard profile, as an entrance saved before anything was derived
      yield* door('campus', { serverUrl: cas.url }, 1)
      // a server that validates at /proxyValidate, by POST, and names the
      // person in an attribute - saved with its expansion, as the form saves it
      yield* door(
        'legacy',
        {
          serverUrl: cas.url,
          protocol: 'custom',
          validateUrl: `${cas.url}/proxyValidate`,
          validateMethod: 'POST',
          identitySource: 'attribute',
          identityAttribute: 'id_number',
          derived: {
            loginUrl: `${cas.url}/login`,
            validateUrl: `${cas.url}/proxyValidate`,
            validateMethod: 'POST',
            responseFormat: 'auto',
            identity: { source: 'attribute', attribute: 'id_number', fallbackToPrincipal: false },
            renew: true,
          },
        },
        2,
      )
      // a server on a metadata address, which is never reachable
      yield* door('metadata', { serverUrl: 'http://169.254.169.254/cas' }, 3)
      return { tenantId, user }
    }).pipe(Effect.provide(probeInfra())),
  )
  tenant = seeded.tenantId
  userId = seeded.user
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope, Exit.void))
  cas.server?.closeAllConnections()
  await new Promise<void>((done) => cas.server?.close(() => done()))
  await db.dispose()
})

beforeEach(async () => {
  if (!postgresAvailable) return
  cas.mode = 'normal'
  cas.validations.length = 0
  await Effect.runPromise(
    runSql(sql`delete from auth_rate_limit_buckets`).pipe(Effect.provide(probeInfra())),
  )
})

const visit = (url: string) => fetch(url, { redirect: 'manual' })

/** start at a door, and what the CAS server was told to come back to */
const depart = async (code: string, returnTo?: string) => {
  const query = returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`
  const response = await visit(`${base}/auth/cas/${code}/start${query}`)
  expect(response.status).toBe(302)
  const away = new URL(response.headers.get('location')!)
  return { away, service: away.searchParams.get('service')! }
}

/** come back the way a CAS server sends the person back: the service, and a ticket on it */
const comeBack = (service: string, ticket: string) =>
  visit(`${service}${service.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(ticket)}`)

const failureOf = (response: Response) => {
  const location = new URL(response.headers.get('location') ?? '', origin)
  return { path: location.pathname, code: location.searchParams.get('error') }
}

const latestEvent = () =>
  Effect.runPromise(
    runSql<{ outcome: string; reason_code: string | null; user_id: string | null }>(
      sql`select outcome, reason_code, user_id from sign_in_events
           order by occurred_at desc, id desc limit 1`,
    ).pipe(
      Effect.map((result) => result.rows[0]!),
      Effect.provide(probeInfra()),
    ),
  )

describe.runIf(postgresAvailable)('signing in through a CAS server', () => {
  it('is offered on the sign-in page as a way out to the server', async () => {
    const response = await fetch(`${base}/auth/login-methods`)
    const body = (await response.json()) as { methods: { code: string; mode: string; href?: string }[] }
    expect(body.methods.find((method) => method.code === 'campus')).toMatchObject({
      mode: 'redirect',
      href: `${QUALY_API_PREFIX}/auth/cas/campus/start`,
    })
  })

  it('goes there with the service, and comes back signed in where it asked to', async () => {
    const { away, service } = await depart('campus', '/assessment/batches')
    expect(away.origin + away.pathname).toBe(`${cas.url}/login`)
    expect(service.startsWith(`${base}/auth/cas/campus/callback?flow=`)).toBe(true)

    const back = await comeBack(service, cas.issue(service, '20990001'))
    expect(back.status).toBe(303)
    expect(back.headers.get('location')).toBe('/assessment/batches')
    expect(back.headers.get('set-cookie')).toContain(`${sessionCookieName}=`)
    // validated once, with the very string the flow was started with
    expect(cas.validations).toEqual([
      { method: 'GET', path: '/cas/p3/serviceValidate', service },
    ])
    const event = await latestEvent()
    expect(event).toMatchObject({ outcome: 'success', user_id: userId })

    const session = await fetch(`${base}/auth/session`, {
      headers: { cookie: back.headers.get('set-cookie')!.split(';')[0]! },
    })
    expect(await session.json()).toMatchObject({ user: { id: userId } })
  })

  it('is a flow that comes back once', async () => {
    const { service } = await depart('campus')
    const ticket = cas.issue(service, '20990001')
    expect((await comeBack(service, ticket)).status).toBe(303)
    const again = await comeBack(service, cas.issue(service, '20990001'))
    expect(failureOf(again)).toEqual({ path: '/login', code: 'AUTH_FLOW_REJECTED' })
    // a flow nobody issued, and no flow at all
    const forged = await visit(`${base}/auth/cas/campus/callback?flow=nobody&ticket=ST-1-x`)
    expect(failureOf(forged).code).toBe('AUTH_FLOW_REJECTED')
    const none = await visit(`${base}/auth/cas/campus/callback?ticket=ST-1-x`)
    expect(failureOf(none).code).toBe('AUTH_FLOW_REJECTED')
  })

  it('is refused when the ticket was issued for another service, and the ticket is spent', async () => {
    const first = await depart('campus')
    const second = await depart('campus')
    // a ticket for the first departure, brought back on the second
    const ticket = cas.issue(first.service, '20990001')
    const crossed = await comeBack(second.service, ticket)
    expect(failureOf(crossed)).toEqual({ path: '/login', code: 'AUTH_CAS_TICKET_REJECTED' })
    // the server burned it answering, so the right return fails too
    const late = await comeBack(first.service, ticket)
    expect(failureOf(late).code).toBe('AUTH_CAS_TICKET_REJECTED')
    expect((await latestEvent()).reason_code).toBe('external-rejected')
  })

  it('takes only a service ticket, and asks the server nothing about anything else', async () => {
    for (const ticket of ['PT-1-synthetic', 'TGT-1-synthetic']) {
      const { service } = await depart('campus')
      const refused = await comeBack(service, ticket)
      expect(failureOf(refused).code).toBe('AUTH_CAS_TICKET_REJECTED')
    }
    // a return with no ticket at all: the person turned back at the server
    const { service } = await depart('campus')
    expect(failureOf(await visit(service)).code).toBe('AUTH_CAS_TICKET_REJECTED')
    expect(cas.validations).toEqual([])
  })

  it('finds nobody it was not told about, and creates nobody', async () => {
    const { service } = await depart('campus')
    const refused = await comeBack(service, cas.issue(service, '20990999'))
    expect(failureOf(refused).code).toBe('AUTH_PERSON_NOT_FOUND')
    const event = await latestEvent()
    expect(event).toMatchObject({ outcome: 'failure', reason_code: 'user-not-found', user_id: null })
    const people = await Effect.runPromise(
      runSql<{ count: number }>(sql`select count(*)::int as count from users where tenant_id = ${tenant}`).pipe(
        Effect.provide(probeInfra()),
      ),
    )
    expect(people.rows[0]!.count).toBe(1)
  })

  it('says the server is away, or unreadable, without saying anything else', async () => {
    cas.mode = 'down'
    const down = await depart('campus')
    expect(failureOf(await comeBack(down.service, cas.issue(down.service, '20990001'))).code).toBe(
      'AUTH_CAS_UPSTREAM_UNAVAILABLE',
    )
    expect((await latestEvent()).reason_code).toBe('external-unavailable')
    cas.mode = 'garbage'
    const garbled = await depart('campus')
    expect(
      failureOf(await comeBack(garbled.service, cas.issue(garbled.service, '20990001'))).code,
    ).toBe('AUTH_CAS_RESPONSE_INVALID')
    expect((await latestEvent()).reason_code).toBe('external-invalid')
  })

  it('never reaches a server on an address no entrance may reach', async () => {
    const { away, service } = await depart('metadata')
    expect(away.host).toBe('169.254.169.254')
    const refused = await comeBack(service, 'ST-1-synthetic')
    expect(failureOf(refused).code).toBe('AUTH_CAS_UPSTREAM_UNAVAILABLE')
  })

  it('validates where and how a custom entrance says, and reads the person from an attribute', async () => {
    const { away, service } = await depart('legacy')
    expect(away.searchParams.get('renew')).toBe('true')
    const ticket = cas.issue(service, 'demo.person', {
      id_number: ['20990001'],
      user_name: ['Test Student'],
    })
    const back = await comeBack(service, ticket)
    expect(back.status).toBe(303)
    expect(back.headers.get('location')).toBe('/')
    expect(cas.validations).toEqual([{ method: 'POST', path: '/cas/proxyValidate', service }])
    expect(await latestEvent()).toMatchObject({ outcome: 'success', user_id: userId })

    // the attribute missing, and no falling back to the name
    const other = await depart('legacy')
    const missing = await comeBack(other.service, cas.issue(other.service, '20990001'))
    expect(failureOf(missing).code).toBe('AUTH_PERSON_NOT_FOUND')
  })

  it('offers nothing for a door that is not there, and slows a burst of departures', async () => {
    const nowhere = await visit(`${base}/auth/cas/nowhere/start`)
    expect(nowhere.status).toBe(303)
    expect(failureOf(nowhere)).toEqual({ path: '/login', code: 'AUTH_METHOD_UNAVAILABLE' })

    for (let started = 0; started < 30; started += 1) {
      expect((await visit(`${base}/auth/cas/campus/start`)).status).toBe(302)
    }
    const slowed = await visit(`${base}/auth/cas/campus/start`)
    const location = new URL(slowed.headers.get('location')!, origin)
    expect(location.searchParams.get('error')).toBe('TOO_MANY_ATTEMPTS')
    expect(Number(location.searchParams.get('retryAfter'))).toBeGreaterThan(0)
  })
})
