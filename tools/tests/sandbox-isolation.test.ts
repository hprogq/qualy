import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The dependency gate of the process-isolation spec (§47): once compilation
// and execution live behind sockets, the business server's production
// dependency closure must not contain a formula compiler or a guest engine.
// Walked over package.json dependencies only - devDependencies are exactly
// where the in-process test stand-ins are allowed to stay.

const root = path.resolve(import.meta.dirname, '..', '..')

const manifestOf = (dir: string): { name: string; dependencies?: Record<string, string> } =>
  JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))

const workspaceDirs = (): Map<string, string> => {
  const found = new Map<string, string>()
  const globs = ['packages/core', 'packages/contracts', 'packages/web', 'packages/build']
  for (const base of globs) {
    for (const entry of fs.readdirSync(path.join(root, base))) {
      const dir = path.join(root, base, entry)
      if (fs.existsSync(path.join(dir, 'package.json'))) found.set(manifestOf(dir).name, dir)
    }
  }
  for (const family of fs.readdirSync(path.join(root, 'packages/plugins'))) {
    const familyDir = path.join(root, 'packages/plugins', family)
    if (!fs.statSync(familyDir).isDirectory()) continue
    for (const entry of fs.readdirSync(familyDir)) {
      const dir = path.join(familyDir, entry)
      if (fs.existsSync(path.join(dir, 'package.json'))) found.set(manifestOf(dir).name, dir)
    }
  }
  for (const entry of fs.readdirSync(path.join(root, 'apps'))) {
    const dir = path.join(root, 'apps', entry)
    if (fs.existsSync(path.join(dir, 'package.json'))) found.set(manifestOf(dir).name, dir)
  }
  return found
}

const closureOf = (start: string): Set<string> => {
  const dirs = workspaceDirs()
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const name = queue.pop()!
    if (seen.has(name)) continue
    seen.add(name)
    const dir = dirs.get(name)
    if (dir === undefined) continue
    for (const dependency of Object.keys(manifestOf(dir).dependencies ?? {})) {
      if (!seen.has(dependency)) queue.push(dependency)
    }
  }
  return seen
}

describe('the sandbox dependency gate', () => {
  it('keeps the compiler out of the formula plugin', () => {
    const deps = Object.keys(
      manifestOf(path.join(root, 'packages/plugins/assessment/formula')).dependencies ?? {},
    )
    for (const banned of ['typescript', 'typescript6', 'esbuild', '@qualy/formula-compiler'])
      expect(deps, banned).not.toContain(banned)
  })

  it('keeps the engine out of the sandbox plugin', () => {
    const deps = Object.keys(
      manifestOf(path.join(root, 'packages/plugins/infra/sandbox')).dependencies ?? {},
    )
    for (const banned of [
      '@qualy/sandbox-engine',
      'quickjs-emscripten-core',
      '@jitl/quickjs-wasmfile-release-sync',
      '@jitl/quickjs-wasmfile-debug-sync',
    ])
      expect(deps, banned).not.toContain(banned)
  })

  it('keeps guest execution and compilation out of the server closure', () => {
    const closure = closureOf('@qualy/app')
    for (const banned of [
      '@qualy/sandbox-engine',
      '@qualy/formula-compiler',
      '@qualy/sandbox-runtime',
      '@qualy/sandbox-authoring',
      'quickjs-emscripten-core',
      '@jitl/quickjs-wasmfile-release-sync',
      'esbuild',
      'typescript',
      'typescript6',
    ])
      expect([...closure], banned).not.toContain(banned)
  })
})
