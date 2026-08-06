import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestContext, databaseFor, postgresAvailable } from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '../src/db/entities.ts'
import { PermissionCatalog, Rbac } from '@qualy/rbac-contract/effect'
import type { ActivePermission } from '@qualy/rbac-contract'
import { layer as rbacLayer } from '../src/server/index.ts'

// A stored permission row is the single truth about what a code means.
//
// Ownership and calling convention are the stable semantics: live grants
// already assume them, so a declaration that disagrees with the stored row
// needs a new code rather than an overwrite. Refusing while the layer is built
// means drift stops the assembly, instead of an instance coming up and
// authorizing against a table that means something else.

const catalog = (target: 'tenant' | 'org-node'): readonly ActivePermission[] => [
  { code: 'demo.thing', name: 'Thing', target, plugin: 'demo' },
]

// what the orm must know for a query to name a table
const closure = [...orgEntities, ...authEntities, ...rbacEntities] as const

const stack = (url: string, permissions: readonly ActivePermission[]) =>
  rbacLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        databaseFor(url, { entities: closure }),
        Layer.succeed(PermissionCatalog, permissions),
      ),
    ),
  )

describe.runIf(postgresAvailable).concurrent('the stored permission row', () => {
  it('refuses to build when a declaration disagrees with what is stored', async () => {
    const db = await createTestContext('effect-rbac-drift')
    try {
      // first assembly stores the code as an org-node permission
      const first = await Effect.runPromiseExit(
        Rbac.pipe(Effect.provide(stack(db.url, catalog('org-node')))),
      )
      expect(Exit.isSuccess(first)).toBe(true)

      // a later one declares the same code with a different calling
      // convention, which live grants would already have assumed
      const second = await Effect.runPromiseExit(
        Rbac.pipe(Effect.provide(stack(db.url, catalog('tenant')))),
      )
      expect(Exit.isFailure(second)).toBe(true)
    } finally {
      await db.dispose()
    }
  })
})
