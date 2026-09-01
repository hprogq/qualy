import { contractIdentityOf, sha256Hex } from './contract-identity.ts'
import { decodeFormulaEnvelope } from './envelope.ts'
import { Context, Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { sql } from 'kysely'
import { Api } from '@qualy/api-kit/local'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { BadRequest, cursorUnusable, pageSize } from '@qualy/api-kit/schema'
import { CurrentUser } from '@qualy/plugin-auth/server/session'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import { UserPlacement } from '@qualy/auth-contract'
import { Audit } from '@qualy/audit-contract/effect'
import {
  SANDBOX_ABI_VERSION,
  Sandbox,
  type SandboxRuntimeIdentity,
} from '@qualy/plugin-sandbox/service'
import { FORMULA_ABI_VERSION, SCORE_AMOUNT_SCHEMA } from '@qualy/formula'
import { MAX_COMPILED_ARTIFACT_BYTES, SOURCE_LIMIT } from '@qualy/sandbox-rpc'
import { FormulaAuthoring } from './authoring.ts'
import {
  VALUE_SCHEMA_PROFILE_VERSION,
  assignmentPlan,
  canonicalDecimal,
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
import { FormulaLanguage } from './language.ts'
import { FormulaLspQuota, bridgeSocket } from './lsp-bridge.ts'
import { db } from './db.ts'
import {
  FormulaTemplateLibrary,
  type TemplateDetail,
  type TemplateSummary,
} from './template-library.ts'
import {
  FormulaBundleFailed,
  FormulaCompileUnavailable,
  FormulaContractInvalid,
  FormulaDraftConflict,
  FormulaExecutionLimitExceeded,
  FormulaFunctionArchived,
  FormulaFunctionNotFound,
  FormulaSourceRefused,
  FormulaSourceTooLarge,
  FormulaTestFailed,
  FormulaTypecheckFailed,
  FormulaVersionNotFound,
} from './errors.ts'
import {
  AssessmentConfigurationAccess,
  AssessmentScoringAuthoringAccess,
} from '@qualy/plugin-assessment/plugin'
import {
  BindableFormulaCatalog,
  type BindableFormulaVersion,
  type FormulaNotBindable,
} from './binding-catalog.ts'

/**
 * The capability to write scoring formulas at all - tenant-wide, because
 * what somebody authors belongs to them rather than to a unit.
 *
 * Two orthogonal questions, and they must not be merged: this one is
 * whether a person may author formulas; `createdBy` is which formulas are
 * theirs. Holding it grants nothing over anybody else's work, and losing it
 * closes the whole authoring plane - not just the create button.
 */
const AUTHOR = 'assessment.formula.author'

/** what an author may SAVE - the formula's own text */
/** the sandbox transport for __qualyContract, above the largest legal
 * contract so a real one always arrives whole */
const MAX_CONTRACT_TRANSPORT_BYTES = 131_072
/** the canonical bytes of a legal contract; part of the v1 profile budget */
const MAX_CANONICAL_CONTRACT_BYTES = 65_536
/** compiles queue behind one permit; past this depth the service is busy */

const LIST_FINGERPRINT = 'assessment-formula-functions'

/** the template library is one list for everybody who can see it */
const TEMPLATE_FINGERPRINT = 'assessment-formula-templates'

/** one batch's options are their own query: a cursor from another round's
 *  page describes a position in a different list */
const bindingFingerprint = (batchId: string) => `assessment-formula-binding-options:${batchId}`

const FORMULA_REF = 'formula@1'
const FORMULA_RUNTIME_KIND = 'formula-version'

/** one template as a library row shows it */
const templateSummaryDto = (row: TemplateSummary) => ({
  versionId: row.versionId,
  functionId: row.functionId,
  functionName: row.functionName,
  description: row.description,
  versionNo: Number(row.versionNo),
  publishedAt: iso(row.publishedAt),
  authorUserId: row.authorUserId,
  authorName: row.authorName,
  parameters: row.parameters,
  sourceStatus: row.sourceStatus,
})

const templateDetailDto = (row: TemplateDetail) => ({
  ...templateSummaryDto(row),
  sourceTs: row.sourceTs,
  tests: row.tests as unknown as FormulaTestInput[],
  inputSchema: row.inputSchema,
  outputSchema: row.outputSchema,
})

const bindingOptionDto = (version: BindableFormulaVersion) => ({
  versionId: version.versionId,
  functionId: version.functionId,
  functionName: version.functionName,
  versionNo: version.versionNo,
  publishedAt: iso(version.publishedAt),
  parameters: Object.keys(version.inputSchema.properties).sort(),
})

// word-level on purpose: the formula language is tiny, and "strictly typed
// at publication" stops being true the moment any `any` slips in - even the
// word inside a string is refused, and the message says exactly that

export interface FormulaTestInput {
  readonly name: string
  readonly input: unknown
  readonly expected: string
}

interface FunctionRow {
  id: string
  /** the exact published version this draft was forked from, if it was */
  copiedFromVersionId: string | null
  /** the author: who wrote it, and the only person who may edit it */
  createdBy: string
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
  readonly at: 'input' | 'expected' | 'output'
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

/** one case sent to the evaluator; expected is a regression check, not a requirement */
export interface EvaluationCaseInput {
  readonly input: unknown
  readonly expected?: string
}

/** one case's outcome: passed only exists where an expectation existed */
export interface EvaluatedCase {
  readonly passed?: boolean
  readonly expected?: string
  readonly actual?: string
  readonly problems?: readonly TestProblem[]
  readonly refusal?: string
  readonly defect?: string
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const functionDto = (row: FunctionRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  authorUserId: row.createdBy,
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
/** everything a source compiles to, before any example runs */
interface PreparedFormula {
  readonly artifact: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
  readonly sourceSha256: string
  readonly runtimeSha256: string
  readonly contractSha256: string
  /** the runtime instance that proved the contract; answers carry it */
  readonly sandboxRuntime: SandboxRuntimeIdentity
  /** the ABI the artifact actually speaks, as the sidecar reported it */
  readonly formulaAbiVersion: number
  readonly formulaRuntimeSha256: string
  readonly typescriptVersion: string
  readonly esbuildVersion: string
  readonly sourcePolicyVersion: number
  readonly sourcePolicyParserVersion: string
  readonly authoringBuildId: string
}

interface CompiledFormula {
  readonly artifact: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
  readonly sourceSha256: string
  readonly runtimeSha256: string
  readonly contractSha256: string
  readonly sandboxRuntime: SandboxRuntimeIdentity
  readonly formulaAbiVersion: number
  readonly formulaRuntimeSha256: string
  readonly typescriptVersion: string
  readonly esbuildVersion: string
  readonly sourcePolicyVersion: number
  readonly sourcePolicyParserVersion: string
  readonly authoringBuildId: string
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

/** what a draft source compiles to, for screens: identity + contract */
export interface DraftPreview {
  readonly sourceSha256: string
  readonly contractSha256: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
}

type DraftRefusal = Exclude<CompileRefusal, FormulaTestFailed>

interface FormulaLibraryShape {
  /**
   * Whether this person may write scoring formulas at all.
   *
   * On the library because it is the library's own capability, and the
   * template surface needs the same answer: a template's only product action
   * is becoming one of your own formulas, so somebody who may not write one
   * has nothing to do there.
   */
  readonly requireAuthor: (as: Principal) => Effect.Effect<void, AccessDenied>
  readonly previewDraft: (
    tenantId: string,
    functionId: string,
    sourceTs: string,
    as: Principal,
  ) => Effect.Effect<DraftPreview, AccessDenied | FormulaFunctionNotFound | DraftRefusal>
  readonly evaluateDraft: (
    tenantId: string,
    functionId: string,
    sourceTs: string,
    cases: readonly EvaluationCaseInput[],
    as: Principal,
  ) => Effect.Effect<
    DraftPreview & { readonly results: readonly EvaluatedCase[] },
    AccessDenied | FormulaFunctionNotFound | DraftRefusal
  >
  readonly managedDraft: (
    tenantId: string,
    functionId: string,
    as: Principal,
  ) => Effect.Effect<{ readonly draftSourceTs: string }, AccessDenied | FormulaFunctionNotFound>
  readonly listFunctions: (
    tenantId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) => Effect.Effect<
    {
      items: ReturnType<typeof functionDto>[]
      nextCursor: string | null
    },
    AccessDenied | BadRequest
  >
  readonly createFunction: (
    tenantId: string,
    input: { name: string; description?: string; draftSourceTs?: string },
    as: Principal,
  ) => Effect.Effect<ReturnType<typeof functionDetailDto>, AccessDenied | FormulaSourceTooLarge>
  readonly getFunction: (
    tenantId: string,
    functionId: string,
    as: Principal,
  ) => Effect.Effect<
    {
      function: ReturnType<typeof functionDetailDto>
      versions: ReturnType<typeof versionViewDto>[]
      /** where this draft was forked from, if it was */
      copiedFrom: { versionId: string; versionNo: number } | null
    },
    AccessDenied | FormulaFunctionNotFound
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
    | AccessDenied
    | FormulaFunctionNotFound
    | FormulaFunctionArchived
    | FormulaDraftConflict
    | FormulaSourceTooLarge
  >
  readonly setStatus: (
    tenantId: string,
    functionId: string,
    status: 'active' | 'archived',
    as: Principal,
  ) => Effect.Effect<ReturnType<typeof functionDetailDto>, AccessDenied | FormulaFunctionNotFound>
  readonly publish: (
    tenantId: string,
    functionId: string,
    expectedDraftRevision: number,
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof versionDetailDto>,
    | AccessDenied
    | FormulaFunctionNotFound
    | FormulaFunctionArchived
    | FormulaDraftConflict
    | CompileRefusal
  >
  readonly getVersion: (
    tenantId: string,
    functionId: string,
    versionNo: number,
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof versionDetailDto>,
    AccessDenied | FormulaFunctionNotFound | FormulaVersionNotFound
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
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

export const make = Effect.fn('FormulaLibrary.make')(function* () {
  const withDb = yield* withDatabase
  const rbac = yield* Rbac
  const audit = yield* Audit
  const sandbox = yield* Sandbox
  const authoring = yield* FormulaAuthoring

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

  /**
   * Whether this person may author formulas at all.
   *
   * A tenant-wide capability, so `hasPermission` rather than `canAt`. It
   * guards the WHOLE authoring plane - reading, editing, testing,
   * publishing, archiving - not merely creating: a capability that can be
   * revoked while every URL still works is not a capability.
   */
  const requireAuthor = (as: Principal) =>
    Effect.flatMap(rbac.hasPermission(as, AUTHOR), (allowed) =>
      allowed
        ? Effect.void
        : Effect.fail(new AccessDenied({ reason: 'cannot author scoring formulas' })),
    )

  /** one function of this author's own; somebody else's reads as absent */
  const ownedRow = (tenantId: string, functionId: string, as: Principal) =>
    foundRow(tenantId, functionId).pipe(
      Effect.tap((row) =>
        row.createdBy === as.userId ? Effect.void : Effect.fail(new FormulaFunctionNotFound()),
      ),
    )

  /** the gate every authoring road goes through: the capability, then the
   *  ownership - unknown and not-mine read the same */
  const authoringRow = (tenantId: string, functionId: string, as: Principal) =>
    requireAuthor(as).pipe(Effect.andThen(ownedRow(tenantId, functionId, as)))

  // the language bridge's whole database need: the same gate every write
  // uses, projected down to the draft source
  const managedDraft = (tenantId: string, functionId: string, as: Principal) =>
    authoringRow(tenantId, functionId, as).pipe(
      Effect.map((row) => ({ draftSourceTs: row.draftSourceTs })),
    )

  const previewOf = (prepared: PreparedFormula): DraftPreview => ({
    sourceSha256: prepared.sourceSha256,
    contractSha256: prepared.contractSha256,
    inputSchema: prepared.inputSchema,
    outputSchema: prepared.outputSchema,
  })

  // preview and try-runs speak about the CURRENT editor buffer, never the
  // persisted draft: they are side-effect-free authoring tools, gated by
  // the same manage semantics as every write, publishable by nothing
  const previewDraft = Effect.fn('FormulaLibrary.previewDraft')(function* (
    tenantId: string,
    functionId: string,
    sourceTs: string,
    as: Principal,
  ) {
    yield* authoringRow(tenantId, functionId, as)
    const prepared = yield* dropTestFailure(prepare(sourceTs))
    return previewOf(prepared)
  })

  const evaluateDraft = Effect.fn('FormulaLibrary.evaluateDraft')(function* (
    tenantId: string,
    functionId: string,
    sourceTs: string,
    cases: readonly EvaluationCaseInput[],
    as: Principal,
  ) {
    yield* authoringRow(tenantId, functionId, as)
    const prepared = yield* dropTestFailure(prepare(sourceTs))
    const evaluated = yield* evaluateCases(prepared, cases)
    return { ...previewOf(prepared), results: evaluated.results }
  })

  // ONE evaluator for every way a formula runs before publication: the
  // ad-hoc try-run (no expectation), a single regression test, the whole
  // suite, and the publish gate - same validation, same sandbox, same
  // canonicalization, so no second execution semantics can drift into being
  const evaluateCases = (
    prepared: PreparedFormula,
    cases: readonly EvaluationCaseInput[],
  ): Effect.Effect<
    { readonly results: readonly EvaluatedCase[]; readonly runtime: SandboxRuntimeIdentity | null },
    FormulaCompileUnavailable
  > =>
    Effect.gen(function* () {
      const { artifact, runtimeSha256: artifactHash, inputSchema, outputSchema } = prepared
      const report: EvaluatedCase[] = []
      // the identity of whoever answered; one round must be answered by one
      // process, or its provenance names an instance that ran only part of it
      let runtime: SandboxRuntimeIdentity | null = null
      for (const test of cases) {
        // the row always carries what was expected, in the canonical spelling
        // the comparison uses; a lexically broken expectation shows as typed
        const expected =
          test.expected === undefined
            ? undefined
            : (canonicalDecimal(test.expected) ?? test.expected)
        const inputIssues = validateValue(inputSchema, test.input)
        const expectedIssues =
          test.expected === undefined ? [] : validateValue(outputSchema, test.expected)
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
          report.push({
            ...(expected === undefined ? {} : { passed: false, expected }),
            problems,
          })
          continue
        }
        const outcome = yield* sandbox
          .invoke({
            artifact,
            artifactHash,
            entrypoint: '__qualyInvoke',
            arguments: [JSON.stringify(test.input)],
            limits: {
              artifactBytes: MAX_COMPILED_ARTIFACT_BYTES,
              // same reasoning as the contract extraction: each example
              // re-evaluates the artifact from cold on the publish path
              softDeadlineMs: 2_000,
              hardDeadlineMs: 10_000,
            },
          })
          .pipe(
            Effect.map((answer) => ({ kind: 'answered', answer }) as const),
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
          report.push({
            ...(expected === undefined ? {} : { passed: false, expected }),
            defect: outcome.message,
          })
          continue
        }
        if (runtime !== null && runtime.instanceId !== outcome.answer.runtime.instanceId) {
          // the serving process changed mid-round: whatever a mixed round
          // would prove, it is not one artifact judged by one runtime
          yield* Effect.logWarning(
            `sandbox runtime changed mid-evaluation: ${runtime.instanceId} -> ${outcome.answer.runtime.instanceId}`,
          )
          return yield* new FormulaCompileUnavailable()
        }
        runtime = outcome.answer.runtime
        const decodedAnswer = decodeFormulaEnvelope(outcome.answer.output)
        if (decodedAnswer._tag === 'malformed') {
          // an answer that is not the wrapper's envelope is this CASE's
          // defect, recorded beside the others; the round keeps evaluating
          report.push({
            ...(expected === undefined ? {} : { passed: false, expected }),
            defect: `malformed formula envelope: ${decodedAnswer.reason}`,
          })
          continue
        }
        const envelope = decodedAnswer.envelope
        if (!envelope.ok) {
          // the strict decoder already capped the message; forged envelopes
          // cannot carry an unbounded string to screens
          report.push({
            ...(expected === undefined ? {} : { passed: false, expected }),
            refusal: envelope.failure.message,
          })
          continue
        }
        const actual = canonicalDecimal(envelope.amount) ?? envelope.amount
        // the same boundary the official evaluator holds: what came back is
        // judged against the formula's own output contract before anything
        // compares or displays it - a violating answer is a broken contract,
        // never a normal actual
        const outputIssues = validateValue(outputSchema, actual)
        if (outputIssues.length > 0) {
          report.push({
            ...(expected === undefined ? {} : { passed: false, expected }),
            problems: outputIssues.map((issue) => {
              const constraint = constraintOf(outputSchema, issue.reason)
              return {
                at: 'output' as const,
                reason: issue.reason,
                ...(constraint === undefined ? {} : { constraint }),
              }
            }),
          })
          continue
        }
        report.push({
          actual,
          ...(expected === undefined ? {} : { passed: actual === expected, expected }),
        })
      }
      return { results: report, runtime }
    })

  const extractContract = (
    artifact: string,
    artifactHash: string,
  ): Effect.Effect<
    {
      readonly contract: { input?: unknown; output?: unknown }
      readonly runtime: SandboxRuntimeIdentity
    },
    CompileRefusal
  > =>
    sandbox
      .invoke({
        artifact,
        artifactHash,
        entrypoint: '__qualyContract',
        arguments: [],
        limits: {
          artifactBytes: MAX_COMPILED_ARTIFACT_BYTES,
          outputBytes: MAX_CONTRACT_TRANSPORT_BYTES,
          // publication-sized deadlines: extracting a contract cold-loads
          // the whole artifact, and this path is a publish, not a score
          softDeadlineMs: 2_000,
          hardDeadlineMs: 10_000,
        },
      })
      .pipe(
        Effect.map((answer) => ({
          contract: JSON.parse(answer.output) as { input?: unknown; output?: unknown },
          runtime: answer.runtime,
        })),
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

  // prepare's error union is CompileRefusal for reuse; the draft tools can
  // never see a test failure out of it, and the narrowing keeps that a type
  const dropTestFailure = <A>(
    effect: Effect.Effect<A, CompileRefusal>,
  ): Effect.Effect<A, DraftRefusal> =>
    effect.pipe(
      Effect.catchTag('ASSESSMENT_FORMULA_TEST_FAILED', () =>
        Effect.die(new Error('prepare raised a test failure')),
      ),
    )

  // source -> everything but the examples: the artifact, the proven
  // contract and every identity hash. Preview, try-runs and publication all
  // start HERE, so there is exactly one interpretation of a formula source.
  const prepare = (source: string): Effect.Effect<PreparedFormula, CompileRefusal> =>
    Effect.gen(function* () {
      // the compiler lives behind the authoring service (a separate process
      // in production); refusals come back already dressed as wire errors.
      // Everything AFTER the artifact exists stays here: contract
      // extraction, the score proof and the examples, on the runtime
      // sandbox, followed by the host-side validation of it all.
      const compiled = yield* authoring.compile(source)

      // in a rolling upgrade the sidecar may still speak an older formula
      // ABI; recording this host's constant for an artifact that sidecar
      // built would falsify the version row and its fingerprint. Refuse the
      // pairing outright - an operator outage, not an author mistake.
      if (compiled.formulaAbiVersion !== FORMULA_ABI_VERSION) {
        yield* Effect.logError(
          `authoring sidecar produced formula abi ${compiled.formulaAbiVersion}, this host supports ${FORMULA_ABI_VERSION}`,
        )
        return yield* new FormulaCompileUnavailable()
      }

      const extracted = yield* extractContract(compiled.artifact, compiled.runtimeSha256)
      const contract = extracted.contract

      // patterns are only worth checking on a structurally sound
      // input, and patternIssues itself is fail-closed on any shape:
      // a contract forged past the type system (input: undefined)
      // must end as a 422, never as a host-side throw
      const inputShapeIssues = validateInputProfile(contract.input)
      const inputPatternIssues = inputShapeIssues.length === 0 ? patternIssues(contract.input) : []
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
      if (issues.length > 0) return yield* new FormulaContractInvalid({ issues })

      const inputSchema = normalizeInputSchema(contract.input as InputSchema)
      const outputSchema = normalizeAtomicSchema(contract.output as AtomicSchema)

      // a scoring formula's answer must fit what the scorer can carry:
      // the platform amount is numeric(12,4), so an unbounded or wider
      // output is publishable nowhere and refused here by proof
      const intoScore = assignmentPlan(outputSchema, normalizeAtomicSchema(SCORE_AMOUNT_SCHEMA))
      if (intoScore.kind !== 'direct') issues.push({ path: 'output', reason: 'not-a-score-amount' })

      const { canonicalInput, canonicalOutput, contractSha256 } = contractIdentityOf(
        inputSchema,
        outputSchema,
      )
      if (
        Buffer.byteLength(canonicalInput, 'utf8') + Buffer.byteLength(canonicalOutput, 'utf8') >
        MAX_CANONICAL_CONTRACT_BYTES
      )
        issues.push({ path: '', reason: 'contract-too-large' })
      if (issues.length > 0) return yield* new FormulaContractInvalid({ issues })

      return {
        artifact: compiled.artifact,
        inputSchema,
        outputSchema,
        sourceSha256: compiled.sourceSha256,
        runtimeSha256: compiled.runtimeSha256,
        contractSha256,
        sandboxRuntime: extracted.runtime,
        formulaAbiVersion: compiled.formulaAbiVersion,
        formulaRuntimeSha256: compiled.formulaRuntimeSha256,
        typescriptVersion: compiled.typescriptVersion,
        esbuildVersion: compiled.esbuildVersion,
        sourcePolicyVersion: compiled.sourcePolicyVersion,
        sourcePolicyParserVersion: compiled.sourcePolicyParserVersion,
        authoringBuildId: compiled.authoringBuildId,
      } satisfies PreparedFormula
    })

  const compile = (
    source: string,
    tests: readonly FormulaTestInput[],
  ): Effect.Effect<CompiledFormula, CompileRefusal> =>
    Effect.gen(function* () {
      const prepared = yield* prepare(source)
      const evaluated = yield* evaluateCases(prepared, tests)
      if (
        evaluated.runtime !== null &&
        evaluated.runtime.instanceId !== prepared.sandboxRuntime.instanceId
      ) {
        // contract proven by one runtime instance, examples by another:
        // whichever identity a version row recorded would be part fiction
        yield* Effect.logWarning(
          `sandbox runtime changed between contract and examples: ${prepared.sandboxRuntime.instanceId} -> ${evaluated.runtime.instanceId}`,
        )
        return yield* new FormulaCompileUnavailable()
      }
      // the publish gate: every named example, an expectation on each, all
      // of them passing - the evaluator itself never requires any of that
      const report: TestReportRow[] = evaluated.results.map((row, index) => ({
        name: tests[index]!.name,
        passed: row.passed ?? false,
        expected: row.expected ?? tests[index]!.expected,
        ...(row.actual === undefined ? {} : { actual: row.actual }),
        ...(row.problems === undefined ? {} : { problems: row.problems }),
        ...(row.refusal === undefined ? {} : { refusal: row.refusal }),
        ...(row.defect === undefined ? {} : { defect: row.defect }),
      }))
      if (tests.length === 0 || report.some((row) => !row.passed))
        return yield* new FormulaTestFailed({ report })
      return { ...prepared, report } satisfies CompiledFormula
    })

  const listFunctions = Effect.fn('FormulaLibrary.listFunctions')(function* (
    tenantId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) {
    yield* requireAuthor(as)
    const size = pageSize(page.limit, DEFAULT_PAGE_SIZE)
    const cursor = readQueryCursor(page.cursor, LIST_FINGERPRINT, ['timestamp', 'uuid'])
    if (cursor === null) return yield* cursorUnusable()
    const rows = yield* db
      .query((k) => {
        let query = k
          .selectFrom('FormulaFunction')
          // projection on purpose: the list never needs the draft source or
          // the examples, and a row may carry a quarter megabyte of each
          .select([
            'FormulaFunction.id',
            'FormulaFunction.name',
            'FormulaFunction.description',
            'FormulaFunction.createdBy',
            'FormulaFunction.draftRevision',
            'FormulaFunction.archivedAt',
            'FormulaFunction.updatedAt',
          ])
          .select(latestNoSubquery.as('latestVersionNo'))
          .where('FormulaFunction.tenantId', '=', tenantId)
          // what this author wrote, and nothing else: there is no
          // organizational range to a formula any more
          .where('FormulaFunction.createdBy', '=', as.userId)
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
    input: { name: string; description?: string; draftSourceTs?: string },
    as: Principal,
  ) {
    yield* requireAuthor(as)
    // the byte gate is a service invariant, identical at create, update and
    // compile - the api's character-length check is not a byte check
    const seed = input.draftSourceTs ?? DEFAULT_SOURCE
    if (Buffer.byteLength(seed, 'utf8') > SOURCE_LIMIT)
      return yield* new FormulaSourceTooLarge({ limit: SOURCE_LIMIT })
    const created = yield* withDb(
      transaction(
        Effect.gen(function* () {
          const row = yield* db
            .query((k) =>
              k
                .insertInto('FormulaFunction')
                .values({
                  tenantId,
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
            details: {},
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
    const row = yield* authoringRow(tenantId, functionId, as)
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
    // Where this draft was forked from, if it was - read as this function's
    // own history rather than as a template. A withdrawn offer must not
    // disturb somebody's copy, so nothing here asks whether the source is
    // still discoverable; the version number comes off the source row,
    // which publication makes permanent.
    const copiedFrom =
      row.copiedFromVersionId === null
        ? null
        : yield* db
            .query((k) =>
              k
                .selectFrom('FormulaVersion')
                .select(['id', 'versionNo'])
                .where('tenantId', '=', tenantId)
                .where('id', '=', row.copiedFromVersionId as string)
                .executeTakeFirst(),
            )
            .pipe(
              Effect.orDie,
              Effect.map((source) => {
                const found = source as { id: string; versionNo: number } | undefined
                return found === undefined
                  ? null
                  : { versionId: found.id, versionNo: Number(found.versionNo) }
              }),
            )
    return {
      function: functionDetailDto(row),
      versions: (versions as unknown as VersionRow[]).map(versionViewDto),
      copiedFrom,
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
    const row = yield* authoringRow(tenantId, functionId, as)
    if (row.archivedAt !== null) return yield* new FormulaFunctionArchived()
    if (
      patch.draftSourceTs !== undefined &&
      Buffer.byteLength(patch.draftSourceTs, 'utf8') > SOURCE_LIMIT
    )
      return yield* new FormulaSourceTooLarge({ limit: SOURCE_LIMIT })
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
            return yield* new FormulaDraftConflict({ draftRevision: -1 })
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
    const row = yield* authoringRow(tenantId, functionId, as)
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
    const row = yield* authoringRow(tenantId, functionId, as)
    if (row.archivedAt !== null) return yield* new FormulaFunctionArchived()
    if (row.draftRevision !== expectedDraftRevision)
      return yield* new FormulaDraftConflict({ draftRevision: row.draftRevision })

    // the long work runs outside any transaction, on the draft as read;
    // the toolchain identities come back WITH the artifact, from whichever
    // compiler process actually produced it
    const compiled = yield* compile(row.draftSourceTs, row.draftTests)

    // what publication is idempotent over: the executable identity - source,
    // examples and the whole toolchain. A double click or a retried request
    // answers with the version that already exists; a toolchain upgrade
    // changes the fingerprint and may legitimately mint a new version.
    // draftRevision stays what it is: the EDITING concurrency token.
    // The engine identity is what the answers themselves carried: reading
    // it anywhere else could name a process that served none of this work.
    const engine = compiled.sandboxRuntime.engineVersion
    const sandboxRuntimeBuildId = compiled.sandboxRuntime.runtimeBuildId
    const fingerprint = sha256Hex(
      [
        compiled.sourceSha256,
        sha256Hex(JSON.stringify(row.draftTests)),
        compiled.typescriptVersion,
        compiled.esbuildVersion,
        String(compiled.sourcePolicyVersion),
        String(compiled.formulaAbiVersion),
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
                .select(['draftRevision', 'archivedAt', 'createdBy'])
                .where('tenantId', '=', tenantId)
                .where('id', '=', functionId)
                .forUpdate()
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (locked === undefined) return yield* new FormulaFunctionNotFound()
          // The compile took real time, and what is being minted is an
          // immutable official record - re-ask before committing (a second
          // pool connection is fine here: one row lock, pool size above one).
          // Authorship is immutable and cannot have moved; the CAPABILITY
          // can have been revoked meanwhile, and that is what is re-asked.
          yield* requireAuthor(as)
          if (locked.createdBy !== as.userId) return yield* new FormulaFunctionNotFound()
          if (locked.archivedAt !== null) return yield* new FormulaFunctionArchived()
          // the compile ran on a snapshot; a draft that moved meanwhile would
          // freeze bytes nobody asked to publish
          if (locked.draftRevision !== expectedDraftRevision)
            return yield* new FormulaDraftConflict({
              draftRevision: locked.draftRevision as number,
            })
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
                  typescriptVersion: compiled.typescriptVersion,
                  esbuildVersion: compiled.esbuildVersion,
                  sourcePolicyVersion: compiled.sourcePolicyVersion,
                  sourcePolicyParserVersion: compiled.sourcePolicyParserVersion,
                  authoringBuildId: compiled.authoringBuildId,
                  sandboxRuntimeBuildId,
                  formulaAbiVersion: compiled.formulaAbiVersion,
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

  const getVersion = Effect.fn('FormulaLibrary.getVersion')(function* (
    tenantId: string,
    functionId: string,
    versionNo: number,
    as: Principal,
  ) {
    yield* authoringRow(tenantId, functionId, as)
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
    if (version === undefined) return yield* new FormulaVersionNotFound()
    return versionDetailDto(version as unknown as VersionRow)
  })

  // every method runs with the database provided once, here: the bodies
  // above stay plain Orm-requiring effects, and nothing leaks the requirement
  const service: FormulaLibraryShape = {
    requireAuthor,
    previewDraft: (tenantId, functionId, sourceTs, as) =>
      withDb(previewDraft(tenantId, functionId, sourceTs, as)),
    evaluateDraft: (tenantId, functionId, sourceTs, cases, as) =>
      withDb(evaluateDraft(tenantId, functionId, sourceTs, cases, as)),
    managedDraft: (tenantId, functionId, as) => withDb(managedDraft(tenantId, functionId, as)),
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
      'listFormulaBindingOptions',
      Effect.fn('assessmentFormula.bindingOptions.handler')(function* ({ params, query }) {
        const principal = yield* CurrentUser
        const access = yield* AssessmentConfigurationAccess
        const authoring = yield* AssessmentScoringAuthoringAccess
        const catalog = yield* BindableFormulaCatalog
        const tenantId = principal.tenantId
        // the actor gate first, and this plugin's own permission has no say
        // in it: who may bind a formula to a question is the round's
        // administrator, not the formula library's
        yield* access.requireManage(tenantId, params.batchId, principal)

        // what the question is bound to TODAY comes from its frozen plan,
        // never from a version id the caller supplies: knowing a uuid must
        // not be a way to make the server display an arbitrary version
        const bound =
          query.itemId === undefined
            ? null
            : yield* authoring
                .currentCalculator(tenantId, params.batchId, query.itemId)
                .pipe(Effect.catchTag('ASSESSMENT_ITEM_NOT_FOUND', () => Effect.succeed(null)))
        const boundVersionId =
          bound !== null &&
          bound.ref === FORMULA_REF &&
          bound.frozen.runtimeRef?.kind === FORMULA_RUNTIME_KIND
            ? bound.frozen.runtimeRef.id
            : null

        const size = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const cursor = readQueryCursor(query.cursor, bindingFingerprint(params.batchId), [
          'text',
          'text',
          'uuid',
        ])
        if (cursor === null) return yield* cursorUnusable()
        const after =
          cursor === undefined
            ? undefined
            : { functionName: cursor[0]!, versionNo: Number(cursor[1]), versionId: cursor[2]! }
        const page = yield* catalog.listForBatch(tenantId, principal.userId, {
          limit: size,
          after,
        })
        const current =
          boundVersionId === null
            ? null
            : yield* catalog.currentBinding(tenantId, boundVersionId, principal.userId)
        return {
          items: page.items.map(bindingOptionDto),
          nextCursor:
            page.more && page.last !== null
              ? encodeQueryCursor(bindingFingerprint(params.batchId), [
                  page.last.functionName,
                  String(page.last.versionNo),
                  page.last.versionId,
                ])
              : null,
          current:
            current === null
              ? null
              : { ...bindingOptionDto(current.version), bindableForNew: current.bindableForNew },
        }
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
      'listFormulaShareOptions',
      Effect.fn('assessmentFormula.shareOptions.handler')(function* ({ query }) {
        const templates = yield* FormulaTemplateLibrary
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        yield* library.requireAuthor(principal)
        const limit = Number(query.limit)
        return yield* templates.shareableNodes(principal.tenantId, principal, {
          ...(query.search === undefined ? {} : { search: query.search }),
          ...(Number.isSafeInteger(limit) && limit > 0 ? { limit } : {}),
        })
      }),
    )
    .handle(
      'listFormulaTemplates',
      Effect.fn('assessmentFormula.listTemplates.handler')(function* ({ query }) {
        const templates = yield* FormulaTemplateLibrary
        const placement = yield* UserPlacement
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const tenantId = principal.tenantId
        // the capability gate first: a template's only product action is to
        // become one of your own formulas, so somebody who may not write
        // them has nothing to do here
        yield* library.requireAuthor(principal)
        const stands = yield* placement.primaryNode(tenantId, principal.userId)
        const size = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const cursor = readQueryCursor(query.cursor, TEMPLATE_FINGERPRINT, ['timestamp', 'uuid'])
        if (cursor === null) return yield* cursorUnusable()
        const page = yield* templates.listTemplates(
          tenantId,
          { userId: principal.userId, nodeId: stands?.nodeId ?? null },
          {
            limit: size,
            ...(cursor === undefined
              ? {}
              : { after: { publishedAt: cursor[0]!, versionId: cursor[1]! } }),
          },
        )
        return {
          items: page.items.map(templateSummaryDto),
          nextCursor:
            page.more && page.last !== null
              ? encodeQueryCursor(TEMPLATE_FINGERPRINT, [
                  page.last.publishedAt,
                  page.last.versionId,
                ])
              : null,
        }
      }),
    )
    .handle(
      'getFormulaTemplate',
      Effect.fn('assessmentFormula.getTemplate.handler')(function* ({ params }) {
        const templates = yield* FormulaTemplateLibrary
        const placement = yield* UserPlacement
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        yield* library.requireAuthor(principal)
        const stands = yield* placement.primaryNode(principal.tenantId, principal.userId)
        const template = yield* templates.getTemplate(principal.tenantId, params.versionId, {
          userId: principal.userId,
          nodeId: stands?.nodeId ?? null,
        })
        return { template: templateDetailDto(template) }
      }),
    )
    .handle(
      'copyFormulaTemplate',
      Effect.fn('assessmentFormula.copyTemplate.handler')(function* ({ params, payload }) {
        const templates = yield* FormulaTemplateLibrary
        const placement = yield* UserPlacement
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const tenantId = principal.tenantId
        yield* library.requireAuthor(principal)
        const stands = yield* placement.primaryNode(tenantId, principal.userId)
        const created = yield* templates.copyTemplate(
          tenantId,
          params.versionId,
          { userId: principal.userId, nodeId: stands?.nodeId ?? null },
          {
            name: payload.name,
            ...(payload.description === undefined ? {} : { description: payload.description }),
          },
        )
        // it was inserted a statement ago by this very caller: a function
        // that cannot be read back is the host contradicting itself
        const detail = yield* library
          .getFunction(tenantId, created.functionId, principal)
          .pipe(Effect.orDie)
        return { function: detail.function }
      }),
    )
    .handle(
      'getFormulaVersionSharing',
      Effect.fn('assessmentFormula.getSharing.handler')(function* ({ params }) {
        const templates = yield* FormulaTemplateLibrary
        const principal = yield* CurrentUser
        const versionNo = Number(params.versionNo)
        if (!Number.isSafeInteger(versionNo) || versionNo < 1) {
          return yield* new BadRequest({ message: 'the version number is not usable here' })
        }
        return yield* templates.getSharing(
          principal.tenantId,
          params.functionId,
          versionNo,
          principal,
        )
      }),
    )
    .handle(
      'replaceFormulaVersionSharing',
      Effect.fn('assessmentFormula.replaceSharing.handler')(function* ({ params, payload }) {
        const templates = yield* FormulaTemplateLibrary
        const principal = yield* CurrentUser
        const versionNo = Number(params.versionNo)
        if (!Number.isSafeInteger(versionNo) || versionNo < 1) {
          return yield* new BadRequest({ message: 'the version number is not usable here' })
        }
        return yield* templates.replaceSharing(
          principal.tenantId,
          params.functionId,
          versionNo,
          { expectedToken: payload.expectedToken, orgNodeIds: payload.orgNodeIds },
          principal,
        )
      }),
    )
    .handle(
      'getFormulaVersion',
      Effect.fn('assessmentFormula.getVersion.handler')(function* ({ params }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const parsed = Number(params.versionNo)
        if (!Number.isSafeInteger(parsed) || parsed < 1)
          return yield* new BadRequest({
            message: 'the version number must be a positive integer',
          })
        return {
          version: yield* library.getVersion(
            principal.tenantId,
            params.functionId,
            parsed,
            principal,
          ),
        }
      }),
    )
    .handle(
      'previewFormulaDraft',
      Effect.fn('assessmentFormula.previewDraft.handler')(function* ({ params, payload }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        return yield* library.previewDraft(
          principal.tenantId,
          params.functionId,
          payload.sourceTs,
          principal,
        )
      }),
    )
    .handle(
      'evaluateFormulaDraft',
      Effect.fn('assessmentFormula.evaluateDraft.handler')(function* ({ params, payload }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const evaluated = yield* library.evaluateDraft(
          principal.tenantId,
          params.functionId,
          payload.sourceTs,
          payload.cases.map((one) => ({
            input: one.input,
            ...(one.expected === undefined ? {} : { expected: one.expected }),
          })),
          principal,
        )
        return {
          sourceSha256: evaluated.sourceSha256,
          contractSha256: evaluated.contractSha256,
          inputSchema: evaluated.inputSchema,
          outputSchema: evaluated.outputSchema,
          cases: evaluated.results.map((row, index) => ({
            clientId: payload.cases[index]!.clientId,
            ...row,
          })),
        }
      }),
    )
    .handleRaw(
      'formulaLsp',
      Effect.fn('assessmentFormula.lsp.handler')(function* ({ params }) {
        const request = yield* HttpServerRequest.HttpServerRequest

        // a browser-initiated WebSocket carries the ambient qualy_session
        // cookie regardless of the initiating page, so the ORIGIN header is
        // the whole cross-site defense: absent, non-http(s) or pointing at a
        // different host means someone else's page is speaking
        const origin = request.headers['origin']
        const host = request.headers['host']
        const sameOrigin = (() => {
          if (origin === undefined || host === undefined) return false
          try {
            const parsed = new URL(origin)
            return (
              (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
            )
          } catch {
            return false
          }
        })()
        if (!sameOrigin) return HttpServerResponse.empty({ status: 403 })

        const principal = yield* CurrentUser
        const library = yield* FormulaLibrary
        const draft = yield* library.managedDraft(principal.tenantId, params.functionId, principal)

        // one live language server per person, tenant-scoped; a second
        // browser is refused rather than the first one torn down
        const quota = yield* FormulaLspQuota
        const admitted = yield* quota.acquire(`${principal.tenantId}:${principal.userId}`)
        if (!admitted) return HttpServerResponse.empty({ status: 429 })

        // open BEFORE upgrading: while this is still plain http, refusal can
        // still be a status code instead of an instantly-closed socket
        const language = yield* FormulaLanguage
        const session = yield* language.open(draft.draftSourceTs).pipe(
          Effect.catchTags({
            FormulaLanguageBusy: () => Effect.succeed(HttpServerResponse.empty({ status: 429 })),
            FormulaLanguageUnavailable: () =>
              Effect.succeed(HttpServerResponse.empty({ status: 503 })),
          }),
        )
        if (HttpServerResponse.isHttpServerResponse(session)) return session

        const socket = yield* request.upgrade.pipe(Effect.orElseSucceed(() => null))
        if (socket === null) return HttpServerResponse.empty({ status: 400 })

        yield* bridgeSocket(socket, session)
        return HttpServerResponse.empty()
      }),
    ),
)
