import { createHash } from 'node:crypto'
import { Context, Effect, Layer, Semaphore } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { sql } from 'kysely'
import { Api } from '@qualy/api-kit/local'
import { BadRequest } from '@qualy/api-kit/schema'
import { CurrentUser } from '@qualy/plugin-auth/server/session'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import { scopeCoverage, type Principal } from '@qualy/rbac-contract'
import { Audit } from '@qualy/audit-contract/effect'
import { Sandbox } from '@qualy/plugin-sandbox/service'
import { FORMULA_ABI_VERSION } from '@qualy/formula'
import {
  TRIPLE_SLASH,
  checkFormulaWorkspace,
  dropWorkspace,
  parseDiagnostics,
  stageFormulaWorkspace,
} from '@qualy/formula/staging'
import {
  canonicalDecimal,
  canonicalizeAtomicSchema,
  canonicalizeInputSchema,
  constraintOf,
  kindOf,
  normalizeAtomicSchema,
  normalizeInputSchema,
  parameterSchemaAt,
  validateAtomicProfile,
  validateInputProfile,
  type AtomicSchema,
  type DecimalSchema,
  type InputSchema,
} from '@qualy/value-schema'
import { validateValue } from '@qualy/value-schema/validate'
import {
  FormulaDraftReplaced,
  FormulaFunctionArchived as FormulaFunctionArchivedAction,
  FormulaFunctionCreated,
} from '../actions.ts'
import { formulaApiGroup } from '../api.ts'
import { FormulaBundleRefused, bundleFormula } from './bundler.ts'
import { db } from './db.ts'
import {
  FormulaCompileUnavailable,
  FormulaContractInvalid,
  FormulaDraftConflict,
  FormulaFunctionArchived,
  FormulaFunctionNotFound,
  FormulaOwnerNodeInvalid,
  FormulaSourceRefused,
  FormulaSourceTooLarge,
  FormulaTestFailed,
  FormulaTypecheckFailed,
  FormulaVersionNotFound,
} from './errors.ts'
import { esbuildVersion, tscEntry, typescriptVersion } from './toolchain.ts'

const MANAGE = 'assessment.formula.manage'
const SOURCE_LIMIT = 262_144

export interface FormulaTestInput {
  readonly name: string
  readonly input: unknown
  readonly expected: string
}

interface FunctionRow {
  id: string
  ownerNodeId: string
  name: string
  description: string | null
  draftSourceTs: string
  draftTests: readonly FormulaTestInput[]
  draftRevision: number
  archivedAt: Date | null
  updatedAt: Date
  latestVersionNo: number | null
}

interface VersionRow {
  id: string
  versionNo: number
  sourceTs: string
  runtimeJs: string
  inputSchema: unknown
  outputSchema: unknown
  sourceSha256: string
  runtimeSha256: string
  contractSha256: string
  typescriptVersion: string
  esbuildVersion: string
  formulaAbiVersion: number
  formulaRuntimeSha256: string
  quickjsEngineVersion: string
  tests: readonly FormulaTestInput[]
  testReport: unknown
  publishedBy: string
  publishedAt: Date
}

export interface TestProblem {
  readonly at: 'input' | 'expected'
  readonly parameter?: string
  readonly reason: string
  readonly constraint?: string
}

export interface TestReportRow {
  readonly name: string
  readonly passed: boolean
  readonly expected: string
  readonly actual?: string
  readonly problems?: readonly TestProblem[]
  readonly refusal?: string
  readonly defect?: string
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const functionDto = (row: FunctionRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  ownerNodeId: row.ownerNodeId,
  status: (row.archivedAt === null ? 'active' : 'archived') as 'active' | 'archived',
  draftRevision: row.draftRevision,
  latestVersionNo: row.latestVersionNo === null ? null : Number(row.latestVersionNo),
  updatedAt: iso(row.updatedAt),
})

