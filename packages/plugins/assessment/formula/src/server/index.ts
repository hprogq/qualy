import { contractIdentityOf, sha256Hex } from './contract-identity.ts'
import { decodeFormulaEnvelope } from './envelope.ts'
import { Context, Effect, Layer, Option } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { sql } from 'kysely'
import { Api } from '@qualy/api-kit/local'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { BadRequest, cursorUnusable, pageSize } from '@qualy/api-kit/schema'
import { originMatchesHost } from '@qualy/api-kit/origin'
import { currentRequestContext } from '@qualy/api-kit/request'
import { CurrentUser } from '@qualy/auth-contract/session'
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
import { FormulaSettings } from './config.ts'
import { bindingOptionsResponse } from './binding-options.ts'
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
  FormulaFunctionArchived as FormulaFunctionArchivedAction,
  FormulaFunctionDeleted,
  FormulaFunctionCreated,
  FormulaFunctionDetailsChanged,
  FormulaFunctionRestored,
  FormulaVersionInfoChanged,
} from '../actions.ts'
import { formulaApiGroup } from '../api.ts'
import { FormulaLanguage } from './language.ts'
import { FormulaLspQuota, bridgeSocket, refuseSeat } from './lsp-bridge.ts'
import { db } from './db.ts'
import { isoInstant } from './instant.ts'
import {
  FormulaTemplateLibrary,
  type TemplateDetail,
  type TemplateSummary,
} from './template-library.ts'
import {
  FormulaBundleFailed,
  FormulaCompileUnavailable,
  FormulaContractInvalid,
  FormulaDetailsConflict,
  FormulaDraftConflict,
  FormulaDraftRevisionNotFound,
  FormulaExecutionLimitExceeded,
  FormulaFunctionArchived,
  FormulaFunctionNotFound,
  FormulaFunctionPublished,
  FormulaSourceRefused,
  FormulaSourceTooLarge,
  FormulaTestFailed,
  FormulaTypecheckFailed,
  FormulaVersionInfoConflict,
  FormulaVersionNotFound,
  FormulaVersionUnchanged,
  FormulaVersionUnrunnable,
  FormulaReleaseNameTaken,
} from './errors.ts'
import { FormulaRuntimeStore, runtimeStoreLayer } from './runtime-store.ts'
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

/** one function's revisions are their own list */
const revisionFingerprint = (functionId: string) =>
  `assessment-formula-draft-revisions:${functionId}`

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
  releaseName: row.releaseName,
  publishedAt: isoInstant(row.publishedAt),
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
  detailsRevision: number
  archivedAt: Date | null
  updatedAt: Date
  latestVersionNo: number | null
  latestReleaseName: string | null
}

interface VersionRow {
  id: string
  versionNo: number
  releaseName: string | null
  releaseNotes: string | null
  publishedByName: string | null
  valueSchemaProfileVersion: number
  regexProfileVersion: number
  sandboxAbiVersion: number
  sourcePolicyVersion: number
  sourcePolicyParserVersion: string
  authoringBuildId: string
  sandboxRuntimeBuildId: string
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
  metadataRevision: number
  metadataUpdatedAt: Date | null
  metadataUpdatedBy: string | null
  metadataUpdatedByName?: string | null
  /** only where the query asked for it: how many units it is offered to */
  sharedCount?: number
}

/** how a saved state of the draft came to be */
export type RevisionOrigin =
  | 'created'
  | 'saved'
  | 'restored-from-version'
  | 'restored-from-draft'
  | 'copied-from-template'
  | 'migration'

interface RevisionRow {
  revisionNo: number
  origin: RevisionOrigin
  sourceSha256: string
  savedBy: string
  savedByName: string | null
  savedAt: Date
  sourceVersionNo: number | null
  sourceReleaseName: string | null
  sourceDraftRevisionNo: number | null
}

/** where a restore reads the state it puts back */
export type RestoreSource =
  | { readonly kind: 'published-version'; readonly versionNo: number }
  | { readonly kind: 'draft-revision'; readonly revisionNo: number }

/**
 * JSON with its object keys in one order, for telling whether two example
 * lists say the same thing. jsonb gives keys back in an order of its own, so
 * a stored list and the same list sent again differ byte for byte and agree
 * in meaning.
 */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, held: unknown) =>
    held !== null && typeof held === 'object' && !Array.isArray(held)
      ? Object.fromEntries(
          Object.entries(held as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : held,
  )

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

const functionDto = (row: FunctionRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  authorUserId: row.createdBy,
  status: (row.archivedAt === null ? 'active' : 'archived') as 'active' | 'archived',
  draftRevision: row.draftRevision,
  detailsRevision: Number(row.detailsRevision ?? 1),
  latestVersionNo: row.latestVersionNo === null ? null : Number(row.latestVersionNo),
  latestReleaseName: row.latestReleaseName ?? null,
  updatedAt: isoInstant(row.updatedAt),
})

const functionDetailDto = (row: FunctionRow) => ({
  ...functionDto(row),
  draftSourceTs: row.draftSourceTs,
  draftTests: row.draftTests,
})

/**
 * The refusals the value profile raised inside the guest, read back as the
 * facts they are about.
 *
 * `normalizeAtomicSchema` throws `not a profile schema: <path> <reason>; …` -
 * our own wording on both sides of the sandbox - and an author is owed the
 * parameters and the rules, not a stack trace. Anything else keeps the generic
 * classification, with the guest's words carried as detail.
 */
const profileRefusals = (
  message: string,
): readonly { readonly path: string; readonly reason: string }[] => {
  const found = /not a profile schema:\s*(.+)$/.exec(message)
  if (found === null) return []
  return found[1]!
    .split(';')
    .map((one) => /^\s*(\S*)\s+([a-z-]+)\s*$/.exec(one))
    .filter((one): one is RegExpExecArray => one !== null)
    .map((one) => ({ path: one[1] ?? '', reason: one[2]! }))
}

