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
  it('keeps client directives before imports and other statements', () => {
    const offenders = ['apps', 'packages']
      .flatMap((root) => walk(root))
      .filter((file) => file.includes(`${path.sep}src${path.sep}`))
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        if (!/^['"]use client['"];?$/m.test(source)) return false
        const start = source
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .trimStart()
        return !/^['"]use client['"](?:;|\r?\n)/.test(start)
      })
    expect(offenders).toEqual([])
  })

  it('routes production query observers through the response-aware adapter', () => {
    const offenders = ['apps', 'packages']
      .flatMap((root) => walk(root))
      .filter((file) => file.includes(`${path.sep}src${path.sep}`))
      .filter((file) => !file.endsWith(`${path.sep}data${path.sep}query.ts`))
      .filter((file) =>
        /import\s*\{[^}]*\buseQuer(?:y|ies)\b[^}]*\}\s*from\s*['"]@tanstack\/react-query['"]/s.test(
          fs.readFileSync(file, 'utf8'),
        ),
      )
    expect(offenders).toEqual([])
  })

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