const functionDetailDto = (row: FunctionRow) => ({
  ...functionDto(row),
  draftSourceTs: row.draftSourceTs,
  draftTests: row.draftTests,
})

const versionViewDto = (row: VersionRow) => ({
  versionNo: row.versionNo,
  contractSha256: row.contractSha256,
  runtimeSha256: row.runtimeSha256,
  publishedBy: row.publishedBy,
  publishedAt: iso(row.publishedAt),
})

const versionDetailDto = (row: VersionRow) => ({
  ...versionViewDto(row),
  sourceTs: row.sourceTs,
  sourceSha256: row.sourceSha256,
  inputSchema: row.inputSchema,
  outputSchema: row.outputSchema,
  typescriptVersion: row.typescriptVersion,
  esbuildVersion: row.esbuildVersion,
  formulaAbiVersion: row.formulaAbiVersion,
  formulaRuntimeSha256: row.formulaRuntimeSha256,
  quickjsEngineVersion: row.quickjsEngineVersion,
  tests: row.tests,
  testReport: row.testReport,
})

/** a compiled draft: everything a version row needs except its number */
interface CompiledFormula {
  readonly artifact: string
  readonly inputSchema: InputSchema
  readonly outputSchema: DecimalSchema
  readonly sourceSha256: string
  readonly runtimeSha256: string
  readonly contractSha256: string
  readonly formulaRuntimeSha256: string
  readonly report: readonly TestReportRow[]
}

type CompileRefusal =
  | FormulaSourceTooLarge
  | FormulaSourceRefused
  | FormulaTypecheckFailed
  | FormulaContractInvalid
  | FormulaTestFailed
  | FormulaCompileUnavailable

