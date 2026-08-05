import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { Placement } from '@qualy/auth-contract'
import { AccessDenied, PermissionCatalog, Rbac } from '../src/effect.ts'

// The point of the port packages, stated as a test.
//
// Under cordis a plugin reached its peers as `ctx.rbac`, typed by an ambient
// module augmentation, so no value ever crossed the package boundary. An
// Effect service tag IS a value, so the same call now needs a real import, and
// importing @qualy/plugin-rbac from org would be a genuine ESM cycle: rbac
// value-imports org's schema for its foreign keys.
//
// This file imports the tags and never the plugins, which is the property the
// packages exist to have. If either tag moved back into its implementation
// package, this file could not be written.

/** an org-shaped consumer: needs both peers, depends on neither package */
const readSubtree = Effect.fn('org.readSubtree')(function* (nodeId: string) {
  const rbac = yield* Rbac
  const placement = yield* Placement
  yield* rbac.requireAt({ userId: 'u', tenantId: 't', sessionId: 's' }, 'org.tree.manage', nodeId)
  return yield* placement.usersBlockingOrgType('t', nodeId, 'type')
})

const rbacStub = (allowed: boolean) =>
  Layer.succeed(Rbac, {
    listPermissions: () => Effect.succeed([]),
    getPermission: () => Effect.succeed(undefined),
    hasPermission: () => Effect.succeed(allowed),
    require: () => Effect.void,
    canAt: () => Effect.succeed(allowed),
    requireAt: () =>
      allowed ? Effect.void : Effect.fail(new AccessDenied({ reason: 'not here' })),
    getProfile: () => Effect.succeed({ tenantPermissions: [], orgPermissions: [] }),
    listAuthorizedScope: () => Effect.succeed({ tenantWide: false, anchors: [] }),
    assertTenantKeepsAdministrator: () => Effect.void,
    grantsBlockingOrgType: () => Effect.succeed([]),
  } satisfies typeof Rbac.Service)

const placementStub = Layer.succeed(Placement, {
  usersBlockingOrgType: () => Effect.succeed(3),
})

describe('the port packages', () => {
  it('lets a consumer hold both peers without importing either plugin', async () => {
    const result = await Effect.runPromise(
      readSubtree('node-1').pipe(Effect.provide(Layer.mergeAll(rbacStub(true), placementStub))),
    )
    expect(result).toBe(3)
  })

  it('carries a denial as a failure the caller can see in its type', async () => {
    const exit = await Effect.runPromiseExit(
      readSubtree('node-1').pipe(Effect.provide(Layer.mergeAll(rbacStub(false), placementStub))),
    )
    expect(exit._tag).toBe('Failure')
    // and it arrives as the declared failure rather than a defect, which is
    // what makes a handler that ignores it fail to compile
    const reason = (exit as Extract<typeof exit, { _tag: 'Failure' }>).cause.reasons[0]
    expect((reason as { error?: { _tag?: string } }).error?._tag).toBe('ACCESS_DENIED')
  })

  it('keeps the catalog a value the host supplies, not something rbac collects', async () => {
    const codes = await Effect.runPromise(
      Effect.gen(function* () {
        return (yield* PermissionCatalog).map((permission) => permission.code)
      }).pipe(
        Effect.provide(
          Layer.succeed(PermissionCatalog, [
            { code: 'org.tree.read', name: 'read', target: 'org-node', plugin: 'org' },
          ]),
        ),
      ),
    )
    // rbac reads what it was handed; it never went looking for contributors
    expect(codes).toEqual(['org.tree.read'])
  })
})
