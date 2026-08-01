import { sql } from 'drizzle-orm'
import {
  foreignKey,
  snakeCase,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { tenants } from '@qualy/plugin-org/schema'
import { authProviders } from './auth-providers.ts'
import { users } from './users.ts'

export const userIdentities = snakeCase.table(
  'user_identities',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid().notNull(),
    authProviderId: uuid().notNull(),
    identifier: varchar({ length: 255 }).notNull(),
    // argon2id digest for local identities; null for future sso bindings
    credentialHash: text(),
    boundAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_user_identities_tenant_id_id').on(table.tenantId, table.id),
    foreignKey({
      name: 'fk_user_identities_user',
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_user_identities_provider',
      columns: [table.tenantId, table.authProviderId],
      foreignColumns: [authProviders.tenantId, authProviders.id],
    }).onDelete('restrict'),
    uniqueIndex('uq_user_identities_login').on(
      table.tenantId,
      table.authProviderId,
      table.identifier,
    ),
    uniqueIndex('uq_user_identities_user_provider').on(
      table.tenantId,
      table.userId,
      table.authProviderId,
    ),
  ],
)
