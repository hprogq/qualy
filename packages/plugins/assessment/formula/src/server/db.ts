import { Db } from '@qualy/plugin-database/plugin'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities } from '../db/entities.ts'

// The library's queries reach its own three tables plus two neighbours'.
// org because an audience IS a place: a share scope points at a node, and
// deciding who it reaches is a question about the tree it hangs on (and
// tenants anchors the tenant foreign key). auth because a template names
// the person who wrote it, and a display name is theirs to own - read with
// a LEFT JOIN, since authorship carries no foreign key and a template must
// not vanish because its author's row did.
//
// Instants cross as epoch milliseconds where ordering matters; DTOs render
// ISO strings at the edge.

const closure = [...orgEntities, ...authEntities, ...entities] as const

export const db = Db.scope(closure)
