import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { normalizeScoringAuthoring } from '../src/scoring/authoring.ts'

// The V2 authoring language at its normalization boundary: identities are
// server-minted, carried forward only from the item's current stored form,
// and the stored output is deterministic enough that re-submitting it is a
// byte-level no-op. The legacy language passes through untouched.

const U1 = '01920000-0000-7000-8000-00000000000a'
const U2 = '01920000-0000-7000-8000-00000000000b'
const U3 = '01920000-0000-7000-8000-00000000000c'

const minting = (ids: readonly string[]) => {
  const calls: number[] = []
  return {
    calls,
    mint: (count: number) =>
      Effect.sync(() => {
        calls.push(count)
        return ids.slice(0, count)
      }),
  }
}

const normalize = (input: { current: unknown; submitted: unknown; ids?: readonly string[] }) => {
  const minted = minting(input.ids ?? [])
  return Effect.runPromise(
    normalizeScoringAuthoring({
      current: input.current,
      submitted: input.submitted,
      mint: minted.mint,
    }),
  ).then((outcome) => ({ outcome, calls: minted.calls }))
}

const issuesOf = (outcome: unknown) =>
  (outcome as { issues?: readonly { path: string; reason: string }[] }).issues ?? []

const draft = (recognitions: unknown[], bindings: Record<string, unknown> = {}) => ({
  version: 2,
  calculator: { ref: 'stored@1', config: { program: 'p' } },
  aggregator: { ref: 'sum@1', config: {} },
  recognitions,
  bindings,
})

const refinement = {
  type: 'integer',
  minimum: 0,
  maximum: 10,
}

