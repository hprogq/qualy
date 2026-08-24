import { Db, type ScopedKysely } from '@qualy/plugin-database/plugin'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities } from '../db/entities.ts'

// What audit's queries may reach: its own table, org's (the event row points
// at the tenant) and auth's users - read side only, to put a current display
// name on an actor whose event carries none. Writers stay free of any such
// join; actor and target keep no foreign keys.

const closure = [...orgEntities, ...authEntities, ...entities] as const

export const db = Db.scope(closure)

export type Db = ScopedKysely<typeof closure>
