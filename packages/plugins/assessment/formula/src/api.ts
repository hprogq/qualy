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
  FormulaSourceRefused,
  FormulaSharingConflict,
  FormulaSourceTooLarge,
  FormulaTemplateNotFound,
  FormulaTestFailed,
  FormulaTypecheckFailed,
  FormulaCompileUnavailable,
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
  /** the author, and the only person who may edit it */
  authorUserId: Schema.String,
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

/** one template as a library row shows it: never the artifact, never the source */
const templateSummary = Schema.Struct({
  versionId: Schema.String,
  functionId: Schema.String,
  functionName: Schema.String,
  description: Schema.NullOr(Schema.String),
  versionNo: Schema.Number,
  publishedAt: Schema.String,
  authorUserId: Schema.String,
  /** null when the author's row is gone; a template does not depend on it */
  authorName: Schema.NullOr(Schema.String),
  parameters: Schema.Array(Schema.String),
  sourceStatus: Schema.Literals(['active', 'archived']),
})

/**
 * One template as its own page shows it.
 *
 * The source and the examples ride along, and the artifact does not.
 * Somebody who may see this may copy it, and a copy hands them the source
 * anyway - so showing it grants no reach they did not already have, while a
 * page that showed only the summary would leave a reader deciding whether to
 * copy something they cannot look at.
 */
const templateDetail = Schema.Struct({
  ...templateSummary.fields,
  sourceTs: Schema.String,
  tests: Schema.Array(formulaTest),
  inputSchema: Schema.Unknown,
  outputSchema: Schema.Unknown,
})

/** a published version's audience, and what it looked like when read */
const versionSharing = Schema.Struct({
  scopes: Schema.Array(Schema.Struct({ orgNodeId: Schema.String, name: Schema.String })),
  token: Schema.String,
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
        error: [BadRequest, AccessDenied, BatchNotFound],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createFormulaFunction', '/assessment/formula-functions', {
      payload: Schema.Struct({
        name: trimmedName(255),
        description: Schema.optional(boundedText(2000)),
        draftSourceTs: Schema.optional(sourceText),
      }),
      success: Schema.Struct({ function: functionDetail }),
      error: [BadRequest, AccessDenied, FormulaSourceTooLarge],
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
  .add(
    // published versions other authors have offered to where this reader
    // stands. Never their own: those are already in their own library
    HttpApiEndpoint.get('listFormulaTemplates', '/assessment/formula-templates', {
      query: Schema.Struct({ ...pageQuery }),
      success: pageOf(templateSummary),
      error: [BadRequest, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // one template, judged discoverable again rather than trusted from the
    // listing: a version somebody can name but not discover is not a
    // template to them, and any other answer tells them it exists
    HttpApiEndpoint.get('getFormulaTemplate', '/assessment/formula-templates/:versionId', {
      params: Schema.Struct({ versionId: id }),
      success: Schema.Struct({ template: templateDetail }),
      error: [FormulaTemplateNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // who this published version has been offered to. The token is what the
    // audience looked like when it was read, so two screens editing the
    // same one cannot take turns silently overwriting each other
    HttpApiEndpoint.get(
      'getFormulaVersionSharing',
      '/assessment/formula-functions/:functionId/versions/:versionNo/sharing',
      {
        params: Schema.Struct({ functionId: id, versionNo: Schema.String }),
        success: versionSharing,
        error: [FormulaFunctionNotFound, FormulaVersionNotFound, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put(
      'replaceFormulaVersionSharing',
      '/assessment/formula-functions/:functionId/versions/:versionNo/sharing',
      {
        params: Schema.Struct({ functionId: id, versionNo: Schema.String }),
        payload: Schema.Struct({
          expectedToken: Schema.String,
          orgNodeIds: Schema.Array(id),
        }),
        success: versionSharing,
        error: [
          FormulaFunctionNotFound,
          FormulaVersionNotFound,
          FormulaSharingConflict,
          AccessDenied,
          BadRequest,
        ],
      },
    ).middleware(Authenticated),
  )