describe('normalizing scoring authoring', () => {
  it('passes the legacy language through untouched', async () => {
    const legacy = { calculator: { ref: 'fixed@1', config: { value: '3' } } }
    const { outcome, calls } = await normalize({ current: null, submitted: legacy })
    expect(outcome).toEqual({ config: legacy })
    expect(calls).toEqual([])
    // even a non-object: the V1 compiler owns that refusal
    const odd = await normalize({ current: null, submitted: 'nonsense' })
    expect(odd.outcome).toEqual({ config: 'nonsense' })
  })

  it('refuses a version it does not speak', async () => {
    const { outcome } = await normalize({ current: null, submitted: { version: 5 } })
    expect(issuesOf(outcome)).toEqual([
      { path: 'scoringConfig.version', reason: 'authoring-version-unsupported' },
    ])
  })

  it('mints an identity per new recognition, in draft order', async () => {
    const submitted = draft(
      [
        { handle: 'level', label: '级别', refinement, defaultFromFieldId: null },
        { handle: 'grade', label: '等第', refinement: null, defaultFromFieldId: 'field-g' },
      ],
      {
        a: { kind: 'recognition', handle: 'level' },
        b: { kind: 'recognition', handle: 'grade' },
      },
    )
    const { outcome, calls } = await normalize({ current: null, submitted, ids: [U1, U2] })
    expect(calls).toEqual([2])
    const config = (outcome as { config: Record<string, unknown> }).config as {
      recognitions: Record<string, { label: string }>
      bindings: Record<string, { kind: string; recognitionId?: string }>
    }
    // the nth minted id belongs to the nth unminted recognition
    expect(config.recognitions[U1]?.label).toBe('级别')
    expect(config.recognitions[U2]?.label).toBe('等第')
    expect(config.bindings['a']?.recognitionId).toBe(U1)
    expect(config.bindings['b']?.recognitionId).toBe(U2)
  })

  it('carries an existing identity forward, and mints nothing for it', async () => {
    const current = {
      version: 2,
      calculator: { ref: 'stored@1', config: {} },
      aggregator: { ref: 'sum@1', config: {} },
      recognitions: { [U1]: { label: 'old', refinement: null, defaultFromFieldId: null } },
      bindings: {},
    }
    const submitted = draft(
      [
        {
          handle: 'renamed',
          id: U1,
          label: 'new name',
          refinement: null,
          defaultFromFieldId: null,
        },
      ],
      { a: { kind: 'recognition', handle: 'renamed' } },
    )
    const { outcome, calls } = await normalize({ current, submitted })
    expect(calls).toEqual([])
    const config = (outcome as { config: { recognitions: Record<string, unknown> } }).config
    expect(Object.keys(config.recognitions)).toEqual([U1])
  })

  it('refuses an identity nobody granted: invented, revived, misshapen or shared', async () => {
    const current = {
      version: 2,
      calculator: { ref: 'stored@1', config: {} },
      aggregator: { ref: 'sum@1', config: {} },
      recognitions: { [U1]: { label: 'a', refinement: null, defaultFromFieldId: null } },
      bindings: {},
    }
    // a well-shaped UUID the current form never declared - invented or
    // salvaged from a deleted recognition, both refused the same way
    const invented = await normalize({
      current,
      submitted: draft([
        { handle: 'x', id: U3, label: 'x', refinement: null, defaultFromFieldId: null },
      ]),
    })
    expect(issuesOf(invented.outcome)).toEqual([
      { path: 'scoringConfig.recognitions[0].id', reason: 'recognition-id-unknown' },
    ])
    // an authored string is not an identity
    const misshapen = await normalize({
      current,
      submitted: draft([
        { handle: 'x', id: 'rec-level', label: 'x', refinement: null, defaultFromFieldId: null },
      ]),
    })
    expect(issuesOf(misshapen.outcome)).toEqual([
      { path: 'scoringConfig.recognitions[0].id', reason: 'recognition-id-invalid' },
    ])
    // one identity cannot be two recognitions
    const shared = await normalize({
      current,
      submitted: draft([
        { handle: 'x', id: U1, label: 'x', refinement: null, defaultFromFieldId: null },
        { handle: 'y', id: U1, label: 'y', refinement: null, defaultFromFieldId: null },
      ]),
    })
    expect(issuesOf(shared.outcome)).toEqual([
      { path: 'scoringConfig.recognitions[1].id', reason: 'recognition-id-reused' },
    ])
    // and a V1 current grants nothing: moving to V2 is a fresh identity set
    const fromLegacy = await normalize({
      current: { calculator: {}, aggregator: {} },
      submitted: draft([
        { handle: 'x', id: U1, label: 'x', refinement: null, defaultFromFieldId: null },
      ]),
    })
    expect(issuesOf(fromLegacy.outcome)).toEqual([
      { path: 'scoringConfig.recognitions[0].id', reason: 'recognition-id-unknown' },
    ])
  })

  it('holds handles unique and bindings aimed at declared handles', async () => {
    const dup = await normalize({
      current: null,
      submitted: draft([
        { handle: 'x', label: 'a', refinement: null, defaultFromFieldId: null },
        { handle: 'x', label: 'b', refinement: null, defaultFromFieldId: null },
      ]),
      ids: [U1, U2],
    })
    expect(issuesOf(dup.outcome)).toEqual([
      { path: 'scoringConfig.recognitions[1].handle', reason: 'recognition-handle-reused' },
    ])
    const stray = await normalize({
      current: null,
      submitted: draft([], { a: { kind: 'recognition', handle: 'ghost' } }),
    })
    expect(issuesOf(stray.outcome)).toEqual([
      { path: 'scoringConfig.bindings.a', reason: 'recognition-unknown' },
    ])
  })

  it('refuses a crowd before minting anything for it', async () => {
    const many = Array.from({ length: 65 }, (_, index) => ({
      handle: `h${String(index)}`,
      label: 'x',
      refinement: null,
      defaultFromFieldId: null,
    }))
    const { outcome, calls } = await normalize({ current: null, submitted: draft(many) })
    expect(issuesOf(outcome)).toEqual([
      { path: 'scoringConfig.recognitions', reason: 'too-many-recognitions' },
    ])
    expect(calls).toEqual([])
  })

  it('checks a refinement early, by index: profile shape and pattern dialect', async () => {
    const outside = await normalize({
      current: null,
      submitted: draft([
        {
          handle: 'x',
          label: 'x',
          refinement: { type: 'integer' },
          defaultFromFieldId: null,
        },
      ]),
    })
    expect(issuesOf(outside.outcome)).toEqual([
      { path: 'scoringConfig.recognitions[0].refinement', reason: 'refinement-not-in-profile' },
    ])
    const dialect = await normalize({
      current: null,
      submitted: draft([
        {
          handle: 'x',
          label: 'x',
          refinement: { type: 'string', minLength: 1, maxLength: 8, pattern: '(?<=a)b' },
          defaultFromFieldId: null,
        },
      ]),
    })
    expect(issuesOf(dialect.outcome)).toEqual([
      {
        path: 'scoringConfig.recognitions[0].refinement',
        reason: 'refinement-pattern-outside-dialect',
      },
    ])
  })

  it('refuses an unknown envelope key instead of stripping it', async () => {
    const { outcome } = await normalize({
      current: null,
      submitted: { ...draft([]), novel: true },
    })
    expect(issuesOf(outcome)).toEqual([{ path: 'scoringConfig', reason: 'scoring-config-shape' }])
  })

  it('normalizes a stored form to itself, byte for byte', async () => {
    const submitted = draft(
      [
        { handle: 'b', label: 'B', refinement: null, defaultFromFieldId: null },
        { handle: 'a', label: 'A', refinement, defaultFromFieldId: 'field-a' },
      ],
      {
        z: { kind: 'recognition', handle: 'b' },
        y: { kind: 'recognition', handle: 'a' },
        x: { kind: 'constant', value: '3' },
      },
    )
    const first = await normalize({ current: null, submitted, ids: [U1, U2] })
    const stored = (first.outcome as { config: unknown }).config
    // the stored form, submitted verbatim against itself as current
    const second = await normalize({ current: stored, submitted: stored })
    expect(second.calls).toEqual([])
    const again = (second.outcome as { config: unknown }).config
    expect(JSON.stringify(again)).toBe(JSON.stringify(stored))
    // and a stored id outside the current form stays refused
    const foreign = await normalize({ current: null, submitted: stored })
    expect(issuesOf(foreign.outcome).map((issue) => issue.reason)).toContain(
      'recognition-id-unknown',
    )
  })
})
