import { Db, type ScopedKysely } from '@qualy/plugin-database/plugin'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities } from '../db/entities.ts'

// What audit's queries may reach: its own table and org's, because the event
// row points at the tenant - and nothing else. Actor and target are ids
// without foreign keys on purpose, so no other plugin's tables belong here.

const closure = [...orgEntities, ...entities] as const

export const db = Db.scope(closure)

export type Db = ScopedKysely<typeof closure>
