import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { inspect } from 'node:util'
import { Effect, Exit, Layer, Schema } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { assembledLayer } from '@qualy/api-kit/assembled'
import { sandboxLayer } from '@qualy/plugin-sandbox/service'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import { configurationAccessLayer } from '@qualy/plugin-assessment/server/configuration-access'
import {
  Assessment,
  auditStoredPlans,
  builtinAggregators,
  builtinCalculators,
  frozenCalculatorOf,
  readScoringPlan,
  scaledAmount,
  scoringAuthoringPolicyProvider,
  scoringRuntimeProvider,
  serviceLayer,
  type PhaseSpecInput,
} from '@qualy/plugin-assessment/testkit'
import {
  ItemPayloadInvalid,
  ItemTypeCatalog,
  Scoring,
  ScoringAuthoringPolicyCatalog,
  ScoringRuntimeCatalog,
  type CalculatorEvaluationError,
  type ItemTypeDriver,
  type ScoringDefinition,
} from '@qualy/plugin-assessment/plugin'
import type { Contributed, ProvideExtension } from '@qualy/plugin-kit'
import { DEFAULT_LIMITS, StorageConfig } from '@qualy/plugin-storage/server'
import { registryLayer } from '@qualy/plugin-storage/server/registry'
import { serviceLayer as storageOnlyLayer } from '@qualy/plugin-storage/server/service'
import { backendLayer, memoryBackend } from '@qualy/plugin-storage/testkit'
import type { Principal } from '@qualy/rbac-contract'
import { FormulaLibrary, layer as formulaLayer } from '../src/server/index.ts'
import { FormulaRuntimeStore, runtimeStoreLayer } from '../src/server/runtime-store.ts'
import { bindingCatalogLayer } from '../src/server/binding-catalog.ts'
import { formula1 } from '../src/scoring/formula-calculator.ts'
import { formulaAuthoringPolicy } from '../src/scoring/authoring-policy.ts'
import { FormulaSettings } from '../src/server/config.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'

// The whole 7.3 protocol in one walk, against the REAL sandbox-runtime
// process: publish a FormulaVersion, bind it to an assessment item as a V2
// scoring configuration, read the frozen plan back, pass the boot audit,
// prepare through the runtime catalog, and score over the unix socket in
// QuickJS. Then the two facts only a real process can prove: the process
// dying turns scoring into a plain unavailability, and an artifact larger
// than the sandbox default - but lawfully published - still executes,
// because publishable must mean executable.

const here = createRequire(import.meta.url)
const mainOf = (app: string): string =>
  path.join(path.dirname(here.resolve(`${app}/package.json`)), 'src', 'main.ts')

