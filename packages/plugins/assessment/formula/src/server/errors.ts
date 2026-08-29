import { Schema } from 'effect'

// The library's wire errors. Diagnostics and reports ride in structured,
// safe `data`: compiler rows are content for the author's screen, never a
// translated message, and nothing here carries SQL, constraint names or
// another tenant's facts.

const diagnostic = Schema.Struct({
  line: Schema.Number,
  column: Schema.Number,
  code: Schema.String,
  message: Schema.String,
})

const testRow = Schema.Struct({
  name: Schema.String,
  passed: Schema.Boolean,
  /** what came back when it did not pass: an amount, a refusal or a defect */
  actual: Schema.optional(Schema.String),
  failure: Schema.optional(Schema.String),
})

export class FormulaFunctionNotFound extends Schema.TaggedError<FormulaFunctionNotFound>()(
  'ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentFormulaFunctionNotFound' },
) {}

export class FormulaVersionNotFound extends Schema.TaggedError<FormulaVersionNotFound>()(
  'ASSESSMENT_FORMULA_VERSION_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentFormulaVersionNotFound' },
) {}

export class FormulaOwnerNodeInvalid extends Schema.TaggedError<FormulaOwnerNodeInvalid>()(
  'ASSESSMENT_FORMULA_OWNER_NODE_INVALID',
  {},
  { httpApiStatus: 422, identifier: 'AssessmentFormulaOwnerNodeInvalid' },
) {}

export class FormulaFunctionArchived extends Schema.TaggedError<FormulaFunctionArchived>()(
  'ASSESSMENT_FORMULA_FUNCTION_ARCHIVED',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentFormulaFunctionArchived' },
) {}

export class FormulaDraftConflict extends Schema.TaggedError<FormulaDraftConflict>()(
  'ASSESSMENT_FORMULA_DRAFT_CONFLICT',
  { draftRevision: Schema.Number },
  { httpApiStatus: 409, identifier: 'AssessmentFormulaDraftConflict' },
) {}

export class FormulaSourceTooLarge extends Schema.TaggedError<FormulaSourceTooLarge>()(
  'ASSESSMENT_FORMULA_SOURCE_TOO_LARGE',
  { limit: Schema.Number },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaSourceTooLarge' },
) {}

export class FormulaSourceRefused extends Schema.TaggedError<FormulaSourceRefused>()(
  'ASSESSMENT_FORMULA_SOURCE_REFUSED',
  {
    reason: Schema.Literals(['triple-slash', 'import']),
    specifier: Schema.optional(Schema.String),
  },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaSourceRefused' },
) {}

export class FormulaTypecheckFailed extends Schema.TaggedError<FormulaTypecheckFailed>()(
  'ASSESSMENT_FORMULA_TYPECHECK_FAILED',
  { diagnostics: Schema.Array(diagnostic) },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaTypecheckFailed' },
) {}

export class FormulaContractInvalid extends Schema.TaggedError<FormulaContractInvalid>()(
  'ASSESSMENT_FORMULA_CONTRACT_INVALID',
  { issues: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })) },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaContractInvalid' },
) {}

export class FormulaTestFailed extends Schema.TaggedError<FormulaTestFailed>()(
  'ASSESSMENT_FORMULA_TEST_FAILED',
  { report: Schema.Array(testRow) },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaTestFailed' },
) {}

export class FormulaCompileUnavailable extends Schema.TaggedError<FormulaCompileUnavailable>()(
  'ASSESSMENT_FORMULA_COMPILE_UNAVAILABLE',
  {},
  { httpApiStatus: 503, identifier: 'AssessmentFormulaCompileUnavailable' },
) {}
