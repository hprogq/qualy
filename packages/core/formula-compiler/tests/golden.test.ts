import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bundleFormula } from '../src/bundler.ts'
import { compileFormula } from '../src/compile.ts'

// The reproducibility anchor: same source, same toolchain - byte-identical
// artifact. Born as the extraction migration gate (hashes generated on main
// BEFORE the compiler moved packages); the toolchain has since legitimately
// evolved (the sdk gained its annotation layer), so the rule is now: an
// UNEXPLAINED mismatch is a stop-work signal, and the file is regenerated
// only in the same commit that deliberately changes the sdk or toolchain,
// with the reason recorded in STATUS.

const golden = JSON.parse(
  fs.readFileSync(new URL('./support/golden-artifacts.json', import.meta.url), 'utf8'),
) as Record<string, { source: string; artifactSha256: string; artifactBytes: number }>

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

describe('the migration golden', () => {
  for (const [name, expected] of Object.entries(golden)) {
    it(`reproduces the pre-extraction artifact byte for byte: ${name}`, async () => {
      const bundled = await bundleFormula(expected.source)
      expect(Buffer.byteLength(bundled.artifact, 'utf8')).toBe(expected.artifactBytes)
      expect(sha256(bundled.artifact)).toBe(expected.artifactSha256)
    })
  }

  it('carries the same identity through the whole compile pipeline', async () => {
    const outcome = await compileFormula(golden['identity']!.source)
    expect(outcome.kind).toBe('compiled')
    if (outcome.kind === 'compiled') {
      expect(outcome.runtimeSha256).toBe(golden['identity']!.artifactSha256)
      expect(outcome.typescriptVersion).toMatch(/^7\./)
      expect(outcome.esbuildVersion).toMatch(/^0\.28\./)
    }
  }, 60_000)
})
