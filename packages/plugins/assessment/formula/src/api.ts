import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import { Authenticated } from '@qualy/plugin-auth/server/session-contract'
import {
  BadRequest,
  boundedText,
  expectedVersion,
  pageOf,
  pageQuery,
  trimmedName,
} from '@qualy/api-kit/schema'
import {
  FormulaBundleFailed,
  FormulaContractInvalid,
  FormulaExecutionLimitExceeded,
  FormulaDraftConflict,
  FormulaFunctionArchived,
  FormulaFunctionNotFound,
  FormulaOwnerNodeInvalid,
  FormulaSourceRefused,
  FormulaSourceTooLarge,
  FormulaTestFailed,
  FormulaTypecheckFailed,
  FormulaCompileUnavailable,
  FormulaBindingOptionsUnavailable,
  FormulaVersionNotFound,
} from './server/errors.ts'
import { BatchNotFound } from '@qualy/plugin-assessment/server/errors'

const id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))

/** a formula source; the compile pipeline enforces the byte limit again */
const sourceText = Schema.String.check(Schema.isMaxLength(262_144))

/** one authored example: named input, expected canonical amount */
const formulaTest = Schema.Struct({
  name: trimmedName(100),
  input: Schema.Unknown,
  expected: Schema.String.check(Schema.isMaxLength(63)),
})

const functionView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  ownerNodeId: Schema.String,
  status: Schema.Literals(['active', 'archived']),
  draftRevision: Schema.Number,
  latestVersionNo: Schema.NullOr(Schema.Number),
  updatedAt: Schema.String,
})

const functionDetail = Schema.Struct({
  ...functionView.fields,
  draftSourceTs: Schema.String,
  draftTests: Schema.Array(formulaTest),
})

const versionView = Schema.Struct({
  versionNo: Schema.Number,
  contractSha256: Schema.String,
  runtimeSha256: Schema.String,
  publishedBy: Schema.String,
  publishedAt: Schema.String,
})

/** one case for the draft evaluator; the client id is an echo, not identity */
const evaluationCase = Schema.Struct({
  clientId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  input: Schema.Unknown,
  expected: Schema.optional(Schema.String.check(Schema.isMaxLength(63))),
})

const evaluatedCase = Schema.Struct({
  clientId: Schema.String,
  passed: Schema.optional(Schema.Boolean),
  expected: Schema.optional(Schema.String),
  actual: Schema.optional(Schema.String),
  problems: Schema.optional(Schema.Unknown),
  refusal: Schema.optional(Schema.String),
  defect: Schema.optional(Schema.String),
})

/** the draft contract identity a screen keys its freshness on */
const draftPreview = Schema.Struct({
  sourceSha256: Schema.String,
  contractSha256: Schema.String,
  inputSchema: Schema.Unknown,
  outputSchema: Schema.Unknown,
})

const versionDetail = Schema.Struct({
  ...versionView.fields,
  sourceTs: Schema.String,
  sourceSha256: Schema.String,
  inputSchema: Schema.Unknown,
  outputSchema: Schema.Unknown,
  typescriptVersion: Schema.String,
  esbuildVersion: Schema.String,
  formulaAbiVersion: Schema.Number,
  formulaRuntimeSha256: Schema.String,
  quickjsEngineVersion: Schema.String,
  tests: Schema.Array(formulaTest),
  testReport: Schema.Unknown,
})

/** one published version as a chooser shows it; the schemas stay out - a
 *  picker names versions, and what a version's contract IS comes from the
 *  preview that compiles it */
const bindingOptionView = Schema.Struct({
  versionId: Schema.String,
  functionId: Schema.String,
  functionName: Schema.String,
  versionNo: Schema.Number,
  publishedAt: Schema.String,
  /** the parameter names this version takes, for a one-line summary */
  parameters: Schema.Array(Schema.String),
})

