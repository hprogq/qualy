import { sql } from 'drizzle-orm'
import { snakeCase, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const pingLogs = snakeCase.table('ping_logs', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})
