import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// A fixture that borrows an opaque class from the application stylesheet
// changes shape when that unrelated production rule moves. Fixture-owned
// layout must use inline style or test-local StyleX. Literal classes are
// allowed only when class propagation itself is the contract, named below.

const TESTS_ROOT = path.join('apps', 'web', 'tests')

/** tests whose subject is the legacy className/utility contract itself */
const INTENTIONAL = new Set([
  // asserts the class attribute string carries through asChild; inert marker
  'button.browser.test.tsx',
])

const walk = (root: string): string[] =>
  fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') ? [full] : []
  })

describe('browser fixture styling is self-contained', () => {
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
