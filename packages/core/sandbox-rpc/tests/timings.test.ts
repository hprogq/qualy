import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { CompiledFormulaWire } from '../src/index.ts'

// The time inside a compile is advisory, so it is optional on the wire like
// every advisory field of this protocol: an authoring sandbox a generation
// apart, which does not say it, must still be readable, where one that left
// out the provenance must not be.

const compiled = {
  artifact: '/*artifact*/',
  sourceSha256: 'a'.repeat(64),
  runtimeSha256: 'b'.repeat(64),
  formulaRuntimeSha256: 'c'.repeat(64),
  sourcePolicyVersion: 1,
  sourcePolicyParserVersion: 'p',
  typescriptVersion: '7.0.2',
  esbuildVersion: '0.28.0',
  formulaAbiVersion: 1,
  authoringBuildId: 'build',
}

describe('a compile answer on the wire', () => {
  it('is read without the time inside, as an older sandbox sends it', () => {
    expect(Schema.decodeUnknownSync(CompiledFormulaWire)(compiled).timings).toBeUndefined()
  })

  it('carries the time inside when the sandbox says it', () => {
    const timings = { queueMs: 1, policyMs: 2, typecheckMs: 300, bundleMs: 40 }
    expect(Schema.decodeUnknownSync(CompiledFormulaWire)({ ...compiled, timings }).timings).toEqual(
      timings,
    )
  })

  it('is refused without its provenance', () => {
    const { authoringBuildId: _, ...withoutProvenance } = compiled
    expect(() => Schema.decodeUnknownSync(CompiledFormulaWire)(withoutProvenance)).toThrow()
  })
})
