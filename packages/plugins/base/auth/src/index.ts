import { implement } from '@orpc/server'
import { parseCookie } from 'cookie'
import { Context, Service } from 'cordis'
import { z } from 'zod'
import type { ApiContext } from '@qualy/plugin-server'
import type {} from '@qualy/plugin-ui-registry'
import type {} from '@qualy/rbac-contract'
import { ADMIN_SHELL, BLANK_SHELL, headerActions, permissionOf, PUBLIC } from '@qualy/ui-contract'
import { loginPage, userDetailPage, userTypesPage, usersPage } from './ui.ts'
import { createIdentityRouter } from './iam/router.ts'
import { IamService } from './iam/service.ts'
import { iamMessages } from './iam/messages.ts'
import { authContract, type LoginMethod, type UserDto } from './contract.ts'
import { permissions as authPermissions } from './permissions.ts'
import { authRelations } from './db/relations.ts'
import {
  createSession,
  loadUser,
  revokeSession,
  tenantActive,
  touchIdentity,
  validateSession,
  type AuthDb,
} from './service.ts'
import { clearSessionCookie, sessionCookie, type CookieSettings } from './session.ts'

// browsers normalize backslashes to slashes, so plain prefix checks can be
// bypassed with values like /\evil.example; parse against a sentinel origin
// and only accept targets that stay on it
function sameOriginPath(href: string): string | null {
  if (!href.startsWith('/')) return null
  const sentinel = 'https://qualy.invalid'
  let target: URL
  try {
    target = new URL(href, sentinel)
  } catch {
    return null
  }
  if (target.origin !== sentinel) return null
  return `${target.pathname}${target.search}${target.hash}`
}

declare module 'cordis' {
  interface Context {
    auth: Auth
  }
}

declare module '@qualy/plugin-server' {
  interface ApiContext {
    // set by the auth enricher when a cookie was presented but its session
    // has expired, so protected procedures can answer SESSION_EXPIRED
    sessionExpired?: boolean
  }
}

// how one provider instance is presented on the login page: an embedded
// renderer component (registered in the plugin's client) or a same-origin
// redirect target owned by the driver's routes
export type LoginPresentation =
  { mode: 'component'; component: string } | { mode: 'redirect'; href: string }

// an authentication protocol family shipped by a driver plugin (auth-local,
// auth-cas, ...); auth_providers rows reference it through their type column
export interface ProviderTypeDefinition {
  type: string
  describe(provider: { code: string }): LoginPresentation
}

const Config = z
  .object({
    defaultTenantSlug: z.string().default('default'),
    cookieName: z.string().default('qualy_session'),
    sessionTtlSeconds: z.number().int().min(60).default(604800),
    touchIntervalSeconds: z.number().int().min(0).default(900),
    // 'auto' follows NODE_ENV; admin credentials never live in config
    secureCookies: z.enum(['auto', 'true', 'false']).default('auto'),
  })
  .prefault({})

// the session core: drivers prove who the user is, this service turns that
// proof into a qualy session (cookie, principal, revocation)
export default class Auth extends Service {
  static Config = Config
  static inject = ['db', 'server', 'ui', 'rbac']

  private db: AuthDb
  private cookie: CookieSettings
  private providerTypes = new Map<string, ProviderTypeDefinition>()
  readonly iam: IamService

  private config: z.output<typeof Config>

  constructor(ctx: Context, config: z.input<typeof Config>) {
    super(ctx, 'auth')
    this.config = config as z.output<typeof Config>
    this.cookie = {
      name: this.config.cookieName,
      secure:
        this.config.secureCookies === 'auto'
          ? process.env.NODE_ENV === 'production'
          : this.config.secureCookies === 'true',
    }
    this.db = ctx.db.withRelations(authRelations)
    ctx.rbac.definePermissions('auth', authPermissions)

    // anonymous requests pass through untouched; an invalid or expired cookie
    // is cleared but never turns into an error at this stage
    ctx.server.enrich('auth', async (context) => {
      const header = context.request.headers.cookie
      if (!header) return
      const token = parseCookie(header)[this.cookie.name]
      if (!token) return
      const check = await validateSession(this.db, token, this.config.touchIntervalSeconds)
      if (check.state === 'valid') {
        context.principal = check.principal
        return
      }
      if (check.state === 'expired') context.sessionExpired = true
      context.response.setHeader('Set-Cookie', clearSessionCookie(this.cookie))
    })

    const impl = implement(authContract).$context<ApiContext>()
    ctx.server.contribute(
      'auth',
      impl.router({
        listLoginMethods: impl.listLoginMethods.handler(async () => ({
          methods: await this.listLoginMethods(),
        })),
        endSession: impl.endSession.handler(async ({ context }) => {
          if (context.principal) await revokeSession(this.db, context.principal)
          context.response.setHeader('Set-Cookie', clearSessionCookie(this.cookie))
          return { ok: true as const }
        }),
        getSession: impl.getSession.handler(async ({ context, errors }) => {
          if (!context.principal) {
            throw context.sessionExpired ? errors.SESSION_EXPIRED() : errors.AUTH_REQUIRED()
          }
          const user = await loadUser(this.db, context.principal.tenantId, context.principal.userId)
          if (!user) throw errors.AUTH_REQUIRED()
          return { user: this.toUserDto(user) }
        }),
      }),
    )

    ctx.ui.addPage({
      page: loginPage,
      component: 'auth/LoginPage',
      layout: BLANK_SHELL,
      visibility: PUBLIC,
    })
    // the menu shows a sign-in link to anonymous visitors, so it is public
    // identity administration rides the same session core
    this.iam = new IamService(ctx)
    ctx.server.contribute('identity', createIdentityRouter(ctx, this.iam))
    ctx.ui.addPage({
      page: usersPage,
      component: 'auth/UsersPage',
      layout: ADMIN_SHELL,
      visibility: permissionOf('auth.user.read'),
      navigation: { label: iamMessages.usersNav, order: 30 },
    })
    // a detail screen is reachable from the list rather than from the
    // navigation, so it registers without one
    ctx.ui.addPage({
      page: userDetailPage,
      component: 'auth/UserDetailPage',
      layout: ADMIN_SHELL,
      visibility: permissionOf('auth.user.read'),
    })
    ctx.ui.addPage({
      page: userTypesPage,
      component: 'auth/UserTypesPage',
      layout: ADMIN_SHELL,
      visibility: permissionOf('auth.user-type.read'),
      navigation: { label: iamMessages.userTypesNav, order: 31 },
    })
    ctx.ui.contribute(headerActions, {
      id: 'auth/user-menu',
      component: 'auth/UserMenu',
      visibility: PUBLIC,
      order: 100,
    })
  }

