import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// A test fixture that styles itself with a Tailwind utility only works while
// some production file happens to reference the same class: the tests
// directory sits outside the Tailwind scan, so the utility rides along until
// a migration removes its last production use - at which point the fixture
// silently changes shape (the shell's StyleX migration blanked the paper
// fixture's viewport exactly this way). Fixture-owned layout must be inline
// style or test-local StyleX; utility strings are allowed only in tests whose
// CONTRACT is the legacy class behavior itself, named below.

const TESTS_ROOT = path.join('apps', 'web', 'tests')

/** tests whose subject is the legacy className/utility contract itself */
const INTENTIONAL = new Set([
  // asserts the class attribute string carries through asChild; inert marker
  'button.browser.test.tsx',
  // pins the migration window's cascade with a real emitted utility
  'select-sizing.browser.test.tsx',
])

const walk = (root: string): string[] =>
  fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') ? [full] : []
  })

describe('browser fixture styling stays off the production Tailwind scan', () => {
  it('no test file carries a literal className string outside the named contracts', () => {
    const offenders = walk(TESTS_ROOT)
      .filter((file) => !INTENTIONAL.has(path.basename(file)))
      .flatMap((file) => {
        const lines = fs.readFileSync(file, 'utf8').split('\n')
        return lines.flatMap((line, at) =>
          line.includes('className="') ? [`${file}:${String(at + 1)} ${line.trim()}`] : [],
        )
      })
    expect(offenders).toEqual([])
  })
})
