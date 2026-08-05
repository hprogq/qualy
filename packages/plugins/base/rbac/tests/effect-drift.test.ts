import { sql } from 'drizzle-orm'
import { Effect, Exit, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Database, DatabaseConfig, layer as databaseLayer } from '@qualy/plugin-database/effect'
import { PermissionCatalog, Rbac } from '@qualy/rbac-contract/effect'
import type { ActivePermission } from '@qualy/rbac-contract'
import { layer as rbacLayer } from '../src/effect/index.ts'

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

const stack = (url: string, permissions: readonly ActivePermission[]) =>
  rbacLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(databaseLayer, Layer.succeed(PermissionCatalog, permissions)),
    ),
    Layer.provide(
      Layer.succeed(
        DatabaseConfig,
        DatabaseConfig.of({
          url: Redacted.make(url),
          migrations: 'apply',
          migrationsFolder: new URL('../../../../../db/migrations', import.meta.url).pathname,
        }),
      ),
    ),
  )

describe.runIf(postgresAvailable)('the stored permission row', () => {
  it('refuses to build when a declaration disagrees with what is stored', async () => {
    const db = await createTestContext('effect-rbac-drift')
    try {
      // first assembly stores the code as an org-node permission
      const first = await Effect.runPromiseExit(
        Effect.gen(function* () {
          yield* Rbac
        }).pipe(Effect.provide(stack(db.url, catalog('org-node')))),
      )
      expect(Exit.isSuccess(first)).toBe(true)

      // a later one declares the same code with a different calling
      // convention, which live grants would already have assumed
      const second = await Effect.runPromiseExit(
        Effect.gen(function* () {
          yield* Rbac
        }).pipe(Effect.provide(stack(db.url, catalog('tenant')))),
      )
      expect(Exit.isFailure(second)).toBe(true)
    } finally {
      await db.dispose()
    }
  })
})
