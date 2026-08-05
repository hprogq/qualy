import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Two suites on one port fail intermittently and blame each other.
//
// The Effect suites each start a real server, and vitest runs files in
// parallel, so a port claimed twice is an EADDRINUSE in whichever file loses.
// It happened, and it did not look like a port: it looked like a login test
// that could not reach its own server.

const roots = ['packages', 'apps', 'scripts']

const walk = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.name === 'node_modules' || entry.name === 'dist') return []
        if (entry.isDirectory()) return walk(full)
        return entry.isFile() && full.endsWith('.test.ts') ? [full] : []
      })
    : []

describe('the ports test servers listen on', () => {
  it('gives each suite one of its own', () => {
    const claims = new Map<string, string[]>()
    for (const file of roots.flatMap(walk)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\bconst port = (\d{4})\b/g)) {
        claims.set(match[1]!, [...(claims.get(match[1]!) ?? []), file])
      }
    }
    const shared = [...claims]
      .filter(([, files]) => files.length > 1)
      .map(([port, files]) => `${port}: ${files.join(', ')}`)
    expect(shared).toEqual([])
  })
})
