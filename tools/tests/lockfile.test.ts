import { describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'
import { documentCount, lockedPackages, readLockfile } from '../lib/lockfile.ts'

// The lockfile is read by more than pnpm. GitHub's dependency graph, and the
// Dependabot alerts that stand on it, read only the first YAML document: when
// pnpm 12 put a document of its own first, the graph fell from 864 packages
// to 249 and every transitive dependency dropped out of view without an error
// anywhere (2026-09-29). One document, then - and the daily
// check-dependency-graph run holds the graph itself to this lockfile.

const text = readLockfile()

describe('the lockfile', () => {
  it('is a single YAML document, which is all the dependency graph reads', () => {
    expect(documentCount(text)).toBe(1)
    expect(parseAllDocuments(text)).toHaveLength(1)
  })

  it('reads the same packages by hand as a YAML parser does', () => {
    const [document] = parseAllDocuments(text)
    const packages = document?.toJS() as { packages?: Record<string, unknown> }
    const parsed = Object.keys(packages.packages ?? {})
    const byHand = lockedPackages(text).map((one) => `${one.name}@${one.version}`)
    expect(byHand.length).toBeGreaterThan(0)
    expect(byHand).toEqual(parsed)
  })

  it('tells a second document apart from the first', () => {
    expect(documentCount('lockfileVersion: 9.0\n')).toBe(1)
    expect(documentCount('---\nlockfileVersion: 9.0\n')).toBe(1)
    expect(documentCount('---\na: 1\n---\nlockfileVersion: 9.0\n')).toBe(2)
  })
})
