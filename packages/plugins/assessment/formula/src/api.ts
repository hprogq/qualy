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
  FormulaContractInvalid,
  FormulaDraftConflict,
  FormulaFunctionArchived,
  FormulaFunctionNotFound,
  FormulaOwnerNodeInvalid,
  FormulaSourceRefused,
  FormulaSourceTooLarge,
  FormulaTestFailed,
  FormulaTypecheckFailed,
  FormulaCompileUnavailable,
  FormulaVersionNotFound,
} from './server/errors.ts'

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

export const formulaApiGroup = HttpApiGroup.make('assessmentFormula')
  .add(
    HttpApiEndpoint.get('listFormulaFunctions', '/assessment/formula-functions', {
      query: Schema.Struct({ ...pageQuery }),
      success: pageOf(functionView),
      error: [BadRequest, AccessDenied],
    }).middleware(Authenticated),
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
      error: [BadRequest, AccessDenied, FormulaOwnerNodeInvalid],
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
