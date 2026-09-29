import { describe, expect, it } from 'vitest'
import { filingCopyOf } from '../src/cli/filing-copy.ts'

const mapOf = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8')

const built = {
  version: 3,
  file: 'c-editor.js',
  sources: [
    '../../node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor.js',
    '../../packages/plugins/formula/src/client/FormulaEditor.tsx',
    'node_modules/react/index.js',
  ],
  sourcesContent: [
    'export const editor = 1',
    'export function FormulaEditor() {}',
    'module.exports = 2',
  ],
  names: ['editor', 'FormulaEditor'],
  mappings: 'AAAA,SAAS;ACAT',
}

describe('the copy of a map the platform is given', () => {
  it('leaves out what a dependency wrote and keeps what this product wrote', () => {
    const copy = JSON.parse(filingCopyOf(mapOf(built)).toString('utf8')) as typeof built
    expect(copy.sourcesContent).toEqual([null, 'export function FormulaEditor() {}', null])
  })

  it('still maps every position to the same file, line and name', () => {
    const copy = JSON.parse(filingCopyOf(mapOf(built)).toString('utf8')) as typeof built
    expect({ ...copy, sourcesContent: undefined }).toEqual({ ...built, sourcesContent: undefined })
  })

  it('files a map with nothing to leave out as the bytes the build wrote', () => {
    const own = mapOf({
      ...built,
      sources: [built.sources[1]],
      sourcesContent: [built.sourcesContent[1]],
    })
    expect(filingCopyOf(own)).toBe(own)
    const bare = mapOf({ version: 3, sources: [built.sources[0]], names: [], mappings: 'AAAA' })
    expect(filingCopyOf(bare)).toBe(bare)
  })
})
