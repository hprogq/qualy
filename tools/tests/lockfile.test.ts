import { describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'
import { lockedPackages, readLockfile } from '../lib/lockfile.ts'

const text = readLockfile()

describe('the lockfile', () => {
  it('reads the complete workspace package set from a pnpm 12 lockfile', () => {
    const documents = parseAllDocuments(text)
    expect(documents.flatMap((document) => document.errors)).toEqual([])
    const workspace = documents.find((document) => document.hasIn(['importers', 'apps/web']))
    expect(workspace).toBeDefined()
    const decoded = workspace?.toJS() as { packages?: Record<string, unknown> } | undefined
    const locked = lockedPackages(text)
    expect(locked.map((one) => `${one.name}@${one.version}`)).toEqual(
      Object.keys(decoded?.packages ?? {}),
    )
    for (const name of ['postgres-array', 'pg-cursor', 'qs', '@effect/platform-node-shared'])
      expect(locked.some((one) => one.name === name)).toBe(true)
  })

  it('does not mistake an environment-only lockfile for the workspace graph', () => {
    const environment = '---\npackages:\n  pnpm@12.18.0: {}\n'
    expect(lockedPackages(environment + '---\nimporters:\n  .: {}\n')).toEqual([])
  })
})