const waitForSocket = async (file: string, child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 30_000
  for (;;) {
    if (fs.existsSync(file)) return
    if (child.exitCode !== null)
      throw new Error(`the sandbox process exited early with ${child.exitCode}`)
    if (Date.now() > deadline) throw new Error('the sandbox socket never appeared')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** a minimal question type: nothing bindable, nothing decoded - the scoring
 *  protocol is the subject, not the filing */
const plainItemType: ItemTypeDriver = {
  id: 'plain',
  configSchema: Schema.Struct({}),
  decodePayload: (_config, payload) =>
    payload === null || typeof payload === 'object'
      ? Effect.succeed(payload)
      : Effect.fail(new ItemPayloadInvalid([])),
  attachmentRefs: () => [],
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}

const registrations = [...builtinCalculators, formula1]
const definitions: readonly ScoringDefinition[] = [
  ...registrations.map(({ kind, ref, configSchema }): ScoringDefinition => ({
    kind,
    ref,
    configSchema,
  })),
  ...builtinAggregators,
]
const contributed = <T>(values: readonly T[]): readonly Contributed<T>[] =>
  values.map((value) => ({ pluginId: '@qualy/plugin-assessment-formula-tests', value }))

const stack = (
  url: string,
  socketPath: string,
  settings: { readonly authoring: boolean } = { authoring: true },
) => {
  const services = servicesFor(url)
  const sandbox = sandboxLayer({ socketPath })
  const formulaServices = Layer.mergeAll(
    formulaLayer.pipe(Layer.provide(sandbox), Layer.provide(formulaAuthoringLocalLayer)),
    runtimeStoreLayer,
    bindingCatalogLayer.pipe(Layer.provide(configurationAccessLayer)),
  ).pipe(Layer.provideMerge(services))
  const catalogLayers = Layer.mergeAll(
    Layer.succeed(ItemTypeCatalog, new Map([[plainItemType.id, plainItemType]])),
    (Scoring.definitionProvider as unknown as ProvideExtension).compile(
      contributed(definitions),
    ) as Layer.Layer<never>,
  )
  // the calculator's runtime binding and its authoring policy, the pair the
  // host wires: one answers what a configuration compiles to, the other who
  // may create the binding in the first place
  const runtimeCatalog = Layer.mergeAll(
    (scoringRuntimeProvider as unknown as ProvideExtension).compile(contributed(registrations)),
    (scoringAuthoringPolicyProvider as unknown as ProvideExtension).compile(
      contributed([formulaAuthoringPolicy]),
    ),
  ).pipe(
    Layer.provide(Layer.succeed(FormulaSettings, FormulaSettings.of(settings))),
    Layer.provide(formulaServices),
    Layer.provide(sandbox),
    Layer.provide(catalogLayers),
    Layer.provide(assembledLayer),
    Layer.provide(services),
  ) as Layer.Layer<ScoringRuntimeCatalog | ScoringAuthoringPolicyCatalog>
  const storage = storageOnlyLayer.pipe(
    Layer.provideMerge(backendLayer(memoryBackend())),
    Layer.provideMerge(registryLayer),
    Layer.provideMerge(
      Layer.succeed(StorageConfig, { defaultBackend: 'memory', limits: DEFAULT_LIMITS }),
    ),
  )
  return Layer.mergeAll(
    serviceLayer.pipe(
      Layer.provideMerge(services),
      Layer.provide(catalogLayers),
      Layer.provide(storage.pipe(Layer.provide(services))),
      Layer.provide(assembledLayer),
      Layer.provideMerge(runtimeCatalog),
    ),
    formulaServices,
  )
}

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const failureOf = (exit: Exit.Exit<unknown, unknown>): { kind?: string; reason?: string } => {
  if (Exit.isSuccess(exit)) throw new Error('expected a failure, got success')
  const cause = exit.cause as { reasons?: readonly { error?: unknown }[] }
  const failure = cause.reasons?.map((one) => one.error).find((error) => error !== undefined)
  if (failure === undefined) {
    throw new Error(`expected a typed failure, got ${inspect(exit.cause, { depth: 10 })}`)
  }
  return failure as { kind?: string; reason?: string }
}

const MOODY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    mode: Schema.choice({ ok: '正常', refuse: '拒绝' }, { title: '模式' }),
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run(input, q) {
    if (input.mode === 'refuse') q.fail('refused by policy')
    return input.value
  },
})
`

/** the same formula wearing 300KiB of ballast that survives tree-shaking:
 *  larger than the sandbox's default artifact budget, lawfully publishable */
const PADDED = `import { Schema, defineFormula } from '@qualy/formula'

