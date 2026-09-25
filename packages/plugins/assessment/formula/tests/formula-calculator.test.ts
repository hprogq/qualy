import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { Schema } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { Sandbox } from '@qualy/plugin-sandbox/service'
import { SandboxTimeout } from '@qualy/sandbox-rpc'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import { configurationAccessLayer } from '@qualy/plugin-assessment/server/configuration-access'
import type { Rbac } from '@qualy/rbac-contract/effect'
import type {
  CalculatorContractError,
  CalculatorEvaluationError,
  CalculatorRuntimeError,
  FrozenCalculatorContract,
  RuntimeRef,
} from '@qualy/plugin-assessment/plugin'
import { FormulaLibrary, layer as formulaLayer } from '../src/server/index.ts'
import { FormulaRuntimeStore, runtimeStoreLayer } from '../src/server/runtime-store.ts'
import { BindableFormulaCatalog, bindingCatalogLayer } from '../src/server/binding-catalog.ts'
import { formula1, formulaConfigSchema } from '../src/scoring/formula-calculator.ts'
import { FormulaSettings } from '../src/server/config.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'

// formula@1 itself: the administrator's whole configuration is one exact
// version UUID; compile freezes that version's identity, verify and prepare
// hold a frozen plan to it field by field, and evaluate runs the published
// artifact. Neither compile nor verify may touch the sandbox - half these
// bearings run against a sandbox that dies on contact to prove it.

const stack = (url: string) =>
  Layer.mergeAll(
    formulaLayer.pipe(
      Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })),
      Layer.provide(formulaAuthoringLocalLayer),
    ),
    runtimeStoreLayer,
    bindingCatalogLayer.pipe(Layer.provide(configurationAccessLayer)),
    sandboxLocalLayer({ size: 1, variant: 'release' }),
  ).pipe(Layer.provideMerge(servicesFor(url)))

const run = <A, E>(
  url: string,
  effect: Effect.Effect<
    A,
    E,
    FormulaLibrary | FormulaRuntimeStore | BindableFormulaCatalog | Sandbox | Rbac | Orm
  >,
) => Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

/** the sandbox that proves an availability boundary: any contact is a defect */
const dyingSandbox = {
  invoke: () => Effect.die(new Error('the sandbox must not be touched on this path')),
} as unknown as Sandbox['Service']

/** the writer open, which every bearing about compile itself assumes */
const authoringOn = Effect.provideService(FormulaSettings, FormulaSettings.of({ authoring: true }))

