import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// the installed set (installed.lock.json) is the only input of database
// assembly; flipping active-set state in cordis.yml must be invisible to
// every installed-driven artifact

describe('installed-set invariants', () => {
  it('disabling a plugin does not alter installed-driven artifacts', () => {
    const lockBefore = fs.readFileSync('assembly.lock.json', 'utf8')
    const assemblyBefore = fs.readFileSync('generated/db/assembly.gen.ts', 'utf8')
    const yml = fs.readFileSync('cordis.yml', 'utf8')
    try {
      fs.writeFileSync(
        'cordis.yml',
        yml.replace("name: '@qualy/plugin-ping'", "name: '@qualy/plugin-ping'\n  disabled: true"),
      )
      execSync('pnpm gen', { stdio: 'pipe' })
      expect(
        fs.readFileSync('assembly.lock.json', 'utf8'),
        'Disabling a plugin must not alter installed database schema',
      ).toBe(lockBefore)
      expect(
        fs.readFileSync('generated/db/assembly.gen.ts', 'utf8'),
        'Disabling a plugin must not alter installed database schema',
      ).toBe(assemblyBefore)
    } finally {
      fs.writeFileSync('cordis.yml', yml)
      execSync('pnpm gen', { stdio: 'pipe' })
    }
  })
})
