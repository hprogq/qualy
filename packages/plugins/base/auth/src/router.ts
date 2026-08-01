import { implement, ORPCError } from '@orpc/server'
import type { ApiContext } from '@qualy/plugin-server'
import { authContract, type UserDto } from './contract.ts'
import { clearSessionCookie, sessionCookie, type CookieSettings } from './session.ts'
import { getCurrentUser, loginLocal, revokeSession, type AuthDb } from './service.ts'

export interface RouterOptions {
  tenantSlug: string
  sessionTtlSeconds: number
  cookie: CookieSettings
}

type LoadedUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

function toUserDto(user: LoadedUser): UserDto {
  return {
    id: user.id,
    displayName: user.displayName,
    businessNo: user.businessNo,
    userType: {
      id: user.userType.id,
      code: user.userType.code,
      name: user.userType.name,
    },
    primaryOrgNode: {
      id: user.primaryOrgNode.id,
      code: user.primaryOrgNode.code,
      name: user.primaryOrgNode.name,
    },
    tenant: { id: user.tenant.id, slug: user.tenant.slug, name: user.tenant.name },
  }
}

export function createAuthRouter(db: AuthDb, options: RouterOptions) {
  const impl = implement(authContract).$context<ApiContext>()
  return impl.router({
    loginLocal: impl.loginLocal.handler(async ({ input, context, errors }) => {
      const session = await loginLocal(db, {
        tenantSlug: options.tenantSlug,
        identifier: input.identifier,
        password: input.password,
        sessionTtlSeconds: options.sessionTtlSeconds,
        loginIp: context.request.socket.remoteAddress ?? undefined,
        userAgent: context.request.headers['user-agent'],
      })
      if (!session) throw errors.INVALID_CREDENTIALS()
      const user = await getCurrentUser(db, {
        tenantId: session.tenantId,
        userId: session.userId,
        sessionId: 'pending',
      })
      if (!user) throw errors.INVALID_CREDENTIALS()
      context.response.setHeader(
        'Set-Cookie',
        sessionCookie(options.cookie, session.token, session.expiresAt),
      )
      return { user: toUserDto(user) }
    }),
    logout: impl.logout.handler(async ({ context }) => {
      if (context.principal) await revokeSession(db, context.principal)
      context.response.setHeader('Set-Cookie', clearSessionCookie(options.cookie))
      return { ok: true }
    }),
    me: impl.me.handler(async ({ context, errors }) => {
      if (!context.principal) {
        throw context.sessionExpired ? errors.SESSION_EXPIRED() : errors.AUTH_REQUIRED()
      }
      const user = await getCurrentUser(db, context.principal)
      if (!user) throw new ORPCError('AUTH_REQUIRED')
      return { user: toUserDto(user) }
    }),
  })
}
