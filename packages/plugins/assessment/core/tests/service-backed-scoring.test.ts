import { randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import { Context, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { transaction } from '@qualy/plugin-database/server'
import { assembledLayer } from '@qualy/api-kit/assembled'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { SCORE_AMOUNT_SCHEMA } from '@qualy/value-schema/score'
import type { Contributed, ProvideExtension } from '@qualy/plugin-kit'
import {
  ItemTypeCatalog,
  Scoring,
  ScoringRuntimeCatalog,
  type CalculatorRegistration,
  type ScoringDefinition,
  type ScoringDefinitionCatalog,
} from '../src/plugin.ts'
import { scoringRuntimeProvider } from '../src/scoring/runtime-provider.ts'
import { builtinAggregators, builtinCalculators } from '../src/scoring/builtins.ts'
import { sweepScoringPlans } from '../src/scoring/backfill.ts'
import { frozenCalculatorOf, readScoringPlan } from '../src/scoring/plan.ts'
import { evaluateEntry } from '../src/scoring/evaluate.ts'
import { scaledAmount } from '../src/scoring/builtins.ts'

// The bearing wall of the runtime topology (phase7-design §5.14), walked on
// production primitives end to end: a calculator whose arithmetic NEEDS a
// running service registers through the same Scoring.calculator every
// plugin uses; both catalogs come off the production providers; bind
// acquires the service while the runtime layer builds; the boot sweep
// compiles and FREEZES a stored plan through the real compiler against it;
// the frozen plan reads back through the canonical reader, prepares once,
// and evaluates to an amount only that service could have produced. And
// with the service's provider removed, the build refuses by name - nothing
// late-binds, nothing falls back.

class Shelf extends Context.Service<Shelf, { readonly bonus: (level: string) => string }>()(
  'assessment-test/Shelf',
) {}

const spoken: string[] = []

const serviceBacked: CalculatorRegistration<Shelf> = {
  kind: 'calculator',
  ref: 'service-backed-test@1',
  configSchema: Schema.Struct({}),
  // the one acquisition seam: bind runs while the runtime layer builds,
  // and everything it returns is closed over what it acquired
  bind: Effect.gen(function* () {
    const shelf = yield* Shelf
    return {
      ref: 'service-backed-test@1',
      compile: (config: unknown) =>
        Effect.succeed({
          config,
          inputSchema: normalizeInputSchema({
            type: 'object',
            properties: { level: { type: 'string', enum: ['national', 'provincial'] } },
            required: ['level'],
            additionalProperties: false,
          }),
          outputSchema: normalizeAtomicSchema(SCORE_AMOUNT_SCHEMA),
          contractHash: 'test:service-backed',
        }),
      verify: () => Effect.void,
      prepare: () =>
        Effect.succeed({
          evaluate: (input: Record<string, unknown>) =>
            Effect.succeed(shelf.bonus(String(input['level']))),
        }),
    }
  }),
}

const registrations = [
  ...builtinCalculators,
  serviceBacked as unknown as CalculatorRegistration<never>,
]
const contributed = <T>(values: readonly T[]): readonly Contributed<T>[] =>
  values.map((value) => ({ pluginId: '@qualy/plugin-assessment-tests', value }))
const definitions: readonly ScoringDefinition[] = [
  ...registrations.map(({ kind, ref, configSchema }): ScoringDefinition => ({
    kind,
    ref,
    configSchema,
  })),
  ...builtinAggregators,
]
// both catalogs off the PRODUCTION providers - same compile, same refusals
const definitionLayer = (Scoring.definitionProvider as unknown as ProvideExtension).compile(
  contributed(definitions),
) as Layer.Layer<ScoringDefinitionCatalog>
const runtimeLayer = (scoringRuntimeProvider as unknown as ProvideExtension).compile(
  contributed(registrations),
)

const SCORING_CONFIG = JSON.stringify({
  calculator: { ref: 'service-backed-test@1', config: {} },
  aggregator: { ref: 'sum@1', config: {} },
  recognitions: { 'rec-level': { label: '认定级别' } },
  bindings: { level: { kind: 'recognition', recognitionId: 'rec-level' } },
})

describe.runIf(postgresAvailable)('a service-backed calculator, through the real path', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-service-backed')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  const catalogOf = (shelf: Layer.Layer<Shelf> | null) => {
    const unshelved = runtimeLayer.pipe(
      Layer.provide(db.services as never),
      Layer.provide(definitionLayer),
      Layer.provide(Layer.succeed(ItemTypeCatalog, new Map())),
      Layer.provide(assembledLayer),
    )
    return (
      shelf === null ? unshelved : unshelved.pipe(Layer.provide(shelf))
    ) as Layer.Layer<ScoringRuntimeCatalog>
  }

  it('freezes, prepares and scores through the service its bind acquired', async () => {
    const one = async (sql: string, values: unknown[] = []) =>
      (await db.row<{ id: string }>(sql, values)).id
    const tenant = await one(
      `insert into tenants (slug, name) values ('svc-${randomUUID().slice(0, 8)}', 'Svc') returning id`,
    )
    const orgType = await one(
      `insert into org_types (tenant_id, name) values ($1, 'Class') returning id`,
      [tenant],
    )
    const node = await one(
      `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
       values ($1, $2, 'Class', 'svc', 0) returning id`,
      [tenant, orgType],
    )
    const userType = await one(
      `insert into user_types (tenant_id, code, name, placement_mode)
       values ($1, 'staff', 'Staff', 'unrestricted') returning id`,
      [tenant],
    )
    const user = await one(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, 'Admin', $2, $3) returning id`,
      [tenant, userType, node],
    )
    const batch = await one(
      `insert into assessment_batches (tenant_id, name, material_range)
       values ($1, 'Service round', daterange('2026-03-01', '2026-09-01')) returning id`,
      [tenant],
    )
    const group = await one(
      `insert into score_groups (tenant_id, batch_id, name) values ($1, $2, '文体') returning id`,
      [tenant, batch],
    )
    const item = await one(
      `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id, status)
       values ($1, $2, 'evidence', '服务加成', $3, 'active') returning id`,
      [tenant, batch, group],
    )
    const revision = await one(
      `insert into assessment_item_revisions
         (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by)
       values ($1, $2, 1, 'administrative', '{}', $3::jsonb, '{}', '{}', $4) returning id`,
      [tenant, item, SCORING_CONFIG, user],
    )

    spoken.length = 0
    const shelf = Layer.succeed(
      Shelf,
      Shelf.of({
        bonus: (level) => {
          spoken.push(level)
          return level === 'national' ? '7.50' : '2.25'
        },
      }),
    )
    const scope = await Effect.runPromise(Scope.make())
    try {
      const context = await Effect.runPromise(Layer.buildWithScope(catalogOf(shelf), scope))
      const catalog = Context.get(context, ScoringRuntimeCatalog)
      // the real boot primitive freezes the plan through the real compiler,
      // against the runtime catalog whose bind holds the service
      await Effect.runPromise(
        Effect.provide(
          transaction(
            sweepScoringPlans({
              itemTypes: new Map(),
              definitions: {
                calculators: new Map(
                  definitions.flatMap((d) =>
                    d.kind === 'calculator' ? [[d.ref, d] as const] : [],
                  ),
                ),
                aggregators: new Map(builtinAggregators.map((a) => [a.ref, a])),
              },
              compile: catalog.compile,
              verify: catalog.verify,
            }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
          ) as never,
          db.services,
        ) as Effect.Effect<unknown>,
      )
      // binding acquired the service; freezing asked it for nothing
      expect(spoken).toEqual([])

      const stored = await db.row<{ scoring_plan: unknown }>(
        `select scoring_plan from assessment_item_revisions where id = $1`,
        [revision],
      )
      expect(stored.scoring_plan).not.toBeNull()
      const plan = await Effect.runPromise(
        readScoringPlan({ id: revision, scoringPlan: stored.scoring_plan }),
      )
      expect(plan.calculator.ref).toBe('service-backed-test@1')

      const prepared = await Effect.runPromise(
        catalog.prepare(plan.calculator.ref, frozenCalculatorOf(plan), {
          tenantId: tenant,
          batchId: batch,
        }),
      )
      const evaluated = await Effect.runPromise(
        evaluateEntry(prepared, {
          entryId: 'entry-under-test',
          entryRevisionId: null,
          itemId: item,
          plan,
          recognition: { 'rec-level': 'national' },
        }),
      )
      // the amount is the service's own answer, scaled by the host
      expect(evaluated.amount).toBe(scaledAmount('7.50'))
      expect(spoken).toEqual(['national'])
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  }, 120_000)

  it('refuses to build at all when the service provider is removed', async () => {
    const scope = await Effect.runPromise(Scope.make())
    try {
      const outcome = await Effect.runPromiseExit(Layer.buildWithScope(catalogOf(null), scope))
      expect(Exit.isFailure(outcome)).toBe(true)
      // named, not defaulted: the missing service is the story
      expect(inspect(outcome, { depth: 6 })).toContain('assessment-test/Shelf')
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  }, 120_000)
})
