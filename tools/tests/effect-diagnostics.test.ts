import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The Effect language service can also run during `tsc`, which is where it
// earns its place: a floating effect or a leaked layer requirement becomes a
// build failure rather than an editor squiggle somebody may not have open.
//
// That only works while the native TypeScript binary stays patched with the
// Effect build, and the patch is reapplied by a `prepare` script that a
// partial install can skip. A gate
// that can quietly stop working is worse than no gate, so this compiles a file
// that is deliberately wrong and fails if nothing complains.

// inside a package that depends on effect, so node resolution finds it by
// walking up the way any real source file does
const HOST = 'apps/server'

const fixture = (body: string) => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), HOST, '.effect-diagnostics-'))
  fs.writeFileSync(path.join(dir, 'subject.ts'), body)
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: path.join(process.cwd(), 'tsconfig.base.json'),
      compilerOptions: { types: [], plugins: [{ name: '@effect/language-service' }] },
      include: ['subject.ts'],
    }),
  )
  return dir
}

const typecheck = (dir: string): string => {
  try {
    execFileSync(path.join(process.cwd(), 'node_modules/.bin/tsc'), ['-p', dir, '--noEmit'], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return ''
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }
}

describe('effect diagnostics during tsc', () => {
  it('reports a floating effect', () => {
    const dir = fixture(
      `import { Effect } from 'effect'\nexport const oops = () => {\n  Effect.succeed(1)\n  return 2\n}\n`,
    )
    try {
      const output = typecheck(dir)
      expect(
        output,
        'tsc reported nothing: the TypeScript binary is no longer patched. Run `pnpm exec effect-tsgo patch`.',
      ).toMatch(/floatingEffect/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('says nothing about code that is fine', () => {
    // so the check above is about the diagnostic and not about tsc failing for
    // some unrelated reason
    const dir = fixture(
      `import { Effect } from 'effect'\nexport const fine = Effect.gen(function* () {\n  return yield* Effect.succeed(1)\n})\n`,
    )
    try {
      expect(typecheck(dir)).toBe('')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
