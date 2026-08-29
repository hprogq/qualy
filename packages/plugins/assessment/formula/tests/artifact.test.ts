import { createHash } from 'node:crypto'
import { Effect, Exit, Layer, Result, Scope, type Context } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Sandbox, sandboxLayer } from '@qualy/plugin-sandbox/service'
import { validateAtomicProfile, validateInputProfile } from '@qualy/value-schema'
import { bundleFormula } from '../src/server/bundler.ts'

// The whole compiled surface, end to end: a bundled artifact runs inside the
// real sandbox, hands its frozen contract out through __qualyContract, and
// scores through __qualyInvoke with q.fail arriving as an envelope rather
// than a defect.

const COMPETITION = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    level: Schema.choice({ national: '国家级', provincial: '省部级', city: '市级' }),
    ordinal: Schema.integer({ minimum: 1 }),
    projectType: Schema.choice({ individual: '个人', team: '集体' }),
    nationalBase: Schema.decimal({ maxScale: 4 }),
    provincialBase: Schema.decimal({ maxScale: 4 }),
    cityBase: Schema.decimal({ maxScale: 4 }),
    individualStep: Schema.decimal({ maxScale: 4 }),
    teamFactor: Schema.decimal({ maxScale: 4 }),
    teamStep: Schema.decimal({ maxScale: 4 }),
    floor: Schema.decimal({ maxScale: 4 }),
  }),
  output: Schema.decimal({ maxScale: 4 }),
  run(input, q) {
    if (input.ordinal > 100) q.fail('ordinal is out of policy')
    const base =
      input.level === 'national'
        ? input.nationalBase
        : input.level === 'provincial'
          ? input.provincialBase
          : input.cityBase
    const first = input.projectType === 'team' ? q.decimal.mul(base, input.teamFactor) : base
    const step = input.projectType === 'team' ? input.teamStep : input.individualStep
    const decline = q.decimal.mulInteger(step, input.ordinal - 1)
    return q.decimal.max(q.decimal.sub(first, decline), input.floor)
  },
})
`

const INPUT = {
  level: 'provincial',
  ordinal: 2,
  projectType: 'team',
  nationalBase: '3.00',
  provincialBase: '2.00',
  cityBase: '1.00',
  individualStep: '0.20',
  teamFactor: '0.50',
  teamStep: '0.10',
  floor: '0.00',
}

let scope: Scope.Scope
let context: Context.Context<Sandbox>

beforeAll(async () => {
  scope = await Effect.runPromise(Scope.make())
  context = await Effect.runPromise(
    Layer.buildWithScope(sandboxLayer({ size: 1, variant: 'release' }), scope),
  )
})

afterAll(() => Effect.runPromise(Scope.close(scope as Scope.Closeable, Exit.void)))

const invoke = async (artifact: string, entrypoint: string, args: readonly unknown[]) => {
  const outcome = await Effect.runPromise(
    Effect.flatMap(Sandbox, (sandbox) =>
      Effect.result(
        sandbox.invoke({
          artifact,
          artifactHash: createHash('sha256').update(artifact, 'utf8').digest('hex'),
          entrypoint,
          arguments: args as never,
        }),
      ),
    ).pipe(Effect.provide(context)),
  )
  if (!Result.isSuccess(outcome)) throw new Error(`sandbox refused: ${JSON.stringify(outcome)}`)
  return outcome.success
}

describe('a bundled artifact in the real sandbox', () => {
  it('hands out a profile-legal contract and scores exactly', async () => {
    const { artifact } = await bundleFormula(COMPETITION)
    const contract = (await invoke(artifact, '__qualyContract', [])) as {
      input: unknown
      output: unknown
    }
    expect(validateInputProfile(contract.input)).toEqual([])
    expect(validateAtomicProfile(contract.output)).toEqual([])

    const answer = JSON.parse(
      (await invoke(artifact, '__qualyInvoke', [JSON.stringify(INPUT)])) as string,
    ) as { ok: boolean; amount?: string }
    expect(answer).toEqual({ ok: true, amount: '0.9' })
  })

  it('carries q.fail out as an envelope, not a defect', async () => {
    const { artifact } = await bundleFormula(COMPETITION)
    const answer = JSON.parse(
      (await invoke(artifact, '__qualyInvoke', [
        JSON.stringify({ ...INPUT, ordinal: 101 }),
      ])) as string,
    ) as { ok: boolean; failure?: { message: string } }
    expect(answer).toEqual({ ok: false, failure: { message: 'ordinal is out of policy' } })
  })
})
