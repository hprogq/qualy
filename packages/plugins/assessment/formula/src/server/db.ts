import { Db } from '@qualy/plugin-database/plugin'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities } from '../db/entities.ts'

// The library's queries reach its own two tables plus org's: the owner node
// joins org_nodes for authorization-scope pushdown, and tenants anchors the
// tenant foreign key. Instants cross as epoch milliseconds where ordering
// matters; DTOs render ISO strings at the edge.

const closure = [...orgEntities, ...entities] as const

export const db = Db.scope(closure)
