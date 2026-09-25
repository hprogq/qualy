import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { createTestContext, databaseFor } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import type { EntitySchema } from '@mikro-orm/core'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { requestContext } from '@qualy/api-kit/request'
import { Api } from '@qualy/api-kit/plugin'
import {
  loginDriversLayer,
  registerLoginDriver,
  type LoginSessions,
} from '@qualy/auth-contract/login'
import { sessionCookieName } from '@qualy/auth-contract/session'
import { hashPassword } from '@qualy/plugin-auth-local/password'
import {
  apiHandlers as authLocalApiHandlers,
  driver as localDriver,
} from '@qualy/plugin-auth-local'
import { authLocalApiGroup } from '@qualy/plugin-auth-local/api'
import { secretsLayer } from '@qualy/plugin-secrets/testkit'
import type { Secrets } from '@qualy/plugin-secrets/plugin'
import type { Captcha, CaptchaProviders } from '@qualy/plugin-captcha/server'
import { sessionApiGroup } from '../../src/api.ts'
import { sessionApiHandlers } from '../../src/server/index.ts'
import { AuthConfig, layer as signInLayer } from '../../src/server/sign-in.ts'
import { layer as sessionLayer, viewerLayer } from '../../src/server/session.ts'
import { singleTenantLayer } from '../../src/server/tenancy.ts'
import { singleOriginLayer } from '../../src/server/public-origin.ts'
import { seedSignIn } from './sign-in-seed.ts'
import { authClosure } from './closure.ts'
import { authAuditLayer } from './audit.ts'
import { unusedEmailFlows } from './email-flows.ts'

// The password door over a real server, with whatever challenge capability a
// suite hands it: a stand-in provider, or the real one made cheap.

export const SIGN_IN_PASSWORD = 'correct horse battery staple'

export interface SignInServer {
  readonly base: string
  /** a connection for reading and arranging rows, without migrating again */
  readonly probeInfra: () => ReturnType<typeof databaseFor>
  /** the sign-in service as the server was given it, for asking it directly */
  readonly signInService: Layer.Layer<LoginSessions, unknown>
  readonly close: () => Promise<void>
}

export const startSignInServer = async (input: {
  readonly name: string
  readonly port: number
  readonly captcha: Layer.Layer<Captcha | CaptchaProviders, never, Secrets | Orm>
  /** tables beyond auth's own the captcha layer writes to */
  readonly entities?: readonly EntitySchema[]
}): Promise<SignInServer> => {
  const db = await createTestContext(input.name)
  const entities: readonly EntitySchema[] = [...authClosure, ...(input.entities ?? [])]
  const infra = databaseFor(db.url, { entities })
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({
      defaultTenantSlug: 'default',
      sessionTtlSeconds: 3600,
      secureCookies: false,
      sessionCookieName,
    }),
  )
  const signIn = signInLayer.pipe(
    Layer.provide(input.captcha),
    Layer.provide(secretsLayer),
    Layer.provide(Layer.mergeAll(singleTenantLayer, singleOriginLayer)),
    Layer.provide(authAuditLayer),
    Layer.provide(
      Layer.mergeAll(
        infra,
        authConfig,
        registerLoginDriver(localDriver, '@qualy/plugin-auth-local').pipe(
          Layer.provideMerge(loginDriversLayer),
        ),
      ),
    ),
  )
  const handlers = Layer.mergeAll(sessionApiHandlers, authLocalApiHandlers).pipe(
    Layer.provide(
      Layer.mergeAll(sessionLayer, viewerLayer).pipe(
        Layer.provide(Layer.mergeAll(infra, authConfig)),
      ),
    ),
  )
  const application = HttpRouter.serve(
    HttpApiBuilder.layer(Api.local(sessionApiGroup, authLocalApiGroup)).pipe(
      Layer.provide(handlers),
    ),
    { middleware: requestContext() },
  ).pipe(
    Layer.provide(signIn),
    Layer.provide(unusedEmailFlows),
    Layer.provide(NodeHttpServer.layer(createServer, { port: input.port })),
    Layer.provide(infra),
  )
  const scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
  const hash = await hashPassword(SIGN_IN_PASSWORD)
  await Effect.runPromise(seedSignIn(hash).pipe(Effect.provide(infra)))
  return {
    base: `http://127.0.0.1:${input.port}${QUALY_API_PREFIX}`,
    probeInfra: () => databaseFor(db.url, { migrations: 'off', entities }),
    signInService: signIn,
    close: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await db.dispose()
    },
  }
}