const versionViewDto = (row: VersionRow) => ({
  versionId: row.id,
  versionNo: Number(row.versionNo),
  releaseName: row.releaseName ?? null,
  releaseNotes: row.releaseNotes ?? null,
  contractSha256: row.contractSha256,
  runtimeSha256: row.runtimeSha256,
  publishedBy: row.publishedBy,
  publishedByName: row.publishedByName ?? null,
  publishedAt: isoInstant(row.publishedAt),
  metadataRevision: Number(row.metadataRevision ?? 1),
  ...(row.sharedCount === undefined ? {} : { sharedCount: Number(row.sharedCount) }),
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
  valueSchemaProfileVersion: Number(row.valueSchemaProfileVersion),
  regexProfileVersion: Number(row.regexProfileVersion),
  sandboxAbiVersion: Number(row.sandboxAbiVersion),
  sourcePolicyVersion: Number(row.sourcePolicyVersion),
  sourcePolicyParserVersion: row.sourcePolicyParserVersion,
  authoringBuildId: row.authoringBuildId,
  sandboxRuntimeBuildId: row.sandboxRuntimeBuildId,
  tests: row.tests,
  testReport: row.testReport,
  metadataUpdatedAt: row.metadataUpdatedAt === null ? null : isoInstant(row.metadataUpdatedAt),
  metadataUpdatedBy: row.metadataUpdatedBy ?? null,
  metadataUpdatedByName: row.metadataUpdatedByName ?? null,
})

