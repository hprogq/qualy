import { afterAll, describe, expect, it } from 'vitest'
import {
  checkFormulaWorkspace,
  dropWorkspace,
  stageFormulaWorkspace,
  tscEntry,
} from './support/workspace.ts'

// The stage-two gate: TypeScript 7, invoked exactly the way publication will
// invoke it, must derive a formula's types from its schemas alone — literal
// choice unions included — and must refuse the specific confusions the type
// system is there to catch. If any case here cannot hold, the plan stops.

const staged: string[] = []
afterAll(() => {
  for (const root of staged.splice(0)) dropWorkspace(root)
})

const check = async (source: string) => {
  const root = stageFormulaWorkspace(source)
  staged.push(root)
  return checkFormulaWorkspace(root, tscEntry)
}

const COMPETITION = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    level: Schema.choice({ national: '国家级', provincial: '省部级', city: '市级' }),
    ordinal: Schema.integer({ minimum: 1 }),
    projectType: Schema.choice({ individual: '个人', team: '集体' }),
    base: Schema.decimal({ maxScale: 4 }),
    step: Schema.decimal({ maxScale: 4 }),
    floor: Schema.decimal({ maxScale: 4 }),
  }),
  output: Schema.decimal({ maxScale: 4 }),
  run(input, q) {
    const first = input.projectType === 'team' ? q.decimal.mul(input.base, q.decimal.quantize(input.step, 2)) : input.base
    const decline = q.decimal.mulInteger(input.step, input.ordinal - 1)
    return q.decimal.max(q.decimal.sub(first, decline), input.floor)
  },
})
`

describe('the formula workspace compiler', () => {
  it('accepts a real competition formula', async () => {
    const outcome = await check(COMPETITION)
    expect(outcome.output).toBe('')
    expect(outcome.code).toBe(0)
  }, 90_000)

  it('accepts the identity formula', async () => {
    const outcome = await check(`import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({ value: Schema.decimal({ minimum: '1.00', maximum: '6.00', maxScale: 2 }) }),
  output: Schema.decimal({ maxScale: 2 }),
  run: (input) => input.value,
})
`)
    expect(outcome.output).toBe('')
    expect(outcome.code).toBe(0)
  }, 90_000)

  it('types integers as numbers, not strings', async () => {
    const outcome = await check(
      COMPETITION.replace(
        'const decline',
        'const wrong = input.ordinal.toUpperCase()\n    const decline',
      ),
    )
    expect(outcome.code).not.toBe(0)
    expect(outcome.output).toContain('toUpperCase')
  }, 90_000)

  it('derives choices as literal unions', async () => {
    const outcome = await check(
      COMPETITION.replace("input.projectType === 'team'", "input.projectType === 'committee'"),
    )
    expect(outcome.code).not.toBe(0)
    expect(outcome.output).toContain('committee')
  }, 90_000)

  it('refuses a non-decimal return against a decimal output', async () => {
    const outcome = await check(
      COMPETITION.replace(
        'return q.decimal.max(q.decimal.sub(first, decline), input.floor)',
        'return true',
      ),
    )
    expect(outcome.code).not.toBe(0)
    expect(outcome.output).toMatch(/boolean/)
  }, 90_000)

  it('keeps Decimal opaque to numeric operators', async () => {
    const outcome = await check(
      COMPETITION.replace(
        'return q.decimal.max(q.decimal.sub(first, decline), input.floor)',
        'return first + decline',
      ),
    )
    expect(outcome.code).not.toBe(0)
    expect(outcome.output).toMatch(/cannot be applied|not assignable/)
  }, 90_000)

  it('resolves nothing but the two staged packages', async () => {
    const outcome = await check(`import { Schema, defineFormula } from '@qualy/formula'
import fs from 'node:fs'

export default defineFormula({
  input: Schema.input({}),
  output: Schema.decimal(),
  run: (input, q) => q.decimal.fromInteger(fs.readFileSync ? 1 : 0),
})
`)
    expect(outcome.code).not.toBe(0)
    expect(outcome.output).toContain('node:fs')
  }, 90_000)
})
