import { sql } from 'drizzle-orm'
import {
  char,
  foreignKey,
  index,
  inet,
  snakeCase,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from '@qualy/plugin-org/schema'
import { users } from './users.ts'

export const sessions = snakeCase.table(
  'sessions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid().notNull(),
    // sha256 of the raw cookie token; the raw value is never stored
    tokenHash: char({ length: 64 }).notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastUsedAt: timestamp({ withTimezone: true }),
    loginIp: inet(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_sessions_user',
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('cascade'),
    // revoke-all-for-user, expiry sweeps and the referencing side of the fk
    index('idx_sessions_tenant_user_expires').on(table.tenantId, table.userId, table.expiresAt),
  ],
)
