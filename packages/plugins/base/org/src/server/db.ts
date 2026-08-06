import { Effect } from 'effect'
import {
  entityManager,
  kyselyOf,
  query,
  type ClosureEntityManager,
} from '@qualy/plugin-database/server'
import { sql } from 'kysely'
import { entities } from '../db/entities.ts'

// What org's queries may reach: its own tables and nothing else.
//
// org reads no other plugin's rows - it asks auth and rbac instead, through
// their services - so the closure is exactly this plugin's entities.

const closure = [...entities] as const

export type OrgEntityManager = ClosureEntityManager<typeof closure>

/** a manager for org's tables, joining an open transaction if there is one */
export const orgEntityManager = () => entityManager<typeof closure>()

/**
 * Serializes every structural write of one tenant.
 *
 * rbac's assignment writes and auth's identity writes take the same lock, so
 * the three plugins cannot interleave a retype with a grant or a transfer.
 */
export const lockTenant = (em: OrgEntityManager, tenantId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('Tenant')
      .select(sql<number>`1`.as('locked'))
      .where('id', '=', tenantId)
      .forUpdate()
      .execute(),
  )

// --- org types ---

const typeColumns = ['id', 'code', 'name', 'sortOrder'] as const

export const listTypes = (em: OrgEntityManager, tenantId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('OrgType')
      .select(typeColumns)
      .where('tenantId', '=', tenantId)
      .orderBy('sortOrder')
      .orderBy('name')
      .execute(),
  )

export const oneType = (em: OrgEntityManager, tenantId: string, typeId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('OrgType')
      .select(typeColumns)
      .where('tenantId', '=', tenantId)
      .where('id', '=', typeId)
      .executeTakeFirst(),
  )

export const countTypes = (em: OrgEntityManager, tenantId: string, typeIds: readonly string[]) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('OrgType')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('tenantId', '=', tenantId)
      .where('id', 'in', typeIds)
      .executeTakeFirst(),
  ).pipe(Effect.map((row) => row?.count ?? 0))

export const insertType = (
  em: OrgEntityManager,
  input: { tenantId: string; code: string; name: string; sortOrder: number },
) =>
  query(() =>
    kyselyOf(em)
      .insertInto('OrgType')
      .values(input)
      .returning(typeColumns)
      .executeTakeFirstOrThrow(),
  )

export const updateType = (
  em: OrgEntityManager,
  tenantId: string,
  typeId: string,
  fields: { name?: string; sortOrder?: number },
) =>
  query(() =>
    kyselyOf(em)
      .updateTable('OrgType')
      .set({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.sortOrder === undefined ? {} : { sortOrder: fields.sortOrder }),
        updatedAt: sql<Date>`now()`,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', typeId)
      .execute(),
  )

export const typeHasNodes = (em: OrgEntityManager, tenantId: string, typeId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('OrgNode')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('orgTypeId', '=', typeId)
      .limit(1)
      .executeTakeFirst(),
  ).pipe(Effect.map((row) => row !== undefined))

export const typeHasRules = (em: OrgEntityManager, tenantId: string, typeId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('OrgTypeRule')
      .select('parentTypeId')
      .where('tenantId', '=', tenantId)
      .where((eb) => eb.or([eb('parentTypeId', '=', typeId), eb('childTypeId', '=', typeId)]))
      .limit(1)
      .executeTakeFirst(),
  ).pipe(Effect.map((row) => row !== undefined))

export const deleteType = (em: OrgEntityManager, tenantId: string, typeId: string) =>
  query(() =>
    kyselyOf(em)
      .deleteFrom('OrgType')
      .where('tenantId', '=', tenantId)
      .where('id', '=', typeId)
      .execute(),
  )

// --- the rules between them ---

export const listRules = (em: OrgEntityManager, tenantId: string) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('OrgTypeRule as r')
      .innerJoin('OrgType as p', (join) =>
        join.onRef('p.tenantId', '=', 'r.tenantId').onRef('p.id', '=', 'r.parentTypeId'),
      )
      .innerJoin('OrgType as c', (join) =>
        join.onRef('c.tenantId', '=', 'r.tenantId').onRef('c.id', '=', 'r.childTypeId'),
      )
      .where('r.tenantId', '=', tenantId)
      .select(['r.parentTypeId', 'r.childTypeId'])
      .orderBy('p.sortOrder')
      .orderBy('p.name')
      .orderBy('c.sortOrder')
      .orderBy('c.name')
      .execute(),
  )

export const ruleExists = (
  em: OrgEntityManager,
  tenantId: string,
  parentTypeId: string,
  childTypeId: string,
) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('OrgTypeRule')
      .select('parentTypeId')
      .where('tenantId', '=', tenantId)
      .where('parentTypeId', '=', parentTypeId)
      .where('childTypeId', '=', childTypeId)
      .executeTakeFirst(),
  ).pipe(Effect.map((row) => row !== undefined))

/**
 * Whether adding parent -> child would close a cycle.
 *
 * It would exactly when parent is already reachable from child by walking
 * existing rules downward, so the rule graph stays a dag.
 */
export const ruleWouldCycle = (
  em: OrgEntityManager,
  tenantId: string,
  parentTypeId: string,
  childTypeId: string,
) =>
  query(() =>
    kyselyOf(em)
      .withRecursive('reach', (db) =>
        db
          .selectFrom('OrgTypeRule')
          .select('childTypeId')
          .where('tenantId', '=', tenantId)
          .where('parentTypeId', '=', childTypeId)
          .union((again) =>
            again
              .selectFrom('OrgTypeRule as r')
              .innerJoin('reach', 'reach.childTypeId', 'r.parentTypeId')
              .select('r.childTypeId')
              .where('r.tenantId', '=', tenantId),
          ),
      )
      .selectFrom('reach')
      .select('childTypeId')
      .where('childTypeId', '=', parentTypeId)
      .limit(1)
      .executeTakeFirst(),
  ).pipe(Effect.map((row) => row !== undefined))

export const insertRule = (
  em: OrgEntityManager,
  input: { tenantId: string; parentTypeId: string; childTypeId: string },
) => query(() => kyselyOf(em).insertInto('OrgTypeRule').values(input).execute())

/** a rule is in use when an actual parent-child node pair depends on it */
export const ruleInUse = (
  em: OrgEntityManager,
  tenantId: string,
  parentTypeId: string,
  childTypeId: string,
) =>
  query(() =>
    kyselyOf(em)
      .selectFrom('OrgNode as child')
      .innerJoin('OrgNode as parent', (join) =>
        join
          .onRef('parent.tenantId', '=', 'child.tenantId')
          .onRef('parent.id', '=', 'child.parentId'),
      )
      .where('child.tenantId', '=', tenantId)
      .where('parent.orgTypeId', '=', parentTypeId)
      .where('child.orgTypeId', '=', childTypeId)
      .select('child.id')
      .limit(1)
      .executeTakeFirst(),
  ).pipe(Effect.map((row) => row !== undefined))

export const deleteRule = (
  em: OrgEntityManager,
  tenantId: string,
  parentTypeId: string,
  childTypeId: string,
) =>
  query(() =>
    kyselyOf(em)
      .deleteFrom('OrgTypeRule')
      .where('tenantId', '=', tenantId)
      .where('parentTypeId', '=', parentTypeId)
      .where('childTypeId', '=', childTypeId)
      .execute(),
  )
