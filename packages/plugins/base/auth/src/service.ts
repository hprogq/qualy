import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { AuthPrincipal } from '@qualy/plugin-server'
import type { authRelations } from './db/relations.ts'
import { sessions, userIdentities } from './db/schema.ts'
import { createSessionToken, hashSessionToken } from './session.ts'

export type AuthDb = NodePgDatabase<typeof authRelations>

export const tenantActive = (tenant: { enabled: boolean; expiresAt: Date | null }) =>
  tenant.enabled && (tenant.expiresAt === null || tenant.expiresAt.getTime() > Date.now())

export interface CreatedSession {
  token: string
  expiresAt: Date
}

export async function createSession(
  db: AuthDb,
  input: {
    tenantId: string
    userId: string
    ttlSeconds: number
    loginIp?: string
    userAgent?: string
  },
): Promise<CreatedSession> {
  const { token, tokenHash } = createSessionToken()
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000)
  await db.insert(sessions).values({
    tenantId: input.tenantId,
    userId: input.userId,
    tokenHash,
    expiresAt,
    loginIp: input.loginIp,
    userAgent: input.userAgent,
  })
  return { token, expiresAt }
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

export async function loadUser(db: AuthDb, tenantId: string, userId: string) {
  return db.query.users.findFirst({
    where: { id: userId, tenantId },
    with: { tenant: true, userType: true, primaryOrgNode: true },
  })
}

export async function revokeSession(db: AuthDb, principal: AuthPrincipal) {
  // scoped delete: repository discipline, even though the id comes from a
  // server-issued principal
  await db
    .delete(sessions)
    .where(
      and(
        eq(sessions.id, principal.sessionId),
        eq(sessions.tenantId, principal.tenantId),
        eq(sessions.userId, principal.userId),
      ),
    )
}

export async function touchIdentity(db: AuthDb, identityId: string) {
  await db
    .update(userIdentities)
    .set({ lastUsedAt: new Date() })
    .where(eq(userIdentities.id, identityId))
}
