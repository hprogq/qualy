import { sql } from 'kysely'
import { Effect, Exit, Layer, Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import { authClosure } from './support/closure.ts'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import {
  loginDriversLayer,
  registerLoginDriver,
  type LoginDriver,
  type LoginDrivers,
} from '@qualy/auth-contract/login'
import { AuthConfig } from '../src/server/auth-config.ts'
import { SignIn, layer as signInLayer } from '../src/server/sign-in.ts'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import { captchaLayer } from '@qualy/plugin-captcha/testkit'
import { authAuditLayer } from './support/audit.ts'
import { singleTenantLayer } from '../src/server/tenancy.ts'
import { singleOriginLayer } from '../src/server/public-origin.ts'

// What a sign-in screen is offered.
//
// From local-login.test.ts 'accepts only same-origin redirect targets,
// surviving backslash tricks'. A driver names where to send a visitor, and
// that target is rendered as a link on the application's own page: a driver
// that names another origin would be redirecting people off the application
// under the application's name. Absolute urls, protocol-relative urls and the
// backslash form browsers normalise into one are all the same attack.

const drivers: readonly LoginDriver[] = [
  {
    type: 'redirecting',
    presentation: {
      mode: 'redirect',
      href: (provider) => HREFS[provider.code] ?? '/fallback',
    },
    // shaped like a campus door: added by the tenant, finding people by
    // their business number, binding nothing
    provisioning: {
      mode: 'tenant-managed',
      entrance: { label: { kind: 'literal', value: 'Redirecting' }, fields: [] },
    },
    resolution: { mode: 'user-field', field: 'businessNo' },
  },
]

const HREFS: Record<string, string> = {
  'evil-absolute': 'https://evil.example/phish',
  'evil-scheme-relative': '//evil.example/phish',
  'evil-backslash': '/\\evil.example/phish',
  good: '/auth/redirecting/good/start?q=1',
}

const stack = (url: string) =>
  signInLayer.pipe(
    Layer.provideMerge(captchaLayer),
    Layer.provideMerge(secretsLayer),
    Layer.provideMerge(Layer.mergeAll(singleTenantLayer, singleOriginLayer)),
    Layer.provideMerge(authAuditLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        databaseFor(url, { entities: authClosure }),
        // the registrations need the registry, so it is provided to them and
        // published in the same move
        drivers
          .map((driver) => registerLoginDriver(driver))
          .reduce(
            (all, one) => Layer.merge(all, one),
            Layer.empty as Layer.Layer<never, never, LoginDrivers>,
          )
          .pipe(Layer.provideMerge(loginDriversLayer)),
        Layer.succeed(
          AuthConfig,
          AuthConfig.of({
            defaultTenantSlug: 'default',
            sessionTtlSeconds: 3600,
            secureCookies: false,
            sessionCookieName: 'qualy_session',
          }),
        ),
      ),
    ),
  )

describe.runIf(postgresAvailable).concurrent('the ways in a deployment offers', () => {
  it('keeps only the redirect targets that stay on this origin', async () => {
    const db = await createTestContext('effect-login-methods')
    const scope = await Effect.runPromise(Scope.make())
    try {
      const methods = await Effect.runPromise(
        Effect.gen(function* () {
          const tenant = (
            (yield* runSql(
              sql`insert into tenants (slug, name) values ('default','T') returning id`,
            )) as unknown as { rows: { id: string }[] }
          ).rows[0]!.id
          for (const [index, code] of Object.keys(HREFS).entries()) {
            yield* runSql(sql`
              insert into auth_providers (tenant_id, code, type, name, enabled, sort_order)
              values (${tenant}, ${code}, 'redirecting', ${code}, true, ${index})`)
          }
          const signIn = yield* SignIn
          return yield* signIn.loginMethods()
        }).pipe(Effect.provide(stack(db.url)), Scope.provide(scope)),
      )
      // only the same-origin one survives; the other three are dropped rather
      // than rewritten, because a driver that names another origin has said
      // something this application cannot honour
      expect(methods.map((method) => method.code)).toEqual(['good'])
      expect(methods[0]).toMatchObject({
        mode: 'redirect',
        href: '/auth/redirecting/good/start?q=1',
      })
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await db.dispose()
    }
  })
})
