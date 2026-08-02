import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// a moved or deleted file must never leave a dangling package export behind
// (a "./x" entry that resolves but points nowhere)

function workspaceManifests(): string[] {
  const manifests: string[] = []
  for (const pattern of ['packages', 'apps']) {
    const stack = [pattern]
    while (stack.length > 0) {
      const dir = stack.pop()!
      if (!fs.existsSync(dir)) continue
      for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!child.isDirectory() || child.name === 'node_modules') continue
        const full = path.join(dir, child.name)
        if (fs.existsSync(path.join(full, 'package.json'))) {
          manifests.push(path.join(full, 'package.json'))
        }
        stack.push(full)
      }
    }
  }
  return manifests.sort()
}

function fileTargets(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('./') ? [value] : []
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((nested) => fileTargets(nested))
  }
  return []
}

describe('workspace package exports', () => {
  it('point at files that exist', () => {
    const missing: string[] = []
    for (const manifest of workspaceManifests()) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        name?: string
        exports?: Record<string, unknown>
      }
      for (const target of fileTargets(pkg.exports ?? {})) {
        const resolved = path.join(path.dirname(manifest), target)
        if (!fs.existsSync(resolved)) missing.push(`${pkg.name}: ${target}`)
      }
    }
    expect(missing).toEqual([])
  })
})
