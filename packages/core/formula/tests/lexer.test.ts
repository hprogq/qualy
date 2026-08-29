import { describe, expect, it } from 'vitest'
import {
  DYNAMIC_SPECIFIER,
  moduleSpecifiers,
  REGEX_LITERAL,
  UNTERMINATED_TEXT,
} from '../src/lexer.ts'

const SDK = '@qualy/formula'
const trespasses = (source: string) => moduleSpecifiers(source).filter((name) => name !== SDK)

describe('the module-closure lexer', () => {
  it('allows the sdk import in its ordinary shapes', () => {
    expect(trespasses(`import x from '@qualy/formula'`)).toEqual([])
    expect(trespasses(`import type { Static } from '@qualy/formula'`)).toEqual([])
    expect(
      trespasses(`import { defineFormula, Schema } from "@qualy/formula"\nconst a = 1`),
    ).toEqual([])
  })

  it('refuses import-equals-require, with and without the type modifier', () => {
    expect(moduleSpecifiers(`import type Secret = require('/tmp/x')`)).toContain('/tmp/x')
    expect(moduleSpecifiers(`import X = require('../../x')`)).toContain('../../x')
  })

  it('refuses export-from, type-position import and dynamic import', () => {
    expect(moduleSpecifiers(`export { x } from '/tmp/x'`)).toContain('/tmp/x')
    expect(moduleSpecifiers(`type X = import('/tmp/x').X`)).toContain('/tmp/x')
    expect(moduleSpecifiers(`await import('/tmp/x')`)).toContain('/tmp/x')
  })

  it('refuses a non-string specifier in call position outright', () => {
    expect(moduleSpecifiers('await import(`/tmp/x`)')).toContain(DYNAMIC_SPECIFIER)
    expect(moduleSpecifiers('const name = "/tmp/x"; await import(name)')).toContain(
      DYNAMIC_SPECIFIER,
    )
    expect(moduleSpecifiers('require(dynamicName)')).toContain(DYNAMIC_SPECIFIER)
  })

  it('survives whitespace, newlines and comments inside the syntax', () => {
    expect(moduleSpecifiers(`import\n  (\n  '/tmp/x'\n)`)).toContain('/tmp/x')
    expect(moduleSpecifiers(`import/*c*/('/tmp/x')`)).toContain('/tmp/x')
    expect(moduleSpecifiers(`import type X = require ( '/tmp/x' )`)).toContain('/tmp/x')
  })

  it('stays conservative about specifier-looking text in comments', () => {
    // the byte channel reads raw text on purpose: a commented-out import is
    // refused rather than reasoned about
    expect(moduleSpecifiers(`// import x from '/tmp/ghost'\nconst a = 1`)).toContain('/tmp/ghost')
  })

  it('refuses regular expression literals as outside the formula language', () => {
    expect(moduleSpecifiers(`const re = /abc/`)).toContain(REGEX_LITERAL)
    expect(moduleSpecifiers(`return /abc/`)).toContain(REGEX_LITERAL)
    // statement position after a block: `}` deliberately re-scans
    expect(
      moduleSpecifiers(`{ }
/abc/.test(name)`),
    ).toContain(REGEX_LITERAL)
  })

  it('does not mistake division for a regex', () => {
    expect(trespasses(`const half = a / 2\nconst third = (a + b) / 3 + c / 4`)).toEqual([])
    expect(trespasses(`const r = total / count / 2`)).toEqual([])
  })

  it('refuses an unterminated string instead of mis-lexing the tail', () => {
    expect(moduleSpecifiers(`const s = 'oops`)).toContain(UNTERMINATED_TEXT)
    expect(moduleSpecifiers('const t = `oops')).toContain(UNTERMINATED_TEXT)
  })

  it('keeps template substitutions aligned so later strings still lex', () => {
    const source = 'const label = `sum ${total + 1} of ${count}`\nimport ("/tmp/x")'
    expect(moduleSpecifiers(source)).toContain('/tmp/x')
    expect(trespasses('const label = `a ${x} b ${y} c`')).toEqual([])
  })

  it('catches a specifier hidden behind a mis-judged regex position', () => {
    // `)` reads as division context, so /'/ mis-lexes and swallows the rest
    // of the line in the token channel - the byte channel still sees the
    // literal keywords and refuses
    const source = `if (x) /'/.test(s); import type X = require('/tmp/x')`
    expect(moduleSpecifiers(source).some((name) => name !== SDK)).toBe(true)
  })
})
