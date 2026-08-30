import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Where the arithmetic may reach, and where it may not.
//
// Scoring has two halves on purpose. Evaluating what a claim is worth is
// allowed to reach for services - a calculator backed by a stored function
// has to read one, and one day it will run guest code in a sandbox. The
// ledger below it is a pure function of amounts: no effects, no database, no
// clock, no guest execution. That line is what makes "the same frozen facts
// give the byte-identical breakdown" a property rather than a hope, and it
// is not a line a type can hold - so it is held here.

const root = path.resolve(import.meta.dirname, '../..')

const codeOnly = (source: string) =>
  source
    .split('\n')
    .map((line) => line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))

const breaches = (
  files: readonly string[],
  rules: readonly { pattern: RegExp; why: string }[],
): string[] =>
  files.flatMap((file) =>
    codeOnly(fs.readFileSync(path.join(root, file), 'utf8')).flatMap((line, index) =>
      rules
        .filter((rule) => rule.pattern.test(line))
        .map((rule) => `${file}:${index + 1} ${rule.why}`),
    ),
  )

/** the pure half: an account, from amounts already decided */
const LEDGER = ['packages/plugins/assessment/core/src/scoring/calc.ts']

const FORBIDDEN = [
  { pattern: /from ['"]effect['"]/, why: 'imports Effect into the pure ledger' },
  { pattern: /from ['"].*plugin-sandbox/, why: 'reaches guest execution from the pure ledger' },
  { pattern: /from ['"].*assessment-formula/, why: 'reaches the formula plugin from the ledger' },
  { pattern: /from ['"].*\/db\.ts['"]/, why: 'queries the database from the pure ledger' },
  { pattern: /from ['"]kysely['"]/, why: 'builds sql in the pure ledger' },
  { pattern: /\bpayload\b/, why: 'reads a filing as scoring input' },
]

const manifestOf = (dir: string) =>
  JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8')) as {
    name: string
    dependencies?: Record<string, string>
  }

describe('the line between evaluating and accounting', () => {
  it('keeps the ledger pure', () => {
    expect(breaches(LEDGER, FORBIDDEN)).toEqual([])
  })

  it('keeps guest execution and the formula library out of assessment core', () => {
    // Core knows calculators by reference and contract; it must not learn
    // what a formula or a sandbox is. When formula@1 arrives it arrives as
    // a plugin contributing a driver, never as a dependency of this one.
    const deps = Object.keys(manifestOf('packages/plugins/assessment/core').dependencies ?? {})
    for (const banned of [
      '@qualy/plugin-sandbox',
      '@qualy/plugin-assessment-formula',
      '@qualy/sandbox-engine',
      '@qualy/formula-compiler',
      'quickjs-emscripten',
    ]) {
      expect(deps, banned).not.toContain(banned)
    }
  })
})
