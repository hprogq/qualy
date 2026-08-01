import { parseCookie } from 'cookie'
import type { Context } from 'cordis'
import { z } from 'zod'
import type {} from '@qualy/plugin-ui-registry'
import { authRelations } from './db/relations.ts'
import { authErrorStatuses } from './contract.ts'
import { createAuthRouter } from './router.ts'
import { clearSessionCookie, type CookieSettings } from './session.ts'
import { validateSession } from './service.ts'

declare module '@qualy/plugin-server' {
  interface ApiContext {
    // set by the auth enricher when a cookie was presented but its session
    // has expired, so protected procedures can answer SESSION_EXPIRED
    sessionExpired?: boolean
  }
}

export const name = 'auth'
export const inject = ['db', 'server', 'ui']

export const Config = z
  .object({
    defaultTenantSlug: z.string().default('default'),
    cookieName: z.string().default('qualy_session'),
    sessionTtlSeconds: z.number().int().min(60).default(604800),
    touchIntervalSeconds: z.number().int().min(0).default(900),
    // 'auto' follows NODE_ENV; admin credentials never live in config
    secureCookies: z.enum(['auto', 'true', 'false']).default('auto'),
  })
  .prefault({})

export function apply(ctx: Context, rawConfig: z.input<typeof Config>) {
  const config = rawConfig as z.output<typeof Config>
  const cookie: CookieSettings = {
    name: config.cookieName,
    secure:
      config.secureCookies === 'auto'
        ? process.env.NODE_ENV === 'production'
        : config.secureCookies === 'true',
  }
  const db = ctx.db.withRelations(authRelations)

  // anonymous requests pass through untouched; an invalid or expired cookie
  // is cleared but never turns into an error at this stage
  ctx.server.enrich('auth', async (context) => {
    const header = context.request.headers.cookie
    if (!header) return
    const token = parseCookie(header)[cookie.name]
    if (!token) return
    const check = await validateSession(db, token, config.touchIntervalSeconds)
    if (check.state === 'valid') {
      context.principal = check.principal
      return
    }
    if (check.state === 'expired') context.sessionExpired = true
    context.response.setHeader('Set-Cookie', clearSessionCookie(cookie))
  })

  ctx.server.contribute(
    'auth',
    createAuthRouter(db, {
      tenantSlug: config.defaultTenantSlug,
      sessionTtlSeconds: config.sessionTtlSeconds,
      cookie,
    }),
    { errorStatuses: authErrorStatuses },
  )

  ctx.ui.addPage({ path: '/login', component: 'LoginPage', layout: 'blank', public: true })
}
