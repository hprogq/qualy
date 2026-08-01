import { sql } from 'drizzle-orm'
import { boolean, check, snakeCase, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { codePattern } from '../code-pattern.ts'

export const tenants = snakeCase.table(
  'tenants',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    slug: varchar({ length: 63 }).notNull().unique(),
    name: varchar({ length: 255 }).notNull(),
    logoUrl: varchar({ length: 2048 }),
    // enabled=false or a past expiresAt blocks new logins and invalidates
    // existing sessions; expiresAt null means no expiry
    enabled: boolean().default(true).notNull(),
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('chk_tenants_slug_format', sql`${table.slug} ~ ${sql.raw(codePattern)}`),
    check('chk_tenants_name_not_blank', sql`btrim(${table.name}) <> ''`),
  ],
)
