import { createHash } from 'node:crypto'
import { Effect, Exit, Layer, Result, Scope, type Context } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Sandbox } from '@qualy/plugin-sandbox/service'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { validateAtomicProfile, validateInputProfile } from '@qualy/value-schema'
import { bundleFormula } from '@qualy/formula-compiler'

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
  output: Schema.scoreAmount({ maxScale: 4 }),
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
    Layer.buildWithScope(sandboxLocalLayer({ size: 1, variant: 'release' }), scope),
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
          // this suite EXPECTS completion; the 25ms scoring default is a
          // design value, not a wait budget, and cold ci machines miss it
          limits: { softDeadlineMs: 5_000, hardDeadlineMs: 10_000 },
        }),
      ),
    ).pipe(Effect.provide(context)),
  )
  if (!Result.isSuccess(outcome)) throw new Error(`sandbox refused: ${JSON.stringify(outcome)}`)
  return outcome.success.output
}

describe('a bundled artifact in the real sandbox', () => {
  it('hands out a profile-legal contract and scores exactly', async () => {
    const { artifact } = await bundleFormula(COMPETITION)
    // the wrapper stringifies the contract itself, with intrinsics captured
    // before any user code ran - one bounded string is all that crosses
    const contract = JSON.parse(await invoke(artifact, '__qualyContract', [])) as {
      input: unknown
      output: unknown
    }
    expect(validateInputProfile(contract.input)).toEqual([])
    expect(validateAtomicProfile(contract.output)).toEqual([])

    const answer = JSON.parse(await invoke(artifact, '__qualyInvoke', [JSON.stringify(INPUT)])) as {
      ok: boolean
      amount?: string
    }
    expect(answer).toEqual({ ok: true, amount: '0.9' })
  })

  it('carries q.fail out as an envelope, not a defect', async () => {
    const { artifact } = await bundleFormula(COMPETITION)
    const answer = JSON.parse(
      await invoke(artifact, '__qualyInvoke', [JSON.stringify({ ...INPUT, ordinal: 101 })]),
    ) as { ok: boolean; failure?: { message: string } }
    expect(answer).toEqual({ ok: false, failure: { message: 'ordinal is out of policy' } })
  })
})

describe('the entrypoints cannot be hijacked by the module they wrap', () => {
  // Every attack runs as user TOP-LEVEL code - before the wrapper installs
  // anything - and is swallowed by its own try/catch so the module still
  // evaluates. The claim under test: whatever the author's code did to the
  // two reserved globals, what the host calls is still the wrapper's.
  const MINIMAL_RUN = `export default defineFormula({
  input: Schema.input({ value: Schema.decimal({ maxScale: 2 }) }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run(input) {
    return input.value
  },
})`
  const hostile = (attack: string) => `import { Schema, defineFormula } from '@qualy/formula'
try {
  ${attack}
} catch {}
${MINIMAL_RUN}
`
  const attacks: readonly (readonly [string, string])[] = [
    ['assigns over the invoke entrypoint', `globalThis.__qualyInvoke = () => '"evil"'`],
    ['assigns over the contract entrypoint', `globalThis.__qualyContract = () => '"evil"'`],
    ['deletes the invoke entrypoint', `delete globalThis.__qualyInvoke`],
    ['deletes the contract entrypoint', `delete globalThis.__qualyContract`],
    [
      'redefines the invoke entrypoint',
      `Object.defineProperty(globalThis, '__qualyInvoke', { value: () => '"evil"' })`,
    ],
    [
      'redefines the contract entrypoint',
      `Object.defineProperty(globalThis, '__qualyContract', { value: () => '"evil"' })`,
    ],
  ]

  for (const [name, attack] of attacks) {
    it(`stays itself when the module ${name}`, async () => {
      const { artifact } = await bundleFormula(hostile(attack))
      const contract = JSON.parse(await invoke(artifact, '__qualyContract', [])) as {
        input: unknown
        output: unknown
      }
      // the real contract, not an attacker's string
      expect(validateInputProfile(contract.input)).toEqual([])
      const answer = JSON.parse(
        await invoke(artifact, '__qualyInvoke', [JSON.stringify({ value: '2.50' })]),
      ) as { ok: boolean; amount?: string }
      expect(answer).toEqual({ ok: true, amount: '2.5' })
    })
  }
})
