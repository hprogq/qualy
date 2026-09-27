import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOOT_HOOKS } from '../boot-hooks.ts'

// A seeding run stops at a boot hook it has not been told about, which is
// right, but it says so an hour into regenerating the data. Every hook the
// plugins register is sorted here instead, where adding one fails a test.

const PLUGINS = path.resolve(import.meta.dirname, '../../../packages/plugins')

/** boot hooks register a name and a run, perhaps with a comment between; readiness probes register a probe */
const REGISTERED = /\.register\(\{\s*name:\s*'([^']+)',(?:\s*\/\/[^\n]*)*\s*run:/g

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'tests' ? [] : sources(at)
    }
    return entry.name.endsWith('.ts') ? [at] : []
  })

const registered = new Set(
  sources(PLUGINS).flatMap((file) =>
    [...fs.readFileSync(file, 'utf8').matchAll(REGISTERED)].map((match) => match[1]!),
  ),
)

describe("the seeding run's boot hooks", () => {
  it('finds the hooks it is sorting', () => {
    expect(registered.size).toBeGreaterThan(10)
  })

  it('sorts every hook a plugin registers', () => {
    expect([...registered].filter((name) => BOOT_HOOKS[name] === undefined)).toEqual([])
  })

  it('sorts no hook that nobody registers any more', () => {
    expect(Object.keys(BOOT_HOOKS).filter((name) => !registered.has(name))).toEqual([])
  })
})