export const formulaApiGroup = HttpApiGroup.make('assessmentFormula')
  .add(
    // where this principal may CREATE a formula: the nodes their manage
    // permission actually covers, not the whole visible org tree
    HttpApiEndpoint.get('listFormulaOwnerOptions', '/assessment/formula-owner-options', {
      success: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({ id: Schema.String, name: Schema.String, depth: Schema.Number }),
        ),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listFormulaFunctions', '/assessment/formula-functions', {
      query: Schema.Struct({ ...pageQuery }),
      success: pageOf(functionView),
      error: [BadRequest, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    /**
     * The formula versions this batch may newly bind, and what it is bound
     * to today.
     *
     * Two different questions, so two fields. The page answers current
     * POLICY - is this version's function live, and does its owner cover
     * every anchor this round is run from - and says nothing about whether
     * the version can still be executed by this build; that is the runtime
     * store's answer, given when a candidate is previewed, and finally the
     * save's. The current binding is history rather than an option: a
     * question keeps showing what it is bound to however its function or
     * owner has changed, and the server derives it from the question's own
     * frozen plan rather than taking a version id from the caller.
     */
    HttpApiEndpoint.get(
      'listFormulaBindingOptions',
      '/assessment/batches/:batchId/formula-binding-options',
      {
        params: Schema.Struct({ batchId: id }),
        query: Schema.Struct({ ...pageQuery, itemId: Schema.optional(id) }),
        success: Schema.Struct({
          items: Schema.Array(bindingOptionView),
          nextCursor: Schema.NullOr(Schema.String),
          current: Schema.NullOr(
            Schema.Struct({
              ...bindingOptionView.fields,
              /** whether the same version could still be bound afresh - a
               *  policy snapshot, never a promise that it will run */
              bindableForNew: Schema.Boolean,
            }),
          ),
        }),
        error: [BadRequest, AccessDenied, BatchNotFound, FormulaBindingOptionsUnavailable],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createFormulaFunction', '/assessment/formula-functions', {
      payload: Schema.Struct({
        ownerNodeId: id,
        name: trimmedName(255),
        description: Schema.optional(boundedText(2000)),
        draftSourceTs: Schema.optional(sourceText),
      }),
      success: Schema.Struct({ function: functionDetail }),
      error: [BadRequest, AccessDenied, FormulaOwnerNodeInvalid, FormulaSourceTooLarge],
    }).middleware(Authenticated),
  )
  .add(
    // what the CURRENT editor buffer compiles to: contract + identities,
    // for the typed test form - a side-effect-free authoring tool
    HttpApiEndpoint.post(
      'previewFormulaDraft',
      '/assessment/formula-functions/:functionId/draft/preview',
      {
        params: Schema.Struct({ functionId: id }),
        payload: Schema.Struct({ sourceTs: sourceText }),
        success: draftPreview,
        error: [
          FormulaFunctionNotFound,
          FormulaSourceTooLarge,
          FormulaSourceRefused,
          FormulaTypecheckFailed,
          FormulaBundleFailed,
          FormulaExecutionLimitExceeded,
          FormulaContractInvalid,
          FormulaCompileUnavailable,
          AccessDenied,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    // run cases against the CURRENT editor buffer: the try-run (no
    // expectation), one regression test or the whole suite - one evaluator,
    // the same one publication uses, results ephemeral by design
    HttpApiEndpoint.post(
      'evaluateFormulaDraft',
      '/assessment/formula-functions/:functionId/draft/evaluation',
      {
        params: Schema.Struct({ functionId: id }),
        payload: Schema.Struct({
          sourceTs: sourceText,
          cases: Schema.Array(evaluationCase).check(Schema.isMaxLength(50)),
        }),
        success: Schema.Struct({
          ...draftPreview.fields,
          cases: Schema.Array(evaluatedCase),
        }),
        error: [
          FormulaFunctionNotFound,
          FormulaSourceTooLarge,
          FormulaSourceRefused,
          FormulaTypecheckFailed,
          FormulaBundleFailed,
          FormulaExecutionLimitExceeded,
          FormulaContractInvalid,
          FormulaCompileUnavailable,
          AccessDenied,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    // the language-service websocket: the response IS an upgraded
    // connection, so the handler is raw - authentication and authorization
    // still belong to this endpoint like any other
    HttpApiEndpoint.get('formulaLsp', '/assessment/formula-functions/:functionId/lsp', {
      params: Schema.Struct({ functionId: id }),
      error: [FormulaFunctionNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getFormulaFunction', '/assessment/formula-functions/:functionId', {
      params: Schema.Struct({ functionId: id }),
      success: Schema.Struct({
        function: functionDetail,
        versions: Schema.Array(versionView),
      }),
      error: [FormulaFunctionNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateFormulaDraft', '/assessment/formula-functions/:functionId', {
      params: Schema.Struct({ functionId: id }),
      payload: Schema.Struct({
        expectedDraftRevision: expectedVersion,
        name: Schema.optional(trimmedName(255)),
        description: Schema.optional(Schema.NullOr(boundedText(2000))),
        draftSourceTs: Schema.optional(sourceText),
        draftTests: Schema.optional(Schema.Array(formulaTest).check(Schema.isMaxLength(50))),
      }),
      success: Schema.Struct({ function: functionDetail }),
      error: [
        BadRequest,
        FormulaFunctionNotFound,
        FormulaFunctionArchived,
        FormulaDraftConflict,
        FormulaSourceTooLarge,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put(
      'setFormulaFunctionStatus',
      '/assessment/formula-functions/:functionId/status',
      {
        params: Schema.Struct({ functionId: id }),
        payload: Schema.Struct({ status: Schema.Literals(['active', 'archived']) }),
        success: Schema.Struct({ function: functionDetail }),
        error: [FormulaFunctionNotFound, AccessDenied],
      },
    ).middleware(Authenticated),
  )
  .add(
    // publishing IS creating a version: the draft is compiled, proven and
    // frozen in one request, and the row that comes back is immutable
    HttpApiEndpoint.post(
      'publishFormulaVersion',
      '/assessment/formula-functions/:functionId/versions',
      {
        params: Schema.Struct({ functionId: id }),
        payload: Schema.Struct({ expectedDraftRevision: expectedVersion }),
        success: Schema.Struct({ version: versionDetail }),
        error: [
          FormulaFunctionNotFound,
          FormulaFunctionArchived,
          FormulaDraftConflict,
          FormulaSourceTooLarge,
          FormulaSourceRefused,
          FormulaTypecheckFailed,
          FormulaBundleFailed,
          FormulaExecutionLimitExceeded,
          FormulaContractInvalid,
          FormulaTestFailed,
          FormulaCompileUnavailable,
          AccessDenied,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get(
      'getFormulaVersion',
      '/assessment/formula-functions/:functionId/versions/:versionNo',
      {
        params: Schema.Struct({ functionId: id, versionNo: Schema.String }),
        success: Schema.Struct({ version: versionDetail }),
        error: [FormulaFunctionNotFound, FormulaVersionNotFound, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
