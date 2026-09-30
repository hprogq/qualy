import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SupportedLocale } from '@qualy/i18n-contract'
import {
  compileMessages,
  messagesOutDir,
  readMessages,
} from '../../packages/build/messages/src/compile.ts'
import { repoRoot } from '../lib/manifest.ts'

// Every message, as the runtime that served it before the compiler did
// rendered it: both locales, each number at 0, 1, 2 and 1234.5, each select
// at every case it names and one it does not (fixtures/messages-golden.json,
// written once from the Lingui runtime before it left). A message whose
// source is still the one migrated must render exactly as it did; one
// edited since is its author's to read, and is skipped by its hash.
//
// What this holds after the migration is the compiler: an upgrade of
// Paraglide or of the ICU plugin that renders a plural, an exact case or a
// number differently fails here, sentence by sentence.

type Row = [inputs: Record<string, unknown>, english: string, chinese: string]
const golden = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tools/tests/fixtures/messages-golden.json'), 'utf8'),
) as Record<string, [hash: string, rows?: Row[]]>

const result = await compileMessages({})
// every package's messages merged under their namespaces, as the compiler reads them
const merged = readMessages(result.sources).byLocale as Record<
  SupportedLocale,
  Record<string, string>
>
const compiled = (await import(
  pathToFileURL(path.join(messagesOutDir(repoRoot), 'paraglide', 'messages', '_index.js')).href
)) as Record<string, (inputs: unknown, options: { locale: SupportedLocale }) => string>

const hashOf = (english: string, chinese: string) =>
  createHash('sha256').update(`${english}\0${chinese}`).digest('hex').slice(0, 16)

describe('the compiled messages', () => {
  it('render every migrated message as it was rendered before', () => {
    const differ: string[] = []
    let checked = 0
    for (const [key, [hash, rows]] of Object.entries(golden)) {
      const english = merged['en-US'][key]
      const chinese = merged['zh-CN'][key]
      // gone, or edited since: nothing here to compare it with
      if (english === undefined || chinese === undefined) continue
      if (hashOf(english, chinese) !== hash) continue
      const say = compiled[key]!
      const cases: Row[] = rows ?? [[{}, english, chinese]]
      for (const [inputs, wantEnglish, wantChinese] of cases) {
        for (const [locale, want] of [
          ['en-US', wantEnglish],
          ['zh-CN', wantChinese],
        ] as const) {
          const got = say(inputs, { locale })
          if (got !== want)
            differ.push(`${key} ${locale} ${JSON.stringify(inputs)}: ${got} != ${want}`)
        }
      }
      checked += 1
    }
    expect(differ).toEqual([])
    // the migration's own messages are most of what there is; a check that
    // matched nothing would pass by vacuity
    expect(checked).toBeGreaterThan(Object.keys(golden).length / 2)
  })
})