  // driver plugins register their protocol family; revoked with their fiber,
  // so deactivating a driver removes its login methods without touching data
  registerProviderType(definition: ProviderTypeDefinition) {
    return this.ctx.effect(() => {
      if (this.providerTypes.has(definition.type)) {
        throw new Error(`auth provider type conflict: ${definition.type}`)
      }
      this.providerTypes.set(definition.type, definition)
      return () => {
        this.providerTypes.delete(definition.type)
      }
    }, `auth-provider-type:${definition.type}`)
  }

  // login methods = enabled provider rows of the anonymous tenant whose
  // driver plugin is currently active (fail closed for missing drivers)
  async listLoginMethods(): Promise<LoginMethod[]> {
    const tenant = await this.db.query.tenants.findFirst({
      where: { slug: this.config.defaultTenantSlug },
    })
    if (!tenant || !tenantActive(tenant)) return []
    const providers = await this.db.query.authProviders.findMany({
      where: { tenantId: tenant.id, enabled: true },
    })
    const methods: LoginMethod[] = []
    for (const provider of providers.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    )) {
      const definition = this.providerTypes.get(provider.type)
      if (!definition) continue
      let presentation = definition.describe({ code: provider.code })
      // redirect targets must stay same-origin relative paths
      if (presentation.mode === 'redirect') {
        const path = sameOriginPath(presentation.href)
        if (!path) {
          this.ctx.logger.warn(
            'login method %s dropped: driver %s returned a non-relative href',
            provider.code,
            provider.type,
          )
          continue
        }
        presentation = { mode: 'redirect', href: path }
      }
      methods.push({
        code: provider.code,
        type: provider.type,
        name: provider.name,
        ...presentation,
      })
    }
    return methods
  }

  // resolves a public provider code to a row of the anonymous tenant; the
  // expected type stops cross-driver routes (a cas row through /auth/local)
  async resolveProvider(input: { providerCode: string; expectedType: string }) {
    const tenant = await this.db.query.tenants.findFirst({
      where: { slug: this.config.defaultTenantSlug },
    })
    if (!tenant || !tenantActive(tenant)) return null
    if (!this.providerTypes.has(input.expectedType)) return null
    const provider = await this.db.query.authProviders.findFirst({
      where: {
        tenantId: tenant.id,
        code: input.providerCode,
        type: input.expectedType,
        enabled: true,
      },
    })
    if (!provider) return null
    return { tenant, provider }
  }

  async findIdentity(input: { tenantId: string; providerId: string; identifier: string }) {
    return this.db.query.userIdentities.findFirst({
      where: {
        tenantId: input.tenantId,
        authProviderId: input.providerId,
        identifier: input.identifier,
      },
      with: { user: { with: { userType: true } } },
    })
  }

  // the driver proved the user; create the session and set the cookie.
  // Returns null when the account state forbids login after all.
  async completeLogin(
    context: ApiContext,
    input: { tenantId: string; userId: string; identityId?: string },
  ): Promise<UserDto | null> {
    const user = await loadUser(this.db, input.tenantId, input.userId)
    if (!user || !user.enabled || !user.userType.enabled || !tenantActive(user.tenant)) return null
    const session = await createSession(this.db, {
      tenantId: input.tenantId,
      userId: input.userId,
      ttlSeconds: this.config.sessionTtlSeconds,
      loginIp: context.request.socket.remoteAddress ?? undefined,
      userAgent: context.request.headers['user-agent'],
    })
    if (input.identityId) await touchIdentity(this.db, input.identityId)
    context.response.setHeader(
      'Set-Cookie',
      sessionCookie(this.cookie, session.token, session.expiresAt),
    )
    return this.toUserDto(user)
  }

  private toUserDto(user: NonNullable<Awaited<ReturnType<typeof loadUser>>>): UserDto {
    return {
      id: user.id,
      displayName: user.displayName,
      businessNo: user.businessNo,
      userType: { id: user.userType.id, code: user.userType.code, name: user.userType.name },
      primaryOrgNode: {
        id: user.primaryOrgNode.id,
        code: user.primaryOrgNode.code,
        name: user.primaryOrgNode.name,
      },
      tenant: { id: user.tenant.id, slug: user.tenant.slug, name: user.tenant.name },
    }
  }
}
