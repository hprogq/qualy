import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Two suites on one port fail intermittently and blame each other.
//
// The Effect suites each start a real server, and vitest runs files in
// parallel, so a port claimed twice is an EADDRINUSE in whichever file loses.
// It happened, and it did not look like a port: it looked like a login test
// that could not reach its own server.

const roots = ['packages', 'apps', 'tools']

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

  it('does not let one suite race itself for its own port', () => {
    // A port is shared state across the cases in a file just as much as across
    // files, and one of these suites asserts that nothing is listening on it.
    // Marking such a suite concurrent had that case read another case's server
    // and fail on a schedule a single-file run never reproduces.
    const offenders = roots
      .flatMap(walk)
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return /\bconst port = \d{4}\b/.test(source) && /\.concurrent\b/.test(source)
      })
      .map((file) => `${file} claims a fixed port and runs concurrently`)
    expect(offenders).toEqual([])
  })
})

// Scripts name paths, and this repository has moved its paths twice. The last
// move left `pnpm plugin:add` - the mandated way to add a plugin - invoking a
// CLI that no longer existed, after it had already edited two manifests and
// installed, and nothing was red until somebody ran it.
const glob = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : glob(full)
        return /\.(ts|yml|yaml|json)$/.test(entry.name) ? [full] : []
      })
    : []

describe('what the scripts point at', () => {
  // what a command string EXECUTES, which is the thing that moves and the
  // thing whose absence is only discovered by running it. Paths a script
  // computes from a root it was handed are that script's business.
  const executed = (source: string): string[] => [
    ...[...source.matchAll(/(?:tsx|node)\s+([\w./-]+\.tsx?)/g)].map((match) => match[1]!),
    // and the same target held in a constant, which is where it moved to
    // after the first repair
    ...[...source.matchAll(/'((?:apps|packages|tools)\/[\w./-]+\.tsx?)'/g)].map(
      (match) => match[1]!,
    ),
  ]

  const sources = ['package.json', ...glob('tools'), ...glob('.github/workflows')]

  it('names files that exist', () => {
    const missing: string[] = []
    for (const source of new Set(sources)) {
      if (!fs.existsSync(source) || fs.statSync(source).isDirectory()) continue
      for (const referenced of executed(fs.readFileSync(source, 'utf8'))) {
        if (!fs.existsSync(referenced)) missing.push(`${source} -> ${referenced}`)
      }
    }
    expect(missing).toEqual([])
  })
})
