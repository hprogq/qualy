import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'

// What the serving runtime is allowed to load late.
//
// A process that is about to be replaced by a newer one has a window between
// "this candidate has finished composing" and "this candidate is now the
// server". The disk moves during that window - that is the whole point of a
// development loop - so a module first loaded after it does not come from the
// generation the rest of the process was built from. One process, two
// versions of the source, and the mismatch is invisible.
//
// Static imports are immune: they are all resolved before the candidate ever
// reports itself ready. So the rule is that serving-runtime code loads its
// own modules statically, and the exceptions are listed here by hand with the
// reason each one is not serving-runtime work at all.
//
// This is a register, not a ban. Adding a line is fine; adding it silently is
// not, because the line is where somebody states which band the module is
// loaded in.

const ROOT = path.resolve(import.meta.dirname, '../..')

/** where the server's own runtime lives; the browser has its own lifecycle */
const ROOTS = ['apps/server/src', 'packages/core', 'packages/contracts', 'packages/plugins']
const BROWSER = `${path.sep}client${path.sep}`

const RELATIVE_DYNAMIC_IMPORT = /import\(\s*['"](\.[^'"]*)['"]/g

/**
 * The relative modules a file loads at run time.
 *
 * `typeof import('...')` is a type query and is gone before the file runs, and
 * a line of prose describing one is not code at all - both are written in this
 * repository and neither loads anything.
 */
const lateLoadsIn = (text: string): string[] =>
  text.split('\n').flatMap((line) => {
    const code = line.trimStart()
    if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return []
    return [...line.matchAll(new RegExp(RELATIVE_DYNAMIC_IMPORT.source, 'g'))]
      .filter((match) => !line.slice(0, match.index).endsWith('typeof '))
      .map((match) => match[1]!)
  })

/**
 * The late loads that are not serving-runtime work, and why.
 *
 * Each key is a repository-relative file; each value says which band the
 * module is actually loaded in.
 */
const REGISTERED: Record<string, string> = {
  'apps/server/src/main.ts':
    'the composition root itself, imported while the boot is still composing - before any resource exists - so that a failure to load it is reported by the logger this process already installed',
  'packages/plugins/infra/database/src/index.ts':
    'a capability module and a CLI command, both loaded by the assembly tooling rather than by a running server',
  'packages/plugins/base/rbac/src/index.ts': 'a capability module, loaded by the assembly tooling',
  'packages/plugins/infra/database/src/assembly/index.ts':
    'inside the capability module: the generator, the differ and the migrator, each loaded by the command that needs it',
}

describe('what the serving runtime loads late', () => {
  it('loads its own modules statically, except where the register says otherwise', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of walkSources(path.join(ROOT, root))) {
        if (file.includes(BROWSER)) continue
        const relative = path.relative(ROOT, file)
        if (relative.includes(`${path.sep}tests${path.sep}`) || relative.endsWith('.test.ts')) {
          continue
        }
        const found = lateLoadsIn(fs.readFileSync(file, 'utf8'))
        if (found.length === 0) continue
        if (relative in REGISTERED) continue
        offenders.push(`${relative} loads ${found.join(', ')} late`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the register honest about what still exists', () => {
    const stale = Object.keys(REGISTERED).filter((relative) => {
      const file = path.join(ROOT, relative)
      if (!fs.existsSync(file)) return true
      return lateLoadsIn(fs.readFileSync(file, 'utf8')).length === 0
    })
    expect(stale).toEqual([])
  })
})
