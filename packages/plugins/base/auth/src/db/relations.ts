import { defineRelations } from 'drizzle-orm'
import { orgNodes, tenants } from '@qualy/plugin-org/schema'
import { authProviders } from './tables/auth-providers.ts'
import { userTypes } from './tables/user-types.ts'
import { sessions } from './tables/sessions.ts'
import { userIdentities } from './tables/user-identities.ts'
import { users } from './tables/users.ts'

// relations exist for the queries auth actually runs (session validation and
// the current-user lookup); they are a top-level singleton because
// ctx.db.withRelations caches views by object identity
export const authRelations = defineRelations(
  { users, userTypes, authProviders, userIdentities, sessions, tenants, orgNodes },
  (r) => ({
    sessions: {
      user: r.one.users({
        from: [r.sessions.tenantId, r.sessions.userId],
        to: [r.users.tenantId, r.users.id],
        optional: false,
      }),
    },
    users: {
      tenant: r.one.tenants({
        from: r.users.tenantId,
        to: r.tenants.id,
        optional: false,
      }),
      userType: r.one.userTypes({
        from: [r.users.tenantId, r.users.userTypeId],
        to: [r.userTypes.tenantId, r.userTypes.id],
        optional: false,
      }),
      primaryOrgNode: r.one.orgNodes({
        from: [r.users.tenantId, r.users.primaryOrgNodeId],
        to: [r.orgNodes.tenantId, r.orgNodes.id],
        optional: false,
      }),
    },
    userIdentities: {
      user: r.one.users({
        from: [r.userIdentities.tenantId, r.userIdentities.userId],
        to: [r.users.tenantId, r.users.id],
        optional: false,
      }),
      provider: r.one.authProviders({
        from: [r.userIdentities.tenantId, r.userIdentities.authProviderId],
        to: [r.authProviders.tenantId, r.authProviders.id],
        optional: false,
      }),
    },
  }),
)
