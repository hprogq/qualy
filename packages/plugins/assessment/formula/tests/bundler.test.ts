import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FormulaBundleRefused, bundleFormula } from '../src/server/bundler.ts'

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({ value: Schema.decimal({ minimum: '1.00', maximum: '6.00', maxScale: 2 }) }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

describe('the artifact bundler', () => {
  it('produces a self-contained artifact with no real paths in it', async () => {
    const { artifact, sdkFiles } = await bundleFormula(IDENTITY)
    expect(artifact).toContain('__qualyContract')
    expect(artifact).toContain('__qualyInvoke')
    expect(artifact).not.toContain('import ')
    expect(artifact).not.toContain('require(')
    expect(artifact).not.toContain(process.cwd())
    expect(artifact).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\/)
    expect(sdkFiles.size).toBeGreaterThan(3)
    for (const name of sdkFiles.keys()) expect(name).toMatch(/^(formula|value-schema)\//)
  })

  it('is byte-identical across builds', async () => {
    const one = await bundleFormula(IDENTITY)
    const two = await bundleFormula(IDENTITY)
    expect(sha(one.artifact)).toBe(sha(two.artifact))
  })

  it('refuses any USED import besides the sdk, by name', async () => {
    // an unused import never reaches resolution: esbuild's ts loader elides
    // it, and the typecheck stage before this one already refuses anything
    // unresolvable in the two-package workspace. What this second fence must
    // stop is an import whose binding the formula actually evaluates.
    for (const [importLine, use] of [
      ["import fs from 'node:fs'", 'fs.readFileSync'],
      ["import x from './other.ts'", 'x'],
      ["import _ from 'lodash'", '_.identity'],
    ] as const) {
      const source = `${importLine}\nconst probe = ${use}\nvoid probe\n${IDENTITY}`
      await expect(bundleFormula(source)).rejects.toSatisfy(
        (error: unknown) => error instanceof FormulaBundleRefused,
      )
    }
  })
})
