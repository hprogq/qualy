import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'

// The widget library is an implementation detail of @qualy/ui.
//
// Everything a page uses arrives through that boundary, which is what makes
// the substrate replaceable at all: the pivot that put Mantine underneath
// touched one package because nothing outside it named the old library
// either. The boundary erodes one import at a time, and each one is
// individually reasonable - a Stack here, a Group there, a style prop to
// avoid writing a compiled style - so it is checked rather than remembered.
//
// Reaching it THROUGH @qualy/ui is the point and is not what this looks at.

const OWNER = path.join('packages', 'web', 'ui')
const ROOTS = ['packages', 'apps', 'tools']
const IMPORTS_WIDGETS = /\bfrom\s+['"]@mantine\/|\brequire\(\s*['"]@mantine\//

const manifests = (): string[] => {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const at = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(at)
      else if (entry.name === 'package.json') found.push(at)
    }
  }
  for (const root of ROOTS) walk(root)
  return found
}

describe('the widget library stays behind @qualy/ui', () => {
  it('is imported by no source outside it', () => {
    const offenders = ROOTS.flatMap((root) => walkSources(root))
      .filter((file) => !file.includes(OWNER))
      .flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .map((text, index) => ({ file, line: index + 1, text }))
          .filter((entry) => IMPORTS_WIDGETS.test(entry.text)),
      )
      .map((entry) => `${entry.file}:${entry.line} ${entry.text.trim()}`)
    expect(offenders).toEqual([])
  })

  it('is depended on by no package but it', () => {
    const offenders = manifests()
      .filter((file) => !file.includes(OWNER))
      .filter((file) => {
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as {
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }
        const named = { ...manifest.dependencies, ...manifest.devDependencies }
        return Object.keys(named).some((name) => name.startsWith('@mantine/'))
      })
    expect(offenders).toEqual([])
  })
})