const MOODY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    mode: Schema.choice({ ok: '正常', refuse: '拒绝', loop: '循环' }, { title: '模式' }),
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run(input, q) {
    if (input.mode === 'refuse') q.fail('refused by policy')
    if (input.mode === 'loop') {
      for (;;) {
        // burns the deadline on purpose
      }
    }
    return input.value
  },
})
`

const failureOf = (
  exit: Exit.Exit<unknown, unknown>,
): CalculatorContractError | CalculatorRuntimeError | CalculatorEvaluationError => {
  if (Exit.isSuccess(exit)) throw new Error('expected a failure, got success')
  const cause = exit.cause as { reasons?: readonly { error?: unknown }[] }
  const failure = cause.reasons?.map((one) => one.error).find((error) => error !== undefined)
  if (failure === undefined) {
    throw new Error(`expected a typed failure, got ${inspect(exit.cause, { depth: 10 })}`)
  }
  return failure as CalculatorContractError | CalculatorRuntimeError | CalculatorEvaluationError
}

describe.runIf(postgresAvailable)('the formula calculator', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-calculator')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('compiles the exact published identity, and gates only NEW bindings', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fc-compile')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const batch = one<{ id: string }>(
            yield* runSql(sql`
              insert into assessment_batches (tenant_id, name, material_range)
              values (${f.t}, 'Round', daterange('2026-03-01','2026-09-01'))
              returning id`),
          ).id
          yield* runSql(sql`
            insert into batch_management_anchors (tenant_id, batch_id, org_node_id)
            values (${f.t}, ${batch}, ${f.collegeA})`)

          const created = yield* library.createFunction(
            f.t,
            { name: '心情分', description: '' },
            as,
          )
          const drafted = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: MOODY,
              draftTests: [{ name: 'ok', input: { mode: 'ok', value: '3.00' }, expected: '3' }],
            },
            as,
          )
          const published = yield* library.publish(
            f.t,
            created.id,
            {
              expectedDraftRevision: drafted.draftRevision,
              releaseName: `release ${drafted.draftRevision}`,
            },
            as,
          )
          void published
          const versionId = one<{ id: string }>(
            yield* runSql(
              sql`select id from assessment_formula_versions where function_id = ${created.id}`,
            ),
          ).id
          const row = one<{ runtime_sha256: string; contract_sha256: string }>(
            yield* runSql(sql`
              select runtime_sha256, contract_sha256 from assessment_formula_versions
              where id = ${versionId}`),
          )

          // every compile in this test runs against a DYING sandbox: the
          // whole compile path never touches execution
          const bound = yield* formula1.bind.pipe(
            Effect.provideService(Sandbox, dyingSandbox),
            authoringOn,
          )
          const host = { tenantId: f.t, batchId: batch }

          const fresh = yield* bound.compile({ versionId }, host)
          const reference = fresh.runtimeRef as RuntimeRef
          // archiving the function closes the door to NEW bindings only
          yield* library.setStatus(f.t, created.id, 'archived', as)
          const archivedNew = yield* Effect.exit(bound.compile({ versionId }, host))
          const continuation = yield* Effect.exit(
            bound.compile({ versionId }, { ...host, previousRuntimeRef: reference }),
          )
          const corrupt = yield* Effect.exit(
            bound.compile(
              { versionId },
              { ...host, previousRuntimeRef: { ...reference, sha256: 'a'.repeat(64) } },
            ),
          )
          const alien = yield* Effect.exit(
            bound.compile(
              { versionId },
              { ...host, previousRuntimeRef: { ...reference, kind: 'test-program' } },
            ),
          )
          const unknownVersion = yield* Effect.exit(
            bound.compile({ versionId: '01920000-0000-7000-8000-0000000000aa' }, host),
          )
          const defensive = yield* Effect.exit(bound.compile({ versionId, extra: true }, host))
          return {
            versionId,
            row,
            fresh,
            reference,
            archivedNew,
            continuation,
            corrupt,
            alien,
            unknownVersion,
            defensive,
          }
        }),
      ),
    )
    // the frozen identity is the published row's, field for field
    expect(outcome.fresh.contractHash).toBe(outcome.row.contract_sha256)
    expect(outcome.reference).toEqual({
      kind: 'formula-version',
      id: outcome.versionId,
      sha256: outcome.row.runtime_sha256,
    })
    expect(outcome.fresh.config).toEqual({ versionId: outcome.versionId })
    // a NEW binding after archive is a lawful refusal, by name
    const refused = failureOf(outcome.archivedNew) as CalculatorContractError
    expect(refused.kind).toBe('refusal')
    expect(refused.code).toBe('formula-function-archived')
    // the SAME identity continues - archive does not strand a running question
    expect(Exit.isSuccess(outcome.continuation)).toBe(true)
    // but a matching id with a corrupt historical sha is a broken promise,
    // never quietly repaired by a resave
    const corrupted = failureOf(outcome.corrupt) as CalculatorContractError
    expect(corrupted.kind).toBe('integrity')
    expect(corrupted.code).toBe('formula-continuation-corrupt')
    const estranged = failureOf(outcome.alien) as CalculatorContractError
    expect(estranged.kind).toBe('integrity')
    expect(estranged.code).toBe('formula-previous-runtime-alien')
    // a version that does not exist is the administrator's mistake on a NEW
    // binding: refusal, not integrity
    const missing = failureOf(outcome.unknownVersion) as CalculatorContractError
    expect(missing.kind).toBe('refusal')
    expect(missing.code).toBe('formula-version-not-found')
    const invalid = failureOf(outcome.defensive) as CalculatorContractError
    expect(invalid.code).toBe('formula-config-invalid')
  }, 120_000)

  it('holds a NEW binding behind the writer switch, and never a continuation', async () => {
    // The rollout gate. While the manifest keeps the writer closed, no
    // question can be newly pointed at a formula - not even one nobody
    // could fault - and a question already bound keeps proving the same
    // exact identity it always did. The gate answers before the version is
    // looked up, so an unknown version reads the same way, and it never
    // stands between a continuation and its integrity proof.
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fc-gate')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const batch = one<{ id: string }>(
            yield* runSql(sql`
              insert into assessment_batches (tenant_id, name, material_range)
              values (${f.t}, 'Round', daterange('2026-03-01','2026-09-01'))
              returning id`),
          ).id
          yield* runSql(sql`
            insert into batch_management_anchors (tenant_id, batch_id, org_node_id)
            values (${f.t}, ${batch}, ${f.collegeA})`)
          const created = yield* library.createFunction(
            f.t,
            { name: '心情分', description: '' },
            as,
          )
          const drafted = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: MOODY,
              draftTests: [{ name: 'ok', input: { mode: 'ok', value: '3.00' }, expected: '3' }],
            },
            as,
          )
          yield* library.publish(
            f.t,
            created.id,
            {
              expectedDraftRevision: drafted.draftRevision,
              releaseName: `release ${drafted.draftRevision}`,
            },
            as,
          )
          const versionId = one<{ id: string }>(
            yield* runSql(
              sql`select id from assessment_formula_versions where function_id = ${created.id}`,
            ),
          ).id
          const bound = (authoring: boolean) =>
            formula1.bind.pipe(
              Effect.provideService(Sandbox, dyingSandbox),
              Effect.provideService(FormulaSettings, FormulaSettings.of({ authoring })),
            )
          const open = yield* bound(true)
          const closed = yield* bound(false)
          const host = { tenantId: f.t, batchId: batch }
          const fresh = yield* open.compile({ versionId }, host)
          const reference = fresh.runtimeRef as RuntimeRef
          const gated = yield* Effect.exit(closed.compile({ versionId }, host))
          const unknownGated = yield* Effect.exit(
            closed.compile({ versionId: '01920000-0000-7000-8000-0000000000aa' }, host),
          )
          const continued = yield* Effect.exit(
            closed.compile({ versionId }, { ...host, previousRuntimeRef: reference }),
          )
          const corrupt = yield* Effect.exit(
            closed.compile(
              { versionId },
              { ...host, previousRuntimeRef: { ...reference, sha256: 'a'.repeat(64) } },
            ),
          )
          return { gated, unknownGated, continued, corrupt }
        }),
      ),
    )
    const refused = failureOf(outcome.gated) as CalculatorContractError
    expect(refused.kind).toBe('refusal')
    expect(refused.code).toBe('formula-authoring-disabled')
    // before the lookup: with the writer closed there is nothing to look up
    const unknown = failureOf(outcome.unknownGated) as CalculatorContractError
    expect(unknown.code).toBe('formula-authoring-disabled')
    // the same identity continues, and its integrity is still proven
    expect(Exit.isSuccess(outcome.continued)).toBe(true)
    const corrupted = failureOf(outcome.corrupt) as CalculatorContractError
    expect(corrupted.kind).toBe('integrity')
    expect(corrupted.code).toBe('formula-continuation-corrupt')
  }, 120_000)

  it('holds a frozen plan to the whole published fact, without the sandbox', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fc-frozen')
          const library = yield* FormulaLibrary
          const store = yield* FormulaRuntimeStore
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { name: '冻结分', description: '' },
            as,
          )
          const drafted = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: MOODY,
              draftTests: [{ name: 'ok', input: { mode: 'ok', value: '3.00' }, expected: '3' }],
            },
            as,
          )
          const published = yield* library.publish(
            f.t,
            created.id,
            {
              expectedDraftRevision: drafted.draftRevision,
              releaseName: `release ${drafted.draftRevision}`,
            },
            as,
          )
          void published
          const versionId = one<{ id: string }>(
            yield* runSql(
              sql`select id from assessment_formula_versions where function_id = ${created.id}`,
            ),
          ).id
          const resolved = yield* store.resolve({ tenantId: f.t, versionId })
          const frozen: FrozenCalculatorContract = {
            config: { versionId },
            contractHash: resolved.contractSha256,
            runtimeRef: {
              kind: 'formula-version',
              id: versionId,
              sha256: resolved.runtimeSha256,
            },
            inputSchema: resolved.inputSchema,
            outputSchema: resolved.outputSchema,
            valueSchemaProfileVersion: resolved.valueSchemaProfileVersion,
            regexProfileVersion: resolved.regexProfileVersion,
          }
          const bound = yield* formula1.bind.pipe(
            Effect.provideService(Sandbox, dyingSandbox),
            authoringOn,
          )
          const host = { tenantId: f.t, batchId: '01920000-0000-7000-8000-0000000000bb' }

          const verified = yield* Effect.exit(bound.verify(frozen, host))
          // a plan whose config grew a key, rehashed to self-consistency,
          // passes the generic reader - and is refused HERE
          const tamperedConfig = yield* Effect.exit(
            bound.verify({ ...frozen, config: { versionId, extra: true } }, host),
          )
          const wrongSha = yield* Effect.exit(
            bound.verify(
              {
                ...frozen,
                runtimeRef: { ...(frozen.runtimeRef as RuntimeRef), sha256: 'b'.repeat(64) },
              },
              host,
            ),
          )
          const wrongContract = yield* Effect.exit(
            bound.verify({ ...frozen, contractHash: 'c'.repeat(64) }, host),
          )
          const missingProfiles = yield* Effect.exit(
            bound.verify({ ...frozen, valueSchemaProfileVersion: undefined }, host),
          )
          const wrongProfiles = yield* Effect.exit(
            bound.verify({ ...frozen, regexProfileVersion: 999 }, host),
          )
          const uncertifiedProfile = yield* Effect.exit(
            bound.verify({ ...frozen, valueSchemaProfileVersion: 1 }, host),
          )
          // A question re-saved today mints its plan under the CURRENT value
          // schema profile while the formula it binds keeps the one it was
          // published under. Both are certified, so this scores; demanding
          // they be equal made every new plan over an older publication
          // unscorable the moment the profile moved.
          const olderPublication = yield* Effect.exit(
            bound.verify(
              { ...frozen, valueSchemaProfileVersion: resolved.valueSchemaProfileVersion - 1 },
              host,
            ),
          )
          // prepare re-proves the same fact and captures the artifact - and
          // still never touches the sandbox; only evaluate does, and this
          // sandbox dies on contact
          const prepared = yield* bound.prepare(frozen, host)
          const evaluated = yield* Effect.exit(prepared.evaluate({ mode: 'ok', value: '3.00' }))
          return {
            verified,
            tamperedConfig,
            wrongSha,
            wrongContract,
            missingProfiles,
            wrongProfiles,
            uncertifiedProfile,
            olderPublication,
            evaluated,
          }
        }),
      ),
    )
    expect(Exit.isSuccess(outcome.verified)).toBe(true)
    for (const [name, exit] of [
      ['tamperedConfig', outcome.tamperedConfig],
      ['wrongSha', outcome.wrongSha],
      ['wrongContract', outcome.wrongContract],
      ['missingProfiles', outcome.missingProfiles],
      ['wrongProfiles', outcome.wrongProfiles],
      ['uncertifiedProfile', outcome.uncertifiedProfile],
    ] as const) {
      const failure = failureOf(exit) as CalculatorRuntimeError
      expect(failure.kind, name).toBe('integrity')
    }
    expect(Exit.isSuccess(outcome.olderPublication)).toBe(true)
    // the dying sandbox was reached only by evaluate: a defect, not a failure
    expect(Exit.isFailure(outcome.evaluated)).toBe(true)
  }, 120_000)

  it('evaluates through the real sandbox and sorts refusal from execution', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fc-evaluate')
          const library = yield* FormulaLibrary
          const store = yield* FormulaRuntimeStore
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { name: '真跑分', description: '' },
            as,
          )
          const drafted = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: MOODY,
              draftTests: [{ name: 'ok', input: { mode: 'ok', value: '3.00' }, expected: '3' }],
            },
            as,
          )
          const published = yield* library.publish(
            f.t,
            created.id,
            {
              expectedDraftRevision: drafted.draftRevision,
              releaseName: `release ${drafted.draftRevision}`,
            },
            as,
          )
          void published
          const versionId = one<{ id: string }>(
            yield* runSql(
              sql`select id from assessment_formula_versions where function_id = ${created.id}`,
            ),
          ).id
          const resolved = yield* store.resolve({ tenantId: f.t, versionId })
          const frozen: FrozenCalculatorContract = {
            config: { versionId },
            contractHash: resolved.contractSha256,
            runtimeRef: { kind: 'formula-version', id: versionId, sha256: resolved.runtimeSha256 },
            inputSchema: resolved.inputSchema,
            outputSchema: resolved.outputSchema,
            valueSchemaProfileVersion: resolved.valueSchemaProfileVersion,
            regexProfileVersion: resolved.regexProfileVersion,
          }
          const bound = yield* formula1.bind.pipe(authoringOn)
          const host = { tenantId: f.t, batchId: '01920000-0000-7000-8000-0000000000cc' }
          const prepared = yield* bound.prepare(frozen, host)
          const answered = yield* prepared.evaluate({ mode: 'ok', value: '7.50' })
          const refused = yield* Effect.exit(prepared.evaluate({ mode: 'refuse', value: '1.00' }))
          const looped = yield* Effect.exit(prepared.evaluate({ mode: 'loop', value: '1.00' }))
          // the two deadlines a sandbox can cross, told apart in the failure
          // it hands back: a stub that crosses each, over the same frozen
          // contract, so the sorting is proven without waiting for a worker
          // to actually wedge
          const asked = { soft: 0, hard: 0 }
          const timingOut = (phase: 'soft' | 'hard') =>
            formula1.bind.pipe(
              Effect.provideService(Sandbox, {
                invoke: () =>
                  Effect.suspend(() => {
                    asked[phase] += 1
                    return Effect.fail(new SandboxTimeout({ phase }))
                  }),
              } as unknown as Sandbox['Service']),
              authoringOn,
            )
          const softly = yield* (yield* timingOut('soft')).prepare(frozen, host)
          const hardly = yield* (yield* timingOut('hard')).prepare(frozen, host)
          const soft = yield* Effect.exit(softly.evaluate({ mode: 'ok', value: '1.00' }))
          const hard = yield* Effect.exit(hardly.evaluate({ mode: 'ok', value: '1.00' }))
          return { answered, refused, looped, soft, hard, asked }
        }),
      ),
    )
    expect(outcome.answered).toBe('7.5')
    // a starved host is asked once more; a wedged worker is not
    expect(outcome.asked).toEqual({ soft: 2, hard: 1 })
    const refusal = failureOf(outcome.refused) as CalculatorEvaluationError
    expect(refusal.kind).toBe('refusal')
    expect(refusal.reason).toBe('refused by policy')
    const execution = failureOf(outcome.looped) as CalculatorEvaluationError
    expect(execution.kind).toBe('execution')
    // a loop is interrupted at the soft deadline, and the failure says which
    expect(execution.reason).toContain('soft deadline')
    const soft = failureOf(outcome.soft) as CalculatorEvaluationError
    expect(soft.kind).toBe('execution')
    expect(soft.reason).toContain('soft deadline')
    const hard = failureOf(outcome.hard) as CalculatorEvaluationError
    expect(hard.kind).toBe('execution')
    expect(hard.reason).toContain('hard deadline')
    expect(hard.reason).not.toContain('soft')
  }, 120_000)

  it('asks the sandbox once for what the program already answered, across reads', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('fc-remember')
          const library = yield* FormulaLibrary
          const store = yield* FormulaRuntimeStore
          const sandbox = yield* Sandbox
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(f.t, { name: '记得', description: '' }, as)
          const drafted = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: MOODY,
              draftTests: [{ name: 'ok', input: { mode: 'ok', value: '3.00' }, expected: '3' }],
            },
            as,
          )
          yield* library.publish(
            f.t,
            created.id,
            {
              expectedDraftRevision: drafted.draftRevision,
              releaseName: `release ${drafted.draftRevision}`,
            },
            as,
          )
          const versionId = one<{ id: string }>(
            yield* runSql(
              sql`select id from assessment_formula_versions where function_id = ${created.id}`,
            ),
          ).id
          const resolved = yield* store.resolve({ tenantId: f.t, versionId })
          const frozen: FrozenCalculatorContract = {
            config: { versionId },
            contractHash: resolved.contractSha256,
            runtimeRef: { kind: 'formula-version', id: versionId, sha256: resolved.runtimeSha256 },
            inputSchema: resolved.inputSchema,
            outputSchema: resolved.outputSchema,
            valueSchemaProfileVersion: resolved.valueSchemaProfileVersion,
            regexProfileVersion: resolved.regexProfileVersion,
          }
          let asked = 0
          const counting = {
            invoke: (request: Parameters<Sandbox['Service']['invoke']>[0]) =>
              Effect.suspend(() => {
                asked += 1
                return sandbox.invoke(request)
              }),
          } as unknown as Sandbox['Service']
          const bound = yield* formula1.bind.pipe(
            Effect.provideService(Sandbox, counting),
            authoringOn,
          )
          const host = { tenantId: f.t, batchId: '01920000-0000-7000-8000-0000000000cc' }
          // two reads of the same account, each preparing the rule anew
          const first = yield* bound.prepare(frozen, host)
          const second = yield* bound.prepare(frozen, host)
          const amounts = [
            yield* first.evaluate({ mode: 'ok', value: '7.50' }),
            yield* second.evaluate({ mode: 'ok', value: '7.50' }),
          ]
          const afterAmounts = asked
          const refusals = [
            yield* Effect.exit(first.evaluate({ mode: 'refuse', value: '1.00' })),
            yield* Effect.exit(second.evaluate({ mode: 'refuse', value: '1.00' })),
          ]
          const afterRefusals = asked
          // a program that did not finish said nothing, and is asked again
          yield* Effect.exit(first.evaluate({ mode: 'loop', value: '1.00' }))
          const afterOneLoop = asked
          yield* Effect.exit(second.evaluate({ mode: 'loop', value: '1.00' }))
          const afterTwoLoops = asked
          // something new is a new question
          const other = yield* second.evaluate({ mode: 'ok', value: '2.25' })
          return {
            amounts,
            other,
            refusals: refusals.map((exit) => (failureOf(exit) as CalculatorEvaluationError).kind),
            afterAmounts,
            afterRefusals,
            afterOneLoop,
            afterTwoLoops,
            afterOther: asked,
          }
        }),
      ),
    )
    expect(outcome.amounts).toEqual(['7.5', '7.5'])
    expect(outcome.afterAmounts).toBe(1)
    expect(outcome.refusals).toEqual(['refusal', 'refusal'])
    expect(outcome.afterRefusals).toBe(2)
    expect(outcome.afterTwoLoops - outcome.afterOneLoop).toBe(
      outcome.afterOneLoop - outcome.afterRefusals,
    )
    expect(outcome.afterOneLoop).toBeGreaterThan(outcome.afterRefusals)
    expect(outcome.other).toBe('2.25')
    expect(outcome.afterOther).toBe(outcome.afterTwoLoops + 1)
  }, 120_000)
})

describe('the formula config language', () => {
  const decode = (raw: unknown) =>
    Effect.runSync(Effect.result(Schema.decodeUnknownEffect(formulaConfigSchema)(raw)))

  it('admits exactly { versionId } and refuses everything else at the seam', () => {
    const versionId = '01920000-0000-7000-8000-000000000001'
    expect(decode({ versionId })._tag).toBe('Success')
    for (const wrong of [
      { versionId, extra: true },
      { versionId, tenantId: 'evil' },
      {},
      { versionId: 'rec-level' },
      { versionId: 42 },
      [versionId],
      'just-a-string',
      null,
    ]) {
      expect(decode(wrong)._tag, JSON.stringify(wrong)).toBe('Failure')
    }
  })
})