const revisionViewDto = (row: RevisionRow) => ({
  revisionNo: Number(row.revisionNo),
  origin: row.origin,
  sourceSha256: row.sourceSha256,
  savedBy: row.savedBy,
  savedByName: row.savedByName ?? null,
  savedAt: isoInstant(row.savedAt),
  sourceVersion:
    row.sourceVersionNo === null
      ? null
      : { versionNo: Number(row.sourceVersionNo), releaseName: row.sourceReleaseName ?? null },
  sourceDraftRevisionNo:
    row.sourceDraftRevisionNo === null ? null : Number(row.sourceDraftRevisionNo),
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

/** what running cases needs of a formula, compiled just now or frozen long ago */
type RunnableFormula = Pick<
  PreparedFormula,
  'artifact' | 'runtimeSha256' | 'inputSchema' | 'outputSchema'
>

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

/** a published version tried: its frozen contract, and what it answered */
export interface VersionEvaluation {
  readonly contractSha256: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
  readonly results: readonly EvaluatedCase[]
}

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
      copiedFrom: {
        versionId: string
        versionNo: number
        functionName: string
        releaseName: string | null
      } | null
    },
    AccessDenied | FormulaFunctionNotFound
  >
  readonly updateDraft: (
    tenantId: string,
    functionId: string,
    patch: {
      expectedDraftRevision: number
      expectedDetailsRevision?: number
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
    | FormulaDetailsConflict
    | FormulaSourceTooLarge
  >
  readonly setStatus: (
    tenantId: string,
    functionId: string,
    status: 'active' | 'archived',
    as: Principal,
  ) => Effect.Effect<ReturnType<typeof functionDetailDto>, AccessDenied | FormulaFunctionNotFound>
  readonly deleteFunction: (
    tenantId: string,
    functionId: string,
    as: Principal,
  ) => Effect.Effect<
    { readonly deleted: boolean },
    AccessDenied | FormulaFunctionNotFound | FormulaFunctionPublished
  >
  readonly publish: (
    tenantId: string,
    functionId: string,
    request: {
      readonly expectedDraftRevision: number
      readonly releaseName: string
      readonly releaseNotes?: string | null
    },
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof versionDetailDto>,
    | AccessDenied
    | FormulaFunctionNotFound
    | FormulaFunctionArchived
    | FormulaDraftConflict
    | FormulaReleaseNameTaken
    | FormulaVersionUnchanged
    | CompileRefusal
  >
  readonly listDraftRevisions: (
    tenantId: string,
    functionId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) => Effect.Effect<
    { items: ReturnType<typeof revisionViewDto>[]; nextCursor: string | null },
    AccessDenied | FormulaFunctionNotFound | BadRequest
  >
  readonly getDraftRevision: (
    tenantId: string,
    functionId: string,
    revisionNo: number,
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof revisionViewDto> & {
      sourceTs: string
      tests: readonly FormulaTestInput[]
    },
    AccessDenied | FormulaFunctionNotFound | FormulaDraftRevisionNotFound
  >
  readonly restoreDraft: (
    tenantId: string,
    functionId: string,
    request: { readonly expectedDraftRevision: number; readonly from: RestoreSource },
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof functionDetailDto>,
    | AccessDenied
    | FormulaFunctionNotFound
    | FormulaFunctionArchived
    | FormulaDraftConflict
    | FormulaVersionNotFound
    | FormulaDraftRevisionNotFound
    | FormulaSourceTooLarge
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
  readonly updateVersionInfo: (
    tenantId: string,
    functionId: string,
    versionNo: number,
    request: {
      readonly expectedMetadataRevision: number
      readonly releaseName: string
      readonly releaseNotes: string | null
    },
    as: Principal,
  ) => Effect.Effect<
    ReturnType<typeof versionDetailDto>,
    | AccessDenied
    | FormulaFunctionNotFound
    | FormulaVersionNotFound
    | FormulaReleaseNameTaken
    | FormulaVersionInfoConflict
  >
  readonly evaluateVersion: (
    tenantId: string,
    functionId: string,
    versionNo: number,
    cases: readonly EvaluationCaseInput[],
    as: Principal,
  ) => Effect.Effect<
    VersionEvaluation,
    | AccessDenied
    | FormulaFunctionNotFound
    | FormulaVersionNotFound
    | FormulaVersionUnrunnable
    | FormulaCompileUnavailable
  >
}

export class FormulaLibrary extends Context.Service<FormulaLibrary, FormulaLibraryShape>()(
  '@qualy/plugin-assessment-formula/FormulaLibrary',
) {}

export const make = Effect.fn('FormulaLibrary.make')(function* () {
  const withDb = yield* withDatabase
  const rbac = yield* Rbac
  const audit = yield* Audit
  const sandbox = yield* Sandbox
  const authoring = yield* FormulaAuthoring
  const runtimeStore = yield* FormulaRuntimeStore

  const actorOf = (as: Principal) => ({ kind: 'user', userId: as.userId }) as const

  const latestNoSubquery = sql<number | null>`(
    select max(v.version_no) from assessment_formula_versions v
    where v.tenant_id = assessment_formula_functions.tenant_id
      and v.function_id = assessment_formula_functions.id
  )`

  const latestReleaseSubquery = sql<string | null>`(
    select v.release_name from assessment_formula_versions v
    where v.tenant_id = assessment_formula_functions.tenant_id
      and v.function_id = assessment_formula_functions.id
    order by v.version_no desc
    limit 1
  )`

  /** one published version with the publisher's name a screen shows */
  const versionRow = (
    tenantId: string,
    where:
      { readonly functionId: string; readonly versionNo: number } | { readonly versionId: string },
  ) =>
    db
      .query((k) => {
        const query = k
          .selectFrom('FormulaVersion as v')
          // LEFT: publishing carries no foreign key to the publisher
          .leftJoin('User as u', (join) =>
            join.onRef('u.tenantId', '=', 'v.tenantId').onRef('u.id', '=', 'v.publishedBy'),
          )
          // LEFT twice: whoever last rewrote the label need not be the
          // publisher, and either row may be gone
          .leftJoin('User as m', (join) =>
            join.onRef('m.tenantId', '=', 'v.tenantId').onRef('m.id', '=', 'v.metadataUpdatedBy'),
          )
          .selectAll('v')
          .select(['u.displayName as publishedByName', 'm.displayName as metadataUpdatedByName'])
          .where('v.tenantId', '=', tenantId)
        return (
          'versionId' in where
            ? query.where('v.id', '=', where.versionId)
            : query
                .where('v.functionId', '=', where.functionId)
                .where('v.versionNo', '=', where.versionNo)
        ).executeTakeFirst()
      })
      .pipe(
        Effect.orDie,
        Effect.map((row) => (row === undefined ? undefined : (row as unknown as VersionRow))),
      )

  /** appends one saved state of a draft; the caller holds the function row */
  const appendRevision = (input: {
    readonly tenantId: string
    readonly functionId: string
    readonly revisionNo: number
    readonly sourceTs: string
    readonly tests: readonly unknown[]
    readonly savedBy: string
    readonly origin: RevisionOrigin
    readonly sourceVersionId?: string
    readonly sourceDraftRevisionNo?: number
  }) =>
    db
      .query((k) =>
        k
          .insertInto('FormulaDraftRevision')
          .values({
            tenantId: input.tenantId,
            functionId: input.functionId,
            revisionNo: input.revisionNo,
            sourceTs: input.sourceTs,
            tests: sql`${JSON.stringify(input.tests)}::jsonb`,
            sourceSha256: sha256Hex(input.sourceTs),
            savedBy: input.savedBy,
            origin: input.origin,
            sourceVersionId: input.sourceVersionId ?? null,
            sourceDraftRevisionNo: input.sourceDraftRevisionNo ?? null,
          } as never)
          .execute(),
      )
      .pipe(Effect.orDie, Effect.asVoid)

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
          .select(latestReleaseSubquery.as('latestReleaseName'))
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

  // ONE evaluator for every way a formula is tried outside scoring: the
  // ad-hoc try-run (no expectation), a single regression test, the whole
  // suite, the publish gate, and a published version tried as it was
  // frozen - same validation, same sandbox, same canonicalization, so no
  // second execution semantics can drift into being
  const evaluateCases = (
    runnable: RunnableFormula,
    cases: readonly EvaluationCaseInput[],
  ): Effect.Effect<
    { readonly results: readonly EvaluatedCase[]; readonly runtime: SandboxRuntimeIdentity | null },
    FormulaCompileUnavailable
  > =>
    Effect.gen(function* () {
      const { artifact, runtimeSha256: artifactHash, inputSchema, outputSchema } = runnable
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
                issues: (() => {
                  const refused = profileRefusals(failure.message)
                  return refused.length === 0 ? [{ path: '', reason: 'contract-error' }] : refused
                })(),
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
          .select(latestReleaseSubquery.as('latestReleaseName'))
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
            isoInstant(sliced[sliced.length - 1]!.updatedAt),
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
    // compile - the api's character-length check is not a byte check.
    // Nothing is written in for the author: a formula that runs is a scoring
    // decision, and a new one has made none yet.
    const seed = input.draftSourceTs ?? ''
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
          yield* appendRevision({
            tenantId,
            functionId: row.id as string,
            revisionNo: 1,
            sourceTs: seed,
            tests: [],
            savedBy: as.userId,
            origin: 'created',
          })
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
          .selectFrom('FormulaVersion as v')
          .leftJoin('User as u', (join) =>
            join.onRef('u.tenantId', '=', 'v.tenantId').onRef('u.id', '=', 'v.publishedBy'),
          )
          .select([
            'v.id as id',
            'v.versionNo as versionNo',
            'v.releaseName as releaseName',
            'v.releaseNotes as releaseNotes',
            'v.contractSha256 as contractSha256',
            'v.runtimeSha256 as runtimeSha256',
            'v.publishedBy as publishedBy',
            'u.displayName as publishedByName',
            'v.publishedAt as publishedAt',
            // the label's own revision: a list this is relabelled from must
            // hand the rewrite the revision it read, or the second rewrite
            // in a row reads as somebody else's
            'v.metadataRevision as metadataRevision',
          ])
          // how wide each publication's audience is, so the list of versions
          // can say it without a request per row
          .select((eb) =>
            eb
              .selectFrom('FormulaShareScope as s')
              .whereRef('s.tenantId', '=', 'v.tenantId')
              .whereRef('s.versionId', '=', 'v.id')
              .select(eb.fn.countAll<number>().as('count'))
              .as('sharedCount'),
          )
          .where('v.tenantId', '=', tenantId)
          .where('v.functionId', '=', functionId)
          .orderBy('v.versionNo', 'desc')
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
                .selectFrom('FormulaVersion as v')
                .innerJoin('FormulaFunction as f', (join) =>
                  join.onRef('f.tenantId', '=', 'v.tenantId').onRef('f.id', '=', 'v.functionId'),
                )
                .select([
                  'v.id as id',
                  'v.versionNo as versionNo',
                  'v.releaseName as releaseName',
                  'f.name as functionName',
                ])
                .where('v.tenantId', '=', tenantId)
                .where('v.id', '=', row.copiedFromVersionId as string)
                .executeTakeFirst(),
            )
            .pipe(
              Effect.orDie,
              Effect.map((source) => {
                const found = source as
                  | {
                      id: string
                      versionNo: number
                      releaseName: string | null
                      functionName: string
                    }
                  | undefined
                return found === undefined
                  ? null
                  : {
                      versionId: found.id,
                      versionNo: Number(found.versionNo),
                      functionName: found.functionName,
                      releaseName: found.releaseName,
                    }
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
      expectedDetailsRevision?: number
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
    // a patch that names no field changes nothing: no revision, no audit
    // event to explain later
    if (
      patch.name === undefined &&
      patch.description === undefined &&
      patch.draftSourceTs === undefined &&
      patch.draftTests === undefined
    )
      return functionDetailDto(row)
    const changed = yield* withDb(
      transaction(
        Effect.gen(function* () {
          const locked = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaFunction')
                .select([
                  'name',
                  'description',
                  'draftSourceTs',
                  'draftTests',
                  'draftRevision',
                  'detailsRevision',
                  'archivedAt',
                ])
                .where('tenantId', '=', tenantId)
                .where('id', '=', functionId)
                .forUpdate()
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (locked === undefined) return yield* new FormulaFunctionNotFound()
          // judged under the lock: the read above ran before this transaction,
          // and a concurrent archive or save between the two must not see its
          // draft edited
          if (locked.archivedAt !== null) return yield* new FormulaFunctionArchived()
          if (Number(locked.draftRevision) !== patch.expectedDraftRevision)
            return yield* new FormulaDraftConflict({ draftRevision: Number(locked.draftRevision) })
          // A revision is a change to what could be published - the source or
          // the examples - and nothing else. A save that repeats them, or only
          // renames the formula, moves no revision and leaves no snapshot of
          // a state that already has one.
          const sourceTs =
            patch.draftSourceTs !== undefined && patch.draftSourceTs !== locked.draftSourceTs
              ? patch.draftSourceTs
              : undefined
          const tests =
            patch.draftTests !== undefined &&
            canonicalJson(patch.draftTests) !== canonicalJson(locked.draftTests)
              ? patch.draftTests
              : undefined
          const name =
            patch.name !== undefined && patch.name !== locked.name ? patch.name : undefined
          const description =
            patch.description !== undefined && patch.description !== locked.description
              ? patch.description
              : undefined
          const content = sourceTs !== undefined || tests !== undefined
          if (!content && name === undefined && description === undefined) return false
          const revisionNo = patch.expectedDraftRevision + (content ? 1 : 0)
          // The words have their own token. A rename moves no draft revision,
          // so two windows that each read revision 8 - one renaming, one
          // rewriting the description - would both be accepted against it and
          // the later save would drop the earlier one's words without either
          // author seeing anything.
          const details = name !== undefined || description !== undefined
          const detailsNow = Number(locked.detailsRevision ?? 1)
          if (details && patch.expectedDetailsRevision !== detailsNow) {
            return yield* new FormulaDetailsConflict({ detailsRevision: detailsNow })
          }
          yield* db
            .query((k) =>
              k
                .updateTable('FormulaFunction')
                .set({
                  ...(name === undefined ? {} : { name }),
                  ...(description === undefined ? {} : { description }),
                  ...(sourceTs === undefined ? {} : { draftSourceTs: sourceTs }),
                  ...(tests === undefined
                    ? {}
                    : { draftTests: sql`${JSON.stringify(tests)}::jsonb` }),
                  draftRevision: revisionNo,
                  ...(details ? { detailsRevision: detailsNow + 1 } : {}),
                  updatedBy: as.userId,
                  updatedAt: sql`now()`,
                })
                .where('tenantId', '=', tenantId)
                .where('id', '=', functionId)
                .execute(),
            )
            .pipe(Effect.orDie)
          // the draft's own history is the revision row; nothing about a save
          // goes to the audit trail twice
          if (content) {
            yield* appendRevision({
              tenantId,
              functionId,
              revisionNo,
              sourceTs: sourceTs ?? (locked.draftSourceTs as string),
              tests: tests ?? (locked.draftTests as readonly unknown[]),
              savedBy: as.userId,
              origin: 'saved',
            })
          }
          // what a formula is called leaves no trace of its own, so a rename
          // is recorded; with the mutation, or not at all
          if (name !== undefined || description !== undefined) {
            yield* audit.record(FormulaFunctionDetailsChanged, {
              tenantId,
              actor: actorOf(as),
              target: { id: functionId, label: name ?? (locked.name as string) },
              details: {
                ...(name === undefined ? {} : { name: { from: locked.name as string, to: name } }),
                descriptionChanged: description !== undefined,
              },
            })
          }
          return true
        }),
      ),
    )
    if (!changed) return functionDetailDto(row)
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

  /**
   * Takes a draft-only formula away for good.
   *
   * Only while nothing has been published from it: a publication is what
   * questions are scored by and what others may have copied, and the
   * database says so too - versions hold the function with a RESTRICT edge,
   * while the draft's own revisions cascade with it. The check here is not
   * the safety, it is the sentence the author gets instead of a constraint.
   */
  const deleteFunction = Effect.fn('FormulaLibrary.deleteFunction')(function* (
    tenantId: string,
    functionId: string,
    as: Principal,
  ) {
    const row = yield* authoringRow(tenantId, functionId, as)
    yield* withDb(
      transaction(
        Effect.gen(function* () {
          const published = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaVersion')
                .select('id')
                .where('tenantId', '=', tenantId)
                .where('functionId', '=', functionId)
                .limit(1)
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (published !== undefined) return yield* new FormulaFunctionPublished()
          yield* db
            .query((k) =>
              k
                .deleteFrom('FormulaFunction')
                .where('tenantId', '=', tenantId)
                .where('id', '=', functionId)
                .execute(),
            )
            .pipe(Effect.orDie)
          yield* audit.record(FormulaFunctionDeleted, {
            tenantId,
            actor: actorOf(as),
            target: { id: functionId, label: row.name },
            details: {},
          })
        }),
      ),
    )
    return { deleted: true }
  })

  const publish = Effect.fn('FormulaLibrary.publish')(function* (
    tenantId: string,
    functionId: string,
    request: {
      readonly expectedDraftRevision: number
      readonly releaseName: string
      readonly releaseNotes?: string | null
    },
    as: Principal,
  ) {
    const expectedDraftRevision = request.expectedDraftRevision
    const releaseName = request.releaseName.trim()
    const releaseNotes =
      request.releaseNotes === undefined || request.releaseNotes === null
        ? null
        : request.releaseNotes.trim() === ''
          ? null
          : request.releaseNotes.trim()
    const row = yield* authoringRow(tenantId, functionId, as)
    if (row.archivedAt !== null) return yield* new FormulaFunctionArchived()
    if (row.draftRevision !== expectedDraftRevision)
      return yield* new FormulaDraftConflict({ draftRevision: row.draftRevision })

    // the long work runs outside any transaction, on the draft as read;
    // the toolchain identities come back WITH the artifact, from whichever
    // compiler process actually produced it
    const compiled = yield* compile(row.draftSourceTs, row.draftTests)

    // What publication is idempotent over: the EXECUTABLE identity alone -
    // source, examples and the whole toolchain. What the author calls it is
    // deliberately not in here: the name and the notes can be rewritten
    // afterwards, so a fingerprint carrying them would describe a version
    // that no longer exists the moment somebody fixes a typo. A double click
    // or a retried request therefore answers with the version that already
    // holds these bytes; a toolchain upgrade changes the fingerprint and may
    // legitimately mint a new one. draftRevision stays what it is: the
    // EDITING concurrency token.
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
          // the same bytes, already published. A retry of the very same
          // request is answered with the version it made; a press that means
          // something else - a new name for code that did not change - is
          // refused rather than minting a version claiming a rule moved
          if (existing !== undefined) {
            const same =
              (existing['releaseName'] as string | null) === releaseName &&
              (existing['releaseNotes'] as string | null) === releaseNotes
            if (same) return existing
            return yield* new FormulaVersionUnchanged({
              versionNo: Number(existing['versionNo']),
              releaseName: (existing['releaseName'] as string | null) ?? null,
            })
          }
          // a different publication wearing the name already: the function
          // row is held, so no second publish can take it meanwhile
          const named = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaVersion')
                .select('id')
                .where('tenantId', '=', tenantId)
                .where('functionId', '=', functionId)
                .where('releaseName', '=', releaseName)
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (named !== undefined) return yield* new FormulaReleaseNameTaken()
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
                  releaseName,
                  releaseNotes,
                } as never)
                .returning('id')
                .executeTakeFirstOrThrow(),
            )
            .pipe(Effect.orDie)
        }),
      ),
    )
    const published = yield* versionRow(tenantId, { versionId: inserted.id as string })
    if (published === undefined) return yield* Effect.die(new Error('a published version vanished'))
    return versionDetailDto(published)
  })

  /**
   * Rewriting what a publication is called, and why it was made.
   *
   * The whole of the executable record is left alone, and so is the
   * publication itself: the number, the instant and the publisher stay as
   * they were, because none of them is what changed. Only the label moves,
   * under the function's own lock so that the name it takes is still free
   * when it takes it, and with its own revision so two windows cannot
   * silently overwrite one another.
   */
  const updateVersionInfo = Effect.fn('FormulaLibrary.updateVersionInfo')(function* (
    tenantId: string,
    functionId: string,
    versionNo: number,
    request: {
      readonly expectedMetadataRevision: number
      readonly releaseName: string
      readonly releaseNotes: string | null
    },
    as: Principal,
  ) {
    yield* authoringRow(tenantId, functionId, as)
    const releaseName = request.releaseName.trim()
    const releaseNotes =
      request.releaseNotes === null || request.releaseNotes.trim() === ''
        ? null
        : request.releaseNotes.trim()
    yield* withDb(
      transaction(
        Effect.gen(function* () {
          // the function row is the lock every write to this formula takes,
          // so a second window renaming another version cannot take the name
          // between this check and this update
          const locked = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaFunction')
                .select(['createdBy'])
                .where('tenantId', '=', tenantId)
                .where('id', '=', functionId)
                .forUpdate()
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (locked === undefined) return yield* new FormulaFunctionNotFound()
          yield* requireAuthor(as)
          if (locked.createdBy !== as.userId) return yield* new FormulaFunctionNotFound()
          const version = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaVersion')
                .select(['id', 'metadataRevision', 'releaseName', 'releaseNotes'])
                .where('tenantId', '=', tenantId)
                .where('functionId', '=', functionId)
                .where('versionNo', '=', versionNo)
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (version === undefined) return yield* new FormulaVersionNotFound()
          const held = Number(version.metadataRevision ?? 1)
          if (held !== request.expectedMetadataRevision)
            return yield* new FormulaVersionInfoConflict({ metadataRevision: held })
          const was = (version.releaseName as string | null) ?? null
          const wasNotes = (version.releaseNotes as string | null) ?? null
          // words that did not move are not an act: no revision, no trail row
          if (was === releaseName && wasNotes === releaseNotes) return
          const taken = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaVersion')
                .select('id')
                .where('tenantId', '=', tenantId)
                .where('functionId', '=', functionId)
                .where('releaseName', '=', releaseName)
                .where('id', '!=', version.id as string)
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (taken !== undefined) return yield* new FormulaReleaseNameTaken()
          yield* db
            .query((k) =>
              k
                .updateTable('FormulaVersion')
                .set({
                  releaseName,
                  releaseNotes,
                  metadataRevision: held + 1,
                  metadataUpdatedAt: sql`now()`,
                  metadataUpdatedBy: as.userId,
                })
                .where('tenantId', '=', tenantId)
                .where('id', '=', version.id as string)
                .execute(),
            )
            .pipe(Effect.orDie)
          // the version row keeps only the latest words, so the trail is the
          // one account that a publication was ever called something else
          yield* audit.record(FormulaVersionInfoChanged, {
            tenantId,
            actor: actorOf(as),
            target: { id: functionId, label: releaseName },
            details: {
              versionId: version.id as string,
              versionNo,
              ...(was === releaseName ? {} : { name: { from: was, to: releaseName } }),
              ...(wasNotes === releaseNotes ? {} : { notes: { from: wasNotes, to: releaseNotes } }),
            },
          })
        }),
      ),
    )
    const updated = yield* versionRow(tenantId, { functionId, versionNo })
    if (updated === undefined) return yield* new FormulaVersionNotFound()
    return versionDetailDto(updated)
  })

  const getVersion = Effect.fn('FormulaLibrary.getVersion')(function* (
    tenantId: string,
    functionId: string,
    versionNo: number,
    as: Principal,
  ) {
    yield* authoringRow(tenantId, functionId, as)
    const version = yield* versionRow(tenantId, { functionId, versionNo })
    if (version === undefined) return yield* new FormulaVersionNotFound()
    return versionDetailDto(version)
  })

  // A published version tried as it was frozen: the stored artifact and
  // contract, re-proven by the runtime store on the way out, never the
  // source compiled again. Behind the same gate as reading the version, and
  // an archived function's versions may still be tried - this writes nothing.
  const evaluateVersion = Effect.fn('FormulaLibrary.evaluateVersion')(function* (
    tenantId: string,
    functionId: string,
    versionNo: number,
    cases: readonly EvaluationCaseInput[],
    as: Principal,
  ) {
    yield* authoringRow(tenantId, functionId, as)
    const found = yield* db
      .query((k) =>
        k
          .selectFrom('FormulaVersion')
          .select('id')
          .where('tenantId', '=', tenantId)
          .where('functionId', '=', functionId)
          .where('versionNo', '=', versionNo)
          .executeTakeFirst(),
      )
      .pipe(Effect.orDie)
    if (found === undefined) return yield* new FormulaVersionNotFound()
    const versionId = found.id as string
    const frozen = yield* runtimeStore.resolve({ tenantId, versionId }).pipe(
      Effect.catchTags({
        ASSESSMENT_FORMULA_RUNTIME_MISSING: () => Effect.fail(new FormulaVersionNotFound()),
        ASSESSMENT_FORMULA_RUNTIME_TAMPERED: (failure) =>
          Effect.logWarning(
            `formula version ${versionId} cannot be tried: its ${failure.field} no longer matches its hash`,
          ).pipe(Effect.andThen(Effect.fail(new FormulaVersionUnrunnable()))),
        ASSESSMENT_FORMULA_RUNTIME_UNSUPPORTED: (failure) =>
          Effect.logWarning(
            `formula version ${versionId} cannot be tried by this build: ${failure.issues.map((issue) => issue.facet).join(', ')}`,
          ).pipe(Effect.andThen(Effect.fail(new FormulaVersionUnrunnable()))),
      }),
    )
    const evaluated = yield* evaluateCases(
      {
        artifact: frozen.runtimeJs,
        runtimeSha256: frozen.runtimeSha256,
        inputSchema: frozen.inputSchema,
        outputSchema: frozen.outputSchema,
      },
      cases,
    )
    return {
      contractSha256: frozen.contractSha256,
      inputSchema: frozen.inputSchema,
      outputSchema: frozen.outputSchema,
      results: evaluated.results,
    } satisfies VersionEvaluation
  })

  const listDraftRevisions = Effect.fn('FormulaLibrary.listDraftRevisions')(function* (
    tenantId: string,
    functionId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) {
    yield* authoringRow(tenantId, functionId, as)
    const size = pageSize(page.limit, DEFAULT_PAGE_SIZE)
    const cursor = readQueryCursor(page.cursor, revisionFingerprint(functionId), ['text'])
    if (cursor === null) return yield* cursorUnusable()
    const before = cursor === undefined ? undefined : Number(cursor[0])
    if (before !== undefined && !(Number.isSafeInteger(before) && before > 0))
      return yield* cursorUnusable()
    const rows = yield* db
      .query((k) => {
        let query = k
          .selectFrom('FormulaDraftRevision as r')
          .leftJoin('User as u', (join) =>
            join.onRef('u.tenantId', '=', 'r.tenantId').onRef('u.id', '=', 'r.savedBy'),
          )
          .leftJoin('FormulaVersion as v', (join) =>
            join.onRef('v.tenantId', '=', 'r.tenantId').onRef('v.id', '=', 'r.sourceVersionId'),
          )
          .select([
            'r.revisionNo as revisionNo',
            'r.origin as origin',
            'r.sourceSha256 as sourceSha256',
            'r.savedBy as savedBy',
            'u.displayName as savedByName',
            'r.savedAt as savedAt',
            'v.versionNo as sourceVersionNo',
            'v.releaseName as sourceReleaseName',
            'r.sourceDraftRevisionNo as sourceDraftRevisionNo',
          ])
          .where('r.tenantId', '=', tenantId)
          .where('r.functionId', '=', functionId)
        if (before !== undefined) query = query.where('r.revisionNo', '<', before)
        return query
          .orderBy('r.revisionNo', 'desc')
          .limit(size + 1)
          .execute()
      })
      .pipe(Effect.orDie)
    const all = rows as unknown as RevisionRow[]
    const sliced = all.slice(0, size)
    return {
      items: sliced.map(revisionViewDto),
      nextCursor:
        all.length > size
          ? encodeQueryCursor(revisionFingerprint(functionId), [
              String(sliced[sliced.length - 1]!.revisionNo),
            ])
          : null,
    }
  })

  const getDraftRevision = Effect.fn('FormulaLibrary.getDraftRevision')(function* (
    tenantId: string,
    functionId: string,
    revisionNo: number,
    as: Principal,
  ) {
    yield* authoringRow(tenantId, functionId, as)
    const row = yield* db
      .query((k) =>
        k
          .selectFrom('FormulaDraftRevision as r')
          .leftJoin('User as u', (join) =>
            join.onRef('u.tenantId', '=', 'r.tenantId').onRef('u.id', '=', 'r.savedBy'),
          )
          .leftJoin('FormulaVersion as v', (join) =>
            join.onRef('v.tenantId', '=', 'r.tenantId').onRef('v.id', '=', 'r.sourceVersionId'),
          )
          .select([
            'r.revisionNo as revisionNo',
            'r.origin as origin',
            'r.sourceSha256 as sourceSha256',
            'r.savedBy as savedBy',
            'u.displayName as savedByName',
            'r.savedAt as savedAt',
            'v.versionNo as sourceVersionNo',
            'v.releaseName as sourceReleaseName',
            'r.sourceDraftRevisionNo as sourceDraftRevisionNo',
            'r.sourceTs as sourceTs',
            'r.tests as tests',
          ])
          .where('r.tenantId', '=', tenantId)
          .where('r.functionId', '=', functionId)
          .where('r.revisionNo', '=', revisionNo)
          .executeTakeFirst(),
      )
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new FormulaDraftRevisionNotFound()
    const found = row as unknown as RevisionRow & {
      sourceTs: string
      tests: readonly FormulaTestInput[]
    }
    return { ...revisionViewDto(found), sourceTs: found.sourceTs, tests: found.tests }
  })

  const restoreDraft = Effect.fn('FormulaLibrary.restoreDraft')(function* (
    tenantId: string,
    functionId: string,
    request: { readonly expectedDraftRevision: number; readonly from: RestoreSource },
    as: Principal,
  ) {
    yield* authoringRow(tenantId, functionId, as)
    yield* withDb(
      transaction(
        Effect.gen(function* () {
          const locked = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaFunction')
                .select(['draftSourceTs', 'draftTests', 'draftRevision', 'archivedAt'])
                .where('tenantId', '=', tenantId)
                .where('id', '=', functionId)
                .forUpdate()
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (locked === undefined) return yield* new FormulaFunctionNotFound()
          if (locked.archivedAt !== null) return yield* new FormulaFunctionArchived()
          if (Number(locked.draftRevision) !== request.expectedDraftRevision)
            return yield* new FormulaDraftConflict({ draftRevision: Number(locked.draftRevision) })
          // the state put back is read here, from the immutable row itself:
          // what the new revision says it came from is what it holds
          const from = request.from
          const source =
            from.kind === 'published-version'
              ? yield* db
                  .query((k) =>
                    k
                      .selectFrom('FormulaVersion')
                      .select(['id', 'sourceTs', 'tests'])
                      .where('tenantId', '=', tenantId)
                      .where('functionId', '=', functionId)
                      .where('versionNo', '=', from.versionNo)
                      .executeTakeFirst(),
                  )
                  .pipe(
                    Effect.orDie,
                    Effect.flatMap((found) =>
                      found === undefined
                        ? Effect.fail(new FormulaVersionNotFound())
                        : Effect.succeed({
                            sourceTs: found.sourceTs as string,
                            tests: found.tests as readonly unknown[],
                            provenance: { sourceVersionId: found.id as string },
                            origin: 'restored-from-version' as const,
                          }),
                    ),
                  )
              : yield* db
                  .query((k) =>
                    k
                      .selectFrom('FormulaDraftRevision')
                      .select(['sourceTs', 'tests'])
                      .where('tenantId', '=', tenantId)
                      .where('functionId', '=', functionId)
                      .where('revisionNo', '=', from.revisionNo)
                      .executeTakeFirst(),
                  )
                  .pipe(
                    Effect.orDie,
                    Effect.flatMap((found) =>
                      found === undefined
                        ? Effect.fail(new FormulaDraftRevisionNotFound())
                        : Effect.succeed({
                            sourceTs: found.sourceTs as string,
                            tests: found.tests as readonly unknown[],
                            provenance: { sourceDraftRevisionNo: from.revisionNo },
                            origin: 'restored-from-draft' as const,
                          }),
                    ),
                  )
          // the ceiling drafts are held to today, whatever a publication was
          // once allowed
          if (Buffer.byteLength(source.sourceTs, 'utf8') > SOURCE_LIMIT)
            return yield* new FormulaSourceTooLarge({ limit: SOURCE_LIMIT })
          // putting back exactly what is already there is not a change
          if (
            source.sourceTs === locked.draftSourceTs &&
            canonicalJson(source.tests) === canonicalJson(locked.draftTests)
          )
            return
          const revisionNo = request.expectedDraftRevision + 1
          yield* db
            .query((k) =>
              k
                .updateTable('FormulaFunction')
                .set({
                  draftSourceTs: source.sourceTs,
                  draftTests: sql`${JSON.stringify(source.tests)}::jsonb`,
                  draftRevision: revisionNo,
                  updatedBy: as.userId,
                  updatedAt: sql`now()`,
                })
                .where('tenantId', '=', tenantId)
                .where('id', '=', functionId)
                .execute(),
            )
            .pipe(Effect.orDie)
          yield* appendRevision({
            tenantId,
            functionId,
            revisionNo,
            sourceTs: source.sourceTs,
            tests: source.tests,
            savedBy: as.userId,
            origin: source.origin,
            ...source.provenance,
          })
        }),
      ),
    )
    const fresh = yield* foundRow(tenantId, functionId)
    return functionDetailDto(fresh)
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
    deleteFunction: (tenantId, functionId, as) => withDb(deleteFunction(tenantId, functionId, as)),
    publish: (tenantId, functionId, request, as) =>
      withDb(publish(tenantId, functionId, request, as)),
    getVersion: (tenantId, functionId, versionNo, as) =>
      withDb(getVersion(tenantId, functionId, versionNo, as)),
    updateVersionInfo: (tenantId, functionId, versionNo, request, as) =>
      withDb(updateVersionInfo(tenantId, functionId, versionNo, request, as)),
    evaluateVersion: (tenantId, functionId, versionNo, cases, as) =>
      withDb(evaluateVersion(tenantId, functionId, versionNo, cases, as)),
    listDraftRevisions: (tenantId, functionId, page, as) =>
      withDb(listDraftRevisions(tenantId, functionId, page, as)),
    getDraftRevision: (tenantId, functionId, revisionNo, as) =>
      withDb(getDraftRevision(tenantId, functionId, revisionNo, as)),
    restoreDraft: (tenantId, functionId, request, as) =>
      withDb(restoreDraft(tenantId, functionId, request, as)),
  }
  return service
})

// the runtime store arrives with the library rather than beside it: trying
// a published version is authoring, gated here, and only the store may say
// what that version is
export const layer = Layer.effect(FormulaLibrary, make()).pipe(Layer.provide(runtimeStoreLayer))

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
        const settings = yield* FormulaSettings
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
        const current =
          boundVersionId === null
            ? null
            : yield* catalog.currentBinding(tenantId, boundVersionId, principal.userId)

        // with the writer closed the catalog of what could be newly bound is
        // never opened - not paged, not even cursor-read: the page is history
        // only, and history has no cursor
        if (!settings.authoring) {
          return bindingOptionsResponse({ authoring: false, current, offered: null })
        }

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
        return bindingOptionsResponse({
          authoring: true,
          current,
          offered: {
            items: page.items,
            nextCursor:
              page.more && page.last !== null
                ? encodeQueryCursor(bindingFingerprint(params.batchId), [
                    page.last.functionName,
                    String(page.last.versionNo),
                    page.last.versionId,
                  ])
                : null,
          },
        })
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
            ...(payload.expectedDetailsRevision === undefined
              ? {}
              : { expectedDetailsRevision: payload.expectedDetailsRevision }),
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
      'deleteFormulaFunction',
      Effect.fn('assessmentFormula.deleteFunction.handler')(function* ({ params }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        return yield* library.deleteFunction(principal.tenantId, params.functionId, principal)
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
          {
            expectedDraftRevision: payload.expectedDraftRevision,
            releaseName: payload.releaseName,
            ...(payload.releaseNotes === undefined ? {} : { releaseNotes: payload.releaseNotes }),
          },
          principal,
        )
        return { version }
      }),
    )
    .handle(
      'listFormulaDraftRevisions',
      Effect.fn('assessmentFormula.listRevisions.handler')(function* ({ params, query }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        return yield* library.listDraftRevisions(
          principal.tenantId,
          params.functionId,
          query,
          principal,
        )
      }),
    )
    .handle(
      'getFormulaDraftRevision',
      Effect.fn('assessmentFormula.getRevision.handler')(function* ({ params }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const revisionNo = Number(params.revisionNo)
        if (!Number.isSafeInteger(revisionNo) || revisionNo < 1)
          return yield* new BadRequest({
            message: 'the revision number must be a positive integer',
          })
        return {
          revision: yield* library.getDraftRevision(
            principal.tenantId,
            params.functionId,
            revisionNo,
            principal,
          ),
        }
      }),
    )
    .handle(
      'restoreFormulaDraft',
      Effect.fn('assessmentFormula.restoreDraft.handler')(function* ({ params, payload }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const restored = yield* library.restoreDraft(
          principal.tenantId,
          params.functionId,
          { expectedDraftRevision: payload.expectedDraftRevision, from: payload.from },
          principal,
        )
        return { function: restored }
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
      'updateFormulaVersionInfo',
      Effect.fn('assessmentFormula.updateVersionInfo.handler')(function* ({ params, payload }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const parsed = Number(params.versionNo)
        if (!Number.isSafeInteger(parsed) || parsed < 1)
          return yield* new BadRequest({
            message: 'the version number must be a positive integer',
          })
        return {
          version: yield* library.updateVersionInfo(
            principal.tenantId,
            params.functionId,
            parsed,
            {
              expectedMetadataRevision: payload.expectedMetadataRevision,
              releaseName: payload.releaseName,
              releaseNotes: payload.releaseNotes,
            },
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
    .handle(
      'evaluateFormulaVersion',
      Effect.fn('assessmentFormula.evaluateVersion.handler')(function* ({ params, payload }) {
        const library = yield* FormulaLibrary
        const principal = yield* CurrentUser
        const versionNo = Number(params.versionNo)
        if (!Number.isSafeInteger(versionNo) || versionNo < 1)
          return yield* new BadRequest({
            message: 'the version number must be a positive integer',
          })
        const evaluated = yield* library.evaluateVersion(
          principal.tenantId,
          params.functionId,
          versionNo,
          payload.cases.map((one) => ({
            input: one.input,
            ...(one.expected === undefined ? {} : { expected: one.expected }),
          })),
          principal,
        )
        return {
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
        // different host means someone else's page is speaking. The host it
        // is held against is the one the request context resolved through
        // the deployment's proxy policy; served bare, the Host header
        const context = Option.getOrUndefined(yield* currentRequestContext)
        const publicHost = context === undefined ? request.headers['host'] : context.publicHost
        if (!originMatchesHost(request.headers['origin'], publicHost)) {
          return HttpServerResponse.empty({ status: 403 })
        }

        const principal = yield* CurrentUser
        const library = yield* FormulaLibrary
        const draft = yield* library.managedDraft(principal.tenantId, params.functionId, principal)

        // a few live language servers per person, tenant-scoped; one past
        // them is refused rather than an earlier one torn down. The refusal
        // is a completed upgrade closed with 4429, the only form a browser
        // can tell apart from an outage, and it opens no language session
        const quota = yield* FormulaLspQuota
        const admitted = yield* quota.acquire(`${principal.tenantId}:${principal.userId}`)
        if (!admitted) {
          const refused = yield* request.upgrade.pipe(Effect.orElseSucceed(() => null))
          if (refused === null) return HttpServerResponse.empty({ status: 429 })
          yield* refuseSeat(refused)
          return HttpServerResponse.empty()
        }

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
