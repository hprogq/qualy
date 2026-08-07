import { describe, expect, it } from 'vitest'
import { runtimeLevels, type RuntimeLayer } from '@qualy/assembly'

// Layer.mergeAll builds its members in parallel and does not satisfy
// dependencies between them, so the generated module has to provide each level
// to the ones above it. Getting the levels wrong is not a visible failure: it
// is a requirement that survives into generated code and surfaces as a type
// error nowhere near the manifest that caused it.

const layer = (id: string, dependsOn: string[] = []): RuntimeLayer => ({
  id,
  specifier: `${id}/effect`,
  dependsOn,
})

const ids = (levels: RuntimeLayer[][]) => levels.map((level) => level.map((l) => l.id))

describe('runtime levels', () => {
  it('puts a plugin above everything it depends on', () => {
    const levels = runtimeLevels([
      layer('org', ['rbac', 'auth']),
      layer('auth', ['rbac', 'db']),
      layer('rbac', ['db']),
      layer('db'),
    ])
    expect(ids(levels)).toEqual([['db'], ['rbac'], ['auth'], ['org']])
  })

  it('keeps independent plugins on one level so they build in parallel', () => {
    const levels = runtimeLevels([layer('a', ['db']), layer('b', ['db']), layer('db')])
    expect(ids(levels)).toEqual([['db'], ['a', 'b']])
  })

  it('places a plugin below anything that depends on it, not merely later', () => {
    // a plugin two hops down must not land on the same level as its dependent,
    // because a level is merged and a merge does not wire
    const levels = runtimeLevels([layer('top', ['mid']), layer('mid', ['base']), layer('base')])
    const level = (id: string) => levels.findIndex((l) => l.some((entry) => entry.id === id))
    expect(level('base')).toBeLessThan(level('mid'))
    expect(level('mid')).toBeLessThan(level('top'))
  })

  it('orders identically however the plugins arrive', () => {
    const shuffled = runtimeLevels([layer('rbac', ['db']), layer('db'), layer('org', ['rbac'])])
    expect(ids(shuffled)).toEqual([['db'], ['rbac'], ['org']])
  })

  it('names the plugin that is missing rather than leaving a type error', () => {
    expect(() => runtimeLevels([layer('org', ['rbac'])])).toThrow(
      /org declares a runtime dependency on rbac/,
    )
  })

  it('refuses a cycle and says static layers cannot express one', () => {
    expect(() => runtimeLevels([layer('org', ['rbac']), layer('rbac', ['org'])])).toThrow(
      /runtime dependency cycle: .*Static layers cannot express a cycle/s,
    )
  })

  it('ignores an empty assembly', () => {
    expect(runtimeLevels([])).toEqual([])
  })
})
