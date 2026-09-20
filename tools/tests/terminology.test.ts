import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'

// A tenant's word for a person's identifier is a term, chosen in settings and
// read through `useTerm` / `resolveTerm`. The default word lives in exactly
// one place - the term's declaration - and a screen that spells it out
// again is a screen the tenant cannot rename.
//
// Production sources only: a fixture may name the default freely, since it
// is what a tenant that never chose otherwise sees.

const repoRoot = path.resolve(import.meta.dirname, '../..')

const DEFAULT_WORD = '学工号'

/** the one declaration, and nothing else */
const ALLOWED = new Set(['packages/contracts/auth/src/terms.ts'])

describe('the identifier term', () => {
  it('is spelled out only where it is declared', () => {
    const offenders = [
      ...walkSources(path.join(repoRoot, 'packages'), ['tests', 'node_modules', 'client-dist']),
      ...walkSources(path.join(repoRoot, 'apps'), ['tests', 'node_modules', 'dist']),
    ]
      .map((file) => path.relative(repoRoot, file))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8').includes(DEFAULT_WORD))
    expect(offenders).toEqual([])
  })
})
