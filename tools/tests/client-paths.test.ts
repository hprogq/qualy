import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'

// Internal navigation names a page reference; a literal route in business
// code is how a path silently forks from its declaration. The host app and
// the runtime own routing itself and are therefore not scanned.
const CLIENT_ROOTS = ['packages/plugins']

const BARE_INTERNAL_PATH =
  /(?:\bto=["'`]\/|\bto=\{["'`]\/|\bnavigate\(\s*["'`]\/|<Navigate\s+to=["'`]\/)/

const walk = walkSources

describe('client navigation discipline', () => {
  it('never hardcodes an internal route in plugin client code', () => {
    const offenders = CLIENT_ROOTS.flatMap((root) => walk(root))
      .filter((file) => file.includes(`${path.sep}client${path.sep}`))
      .flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ file, line: index + 1, text: line }))
          .filter((entry) => BARE_INTERNAL_PATH.test(entry.text)),
      )
      .map((entry) => `${entry.file}:${entry.line} ${entry.text.trim()}`)
    expect(offenders).toEqual([])
  })
})
