import { describe, expect, it } from 'vitest'
import { sourcePolicy, sourcePolicyParserVersion } from '../src/source-policy.ts'

// The language fence on a real AST. Where the old lexer refused by shape,
// this refuses by syntax: strings and comments are content again, and the
// whole §52 attack list must die here - before TS7 is ever spawned.

const refusalsOf = (source: string) => {
  const verdict = sourcePolicy(source)
  if (verdict.kind !== 'refused') return []
  // positions ride along for editors; these assertions compare substance
  return verdict.findings.map(({ line, column, ...finding }) => {
    expect(line).toBeGreaterThan(0)
    expect(column).toBeGreaterThan(0)
    return finding
  })
}

describe('the source policy', () => {
  it('names its parser', () => {
    expect(sourcePolicyParserVersion()).toBe('typescript@6.0.3')
  })

  it('allows the sdk import in its ordinary shapes', () => {
    expect(sourcePolicy(`import x from '@qualy/formula'`).kind).toBe('clean')
    expect(sourcePolicy(`import type { Static } from '@qualy/formula'`).kind).toBe('clean')
    expect(
      sourcePolicy(`import { defineFormula, Schema } from "@qualy/formula"\nconst a = 1`).kind,
    ).toBe('clean')
    expect(sourcePolicy(`export default 1`).kind).toBe('clean')
  })

  it('refuses every other module dependency by name', () => {
    expect(refusalsOf(`import fs from 'node:fs'`)).toEqual([
      { reason: 'import', specifier: 'node:fs' },
    ])
    expect(refusalsOf(`import x from '../../x.ts'`)).toEqual([
      { reason: 'import', specifier: '../../x.ts' },
    ])
    expect(refusalsOf(`export { x } from '/tmp/x'`)).toEqual([
      { reason: 'import', specifier: '/tmp/x' },
    ])
  })

  it('refuses import-equals outright, even for the sdk', () => {
    expect(refusalsOf(`import type Secret = require('/tmp/x')`)).toEqual([
      { reason: 'import', specifier: '/tmp/x' },
    ])
    expect(refusalsOf(`import X = require('../../x')`)).toEqual([
      { reason: 'import', specifier: '../../x' },
    ])
    expect(refusalsOf(`import F = require('@qualy/formula')`)).toEqual([
      { reason: 'import', specifier: '@qualy/formula' },
    ])
  })

  it('refuses type-position and dynamic imports', () => {
    expect(refusalsOf(`type X = import('/tmp/x').X`)).toEqual([
      { reason: 'import', specifier: '/tmp/x' },
    ])
    expect(refusalsOf(`await import('/tmp/x')`)).toEqual([
      { reason: 'import', specifier: '/tmp/x' },
    ])
    expect(refusalsOf('await import(`/tmp/x`)')).toEqual([
      { reason: 'import', specifier: '/tmp/x' },
    ])
    expect(refusalsOf(`const name = '/tmp/x'; await import(name)`)).toEqual([
      { reason: 'import', specifier: '<dynamic specifier>' },
    ])
  })

  it('refuses explicit any wherever it is syntax', () => {
    expect(refusalsOf(`let x: any`)).toEqual([{ reason: 'any' }])
    expect(refusalsOf(`const y = (1 as unknown) as any`)).toEqual([{ reason: 'any' }])
    expect(refusalsOf(`const z = <any>1`)).toEqual([{ reason: 'any' }])
  })

  it('refuses suppression directives inside comments', () => {
    expect(refusalsOf(`// @ts-ignore\nconst a = 1`)).toEqual([
      { reason: 'suppression', specifier: '@ts-ignore' },
    ])
    expect(refusalsOf(`/* @ts-nocheck */ const a = 1`)).toEqual([
      { reason: 'suppression', specifier: '@ts-nocheck' },
    ])
    expect(refusalsOf(`// @ts-expect-error\nconst a = 1`)).toEqual([
      { reason: 'suppression', specifier: '@ts-expect-error' },
    ])
  })

  it('refuses file-head triple-slash references, where the compiler honors them', () => {
    expect(refusalsOf(`/// <reference path="./b.d.ts" />\nconst a = 1`)).toEqual([
      { reason: 'triple-slash' },
    ])
    expect(refusalsOf(`/// <reference types="node" />\nconst a = 1`)).toEqual([
      { reason: 'triple-slash' },
    ])
  })

  it('treats strings and comments as content, not syntax', () => {
    // the old whole-text scan refused all of these; a parser knows better
    expect(sourcePolicy(`const s = "import('/fake') any @ts-nocheck"`).kind).toBe('clean')
    expect(sourcePolicy(`// import x from '/tmp/ghost'\nconst a = 1`).kind).toBe('clean')
    expect(sourcePolicy(`const many = 'many any germany'`).kind).toBe('clean')
  })

  it('demands clean syntax before reasoning at all', () => {
    const verdict = sourcePolicy(`const = = ;;; import { x } from '/tmp/x`)
    expect(verdict.kind).toBe('syntax')
    if (verdict.kind === 'syntax') {
      expect(verdict.diagnostics.length).toBeGreaterThan(0)
      expect(verdict.diagnostics[0]).toMatchObject({
        line: expect.any(Number),
        column: expect.any(Number),
        code: expect.stringMatching(/^TS\d+$/),
      })
    }
  })

  it('collects every finding, not just the first', () => {
    const findings = refusalsOf(
      [`import fs from 'node:fs'`, `let a: any`, `await import('/x')`].join('\n'),
    )
    expect(findings.map((finding) => finding.reason).sort()).toEqual(['any', 'import', 'import'])
  })

  it('handles division and regular expressions like the language they are', () => {
    // the token-fence era refused regex literals as a lexing hazard; a real
    // parser has no such ambiguity to defend against
    expect(sourcePolicy(`const half = a / 2\nconst r = /abc/.test(s)`).kind).toBe('clean')
  })
})
