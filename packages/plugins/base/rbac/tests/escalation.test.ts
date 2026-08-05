import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Reach } from '../src/queries.ts'
import {
  ESCALATE,
  ORG_BIND,
  TENANT_BIND,
  assertMayDefineRole,
  assertMayGrantRole,
  type Authority,
} from '../src/effect/escalation.ts'

// The escalation rules, stated without a database.
//
// They decide who may hand out what, so their failure mode is someone quietly
// acquiring authority they were never given. Every case here is a sentence
// from the rule rather than a scenario: the guards take an Authority, so what
// the actor holds can be said directly instead of assembled out of grants.

const authority = (
  held: readonly string[],
  reach: Record<string, Reach> = {},
  active: readonly string[] = [],
): Authority => ({
  tenantWide: () => Effect.succeed(new Set(held)),
  reachAt: () => Effect.succeed(new Map(Object.entries(reach))),
  activeCodes: () => active,
  catalog: () => new Map(active.map((code) => [code, { target: 'tenant' as const }])),
})

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSyncExit(effect)
const refused = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? ((exit.cause.reasons[0] as { error?: { _tag?: string; permissions?: string[] } })?.error ??
      {})
    : undefined

describe('defining a role', () => {
  it('allows only capabilities the author already holds', () => {
    const held = authority(['a', 'b'])
    expect(Exit.isSuccess(run(assertMayDefineRole(held, ['a'])))).toBe(true)
    const denied = refused(run(assertMayDefineRole(held, ['a', 'c'])))
    expect(denied?._tag).toBe('ROLE_ESCALATION_REFUSED')
    // the refusal names what was beyond the author, so it can be fixed
    expect(denied?.permissions).toEqual(['c'])
  })

  it('lets the named exception through, and only that', () => {
    expect(Exit.isSuccess(run(assertMayDefineRole(authority([ESCALATE]), ['anything'])))).toBe(
      true,
    )
    // holding a bind is not holding escalate
    expect(
      Exit.isSuccess(run(assertMayDefineRole(authority([TENANT_BIND]), ['anything']))),
    ).toBe(false)
  })

  it('measures an org role tenant-wide too', () => {
    // the definition is reusable at every node, so authority at one college
    // would not justify it. reachAt is never consulted here.
    const held: Authority = {
      ...authority([]),
      reachAt: () => Effect.succeed(new Map([['a', 'subtree' as Reach]])),
    }
    expect(Exit.isSuccess(run(assertMayDefineRole(held, ['a'])))).toBe(false)
  })

  it('has nothing to check when the role names no capabilities', () => {
    expect(Exit.isSuccess(run(assertMayDefineRole(authority([]), [])))).toBe(true)
  })
})

describe('granting a role', () => {
  const tenant = { kind: 'tenant' as const }
  const at = (coverage: 'self' | 'subtree') => ({
    kind: 'org-node' as const,
    orgNodeId: 'n',
    coverage,
  })

  it('allows only authority the granter holds', () => {
    const role = { codes: ['a'], allActive: false }
    expect(Exit.isSuccess(run(assertMayGrantRole(authority(['a']), role, tenant)))).toBe(true)
    const denied = refused(run(assertMayGrantRole(authority(['b']), role, tenant)))
    expect(denied?._tag).toBe('GRANT_ESCALATION_REFUSED')
    expect(denied?.permissions).toEqual(['a'])
  })

  it('lets only someone holding everything hand on an all-active role', () => {
    const role = { codes: [], allActive: true }
    // the role carries every active capability, so the granter must hold them
    expect(
      Exit.isSuccess(run(assertMayGrantRole(authority(['a', 'b'], {}, ['a', 'b']), role, tenant))),
    ).toBe(true)
    expect(
      Exit.isSuccess(run(assertMayGrantRole(authority(['a'], {}, ['a', 'b']), role, tenant))),
    ).toBe(false)
  })

  it('refuses coverage wider than the granter holds', () => {
    const role = { codes: ['a'], allActive: false }
    // holding it for one node is not authority to grant it over a subtree
    expect(
      Exit.isSuccess(run(assertMayGrantRole(authority([], { a: 'self' }), role, at('self')))),
    ).toBe(true)
    expect(
      Exit.isSuccess(run(assertMayGrantRole(authority([], { a: 'self' }), role, at('subtree')))),
    ).toBe(false)
    expect(
      Exit.isSuccess(run(assertMayGrantRole(authority([], { a: 'subtree' }), role, at('subtree')))),
    ).toBe(true)
  })

  it('makes the escape hatch answer to coverage as well', () => {
    // this is the case that would otherwise invert the rule: the weakest
    // possible bind would become the strongest thing to hold
    const role = { codes: ['a'], allActive: false }
    expect(
      Exit.isSuccess(
        run(assertMayGrantRole(authority([], { [ORG_BIND]: 'self' }), role, at('subtree'))),
      ),
    ).toBe(false)
    expect(
      Exit.isSuccess(
        run(assertMayGrantRole(authority([], { [ORG_BIND]: 'subtree' }), role, at('subtree'))),
      ),
    ).toBe(true)
  })

  it('uses the tenant bind for a tenant grant and the org bind for an org one', () => {
    const role = { codes: ['a'], allActive: false }
    // an org bind does not unlock a tenant-wide grant
    expect(Exit.isSuccess(run(assertMayGrantRole(authority([ORG_BIND]), role, tenant)))).toBe(
      false,
    )
    expect(Exit.isSuccess(run(assertMayGrantRole(authority([TENANT_BIND]), role, tenant)))).toBe(
      true,
    )
  })

  it('never lets an all-active role through on coverage alone', () => {
    // every code reachable at subtree, but the role carries everything, so
    // only the bind at that reach can justify it
    const role = { codes: [], allActive: true }
    expect(
      Exit.isSuccess(run(assertMayGrantRole(authority([], { a: 'subtree' }), role, at('subtree')))),
    ).toBe(false)
    expect(
      Exit.isSuccess(
        run(assertMayGrantRole(authority([], { [ORG_BIND]: 'subtree' }), role, at('subtree'))),
      ),
    ).toBe(true)
  })
})
