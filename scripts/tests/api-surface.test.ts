import { describe, expect, it } from 'vitest'
import { authContract, identityContract } from '../../packages/plugins/base/auth/src/contract.ts'
import { authLocalContract } from '../../packages/plugins/base/auth-local/src/contract.ts'
import { accessContract } from '../../packages/plugins/base/rbac/src/contract.ts'
import { orgContract } from '../../packages/plugins/base/org/src/contract.ts'
import { appContract as manifestContract } from '../../packages/plugins/infra/ui-registry/src/contract.ts'
import { pingContract } from '../../packages/plugins/demo/ping/src/contract.ts'

// read from the plugins rather than from the generated client: that file
// tracks whichever plugins are enabled, and another test disables one

// The whole http surface, frozen.
//
// Paths are the one part of this system that outlives every refactor inside
// it, and the failure mode is quiet: a plugin adds /rbac/roles, or an action
// verb like /nodes/{id}/move, and nothing complains until a client depends
// on it. This test makes the surface a decision the diff has to show.
//
// Conventions it enforces by construction:
//   the first segment is a product domain (auth, iam, org, app, ping), never
//   an implementation (rbac, ui-registry);
//   a mutable subresource is replaced with PUT (status, placement,
//   permissions, eligibility, placement-policy), not poked with a verb;
//   collections are plural nouns and relationships say what they relate.

type Meta = { '~orpc'?: { meta?: { '~openapi'?: { method: string; path: string } } } }

const surface = (): string[] => {
  const routes: string[] = []
  const walk = (node: unknown) => {
    if (node === null || typeof node !== 'object') return
    const openapi = (node as Meta)['~orpc']?.meta?.['~openapi']
    if (openapi) {
      routes.push(`${openapi.method} ${openapi.path}`)
      return
    }
    for (const child of Object.values(node as Record<string, unknown>)) walk(child)
  }
  walk([
    authContract,
    identityContract,
    authLocalContract,
    accessContract,
    orgContract,
    manifestContract,
    pingContract,
  ])
  return routes.sort()
}

// every route the assembled api serves, under the server's /api prefix
const EXPECTED = [
  'DELETE /auth/session',
  'GET /auth/login-methods',
  'GET /auth/session',
  'POST /auth/local/{providerCode}/login',

  'GET /app/manifest',

  'GET /iam/permissions',
  'POST /iam/access-evaluations',
  'GET /iam/role-options',
  'GET /iam/roles',
  'POST /iam/roles',
  'GET /iam/roles/{roleId}',
  'PATCH /iam/roles/{roleId}',
  'DELETE /iam/roles/{roleId}',
  'GET /iam/roles/{roleId}/eligibility',
  'PUT /iam/roles/{roleId}/eligibility',
  'GET /iam/roles/{roleId}/permissions',
  'PUT /iam/roles/{roleId}/permissions',
  'PUT /iam/roles/{roleId}/status',
  'GET /iam/role-grants',
  'POST /iam/role-grants',
  'DELETE /iam/role-grants/{grantId}',
  'GET /iam/role-grant-options',

  'GET /iam/user-options',
  'GET /iam/user-type-options',
  'GET /iam/user-types',
  'POST /iam/user-types',
  'GET /iam/user-types/{userTypeId}',
  'PATCH /iam/user-types/{userTypeId}',
  'DELETE /iam/user-types/{userTypeId}',
  'GET /iam/user-types/{userTypeId}/placement-policy',
  'PUT /iam/user-types/{userTypeId}/placement-policy',
  'PUT /iam/user-types/{userTypeId}/status',

  'GET /iam/users',
  'POST /iam/users',
  'GET /iam/users/{userId}',
  'PATCH /iam/users/{userId}',
  'PUT /iam/users/{userId}/placement',
  'PUT /iam/users/{userId}/status',
  'GET /iam/users/{userId}/effective-permissions',
  'GET /iam/users/{userId}/role-grants',

  'GET /org/tree',
  'GET /org/types',
  'POST /org/types',
  'PATCH /org/types/{typeId}',
  'DELETE /org/types/{typeId}',
  'GET /org/type-rules',
  'PUT /org/type-rules/{parentTypeId}/{childTypeId}',
  'DELETE /org/type-rules/{parentTypeId}/{childTypeId}',
  'GET /org/nodes/{nodeId}',
  'POST /org/nodes',
  'PATCH /org/nodes/{nodeId}',
  'DELETE /org/nodes/{nodeId}',
  'PUT /org/nodes/{nodeId}/placement',
  'PUT /org/nodes/{nodeId}/type',

  'GET /ping/hello',
].sort()

describe('http surface', () => {
  it('serves exactly the frozen set of routes', () => {
    // adding or moving a route is a deliberate act: update this list in the
    // same commit, and the reviewer sees the api change
    expect(surface()).toEqual(EXPECTED)
  })

  it('names product domains rather than implementations', () => {
    const domains = new Set(surface().map((route) => route.split(' ')[1]!.split('/')[1]))
    expect([...domains].sort()).toEqual(['app', 'auth', 'iam', 'org', 'ping'])
    // rbac is how authorization is implemented; a url must not say so
    expect(surface().filter((route) => /\/(rbac|ui|ui-registry|admin|v1)\//.test(route))).toEqual([])
  })

  it('replaces subresources instead of poking them with verbs', () => {
    // an action segment is a sign a subresource was missing
    const verbs = surface().filter((route) =>
      /\/(move|enable|disable|activate|assign|revoke|sync|allowed)(\/|$)/.test(route),
    )
    expect(verbs).toEqual([])
    // and every subresource of a single record is replaced with PUT, so
    // repeating the call converges instead of doing something else
    for (const route of surface()) {
      if (/\{[^}]+\}\/(status|placement)$/.test(route)) {
        expect(route.startsWith('PUT ')).toBe(true)
      }
      // a subresource that is both read and replaced offers GET and PUT and
      // nothing else: no POST that appends, no DELETE that empties
      if (/\{[^}]+\}\/(permissions|eligibility|placement-policy)$/.test(route)) {
        expect(route.startsWith('PUT ') || route.startsWith('GET ')).toBe(true)
      }
    }
  })

  it('keeps health probes off the api surface', () => {
    // liveness and readiness serve orchestrators, not api clients, so they
    // live outside the prefix and outside the generated document
    expect(surface().filter((route) => route.includes('/health'))).toEqual([])
  })
})
