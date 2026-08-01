import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { AuthPrincipal } from '@qualy/plugin-server'
import type { authRelations } from './db/relations.ts'
import { sessions, userIdentities } from './db/schema.ts'
import { normalizeLocalIdentifier, timingEqualizerHash, verifyPassword } from './password.ts'
import { createSessionToken, hashSessionToken } from './session.ts'

export type AuthDb = NodePgDatabase<typeof authRelations>

const tenantActive = (tenant: { enabled: boolean; expiresAt: Date | null }) =>
  tenant.enabled && (tenant.expiresAt === null || tenant.expiresAt.getTime() > Date.now())

export interface LoginInput {
  tenantSlug: string
  identifier: string
  password: string
  sessionTtlSeconds: number
  loginIp?: string
  userAgent?: string
}

// every failure between tenant lookup and password verification returns null
// so the client sees one uniform INVALID_CREDENTIALS; the timing equalizer
// keeps "unknown user" and "wrong password" indistinguishable
export async function loginLocal(db: AuthDb, input: LoginInput) {
  const failClosed = async () => {
    await verifyPassword(timingEqualizerHash, input.password)
    return null
  }

  const tenant = await db.query.tenants.findFirst({ where: { slug: input.tenantSlug } })
  if (!tenant || !tenantActive(tenant)) return failClosed()

  const provider = await db.query.authProviders.findFirst({
    where: { tenantId: tenant.id, type: 'local', enabled: true },
  })
  if (!provider) return failClosed()

  const identifier = normalizeLocalIdentifier(input.identifier)
  if (!identifier) return failClosed()

  const identity = await db.query.userIdentities.findFirst({
    where: { tenantId: tenant.id, authProviderId: provider.id, identifier },
    with: { user: { with: { userType: true } } },
  })
  if (!identity?.credentialHash) return failClosed()

  const verified = await verifyPassword(identity.credentialHash, input.password)
  if (!verified) return null
  const { user } = identity
  if (!user.enabled) return null
  if (!user.userType.enabled || !user.userType.allowLocalLogin) return null

  const { token, tokenHash } = createSessionToken()
  const expiresAt = new Date(Date.now() + input.sessionTtlSeconds * 1000)
  await db.insert(sessions).values({
    tenantId: tenant.id,
    userId: user.id,
    tokenHash,
    expiresAt,
    loginIp: input.loginIp,
    userAgent: input.userAgent,
  })
  await db
    .update(userIdentities)
    .set({ lastUsedAt: new Date() })
    .where(eq(userIdentities.id, identity.id))

  return { token, expiresAt, userId: user.id, tenantId: tenant.id }
}

export type SessionCheck =
  { state: 'valid'; principal: AuthPrincipal } | { state: 'expired' } | { state: 'invalid' }

// a session stays valid only while the session itself, the user, the user
// type and the tenant are all alive; disabling any of them revokes access
// immediately. Expired rows are deleted on sight.
export async function validateSession(
  db: AuthDb,
  token: string,
  touchIntervalSeconds: number,
): Promise<SessionCheck> {
  const session = await db.query.sessions.findFirst({
    where: { tokenHash: hashSessionToken(token) },
    with: { user: { with: { userType: true, tenant: true } } },
  })
  if (!session) return { state: 'invalid' }
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, session.id))
    return { state: 'expired' }
  }
  const { user } = session
  if (!user.enabled || !user.userType.enabled || !tenantActive(user.tenant)) {
    return { state: 'invalid' }
  }
  const stale =
    !session.lastUsedAt || Date.now() - session.lastUsedAt.getTime() > touchIntervalSeconds * 1000
  if (stale) {
    await db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, session.id))
  }
  return {
    state: 'valid',
    principal: { tenantId: session.tenantId, userId: session.userId, sessionId: session.id },
  }
}

export async function getCurrentUser(db: AuthDb, principal: AuthPrincipal) {
  return db.query.users.findFirst({
    where: { id: principal.userId, tenantId: principal.tenantId },
    with: { tenant: true, userType: true, primaryOrgNode: true },
  })
}

// tenant-scoped delete: a forged cookie can never delete another tenant's row
export async function revokeSession(db: AuthDb, principal: AuthPrincipal) {
  await db.delete(sessions).where(eq(sessions.id, principal.sessionId))
}
