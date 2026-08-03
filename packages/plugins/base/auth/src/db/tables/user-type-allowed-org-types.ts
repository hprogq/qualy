import { foreignKey, index, primaryKey, snakeCase, timestamp, uuid } from 'drizzle-orm/pg-core'
import { orgTypes, tenants } from '@qualy/plugin-org/schema'
import { userTypes } from './user-types.ts'

// Where a kind of person may stand. A student belongs to a class, a teacher
// to a grade or a teaching-research office, a system account to the root —
// that is a fact about the identity, not about any duty they take on.
//
// This is the half of the model that used to be missing, which is why user
// types ended up carrying roles: with nothing to say about placement, the
// only thing a type could express was authority, and authority already had
// a home. Now a type constrains where, a role constrains what, and neither
// needs to reach into the other.
export const userTypeAllowedOrgTypes = snakeCase.table(
  'user_type_allowed_org_types',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userTypeId: uuid().notNull(),
    orgTypeId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'pk_user_type_allowed_org_types',
      columns: [table.tenantId, table.userTypeId, table.orgTypeId],
    }),
    foreignKey({
      name: 'fk_user_type_allowed_org_types_type',
      columns: [table.tenantId, table.userTypeId],
      foreignColumns: [userTypes.tenantId, userTypes.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_user_type_allowed_org_types_org_type',
      columns: [table.tenantId, table.orgTypeId],
      foreignColumns: [orgTypes.tenantId, orgTypes.id],
    }).onDelete('restrict'),
    index('idx_user_type_allowed_org_types_tenant_type').on(table.tenantId, table.userTypeId),
  ],
)
