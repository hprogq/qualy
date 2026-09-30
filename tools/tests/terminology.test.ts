import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles, walkSources } from '../lib/walk.ts'

// A tenant's word for a person's identifier is a term, chosen in settings and
// read through `useTerm` / `resolveTerm`. The default word lives in exactly
// one place - the message the term's declaration names as its default - and
// a screen, or another message, that spells it out again is one the tenant
// cannot rename.
//
// Production sources only: a fixture may name the default freely, since it
// is what a tenant that never chose otherwise sees.

const repoRoot = path.resolve(import.meta.dirname, '../..')

const DEFAULT_WORD = '学工号'

/** the one declaration: auth's message for the term's default */
const DECLARED = {
  file: 'packages/plugins/base/auth/messages/zh-CN.json',
  key: 'settings_term_businessNumberDefault',
}

describe('the identifier term', () => {
  it('is spelled out in no source', () => {
    const offenders = [
      ...walkSources(path.join(repoRoot, 'packages'), ['tests', 'node_modules', 'client-dist']),
      ...walkSources(path.join(repoRoot, 'apps'), ['tests', 'node_modules', 'dist']),
    ]
      .map((file) => path.relative(repoRoot, file))
      .filter((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8').includes(DEFAULT_WORD))
    expect(offenders).toEqual([])
  })

  it('is spelled out in no message but its own', () => {
    const said: string[] = []
    for (const file of walkFiles(path.join(repoRoot, 'packages'), ['tests', 'client-dist'])) {
      // a package's messages, one file per locale
      if (!/[\\/]messages[\\/][a-z]{2}-[A-Z]{2}\.json$/.test(file)) continue
      const messages = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
      for (const [key, message] of Object.entries(messages)) {
        if (typeof message === 'string' && message.includes(DEFAULT_WORD)) {
          said.push(`${path.relative(repoRoot, file)} ${key}`)
        }
      }
    }
    expect(said).toEqual([`${DECLARED.file} ${DECLARED.key}`])
  })
})
