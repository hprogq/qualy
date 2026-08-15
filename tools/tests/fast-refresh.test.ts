import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'

// A module that exports a component and anything else cannot be hot-replaced:
// the editor reloads the whole page on every keystroke in it, and the screen
// under work loses whatever state it was holding. Types are erased and do not
// count; a constant, a helper or a hook does.
//
// Twice now a row model and a label map have drifted into a component file
// and cost the reload, which is what this is here to catch.
// Plugin screens only. The shared web packages publish hooks beside their
// providers on purpose - whether to split those is its own question, and not
// one a screen's reload budget should decide.
const CLIENT_ROOTS = ['packages/plugins']

const VALUE_EXPORT = /^export\s+(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/
const isComponent = (name: string) => /^[A-Z]/.test(name)

describe('client module discipline', () => {
  it('exports only components from a file that exports a component', () => {
    const offenders = CLIENT_ROOTS.flatMap((root) => walkSources(root))
      .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
      .filter((file) => file.includes(`${path.sep}client${path.sep}`))
      .flatMap((file) => {
        const lines = fs.readFileSync(file, 'utf8').split('\n')
        const named = lines.flatMap((line) => {
          const found = VALUE_EXPORT.exec(line)
          return found === null ? [] : [found[1]!]
        })
        // a file with no component in it is a plain module and free to export
        // whatever it likes; the rule is about mixing the two
        if (!named.some(isComponent)) return []
        return named
          .filter((name) => !isComponent(name))
          .map((name) => `${path.relative(process.cwd(), file)} exports ${name}`)
      })
    expect(offenders).toEqual([])
  })
})
