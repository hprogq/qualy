import { createHash } from 'node:crypto'
import { Context, Effect, Layer, Semaphore } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { sql } from 'kysely'
import { Api } from '@qualy/api-kit/local'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { BadRequest, cursorUnusable, pageSize } from '@qualy/api-kit/schema'
import { CurrentUser } from '@qualy/plugin-auth/server/session'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import { scopeCoverage, type Principal } from '@qualy/rbac-contract'
import { Audit } from '@qualy/audit-contract/effect'
import { SANDBOX_ABI_VERSION, Sandbox } from '@qualy/plugin-sandbox/service'
import { FORMULA_ABI_VERSION, SCORE_AMOUNT_SCHEMA } from '@qualy/formula'
import {
  TRIPLE_SLASH,
  checkFormulaWorkspace,
  dropWorkspace,
  moduleSpecifiers,
  parseDiagnostics,
  stageFormulaWorkspace,
} from '@qualy/formula/staging'
import {
  VALUE_SCHEMA_PROFILE_VERSION,
  assignmentPlan,
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
  type NormalizedAtomicSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { validateValue } from '@qualy/value-schema/validate'
import { REGEX_PROFILE_VERSION, patternIssues } from '@qualy/value-schema/regex'
import {
  FormulaDraftReplaced,
  FormulaFunctionArchived as FormulaFunctionArchivedAction,
  FormulaFunctionCreated,
  FormulaFunctionRestored,
} from '../actions.ts'
import { formulaApiGroup } from '../api.ts'
import { FormulaBundleRefused, bundleFormula } from './bundler.ts'
import { db } from './db.ts'
import {
  FormulaBundleFailed,
  FormulaCompileUnavailable,
  FormulaContractInvalid,
  FormulaDraftConflict,
  FormulaExecutionLimitExceeded,
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

/** what an author may SAVE - the formula's own text */
const SOURCE_LIMIT = 262_144
/** what a compiled artifact may weigh: user source plus the trusted wrapper
 * and the bundled SDK; deliberately a separate, larger wall than the source
 * limit so a legal source can never produce an unshippable artifact */
const MAX_COMPILED_ARTIFACT_BYTES = 1_048_576
/** the sandbox transport for __qualyContract, above the largest legal
 * contract so a real one always arrives whole */
const MAX_CONTRACT_TRANSPORT_BYTES = 131_072
/** the canonical bytes of a legal contract; part of the v1 profile budget */
const MAX_CANONICAL_CONTRACT_BYTES = 65_536
/** compiles queue behind one permit; past this depth the service is busy */
const MAX_PENDING_COMPILES = 8

const LIST_FINGERPRINT = 'assessment-formula-functions'

const SUPPRESSION = /@ts-(?:ignore|nocheck|expect-error)\b/
// word-level on purpose: the formula language is tiny, and "strictly typed
// at publication" stops being true the moment any `any` slips in - even the
// word inside a string is refused, and the message says exactly that
const ANY_WORD = /\bany\b/

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
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
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
  | FormulaBundleFailed
  | FormulaExecutionLimitExceeded
  | FormulaContractInvalid
  | FormulaTestFailed
  | FormulaCompileUnavailable

interface FormulaLibraryShape {
  readonly listFunctions: (
    tenantId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) => Effect.Effect<
    {
      items: ReturnType<typeof functionDto>[]
      nextCursor: string | null
    },
    BadRequest
  >
  readonly createFunction: (
    tenantId: string,
    input: { ownerNodeId: string; name: string; description?: string; draftSourceTs?: string },
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof functionDetailDto>,
    AccessDenied | FormulaOwnerNodeInvalid | FormulaSourceTooLarge
  >
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
  readonly listOwnerOptions: (
    tenantId: string,
    as: Principal,
  ) => Effect.Effect<{ nodes: { id: string; name: string; depth: number }[] }>
}

export class FormulaLibrary extends Context.Service<FormulaLibrary, FormulaLibraryShape>()(
  '@qualy/plugin-assessment-formula/FormulaLibrary',
) {}

const DEFAULT_SOURCE = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
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
    inputSchema: NormalizedInputSchema,
    outputSchema: NormalizedAtomicSchema,
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
            limits: { artifactBytes: MAX_COMPILED_ARTIFACT_BYTES },
          })
          .pipe(
            Effect.map((value) => ({ kind: 'answered', value }) as const),
            // an example that exhausts the engine is that EXAMPLE failing,
            // reported on its row - never the whole publish dressed up as an
            // infrastructure outage
            Effect.catchTags({
              SandboxEvalFailed: (failure) =>
                Effect.succeed({ kind: 'defect', message: failure.message } as const),
              SandboxTimeout: () =>
                Effect.succeed({ kind: 'defect', message: 'execution interrupted' } as const),
              SandboxMemoryExceeded: () =>
                Effect.succeed({ kind: 'defect', message: 'execution out of memory' } as const),
              SandboxStackExceeded: () =>
                Effect.succeed({ kind: 'defect', message: 'execution stack overflow' } as const),
              SandboxOutputTooLarge: () =>
                Effect.succeed({ kind: 'defect', message: 'the answer was too large' } as const),
            }),
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

  // publish bursts queue behind the single compile permit; past a bounded
  // depth the service says busy instead of hoarding child processes
  let pendingCompiles = 0

  const refuseSource = (source: string): CompileRefusal | undefined => {
    if (Buffer.byteLength(source, 'utf8') > SOURCE_LIMIT)
      return new FormulaSourceTooLarge({ limit: SOURCE_LIMIT })
    if (TRIPLE_SLASH.test(source)) return new FormulaSourceRefused({ reason: 'triple-slash' })
    const suppression = SUPPRESSION.exec(source)
    if (suppression !== null)
      return new FormulaSourceRefused({ reason: 'suppression', specifier: suppression[0] })
    if (ANY_WORD.test(source)) return new FormulaSourceRefused({ reason: 'any' })
    // the closure fence runs BEFORE the compiler: tsc resolves whatever the
    // source names even though it executes nothing, and an unchecked
    // specifier is a read of the host filesystem
    const trespass = moduleSpecifiers(source).find((specifier) => specifier !== '@qualy/formula')
    if (trespass !== undefined)
      return new FormulaSourceRefused({ reason: 'import', specifier: trespass })
    return undefined
  }

  const extractContract = (
    artifact: string,
    artifactHash: string,
  ): Effect.Effect<{ input?: unknown; output?: unknown }, CompileRefusal> =>
    sandbox
      .invoke({
        artifact,
        artifactHash,
        entrypoint: '__qualyContract',
        arguments: [],
        limits: {
          artifactBytes: MAX_COMPILED_ARTIFACT_BYTES,
          outputBytes: MAX_CONTRACT_TRANSPORT_BYTES,
        },
      })
      .pipe(
        Effect.map((text) => JSON.parse(text) as { input?: unknown; output?: unknown }),
        Effect.catchTags({
          // the guest's own failure to hand a contract out is the author's
          // problem, classified as such - never a 503
          SandboxEvalFailed: (failure) =>
            Effect.fail(
              new FormulaContractInvalid({
                issues: [{ path: '', reason: 'contract-error' }],
                detail: `${failure.name}: ${failure.message}`,
              }),
            ),
          SandboxOutputTooLarge: () =>
            Effect.fail(
              new FormulaContractInvalid({ issues: [{ path: '', reason: 'contract-too-large' }] }),
            ),
          SandboxTimeout: (failure) =>
            Effect.fail(
              new FormulaExecutionLimitExceeded({ phase: 'contract', verdict: failure.phase }),
            ),
          SandboxMemoryExceeded: () =>
            Effect.fail(
              new FormulaExecutionLimitExceeded({ phase: 'contract', verdict: 'memory' }),
            ),
          SandboxStackExceeded: () =>
            Effect.fail(new FormulaExecutionLimitExceeded({ phase: 'contract', verdict: 'stack' })),
        }),
        Effect.mapError((failure) =>
          failure instanceof FormulaContractInvalid ||
          failure instanceof FormulaExecutionLimitExceeded
            ? failure
            : new FormulaCompileUnavailable(),
        ),
      )

  const compile = (
    source: string,
    tests: readonly FormulaTestInput[],
  ): Effect.Effect<CompiledFormula, CompileRefusal> =>
    Effect.suspend(() => {
      const refused = refuseSource(source)
      if (refused !== undefined) return Effect.fail(refused)
      if (pendingCompiles >= MAX_PENDING_COMPILES)
        return Effect.fail(new FormulaCompileUnavailable())
      pendingCompiles += 1
      return compiles
        .withPermits(1)(
          Effect.gen(function* () {
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
            if (checked.timedOut)
              return yield* Effect.fail(
                new FormulaExecutionLimitExceeded({ phase: 'typecheck', verdict: 'wall-clock' }),
              )
            if (checked.code !== 0) {
              const parsed = parseDiagnostics(checked.output)
              return yield* Effect.fail(
                new FormulaTypecheckFailed({
                  diagnostics: parsed.diagnostics,
                  truncated: parsed.truncated,
                }),
              )
            }

            const bundled = yield* Effect.tryPromise({
              try: () => bundleFormula(source),
              catch: (failure) =>
                failure instanceof FormulaBundleRefused
                  ? new FormulaSourceRefused({
                      reason: 'import',
                      specifier: failure.refusals[0]?.specifier ?? 'unknown',
                    })
                  : new FormulaBundleFailed({
                      message: (failure instanceof Error ? failure.message : String(failure)).slice(
                        0,
                        2000,
                      ),
                    }),
            })
            const artifactBytes = Buffer.byteLength(bundled.artifact, 'utf8')
            if (artifactBytes > MAX_COMPILED_ARTIFACT_BYTES)
              return yield* Effect.fail(
                new FormulaBundleFailed({
                  message: `the compiled artifact is ${artifactBytes} bytes; the ceiling is ${MAX_COMPILED_ARTIFACT_BYTES}`,
                }),
              )

            const artifactHash = sha256(bundled.artifact)
            const contract = yield* extractContract(bundled.artifact, artifactHash)

            // patterns are only worth checking on a structurally sound
            // input, and patternIssues itself is fail-closed on any shape:
            // a contract forged past the type system (input: undefined)
            // must end as a 422, never as a host-side throw
            const inputShapeIssues = validateInputProfile(contract.input)
            const inputPatternIssues =
              inputShapeIssues.length === 0 ? patternIssues(contract.input) : []
            const issues = [
              ...[...inputShapeIssues, ...inputPatternIssues].map((issue) => ({
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
            const outputSchema = normalizeAtomicSchema(contract.output as AtomicSchema)

            // a scoring formula's answer must fit what the scorer can carry:
            // the platform amount is numeric(12,4), so an unbounded or wider
            // output is publishable nowhere and refused here by proof
            const intoScore = assignmentPlan(
              outputSchema,
              normalizeAtomicSchema(SCORE_AMOUNT_SCHEMA),
            )
            if (intoScore.kind !== 'direct')
              issues.push({ path: 'output', reason: 'not-a-score-amount' })

            const canonicalInput = canonicalizeInputSchema(inputSchema)
            const canonicalOutput = canonicalizeAtomicSchema(outputSchema)
            if (
              Buffer.byteLength(canonicalInput, 'utf8') +
                Buffer.byteLength(canonicalOutput, 'utf8') >
              MAX_CANONICAL_CONTRACT_BYTES
            )
              issues.push({ path: '', reason: 'contract-too-large' })
            if (issues.length > 0) return yield* Effect.fail(new FormulaContractInvalid({ issues }))

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
              contractSha256: sha256(`${canonicalInput}|${canonicalOutput}`),
              formulaRuntimeSha256: runtimeDigest.digest('hex'),
              report,
            } satisfies CompiledFormula
          }),
        )
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              pendingCompiles -= 1
            }),
          ),
        )
    })

  const listFunctions = Effect.fn('FormulaLibrary.listFunctions')(function* (
    tenantId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) {
    const scope = yield* rbac.listAuthorizedScope(as, MANAGE)
    if (!scope.tenantWide && scope.anchors.length === 0)
      return { items: [], nextCursor: null as string | null }
    const size = pageSize(page.limit, DEFAULT_PAGE_SIZE)
    const cursor = readQueryCursor(page.cursor, LIST_FINGERPRINT, ['timestamp', 'uuid'])
    if (cursor === null) return yield* Effect.fail(cursorUnusable())
    const rows = yield* db
      .query((k) => {
        let query = k
          .selectFrom('FormulaFunction')
          .innerJoin('OrgNode', (join) =>
            join
              .onRef('OrgNode.tenantId', '=', 'FormulaFunction.tenantId')
              .onRef('OrgNode.id', '=', 'FormulaFunction.ownerNodeId'),
          )
          // projection on purpose: the list never needs the draft source or
          // the examples, and a row may carry a quarter megabyte of each
          .select([
            'FormulaFunction.id',
            'FormulaFunction.name',
            'FormulaFunction.description',
            'FormulaFunction.ownerNodeId',
            'FormulaFunction.draftRevision',
            'FormulaFunction.archivedAt',
            'FormulaFunction.updatedAt',
          ])
          .select(latestNoSubquery.as('latestVersionNo'))
          .where('FormulaFunction.tenantId', '=', tenantId)
          .where(
            scopeCoverage(scope, {
              id: sql.ref('org_nodes.id') as never,
              tenantId: sql.ref('org_nodes.tenant_id') as never,
              path: sql.ref('org_nodes.path') as never,
            }),
          )
        if (cursor !== undefined) {
          // row-value keyset comparison is the postgres-specific idiom the
          // repo allows as a minimal sql fragment
          query = query.where(
            sql<boolean>`(assessment_formula_functions.updated_at, assessment_formula_functions.id)
              < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
          )
        }
        return query
          .orderBy('FormulaFunction.updatedAt', 'desc')
          .orderBy('FormulaFunction.id', 'desc')
          .limit(size + 1)
          .execute()
      })
      .pipe(Effect.orDie)
    const sliced = (rows as unknown as FunctionRow[]).slice(0, size)
    const nextCursor =
      rows.length > size
        ? encodeQueryCursor(LIST_FINGERPRINT, [
            iso(sliced[sliced.length - 1]!.updatedAt),
            sliced[sliced.length - 1]!.id,
          ])
        : null
    return { items: sliced.map(functionDto), nextCursor }
  })

  const createFunction = Effect.fn('FormulaLibrary.createFunction')(function* (
    tenantId: string,
    input: { ownerNodeId: string; name: string; description?: string; draftSourceTs?: string },
    as: Principal,
  ) {
    const allowed = yield* rbac.canAt(as, MANAGE, input.ownerNodeId)
    if (!allowed)
      return yield* Effect.fail(new AccessDenied({ reason: 'cannot manage scoring formulas here' }))
    // the byte gate is a service invariant, identical at create, update and
    // compile - the api's character-length check is not a byte check
    const seed = input.draftSourceTs ?? DEFAULT_SOURCE
    if (Buffer.byteLength(seed, 'utf8') > SOURCE_LIMIT)
      return yield* Effect.fail(new FormulaSourceTooLarge({ limit: SOURCE_LIMIT }))
    const created = yield* withDb(
      transaction(
        Effect.gen(function* () {
          // there is deliberately no owner foreign key, so the existence
          // check and the insert must not race a node deletion: the shared
          // lock keeps the row alive until this commits
          const node = yield* db
            .query((k) =>
              k
                .selectFrom('OrgNode')
                .select('id')
                .where('tenantId', '=', tenantId)
                .where('id', '=', input.ownerNodeId)
                .forShare()
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (node === undefined) return yield* Effect.fail(new FormulaOwnerNodeInvalid())
          const row = yield* db
            .query((k) =>
              k
                .insertInto('FormulaFunction')
                .values({
                  tenantId,
                  ownerNodeId: input.ownerNodeId,
                  name: input.name,
                  description: input.description ?? null,
                  draftSourceTs: seed,
                  draftTests: sql`${JSON.stringify([])}::jsonb`,
                  createdBy: as.userId,
                  updatedBy: as.userId,
                })
                .returning('id')
                .executeTakeFirstOrThrow(),
            )
            .pipe(Effect.orDie)
          // in the transaction on purpose: an auditable write commits with
          // its audit event or not at all (the audit contract's invariant)
          yield* audit.record(FormulaFunctionCreated, {
            tenantId,
            actor: actorOf(as),
            target: { id: row.id as string, label: input.name },
            details: { ownerNodeId: input.ownerNodeId },
          })
          return row
        }),
      ),
    )
    const row = yield* foundRow(tenantId, created.id as string).pipe(Effect.orDie)
    return functionDetailDto(row)
  })

  const getFunction = Effect.fn('FormulaLibrary.getFunction')(function* (
    tenantId: string,
    functionId: string,
    as: Principal,
  ) {
    const row = yield* managedRow(tenantId, functionId, as)
    // summaries only: every published row also carries the full artifact and
    // sources, which belong to getVersion, not to opening the editor
    const versions = yield* db
      .query((k) =>
        k
          .selectFrom('FormulaVersion')
          .select(['versionNo', 'contractSha256', 'runtimeSha256', 'publishedBy', 'publishedAt'])
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
    // a patch that names no field changes nothing: no revision bump, no
    // audit event to explain later
    if (
      patch.name === undefined &&
      patch.description === undefined &&
      patch.draftSourceTs === undefined &&
      patch.draftTests === undefined
    )
      return functionDetailDto(row)
    yield* withDb(
      transaction(
        Effect.gen(function* () {
          const updated = yield* db
            .query((k) =>
              k
                .updateTable('FormulaFunction')
                .set({
                  ...(patch.name === undefined ? {} : { name: patch.name }),
                  ...(patch.description === undefined ? {} : { description: patch.description }),
                  ...(patch.draftSourceTs === undefined
                    ? {}
                    : { draftSourceTs: patch.draftSourceTs }),
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
                // the archive check rides IN the update: the read above ran
                // before this transaction, and a concurrent archive between
                // the two must not see its frozen draft edited
                .where('archivedAt', 'is', null)
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (Number(updated.numUpdatedRows ?? 0) === 0)
            return yield* Effect.fail(new FormulaDraftConflict({ draftRevision: -1 }))
          // with the mutation, or not at all: the audit contract's invariant
          yield* audit.record(FormulaDraftReplaced, {
            tenantId,
            actor: actorOf(as),
            target: { id: functionId, label: patch.name ?? row.name },
            details: { draftRevision: patch.expectedDraftRevision + 1 },
          })
        }),
      ),
    ).pipe(
      // zero rows updated means EITHER a stale revision or a concurrent
      // archive; the reread tells the caller which refusal is theirs
      Effect.catchTag('ASSESSMENT_FORMULA_DRAFT_CONFLICT', () =>
        foundRow(tenantId, functionId).pipe(
          Effect.flatMap((current) =>
            Effect.fail(
              current.archivedAt !== null
                ? new FormulaFunctionArchived()
                : new FormulaDraftConflict({ draftRevision: current.draftRevision }),
            ),
          ),
        ),
      ),
    )
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
      yield* withDb(
        transaction(
          Effect.gen(function* () {
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
            yield* audit.record(
              willArchive ? FormulaFunctionArchivedAction : FormulaFunctionRestored,
              {
                tenantId,
                actor: actorOf(as),
                target: { id: functionId, label: row.name },
                details: {},
              },
            )
          }),
        ),
      )
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

    // what publication is idempotent over: the executable identity - source,
    // examples and the whole toolchain. A double click or a retried request
    // answers with the version that already exists; a toolchain upgrade
    // changes the fingerprint and may legitimately mint a new version.
    // draftRevision stays what it is: the EDITING concurrency token.
    // The engine identity now comes from the runtime sandbox itself; not
    // reaching it is the same outage as not reaching the compiler.
    const engine = yield* sandbox.engine.pipe(
      Effect.mapError(() => new FormulaCompileUnavailable()),
    )
    const fingerprint = sha256(
      [
        compiled.sourceSha256,
        sha256(JSON.stringify(row.draftTests)),
        compilerVersion,
        esbuildVersion,
        String(FORMULA_ABI_VERSION),
        compiled.formulaRuntimeSha256,
        // the full-artifact hash covers what the sdkFiles digest cannot: the
        // trusted WRAPPER and PRELUDE strings live in bundler.ts, so an
        // edit to the entry protocol alone still changes the fingerprint
        compiled.runtimeSha256,
        String(SANDBOX_ABI_VERSION),
        String(VALUE_SCHEMA_PROFILE_VERSION),
        String(REGEX_PROFILE_VERSION),
        engine,
      ].join('|'),
    )

    const inserted = yield* withDb(
      transaction(
        Effect.gen(function* () {
          const locked = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaFunction')
                .select(['draftRevision', 'archivedAt', 'ownerNodeId'])
                .where('tenantId', '=', tenantId)
                .where('id', '=', functionId)
                .forUpdate()
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (locked === undefined) return yield* Effect.fail(new FormulaFunctionNotFound())
          // the compile took real time; the authority that opened this call
          // may have been revoked meanwhile, and what is being minted is an
          // immutable official record - re-ask before committing (a second
          // pool connection is fine here: one row lock, pool size above one)
          const stillAllowed = yield* rbac.canAt(as, MANAGE, locked.ownerNodeId as string)
          if (!stillAllowed) return yield* Effect.fail(new FormulaFunctionNotFound())
          if (locked.archivedAt !== null) return yield* Effect.fail(new FormulaFunctionArchived())
          // the compile ran on a snapshot; a draft that moved meanwhile would
          // freeze bytes nobody asked to publish
          if (locked.draftRevision !== expectedDraftRevision)
            return yield* Effect.fail(
              new FormulaDraftConflict({ draftRevision: locked.draftRevision as number }),
            )
          const existing = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaVersion')
                .selectAll()
                .where('tenantId', '=', tenantId)
                .where('functionId', '=', functionId)
                .where('publishFingerprint', '=', fingerprint)
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (existing !== undefined) return existing
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
                  quickjsEngineVersion: engine,
                  valueSchemaProfileVersion: VALUE_SCHEMA_PROFILE_VERSION,
                  regexProfileVersion: REGEX_PROFILE_VERSION,
                  sandboxAbiVersion: SANDBOX_ABI_VERSION,
                  publishFingerprint: fingerprint,
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

  const listOwnerOptions = Effect.fn('FormulaLibrary.listOwnerOptions')(function* (
    tenantId: string,
    as: Principal,
  ) {
    const scope = yield* rbac.listAuthorizedScope(as, MANAGE)
    if (!scope.tenantWide && scope.anchors.length === 0)
      return { nodes: [] as { id: string; name: string; depth: number }[] }
    const rows = yield* db
      .query((k) =>
        k
          .selectFrom('OrgNode')
          .select(['id', 'name', 'depth'])
          .where('tenantId', '=', tenantId)
          .where(
            scopeCoverage(scope, {
              id: sql.ref('org_nodes.id') as never,
              tenantId: sql.ref('org_nodes.tenant_id') as never,
              path: sql.ref('org_nodes.path') as never,
            }),
          )
          .orderBy(sql`path`)
          .execute(),
      )
      .pipe(Effect.orDie)
    return { nodes: rows as { id: string; name: string; depth: number }[] }
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
    listOwnerOptions: (tenantId, as) => withDb(listOwnerOptions(tenantId, as)),
  }
  return service
})

export const layer = Layer.effect(FormulaLibrary, make())

const local = Api.local(formulaApiGroup)

export const formulaApiHandlers = HttpApiBuilder.group(local, 'assessmentFormula', (handlers) =>
  handlers
    .handle(
      'listFormulaOwnerOptions',
      Effect.fn('assessmentFormula.ownerOptions.handler')(function* () {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        return yield* library.listOwnerOptions(principal.tenantId, principal)
      }),
    )
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