const BALLAST = '${'x'.repeat(240 * 1024)}'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run(input, q) {
    if (BALLAST.length === -1) q.fail('never')
    return input.value
  },
})
`

/** a formula that hands its one parameter straight back as the amount */
const PASSTHROUGH = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

/** author, draft, publish - and the exact version id that came out */
const publishFormula = (
  library: FormulaLibrary['Service'],
  tenantId: string,
  as: Principal,
  source: string,
  name: string,
  test: { readonly value: string; readonly expected: string } = { value: '3.00', expected: '3' },
) =>
  Effect.gen(function* () {
    const created = yield* library.createFunction(tenantId, { name, description: '' }, as)
    const drafted = yield* library.updateDraft(
      tenantId,
      created.id,
      {
        expectedDraftRevision: created.draftRevision,
        draftSourceTs: source,
        draftTests: [{ name: 'ok', input: { value: test.value }, expected: test.expected }],
      },
      as,
    )
    yield* library.publish(
      tenantId,
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
    return { functionId: created.id, versionId }
  })

/** a running round with one score group, ready to hold questions */
const roundWithGroup = (
  assessment: Assessment['Service'],
  f: { t: string; collegeA: string; admin: string; principal: (userId: string) => Principal },
  name: string,
) =>
  Effect.gen(function* () {
    const as = f.principal(f.admin)
    const studentType = one<{ id: string }>(
      yield* runSql(sql`select id from user_types where tenant_id = ${f.t}`),
    ).id
    const batch = yield* assessment.createBatch(
      f.t,
      {
        name,
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        import: { orgNodeIds: [f.collegeA], userTypeIds: [studentType] },
      },
      as,
    )
    yield* assessment.replacePlan(
      f.t,
      batch.id,
      { specs: [phase({ phaseKey: 'entry' }), phase({ phaseKey: 'archive' })] },
      as,
    )
    const groups = yield* assessment.replaceScoreGroups(
      f.t,
      batch.id,
      {
        groups: [{ name: '主组', parentGroupId: null, cap: null, floor: null }],
        expectedVersion: 1,
      },
      as,
    )
    return { batchId: batch.id, groupId: groups.groups[0]!.id }
  })

/** one question's configuration, scored by an exact published version */
const boundConfig = (versionId: string, valueId?: string) => ({
  entryChannels: ['participant'] as const,
  formConfig: {},
  scoringConfig: {
    version: 2,
    calculator: { ref: 'formula@1', config: { versionId } },
    aggregator: { ref: 'sum@1', config: {} },
    recognitions: [
      {
        handle: 'value',
        ...(valueId === undefined ? {} : { id: valueId }),
        label: '数值',
        refinement: null,
        defaultFromFieldId: null,
      },
    ],
    bindings: { value: { kind: 'recognition', handle: 'value' } },
  },
  reviewPolicy: {
    normal: {
      stages: [
        {
          id: 's1',
          selector: {
            kind: 'roleAt',
            nodeTypeId: '01920000-0000-7000-8000-0000000000d1',
            roleIds: ['01920000-0000-7000-8000-0000000000d2'],
          },
          quorum: { type: 'any' },
        },
      ],
    },
    escalation: { stages: [] },
  },
})

const phase = (over: Partial<PhaseSpecInput> & { phaseKey: string }): PhaseSpecInput => ({
  displayName: over.phaseKey,
  permissionProfile: [],
  ...over,
})

describe.runIf(postgresAvailable)('formula scoring, end to end', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-formula-scoring-'))
  const socketPath = path.join(tempDir, 'runtime.sock')
  const children: ChildProcess[] = []

  beforeAll(async () => {
    db = await createTestContext('formula-scoring')
    const child = spawn(process.execPath, [mainOf('@qualy/sandbox-runtime')], {
      env: { ...process.env, QUALY_SANDBOX_RUNTIME_SOCKET: socketPath },
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    children.push(child)
    await waitForSocket(socketPath, child)
  }, 120_000)

  afterAll(async () => {
    for (const child of children) child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 500))
    for (const child of children) child.kill('SIGKILL')
    await db?.dispose()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('walks from publication to a scored amount over the unix socket', async () => {
    const outcome = ok(
      await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const f = yield* seedFormulaFixture('fs-walk')
            const library = yield* FormulaLibrary
            const assessment = yield* Assessment
            const catalog = yield* ScoringRuntimeCatalog
            const as: Principal = f.principal(f.admin)
            const studentType = one<{ id: string }>(
              yield* runSql(sql`select id from user_types where tenant_id = ${f.t}`),
            ).id

            const created = yield* library.createFunction(
              f.t,
              { name: '真进程分', description: '' },
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

            const batch = yield* assessment.createBatch(
              f.t,
              {
                name: 'Formula Round',
                materialRange: { start: '2026-03-01', end: '2026-09-01' },
                import: { orgNodeIds: [f.collegeA], userTypeIds: [studentType] },
              },
              as,
            )
            yield* assessment.replacePlan(
              f.t,
              batch.id,
              { specs: [phase({ phaseKey: 'entry' }), phase({ phaseKey: 'archive' })] },
              as,
            )
            const groups = yield* assessment.replaceScoreGroups(
              f.t,
              batch.id,
              {
                groups: [{ name: '主组', parentGroupId: null, cap: null, floor: null }],
                expectedVersion: 1,
              },
              as,
            )
            const groupId = groups.groups[0]!.id

            const item = yield* assessment.createItem(
              f.t,
              batch.id,
              {
                itemType: 'plain',
                title: '公式题',
                scoreGroupId: groupId,
                maxEntries: 1,
                config: {
                  entryChannels: ['participant'],
                  formConfig: {},
                  scoringConfig: {
                    version: 2,
                    calculator: { ref: 'formula@1', config: { versionId } },
                    aggregator: { ref: 'sum@1', config: {} },
                    recognitions: [
                      { handle: 'mode', label: '状态', refinement: null, defaultFromFieldId: null },
                      {
                        handle: 'value',
                        label: '数值',
                        refinement: null,
                        defaultFromFieldId: null,
                      },
                    ],
                    bindings: {
                      mode: { kind: 'recognition', handle: 'mode' },
                      value: { kind: 'recognition', handle: 'value' },
                    },
                  },
                  reviewPolicy: {
                    normal: {
                      stages: [
                        {
                          id: 's1',
                          selector: {
                            kind: 'roleAt',
                            nodeTypeId: '01920000-0000-7000-8000-0000000000d1',
                            roleIds: ['01920000-0000-7000-8000-0000000000d2'],
                          },
                          quorum: { type: 'any' },
                        },
                      ],
                    },
                    escalation: { stages: [] },
                  },
                },
              },
              as,
            )
            const revisionId = item.currentRevision!.id
            const stored = one<{ scoring_plan: Record<string, unknown> }>(
              yield* runSql(
                sql`select scoring_plan from assessment_item_revisions where id = ${revisionId}`,
              ),
            )
            const plan = yield* readScoringPlan({
              id: revisionId,
              scoringPlan: stored.scoring_plan,
            })
            // the boot audit walks the same stored plan and hands the whole
            // frozen fact to formula@1's verify - which resolves and matches
            // it against the published row, sandbox untouched
            yield* auditStoredPlans({
              itemTypes: new Map([[plainItemType.id, plainItemType]]),
              definitions: {
                calculators: new Map(
                  definitions
                    .filter((d) => d.kind === 'calculator')
                    .map((d) => [d.ref, d] as const),
                ),
                aggregators: new Map(
                  builtinAggregators.map((driver) => [driver.ref, driver] as const),
                ),
              },
              compile: catalog.compile,
              verify: catalog.verify,
            })
            const prepared = yield* catalog.prepare(plan.calculator.ref, frozenCalculatorOf(plan), {
              tenantId: f.t,
              batchId: batch.id,
            })
            const amount = yield* prepared.evaluate({ mode: 'ok', value: '7.50' })
            const refused = yield* Effect.exit(prepared.evaluate({ mode: 'refuse', value: '1.00' }))
            return { plan, amount, scaled: scaledAmount(amount), refused }
          }),
          stack(db.url, socketPath) as never,
        ) as Effect.Effect<never, never>,
      ),
    ) as {
      plan: { version: number; calculator: { runtimeRef?: unknown } }
      amount: string
      scaled: bigint
      refused: Exit.Exit<string, CalculatorEvaluationError>
    }
    expect(outcome.plan.version).toBe(2)
    expect(outcome.plan.calculator.runtimeRef).toBeDefined()
    expect(outcome.amount).toBe('7.5')
    expect(outcome.scaled).toBe(75_000n)
    expect(Exit.isFailure(outcome.refused)).toBe(true)
  }, 120_000)

  it('binds only a formula the person saving it wrote, and never re-asks a continuation', async () => {
    // The rule is about who may START a binding. Somebody else's published
    // version is not a thing this administrator may point a question at,
    // however completely they administer the round; and once a question IS
    // pointed at one, keeping it working is a different question with a
    // different answer, so a rename goes through even after authorship has
    // moved out from under it.
    const outcome = ok(
      await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const f = yield* seedFormulaFixture('fs-owned')
            const library = yield* FormulaLibrary
            const assessment = yield* Assessment
            const mine = f.principal(f.authorA)
            // both of them administer this round, completely and equally:
            // what separates them is authorship and nothing else
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id)
              select ${f.t}, ${f.authorA}, id from roles
              where tenant_id = ${f.t} and system_key = 'tenant-admin'`)
            const published = yield* publishFormula(library, f.t, mine, PASSTHROUGH, '我的公式')
            const { batchId, groupId } = yield* roundWithGroup(assessment, f, '所有权轮次')

            const bind = (versionId: string, as: Principal) =>
              assessment.createItem(
                f.t,
                batchId,
                {
                  itemType: 'plain',
                  title: '公式题',
                  scoreGroupId: groupId,
                  maxEntries: 1,
                  config: boundConfig(versionId),
                },
                as,
              )

            // the author binds their own: allowed
            const own = yield* bind(published.versionId, mine)
            // a batch administrator who did not write it: refused, by name
            const other = yield* Effect.flip(bind(published.versionId, f.principal(f.admin)))

            // and the preview a screen shows must give the SAME answer the
            // save would: a kinder one would offer a binding the save is
            // about to turn down
            const previewed = yield* Effect.flip(
              assessment.previewScoring(
                f.t,
                batchId,
                {
                  itemType: 'plain',
                  formConfig: {},
                  calculator: { ref: 'formula@1', config: { versionId: published.versionId } },
                },
                f.principal(f.admin),
              ),
            )

            // authorship moves out from under the question that already runs
            // it - the shape of an author leaving
            yield* runSql(sql`
              update assessment_formula_functions set created_by = ${f.authorB}
              where id = ${published.functionId}`)
            // a real save carrying the SAME configuration, which is what
            // makes this a continuation rather than a title-only edit the
            // compiler never sees
            const renamed = yield* assessment.updateItem(
              f.t,
              own.id,
              { title: '公式题(改名)', config: boundConfig(published.versionId) },
              mine,
            )
            // but pointing a NEW question at it is a new binding, and now it
            // is somebody else's
            const freshRefused = yield* Effect.flip(bind(published.versionId, mine))

            return {
              own: own.currentRevision!.id,
              other: (other as { issues?: readonly { reason: string }[] }).issues?.map(
                (issue) => issue.reason,
              ),
              previewed: (previewed as { issues?: readonly { path: string; reason: string }[] })
                .issues,
              renamed: renamed.title,
              freshRefused: (
                freshRefused as { issues?: readonly { reason: string }[] }
              ).issues?.map((issue) => issue.reason),
            }
          }),
          stack(db.url, socketPath) as never,
        ) as Effect.Effect<never, never>,
      ),
    ) as {
      own: string
      other: readonly string[] | undefined
      previewed: readonly { path: string; reason: string }[] | undefined
      renamed: string
      freshRefused: readonly string[] | undefined
    }

    expect(outcome.own).toEqual(expect.any(String))
    expect(outcome.other).toEqual(['formula-not-yours'])
    // the same refusal, and spelled in the payload's own paths rather than
    // the compiler's - a preview is asked about a candidate
    expect(outcome.previewed).toEqual([{ path: 'calculator.config', reason: 'formula-not-yours' }])
    // a continuation is never re-asked: the question keeps working
    expect(outcome.renamed).toBe('公式题(改名)')
    expect(outcome.freshRefused).toEqual(['formula-not-yours'])
  }, 120_000)

  it('keeps a bound question working with the writer closed, and admits nothing new', async () => {
    // Deployment A, on real data. A question bound while the writer was open
    // goes on being read, scored and re-saved under the same exact version
    // after the writer is closed - and nothing new is bound at any version,
    // by a save or by a preview.
    const administrative = (versionId: string, valueId?: string) => ({
      ...boundConfig(versionId, valueId),
      entryChannels: ['administrative'] as const,
    })
    const opened = ok(
      await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const f = yield* seedFormulaFixture('fs-reader')
            const library = yield* FormulaLibrary
            const assessment = yield* Assessment
            const mine = f.principal(f.authorA)
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id)
              select ${f.t}, ${f.authorA}, id from roles
              where tenant_id = ${f.t} and system_key = 'tenant-admin'`)
            const v1 = yield* publishFormula(library, f.t, mine, PASSTHROUGH, '直通一')
            const v2 = yield* publishFormula(library, f.t, mine, PASSTHROUGH, '直通二')
            const { batchId, groupId } = yield* roundWithGroup(assessment, f, '只读部署轮次')
            yield* assessment.replacePlan(
              f.t,
              batchId,
              {
                specs: [
                  phase({ phaseKey: 'entry', permissionProfile: ['assessment.entry.record'] }),
                  phase({ phaseKey: 'archive' }),
                ],
              },
              mine,
            )
            const plan = yield* assessment.getPlan(f.t, batchId, mine)
            yield* assessment.schedulePhase(f.t, batchId, plan[0]!.id, Date.now() + 3_600_000, mine)
            yield* assessment.advancePhase(
              f.t,
              batchId,
              { to: plan[0]!.id, force: true, reason: 'the round opens' },
              mine,
            )
            const participant = one<{ id: string }>(
              yield* runSql(sql`
                select id from batch_participants
                where batch_id = ${batchId} and user_id = ${f.bystander}`),
            ).id
            const item = yield* assessment.createItem(
              f.t,
              batchId,
              {
                itemType: 'plain',
                title: '直通题',
                scoreGroupId: groupId,
                maxEntries: null,
                config: administrative(v1.versionId),
              },
              mine,
            )
            yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, mine)
            const stored = item.currentRevision!.scoringConfig as {
              recognitions: Record<string, unknown>
            }
            const valueId = Object.keys(stored.recognitions)[0]!
            yield* assessment.createEntry(
              f.t,
              {
                itemId: item.id,
                participantId: participant,
                payload: {},
                note: 'the register',
                recognition: { values: { [valueId]: '3.00' } },
              },
              mine,
            )
            const student = f.principal(f.bystander)
            const before = yield* assessment.getMyResult(f.t, batchId, student)
            return {
              t: f.t,
              batchId,
              groupId,
              itemId: item.id,
              valueId,
              v1: v1.versionId,
              v2: v2.versionId,
              mine,
              student,
              before: before.total,
            }
          }),
          stack(db.url, socketPath) as never,
        ) as Effect.Effect<never, never>,
      ),
    ) as {
      t: string
      batchId: string
      groupId: string
      itemId: string
      valueId: string
      v1: string
      v2: string
      mine: Principal
      student: Principal
      before: string
    }

    type Issues = readonly { path: string; reason: string }[] | undefined
    const issuesOf = (error: unknown): Issues => (error as { issues?: Issues }).issues
    const closed = ok(
      await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const assessment = yield* Assessment
            const { t, batchId, groupId, itemId, valueId, v1, v2, mine, student } = opened
            const calculator = (versionId: string) => ({
              ref: 'formula@1',
              config: { versionId },
            })
            // the same exact version, re-saved: a continuation, never re-asked
            const renamed = yield* assessment.updateItem(
              t,
              itemId,
              { title: '直通题(改名)', config: administrative(v1, valueId) },
              mine,
            )
            const after = yield* assessment.getMyResult(t, batchId, student)
            // a new question at a version the writer would have admitted
            const fresh = yield* Effect.flip(
              assessment.createItem(
                t,
                batchId,
                {
                  itemType: 'plain',
                  title: '新公式题',
                  scoreGroupId: groupId,
                  maxEntries: null,
                  config: administrative(v1),
                },
                mine,
              ),
            )
            const previewedNew = yield* Effect.flip(
              assessment.previewScoring(
                t,
                batchId,
                { itemType: 'plain', formConfig: {}, calculator: calculator(v1) },
                mine,
              ),
            )
            const previewedSame = yield* Effect.exit(
              assessment.previewScoring(
                t,
                batchId,
                { itemType: 'plain', formConfig: {}, calculator: calculator(v1), itemId },
                mine,
              ),
            )
            const rebound = yield* Effect.flip(
              assessment.updateItem(
                t,
                itemId,
                { config: administrative(v2, valueId), reason: '换版本' },
                mine,
              ),
            )
            return {
              renamed: renamed.title,
              after: after.total,
              fresh: issuesOf(fresh),
              previewedNew: issuesOf(previewedNew),
              previewedSame: Exit.isSuccess(previewedSame),
              rebound: issuesOf(rebound),
            }
          }),
          stack(db.url, socketPath, { authoring: false }) as never,
        ) as Effect.Effect<never, never>,
      ),
    ) as {
      renamed: string
      after: string
      fresh: Issues
      previewedNew: Issues
      previewedSame: boolean
      rebound: Issues
    }

    expect(closed.renamed).toBe('直通题(改名)')
    expect(closed.after).toBe(opened.before)
    const disabled = [
      { path: 'scoringConfig.calculator.config', reason: 'formula-authoring-disabled' },
    ]
    expect(closed.fresh).toEqual(disabled)
    expect(closed.previewedNew).toEqual([
      { path: 'calculator.config', reason: 'formula-authoring-disabled' },
    ])
    expect(closed.previewedSame).toBe(true)
    expect(closed.rebound).toEqual(disabled)
  }, 120_000)

  it('executes an artifact larger than the sandbox default, because it was publishable', async () => {
    const outcome = ok(
      await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const f = yield* seedFormulaFixture('fs-large')
            const library = yield* FormulaLibrary
            const catalog = yield* ScoringRuntimeCatalog
            const as: Principal = f.principal(f.admin)
            const created = yield* library.createFunction(
              f.t,
              { name: '大公式', description: '' },
              as,
            )
            const drafted = yield* library.updateDraft(
              f.t,
              created.id,
              {
                expectedDraftRevision: created.draftRevision,
                draftSourceTs: PADDED,
                draftTests: [{ name: 'ok', input: { value: '3.00' }, expected: '3' }],
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
            const row = one<{ id: string; bytes: number }>(
              yield* runSql(sql`
                select id, octet_length(runtime_js) as bytes
                from assessment_formula_versions where function_id = ${created.id}`),
            )
            const store = yield* FormulaRuntimeStore
            const resolved = yield* store.resolve({ tenantId: f.t, versionId: row.id })
            const frozen = {
              config: { versionId: row.id },
              contractHash: resolved.contractSha256,
              runtimeRef: {
                kind: 'formula-version',
                id: row.id,
                sha256: resolved.runtimeSha256,
              },
              inputSchema: resolved.inputSchema,
              outputSchema: resolved.outputSchema,
              valueSchemaProfileVersion: resolved.valueSchemaProfileVersion,
              regexProfileVersion: resolved.regexProfileVersion,
            }
            const catalogRef = 'formula@1'
            const prepared = yield* catalog.prepare(catalogRef, frozen, {
              tenantId: f.t,
              batchId: '01920000-0000-7000-8000-0000000000e1',
            })
            const amount = yield* prepared.evaluate({ value: '4.25' })
            return { row, amount }
          }),
          stack(db.url, socketPath) as never,
        ) as Effect.Effect<never, never>,
      ),
    ) as { row: { id: string; bytes: number }; amount: string }
    // bigger than the sandbox's 256KiB default artifact budget, lawfully
    // published, and it still scored: publishable means executable
    expect(outcome.row.bytes).toBeGreaterThan(256 * 1024)
    expect(outcome.amount).toBe('4.25')
  }, 120_000)

  it('proves a determination against the rule, and a rule against what stands, over the socket', async () => {
    // The whole closure, on the real arithmetic: a determination the rule
    // refuses never becomes a fact; a rule that refuses what stands never
    // becomes the rule; a rule that re-prices what stands is acknowledged
    // and then read back at its new amount.
    const REFUSING = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run(input, q) {
    if (q.decimal.compare(input.value, q.decimal.fromInteger(3)) === 0) {
      q.fail('three is not recognised here')
    }
    return input.value
  },
})
`
    const FOUR = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (_input, q) => q.decimal.fromInteger(4),
})
`
    const outcome = ok(
      await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const f = yield* seedFormulaFixture('fs-closure')
            const library = yield* FormulaLibrary
            const assessment = yield* Assessment
            const mine = f.principal(f.authorA)
            yield* runSql(sql`
              insert into role_grants (tenant_id, user_id, role_id)
              select ${f.t}, ${f.authorA}, id from roles
              where tenant_id = ${f.t} and system_key = 'tenant-admin'`)
            const v1 = yield* publishFormula(library, f.t, mine, PASSTHROUGH, '直通')
            const refusing = yield* publishFormula(library, f.t, mine, REFUSING, '拒三', {
              value: '2.00',
              expected: '2',
            })
            const four = yield* publishFormula(library, f.t, mine, FOUR, '恒四', {
              value: '3.00',
              expected: '4',
            })
            const { batchId, groupId } = yield* roundWithGroup(assessment, f, '闭环轮次')
            // the round is entered, with the office allowed to record
            yield* assessment.replacePlan(
              f.t,
              batchId,
              {
                specs: [
                  phase({ phaseKey: 'entry', permissionProfile: ['assessment.entry.record'] }),
                  phase({ phaseKey: 'archive' }),
                ],
              },
              mine,
            )
            const plan = yield* assessment.getPlan(f.t, batchId, mine)
            yield* assessment.schedulePhase(f.t, batchId, plan[0]!.id, Date.now() + 3_600_000, mine)
            yield* assessment.advancePhase(
              f.t,
              batchId,
              { to: plan[0]!.id, force: true, reason: 'the round opens' },
              mine,
            )
            const participant = one<{ id: string }>(
              yield* runSql(sql`
                select id from batch_participants
                where batch_id = ${batchId} and user_id = ${f.bystander}`),
            ).id
            const recorded = (versionId: string, valueId?: string) => ({
              ...boundConfig(versionId, valueId),
              entryChannels: ['administrative'] as const,
            })
            const ask = (title: string, versionId: string) =>
              Effect.gen(function* () {
                const item = yield* assessment.createItem(
                  f.t,
                  batchId,
                  {
                    itemType: 'plain',
                    title,
                    scoreGroupId: groupId,
                    maxEntries: null,
                    config: recorded(versionId),
                  },
                  mine,
                )
                yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, mine)
                const stored = item.currentRevision!.scoringConfig as {
                  recognitions: Record<string, unknown>
                }
                return { id: item.id, valueId: Object.keys(stored.recognitions)[0]! }
              })
            const record = (item: { id: string; valueId: string }, value: string) =>
              Effect.exit(
                assessment.createEntry(
                  f.t,
                  {
                    itemId: item.id,
                    participantId: participant,
                    payload: {},
                    note: 'the register',
                    recognition: { values: { [item.valueId]: value } },
                  },
                  mine,
                ),
              )
            const tagOf = (exit: Exit.Exit<unknown, unknown>) =>
              Exit.isFailure(exit)
                ? (failureOf(exit) as { _tag?: string; reason?: string })
                : undefined

            // the rule refuses a determination before it is a fact
            const gated = yield* ask('拒三题', refusing.versionId)
            const refused = yield* record(gated, '3.00')
            const taken = yield* record(gated, '1.00')

            // a determination in force under the passthrough rule
            const open = yield* ask('直通题', v1.versionId)
            const stood = yield* record(open, '3.00')
            const before = yield* assessment.getMyResult(f.t, batchId, f.principal(f.bystander))

            // a rule that refuses what stands cannot become the rule
            const rebound = yield* Effect.exit(
              assessment.updateItem(
                f.t,
                open.id,
                { config: recorded(refusing.versionId, open.valueId), reason: '换规则' },
                mine,
              ),
            )
            // a rule that re-prices what stands is acknowledged, then read back
            const asked = yield* Effect.exit(
              assessment.updateItem(
                f.t,
                open.id,
                { config: recorded(four.versionId, open.valueId), reason: '恒四' },
                mine,
              ),
            )
            const report = tagOf(asked) as
              | {
                  _tag?: string
                  impactToken?: string
                  scoring?: { approved: { amountChanged: number } }
                }
              | undefined
            const saved = yield* assessment.updateItem(
              f.t,
              open.id,
              {
                config: recorded(four.versionId, open.valueId),
                reason: '恒四',
                effects: { impactToken: report?.impactToken ?? '' },
              },
              mine,
            )
            const after = yield* assessment.getMyResult(f.t, batchId, f.principal(f.bystander))
            return {
              refused: tagOf(refused),
              taken: Exit.isSuccess(taken),
              stood: Exit.isSuccess(stood),
              before: before.total,
              rebound: tagOf(rebound) as
                | { _tag?: string; approved?: { refused: number } }
                | undefined,
              asked: report?._tag,
              amountChanged: report?.scoring?.approved.amountChanged,
              saved: saved.currentRevision?.revisionNo,
              after: after.total,
            }
          }),
          stack(db.url, socketPath) as never,
        ) as Effect.Effect<never, never>,
      ),
    ) as {
      refused: { _tag?: string; reason?: string } | undefined
      taken: boolean
      stood: boolean
      before: string
      rebound: { _tag?: string; approved?: { refused: number } } | undefined
      asked: string | undefined
      amountChanged: number | undefined
      saved: number | undefined
      after: string
    }
    expect(outcome.refused?._tag).toBe('ASSESSMENT_DETERMINATION_REFUSED')
    expect(outcome.refused?.reason).toBe('three is not recognised here')
    expect(outcome.taken).toBe(true)
    expect(outcome.stood).toBe(true)
    // 1.00 from the gated question, 3.00 from the open one
    expect(outcome.before).toBe('4.00')
    expect(outcome.rebound?._tag).toBe('ASSESSMENT_ITEM_SCORING_INCOMPATIBLE')
    expect(outcome.rebound?.approved?.refused).toBe(1)
    expect(outcome.asked).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
    expect(outcome.amountChanged).toBe(1)
    expect(outcome.saved).toBe(2)
    // 1.00 from the gated question, now 4.00 from the re-priced one
    expect(outcome.after).toBe('5.00')
  }, 180_000)

  it('reads a dead sandbox as plain unavailability, never a broken promise', async () => {
    // this runs LAST: the runtime process is killed, prepare still succeeds
    // (it never touches execution), and only evaluate reports unavailable
    for (const child of children) child.kill('SIGKILL')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const outcome = ok(
      await Effect.runPromiseExit(
        Effect.provide(
          Effect.gen(function* () {
            const f = yield* seedFormulaFixture('fs-down')
            const library = yield* FormulaLibrary
            const catalog = yield* ScoringRuntimeCatalog
            const store = yield* FormulaRuntimeStore
            // published while the sandbox was alive? no - publication needs
            // the sandbox too, so this suite plants the version by SQL from
            // an earlier publication's bytes
            const source = one<{
              runtime_js: string
              input_schema: unknown
              output_schema: unknown
              runtime_sha256: string
              contract_sha256: string
            }>(
              yield* runSql(sql`
                select v.runtime_js, v.input_schema, v.output_schema,
                       v.runtime_sha256, v.contract_sha256
                from assessment_formula_versions v
                join assessment_formula_functions fn on fn.id = v.function_id
                where fn.name = '真进程分'
                limit 1`),
            )
            const functionId = one<{ id: string }>(
              yield* runSql(sql`
                insert into assessment_formula_functions
                  (tenant_id, name, draft_source_ts, draft_tests, created_by, updated_by)
                values (${f.t}, '断线公式', 'export {}', '[]'::jsonb, ${f.admin}, ${f.admin})
                returning id`),
            ).id
            const versionId = one<{ id: string }>(
              yield* runSql(sql`
                insert into assessment_formula_versions
                  (tenant_id, function_id, version_no, source_ts, runtime_js,
                   input_schema, output_schema, source_sha256, runtime_sha256, contract_sha256,
                   typescript_version, esbuild_version, formula_abi_version, formula_runtime_sha256,
                   quickjs_engine_version, tests, test_report, published_by,
                   value_schema_profile_version)
                values (${f.t}, ${functionId}, 1, 'export {}', ${source.runtime_js},
                        ${JSON.stringify(source.input_schema)}::jsonb, ${JSON.stringify(source.output_schema)}::jsonb,
                        ${source.runtime_sha256}, ${source.runtime_sha256}, ${source.contract_sha256},
                        '7.0.0', '0.28.0', 1, ${source.runtime_sha256},
                        'quickjs-test', '[]'::jsonb, '[]'::jsonb, ${f.admin}, 2)
                returning id`),
            ).id
            void library
            const resolved = yield* store.resolve({ tenantId: f.t, versionId })
            const frozen = {
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
            const prepared = yield* catalog.prepare('formula@1', frozen, {
              tenantId: f.t,
              batchId: '01920000-0000-7000-8000-0000000000e2',
            })
            const evaluated = yield* Effect.exit(prepared.evaluate({ mode: 'ok', value: '1.00' }))
            return { evaluated }
          }),
          stack(db.url, socketPath) as never,
        ) as Effect.Effect<never, never>,
      ),
    ) as { evaluated: Exit.Exit<string, CalculatorEvaluationError> }
    const failure = failureOf(outcome.evaluated)
    expect(failure.kind).toBe('unavailable')
  }, 120_000)
})