interface FormulaLibraryShape {
  readonly listFunctions: (
    tenantId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) => Effect.Effect<{
    items: ReturnType<typeof functionDto>[]
    nextCursor: string | null
  }>
  readonly createFunction: (
    tenantId: string,
    input: { ownerNodeId: string; name: string; description?: string; draftSourceTs?: string },
    as: Principal,
  ) => Effect.Effect<ReturnType<typeof functionDetailDto>, AccessDenied | FormulaOwnerNodeInvalid>
  readonly getFunction: (
    tenantId: string,
    functionId: string,
    as: Principal,
  ) => Effect.Effect<
    {
      function: ReturnType<typeof functionDetailDto>
      versions: ReturnType<typeof versionViewDto>[]
    },
    FormulaFunctionNotFound
  >
  readonly updateDraft: (
    tenantId: string,
    functionId: string,
    patch: {
      expectedDraftRevision: number
      name?: string
      description?: string | null
      draftSourceTs?: string
      draftTests?: readonly FormulaTestInput[]
    },
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof functionDetailDto>,
    FormulaFunctionNotFound | FormulaFunctionArchived | FormulaDraftConflict | FormulaSourceTooLarge
  >
  readonly setStatus: (
    tenantId: string,
    functionId: string,
    status: 'active' | 'archived',
    as: Principal,
  ) => Effect.Effect<ReturnType<typeof functionDetailDto>, FormulaFunctionNotFound>
  readonly publish: (
    tenantId: string,
    functionId: string,
    expectedDraftRevision: number,
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof versionDetailDto>,
    FormulaFunctionNotFound | FormulaFunctionArchived | FormulaDraftConflict | CompileRefusal
  >
  readonly getVersion: (
    tenantId: string,
    functionId: string,
    versionNo: number,
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof versionDetailDto>,
    FormulaFunctionNotFound | FormulaVersionNotFound
  >
}

export class FormulaLibrary extends Context.Service<FormulaLibrary, FormulaLibraryShape>()(
  '@qualy/plugin-assessment-formula/FormulaLibrary',
) {}

const DEFAULT_SOURCE = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
  }),
  output: Schema.decimal({ maxScale: 2 }),
  run: (input) => input.value,
})
`

export const make = Effect.fn('FormulaLibrary.make')(function* () {
  const withDb = yield* withDatabase
  const rbac = yield* Rbac
  const audit = yield* Audit
  const sandbox = yield* Sandbox

  // one compile at a time: tsc and esbuild are whole child processes, and a
  // publish burst must queue rather than multiply them
  const compiles = Semaphore.makeUnsafe(1)

  const actorOf = (as: Principal) => ({ kind: 'user', userId: as.userId }) as const

  const latestNoSubquery = sql<number | null>`(
    select max(v.version_no) from assessment_formula_versions v
    where v.tenant_id = assessment_formula_functions.tenant_id
      and v.function_id = assessment_formula_functions.id
  )`

  const foundRow = (
    tenantId: string,
    functionId: string,
  ): Effect.Effect<FunctionRow, FormulaFunctionNotFound, Orm> =>
    db
      .query((k) =>
        k
          .selectFrom('FormulaFunction')
          .selectAll()
          .select(latestNoSubquery.as('latestVersionNo'))
          .where('tenantId', '=', tenantId)
          .where('id', '=', functionId)
          .executeTakeFirst(),
      )
      .pipe(
        Effect.orDie,
        Effect.flatMap((row) =>
          row === undefined
            ? Effect.fail(new FormulaFunctionNotFound())
            : Effect.succeed(row as unknown as FunctionRow),
        ),
      )

  /** the manage gate for one function; unknown and unreachable read the same */
  const managedRow = (tenantId: string, functionId: string, as: Principal) =>
    foundRow(tenantId, functionId).pipe(
      Effect.tap((row) =>
        Effect.flatMap(rbac.canAt(as, MANAGE, row.ownerNodeId), (allowed) =>
          allowed ? Effect.void : Effect.fail(new FormulaFunctionNotFound()),
        ),
      ),
    )

  const runTests = (
    artifact: string,
    artifactHash: string,
    inputSchema: InputSchema,
    outputSchema: DecimalSchema,
    tests: readonly FormulaTestInput[],
  ): Effect.Effect<readonly TestReportRow[], FormulaCompileUnavailable> =>
    Effect.gen(function* () {
      const report: TestReportRow[] = []
      for (const test of tests) {
        // the row always carries what was expected, in the canonical spelling
        // the comparison uses; a lexically broken expectation shows as typed
        const expected = canonicalDecimal(test.expected) ?? test.expected
        const inputIssues = validateValue(inputSchema, test.input)
        const expectedIssues = validateValue(outputSchema, test.expected)
        if (inputIssues.length > 0 || expectedIssues.length > 0) {
          const problems: TestProblem[] = [
            ...inputIssues.map((issue) => {
              const parameter = issue.path.startsWith('/') ? issue.path.slice(1) : undefined
              const at =
                parameter === undefined ? undefined : parameterSchemaAt(inputSchema, issue.path)
              const constraint = at === undefined ? undefined : constraintOf(at, issue.reason)
              return {
                at: 'input' as const,
                ...(parameter === undefined ? {} : { parameter }),
                reason: issue.reason,
                ...(constraint === undefined ? {} : { constraint }),
              }
            }),
            ...expectedIssues.map((issue) => {
              const constraint = constraintOf(outputSchema, issue.reason)
              return {
                at: 'expected' as const,
                reason: issue.reason,
                ...(constraint === undefined ? {} : { constraint }),
              }
            }),
          ]
          report.push({ name: test.name, passed: false, expected, problems })
          continue
        }
        const outcome = yield* sandbox
          .invoke({
            artifact,
            artifactHash,
            entrypoint: '__qualyInvoke',
            arguments: [JSON.stringify(test.input)],
          })
          .pipe(
            Effect.map((value) => ({ kind: 'answered', value }) as const),
            Effect.catchTag('SandboxEvalFailed', (failure) =>
              Effect.succeed({ kind: 'defect', message: failure.message } as const),
            ),
            Effect.mapError(() => new FormulaCompileUnavailable()),
          )
        if (outcome.kind === 'defect') {
          report.push({ name: test.name, passed: false, expected, defect: outcome.message })
          continue
        }
        const envelope = JSON.parse(outcome.value as string) as {
          ok: boolean
          amount?: string
          failure?: { message: string }
        }
        if (!envelope.ok) {
          report.push({
            name: test.name,
            passed: false,
            expected,
            refusal: envelope.failure?.message ?? '',
          })
          continue
        }
        const actual = canonicalDecimal(envelope.amount ?? '') ?? envelope.amount ?? ''
        report.push({ name: test.name, passed: actual === expected, expected, actual })
      }
      return report
    })

  const compile = (
    source: string,
    tests: readonly FormulaTestInput[],
  ): Effect.Effect<CompiledFormula, CompileRefusal> =>
    compiles.withPermits(1)(
      Effect.gen(function* () {
        if (Buffer.byteLength(source, 'utf8') > SOURCE_LIMIT)
          return yield* Effect.fail(new FormulaSourceTooLarge({ limit: SOURCE_LIMIT }))
        if (TRIPLE_SLASH.test(source))
          return yield* Effect.fail(new FormulaSourceRefused({ reason: 'triple-slash' }))

        const checked = yield* Effect.tryPromise({
          try: async () => {
            const root = stageFormulaWorkspace(source)
            try {
              return await checkFormulaWorkspace(root, tscEntry)
            } finally {
              dropWorkspace(root)
            }
          },
          catch: () => new FormulaCompileUnavailable(),
        })
        if (checked.code !== 0)
          return yield* Effect.fail(
            new FormulaTypecheckFailed({ diagnostics: parseDiagnostics(checked.output) }),
          )

        const bundled = yield* Effect.tryPromise({
          try: () => bundleFormula(source),
          catch: (failure) =>
            failure instanceof FormulaBundleRefused
              ? new FormulaSourceRefused({
                  reason: 'import',
                  specifier: failure.refusals[0]?.specifier ?? 'unknown',
                })
              : new FormulaCompileUnavailable(),
        })

        const artifactHash = sha256(bundled.artifact)
        const rawContract = yield* sandbox
          .invoke({
            artifact: bundled.artifact,
            artifactHash,
            entrypoint: '__qualyContract',
            arguments: [],
          })
          .pipe(Effect.mapError(() => new FormulaCompileUnavailable()))

        const contract =
          typeof rawContract === 'object' && rawContract !== null
            ? (rawContract as { input?: unknown; output?: unknown })
            : {}
        const issues = [
          ...validateInputProfile(contract.input).map((issue) => ({
            path: issue.path === '' ? 'input' : `input.${issue.path}`,
            reason: issue.reason,
          })),
          ...validateAtomicProfile(contract.output).map((issue) => ({
            path: issue.path === '' ? 'output' : `output.${issue.path}`,
            reason: issue.reason,
          })),
        ]
        if (issues.length === 0 && kindOf(contract.output as AtomicSchema) !== 'decimal')
          issues.push({ path: 'output', reason: 'not-a-decimal' })
        if (issues.length > 0) return yield* Effect.fail(new FormulaContractInvalid({ issues }))

        const inputSchema = normalizeInputSchema(contract.input as InputSchema)
        const outputSchema = normalizeAtomicSchema(contract.output as AtomicSchema) as DecimalSchema

        const report = yield* runTests(
          bundled.artifact,
          artifactHash,
          inputSchema,
          outputSchema,
          tests,
        )
        if (tests.length === 0 || report.some((row) => !row.passed))
          return yield* Effect.fail(new FormulaTestFailed({ report }))

        const runtimeDigest = createHash('sha256')
        for (const name of [...bundled.sdkFiles.keys()].sort()) {
          runtimeDigest.update(name, 'utf8')
          runtimeDigest.update(' ', 'utf8')
          runtimeDigest.update(bundled.sdkFiles.get(name)!, 'utf8')
        }

        return {
          artifact: bundled.artifact,
          inputSchema,
          outputSchema,
          sourceSha256: sha256(source),
          runtimeSha256: artifactHash,
          contractSha256: sha256(
            `${canonicalizeInputSchema(inputSchema)}|${canonicalizeAtomicSchema(outputSchema)}`,
          ),
          formulaRuntimeSha256: runtimeDigest.digest('hex'),
          report,
        } satisfies CompiledFormula
      }),
    )

  const listFunctions = Effect.fn('FormulaLibrary.listFunctions')(function* (
    tenantId: string,
    _page: { cursor?: string; limit?: string },
    as: Principal,
  ) {
    const scope = yield* rbac.listAuthorizedScope(as, MANAGE)
    if (!scope.tenantWide && scope.anchors.length === 0)
      return { items: [], nextCursor: null as string | null }
    const rows = yield* db
      .query((k) =>
        k
          .selectFrom('FormulaFunction')
          .innerJoin('OrgNode', (join) =>
            join
              .onRef('OrgNode.tenantId', '=', 'FormulaFunction.tenantId')
              .onRef('OrgNode.id', '=', 'FormulaFunction.ownerNodeId'),
          )
          .selectAll('FormulaFunction')
          .select(latestNoSubquery.as('latestVersionNo'))
          .where('FormulaFunction.tenantId', '=', tenantId)
          .where(
            scopeCoverage(scope, {
              id: sql.ref('org_nodes.id') as never,
              tenantId: sql.ref('org_nodes.tenant_id') as never,
              path: sql.ref('org_nodes.path') as never,
            }),
          )
          .orderBy('FormulaFunction.updatedAt', 'desc')
          .orderBy('FormulaFunction.id', 'desc')
          .execute(),
      )
      .pipe(Effect.orDie)
    return {
      items: (rows as unknown as FunctionRow[]).map(functionDto),
      nextCursor: null as string | null,
    }
  })

  const createFunction = Effect.fn('FormulaLibrary.createFunction')(function* (
    tenantId: string,
    input: { ownerNodeId: string; name: string; description?: string; draftSourceTs?: string },
    as: Principal,
  ) {
    const allowed = yield* rbac.canAt(as, MANAGE, input.ownerNodeId)
    if (!allowed)
      return yield* Effect.fail(new AccessDenied({ reason: 'cannot manage scoring formulas here' }))
    const node = yield* db
      .query((k) =>
        k
          .selectFrom('OrgNode')
          .select('id')
          .where('tenantId', '=', tenantId)
          .where('id', '=', input.ownerNodeId)
          .executeTakeFirst(),
      )
      .pipe(Effect.orDie)
    if (node === undefined) return yield* Effect.fail(new FormulaOwnerNodeInvalid())
    const created = yield* db
      .query((k) =>
        k
          .insertInto('FormulaFunction')
          .values({
            tenantId,
            ownerNodeId: input.ownerNodeId,
            name: input.name,
            description: input.description ?? null,
            draftSourceTs: input.draftSourceTs ?? DEFAULT_SOURCE,
            draftTests: sql`${JSON.stringify([])}::jsonb`,
            createdBy: as.userId,
            updatedBy: as.userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      )
      .pipe(Effect.orDie)
    yield* audit.record(FormulaFunctionCreated, {
      tenantId,
      actor: actorOf(as),
      target: { id: created.id as string, label: input.name },
      details: { ownerNodeId: input.ownerNodeId },
    })
    const row = yield* foundRow(tenantId, created.id as string).pipe(Effect.orDie)
    return functionDetailDto(row)
  })

  const getFunction = Effect.fn('FormulaLibrary.getFunction')(function* (
    tenantId: string,
    functionId: string,
    as: Principal,
  ) {
    const row = yield* managedRow(tenantId, functionId, as)
    const versions = yield* db
      .query((k) =>
        k
          .selectFrom('FormulaVersion')
          .selectAll()
          .where('tenantId', '=', tenantId)
          .where('functionId', '=', functionId)
          .orderBy('versionNo', 'desc')
          .execute(),
      )
      .pipe(Effect.orDie)
    return {
      function: functionDetailDto(row),
      versions: (versions as unknown as VersionRow[]).map(versionViewDto),
    }
  })

  const updateDraft = Effect.fn('FormulaLibrary.updateDraft')(function* (
    tenantId: string,
    functionId: string,
    patch: {
      expectedDraftRevision: number
      name?: string
      description?: string | null
      draftSourceTs?: string
      draftTests?: readonly FormulaTestInput[]
    },
    as: Principal,
  ) {
    const row = yield* managedRow(tenantId, functionId, as)
    if (row.archivedAt !== null) return yield* Effect.fail(new FormulaFunctionArchived())
    if (
      patch.draftSourceTs !== undefined &&
      Buffer.byteLength(patch.draftSourceTs, 'utf8') > SOURCE_LIMIT
    )
      return yield* Effect.fail(new FormulaSourceTooLarge({ limit: SOURCE_LIMIT }))
    const updated = yield* db
      .query((k) =>
        k
          .updateTable('FormulaFunction')
          .set({
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.description === undefined ? {} : { description: patch.description }),
            ...(patch.draftSourceTs === undefined ? {} : { draftSourceTs: patch.draftSourceTs }),
            ...(patch.draftTests === undefined
              ? {}
              : { draftTests: sql`${JSON.stringify(patch.draftTests)}::jsonb` }),
            draftRevision: sql`draft_revision + 1`,
            updatedBy: as.userId,
            updatedAt: sql`now()`,
          })
          .where('tenantId', '=', tenantId)
          .where('id', '=', functionId)
          .where('draftRevision', '=', patch.expectedDraftRevision)
          .executeTakeFirst(),
      )
      .pipe(Effect.orDie)
    if (Number(updated.numUpdatedRows ?? 0) === 0) {
      const current = yield* foundRow(tenantId, functionId)
      return yield* Effect.fail(new FormulaDraftConflict({ draftRevision: current.draftRevision }))
    }
    yield* audit.record(FormulaDraftReplaced, {
      tenantId,
      actor: actorOf(as),
      target: { id: functionId, label: patch.name ?? row.name },
      details: { draftRevision: patch.expectedDraftRevision + 1 },
    })
    const fresh = yield* foundRow(tenantId, functionId)
    return functionDetailDto(fresh)
  })

  const setStatus = Effect.fn('FormulaLibrary.setStatus')(function* (
    tenantId: string,
    functionId: string,
    status: 'active' | 'archived',
    as: Principal,
  ) {
    const row = yield* managedRow(tenantId, functionId, as)
    const willArchive = status === 'archived'
    if ((row.archivedAt !== null) !== willArchive) {
      yield* db
        .query((k) =>
          k
            .updateTable('FormulaFunction')
            .set({
              archivedAt: willArchive ? sql`now()` : null,
              updatedBy: as.userId,
              updatedAt: sql`now()`,
            })
            .where('tenantId', '=', tenantId)
            .where('id', '=', functionId)
            .execute(),
        )
        .pipe(Effect.orDie)
      if (willArchive)
        yield* audit.record(FormulaFunctionArchivedAction, {
          tenantId,
          actor: actorOf(as),
          target: { id: functionId, label: row.name },
          details: {},
        })
    }
    const fresh = yield* foundRow(tenantId, functionId)
    return functionDetailDto(fresh)
  })

  const publish = Effect.fn('FormulaLibrary.publish')(function* (
    tenantId: string,
    functionId: string,
    expectedDraftRevision: number,
    as: Principal,
  ) {
    const row = yield* managedRow(tenantId, functionId, as)
    if (row.archivedAt !== null) return yield* Effect.fail(new FormulaFunctionArchived())
    if (row.draftRevision !== expectedDraftRevision)
      return yield* Effect.fail(new FormulaDraftConflict({ draftRevision: row.draftRevision }))

    // the long work runs outside any transaction, on the draft as read
    const compiled = yield* compile(row.draftSourceTs, row.draftTests)
    const compilerVersion = yield* Effect.tryPromise({
      try: () => typescriptVersion(),
      catch: () => new FormulaCompileUnavailable(),
    })

    const inserted = yield* withDb(
      transaction(
        Effect.gen(function* () {
          const locked = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaFunction')
                .select(['draftRevision', 'archivedAt'])
                .where('tenantId', '=', tenantId)
                .where('id', '=', functionId)
                .forUpdate()
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (locked === undefined) return yield* Effect.fail(new FormulaFunctionNotFound())
          if (locked.archivedAt !== null) return yield* Effect.fail(new FormulaFunctionArchived())
          // the compile ran on a snapshot; a draft that moved meanwhile would
          // freeze bytes nobody asked to publish
          if (locked.draftRevision !== expectedDraftRevision)
            return yield* Effect.fail(
              new FormulaDraftConflict({ draftRevision: locked.draftRevision as number }),
            )
          const top = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaVersion')
                .select(sql<number | null>`max(version_no)`.as('top'))
                .where('tenantId', '=', tenantId)
                .where('functionId', '=', functionId)
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          return yield* db
            .query((k) =>
              k
                .insertInto('FormulaVersion')
                .values({
                  tenantId,
                  functionId,
                  versionNo: Number(top?.top ?? 0) + 1,
                  sourceTs: row.draftSourceTs,
                  runtimeJs: compiled.artifact,
                  inputSchema: sql`${JSON.stringify(compiled.inputSchema)}::jsonb`,
                  outputSchema: sql`${JSON.stringify(compiled.outputSchema)}::jsonb`,
                  sourceSha256: compiled.sourceSha256,
                  runtimeSha256: compiled.runtimeSha256,
                  contractSha256: compiled.contractSha256,
                  typescriptVersion: compilerVersion,
                  esbuildVersion,
                  formulaAbiVersion: FORMULA_ABI_VERSION,
                  formulaRuntimeSha256: compiled.formulaRuntimeSha256,
                  quickjsEngineVersion: sandbox.engine,
                  tests: sql`${JSON.stringify(row.draftTests)}::jsonb`,
                  testReport: sql`${JSON.stringify(compiled.report)}::jsonb`,
                  publishedBy: as.userId,
                })
                .returningAll()
                .executeTakeFirstOrThrow(),
            )
            .pipe(Effect.orDie)
        }),
      ),
    )
    return versionDetailDto(inserted as unknown as VersionRow)
  })

  const getVersion = Effect.fn('FormulaLibrary.getVersion')(function* (
    tenantId: string,
    functionId: string,
    versionNo: number,
    as: Principal,
  ) {
    yield* managedRow(tenantId, functionId, as)
    const version = yield* db
      .query((k) =>
        k
          .selectFrom('FormulaVersion')
          .selectAll()
          .where('tenantId', '=', tenantId)
          .where('functionId', '=', functionId)
          .where('versionNo', '=', versionNo)
          .executeTakeFirst(),
      )
      .pipe(Effect.orDie)
    if (version === undefined) return yield* Effect.fail(new FormulaVersionNotFound())
    return versionDetailDto(version as unknown as VersionRow)
  })

  // every method runs with the database provided once, here: the bodies
  // above stay plain Orm-requiring effects, and nothing leaks the requirement
  const service: FormulaLibraryShape = {
    listFunctions: (tenantId, page, as) => withDb(listFunctions(tenantId, page, as)),
    createFunction: (tenantId, input, as) => withDb(createFunction(tenantId, input, as)),
    getFunction: (tenantId, functionId, as) => withDb(getFunction(tenantId, functionId, as)),
    updateDraft: (tenantId, functionId, patch, as) =>
      withDb(updateDraft(tenantId, functionId, patch, as)),
    setStatus: (tenantId, functionId, status, as) =>
      withDb(setStatus(tenantId, functionId, status, as)),
    publish: (tenantId, functionId, expected, as) =>
      withDb(publish(tenantId, functionId, expected, as)),
    getVersion: (tenantId, functionId, versionNo, as) =>
      withDb(getVersion(tenantId, functionId, versionNo, as)),
  }
  return service
})

export const layer = Layer.effect(FormulaLibrary, make())

const local = Api.local(formulaApiGroup)

export const formulaApiHandlers = HttpApiBuilder.group(local, 'assessmentFormula', (handlers) =>
  handlers
    .handle(
      'listFormulaFunctions',
      Effect.fn('assessmentFormula.list.handler')(function* ({ query }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        return yield* library.listFunctions(principal.tenantId, query, principal)
      }),
    )
    .handle(
      'createFormulaFunction',
      Effect.fn('assessmentFormula.create.handler')(function* ({ payload }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const created = yield* library.createFunction(
          principal.tenantId,
          {
            ownerNodeId: payload.ownerNodeId,
            name: payload.name,
            ...(payload.description === undefined ? {} : { description: payload.description }),
            ...(payload.draftSourceTs === undefined
              ? {}
              : { draftSourceTs: payload.draftSourceTs }),
          },
          principal,
        )
        return { function: created }
      }),
    )
    .handle(
      'getFormulaFunction',
      Effect.fn('assessmentFormula.get.handler')(function* ({ params }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        return yield* library.getFunction(principal.tenantId, params.functionId, principal)
      }),
    )
    .handle(
      'updateFormulaDraft',
      Effect.fn('assessmentFormula.updateDraft.handler')(function* ({ params, payload }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const updated = yield* library.updateDraft(
          principal.tenantId,
          params.functionId,
          {
            expectedDraftRevision: payload.expectedDraftRevision,
            ...(payload.name === undefined ? {} : { name: payload.name }),
            ...(payload.description === undefined ? {} : { description: payload.description }),
            ...(payload.draftSourceTs === undefined
              ? {}
              : { draftSourceTs: payload.draftSourceTs }),
            ...(payload.draftTests === undefined
              ? {}
              : { draftTests: payload.draftTests as readonly FormulaTestInput[] }),
          },
          principal,
        )
        return { function: updated }
      }),
    )
    .handle(
      'setFormulaFunctionStatus',
      Effect.fn('assessmentFormula.setStatus.handler')(function* ({ params, payload }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const updated = yield* library.setStatus(
          principal.tenantId,
          params.functionId,
          payload.status,
          principal,
        )
        return { function: updated }
      }),
    )
    .handle(
      'publishFormulaVersion',
      Effect.fn('assessmentFormula.publish.handler')(function* ({ params, payload }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const version = yield* library.publish(
          principal.tenantId,
          params.functionId,
          payload.expectedDraftRevision,
          principal,
        )
        return { version }
      }),
    )
    .handle(
      'getFormulaVersion',
      Effect.fn('assessmentFormula.getVersion.handler')(function* ({ params }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const parsed = Number(params.versionNo)
        if (!Number.isSafeInteger(parsed) || parsed < 1)
          return yield* Effect.fail(
            new BadRequest({ message: 'the version number must be a positive integer' }),
          )
        return {
          version: yield* library.getVersion(
            principal.tenantId,
            params.functionId,
            parsed,
            principal,
          ),
        }
      }),
    ),
)
