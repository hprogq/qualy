import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { CalculatorRuntimeError } from '../src/plugin.ts'
import { proveSettlements } from '../src/scoring/failure-boundary.ts'
import type { ScoringPlan } from '../src/scoring/plan.ts'

// Proving a whole import's worth of determinations before any of it is
// written.
//
// The single-record path runs the writer, rolls it back, proves, and runs it
// again. Two thousand of those is the batch lock held for two thousand
// sandbox runs, so a bulk act inverts the order: prove first, outside any
// transaction, and write identities it already holds. What that costs is
// what this pins - one preparation for the whole import, one evaluation per
// distinct determination, and a refusal that belongs to its own rows rather
// than to the import.

const plan = {
  version: 1,
  planHash: 'plan-hash',
  calculator: { ref: 'test@1', config: {}, contractHash: 'x' },
  parameters: {
    level: { kind: 'recognition', recognitionId: 'rec-level', assignment: { kind: 'direct' } },
  },
  inputSchema: {
    type: 'object',
    properties: { level: { type: 'string', enum: ['national', 'provincial', 'refused'] } },
    required: ['level'],
    additionalProperties: false,
  },
  // the calculator answers a decimal string; the plan says so, and the
  // boundary checks it before it counts as an amount
  outputSchema: { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2 },
  recognitionSchemas: {},
} as unknown as ScoringPlan

const site = {
  tenantId: 't',
  batchId: 'b',
  itemId: 'item-under-test',
  revisionId: 'rev-1',
  plan,
}

/** a runtime that counts what it was asked to do */
const runtimeThat = (
  answer: (input: Readonly<Record<string, unknown>>) => Effect.Effect<unknown, unknown>,
) => {
  const counts = { prepared: 0, evaluated: 0 }
  const runtime = {
    prepare: () => {
      counts.prepared += 1
      return Effect.succeed({
        evaluate: (input: Readonly<Record<string, unknown>>) => {
          counts.evaluated += 1
          return answer(input)
        },
      })
    },
  }
  return { runtime: runtime as never, counts }
}

const amount = (value: string) => Effect.succeed(value)

describe('proving a whole import before writing any of it', () => {
  it('prepares the arithmetic once, however many rows there are', async () => {
    const { runtime, counts } = runtimeThat(() => amount('1.00'))
    const rows = Array.from({ length: 50 }, (_, at) => ({
      'rec-level': at % 2 === 0 ? 'national' : 'provincial',
    }))
    const proven = await Effect.runPromise(proveSettlements(runtime, site, rows))

    // every row of one import answers the same question version, so it is
    // the same calculator and the same plan
    expect(counts.prepared).toBe(1)
    // and fifty rows saying two things is two pieces of arithmetic
    expect(counts.evaluated).toBe(2)
    expect(proven.size).toBe(2)
  })

  it('gives determinations that say the same thing the same identity', async () => {
    const { runtime } = runtimeThat(() => amount('1.00'))
    const proven = await Effect.runPromise(
      proveSettlements(runtime, site, [
        { 'rec-level': 'national' },
        { 'rec-level': 'national' },
        { 'rec-level': 'provincial' },
      ]),
    )
    const identities = [...proven.values()].map((one) =>
      'identity' in one ? one.identity : 'refused',
    )
    // two distinct answers out of three rows, and neither is a refusal
    expect(new Set(identities).size).toBe(2)
    expect(identities).not.toContain('refused')
  })

  it('gives a refusal to the rows that earned it, and proves the rest anyway', async () => {
    const { runtime } = runtimeThat((input) =>
      input['level'] === 'refused'
        ? Effect.fail({ kind: 'refusal' as const, reason: 'no such level here' })
        : amount('1.00'),
    )
    const proven = await Effect.runPromise(
      proveSettlements(runtime, site, [
        { 'rec-level': 'national' },
        { 'rec-level': 'refused' },
        { 'rec-level': 'provincial' },
      ]),
    )

    const answers = [...proven.values()]
    // the reader of a preview is owed every bad row at once, not the first
    // one and then silence
    expect(answers.filter((one) => 'refused' in one)).toHaveLength(1)
    expect(answers.filter((one) => 'identity' in one)).toHaveLength(2)
  })

  it('raises an outage rather than reporting it row by row', async () => {
    const { runtime } = runtimeThat(() =>
      Effect.fail({ kind: 'unavailable' as const, reason: 'sandbox down' }),
    )
    const exit = await Effect.runPromiseExit(
      proveSettlements(runtime, site, [{ 'rec-level': 'national' }]),
    )
    // nothing can be proven, so nothing can be written: this is not a fact
    // about one row
    expect(exit._tag).toBe('Failure')
  })

  it('raises an outage when the runtime will not prepare at all', async () => {
    const runtime = {
      prepare: () => Effect.fail(new CalculatorRuntimeError('unavailable', 'no sandbox')),
    } as never
    const exit = await Effect.runPromiseExit(
      proveSettlements(runtime, site, [{ 'rec-level': 'national' }]),
    )
    expect(exit._tag).toBe('Failure')
  })

  it('asks nothing of the sandbox when there is nothing to prove', async () => {
    const { runtime, counts } = runtimeThat(() => amount('1.00'))
    const proven = await Effect.runPromise(proveSettlements(runtime, site, []))
    expect(proven.size).toBe(0)
    // a question that determines nothing must not start a sandbox
    expect(counts.prepared).toBe(0)
  })
})
