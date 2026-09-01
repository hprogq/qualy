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

// One example's outcome, structured for a screen: the expectation and the
// answer side by side, and when a value never reached the formula, WHICH
// parameter refused and what the rule's own value was - the reason stays a
// machine key the client translates, the constraint is content.
const testProblem = Schema.Struct({
  at: Schema.Literals(['input', 'expected', 'output']),
  parameter: Schema.optional(Schema.String),
  reason: Schema.String,
  constraint: Schema.optional(Schema.String),
})

const testRow = Schema.Struct({
  name: Schema.String,
  passed: Schema.Boolean,
  expected: Schema.String,
  /** the amount the formula answered with, when it ran to an answer */
  actual: Schema.optional(Schema.String),
  problems: Schema.optional(Schema.Array(testProblem)),
  /** the formula's own q.fail wording, verbatim - the author wrote it */
  refusal: Schema.optional(Schema.String),
  /** an unexpected crash while running, as the engine reported it */
  defect: Schema.optional(Schema.String),
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

/**
 * The audience moved while somebody was editing it.
 *
 * Two screens open on the same version's sharing must not let the later
 * save silently swallow the earlier one - removing a unit and adding
 * another are both whole decisions, and last-write-wins turns one of them
 * into a mistake nobody made.
 */
export class FormulaSharingConflict extends Schema.TaggedError<FormulaSharingConflict>()(
  'ASSESSMENT_FORMULA_SHARING_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentFormulaSharingConflict' },
) {}

/**
 * There is no such template for this reader.
 *
 * One answer for every way a template can fail to be one: the version does
 * not exist, it was never offered, the offer does not reach where this
 * reader stands, or it is their own. Telling them apart would let anybody
 * holding a version id learn whether it exists, which is the one thing the
 * template surface must not leak.
 */
export class FormulaTemplateNotFound extends Schema.TaggedError<FormulaTemplateNotFound>()(
  'ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentFormulaTemplateNotFound' },
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
    reason: Schema.Literals(['triple-slash', 'import', 'suppression', 'any']),
    specifier: Schema.optional(Schema.String),
  },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaSourceRefused' },
) {}

export class FormulaTypecheckFailed extends Schema.TaggedError<FormulaTypecheckFailed>()(
  'ASSESSMENT_FORMULA_TYPECHECK_FAILED',
  { diagnostics: Schema.Array(diagnostic), truncated: Schema.Boolean },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaTypecheckFailed' },
) {}

export class FormulaBundleFailed extends Schema.TaggedError<FormulaBundleFailed>()(
  'ASSESSMENT_FORMULA_BUNDLE_FAILED',
  { message: Schema.String },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaBundleFailed' },
) {}

export class FormulaExecutionLimitExceeded extends Schema.TaggedError<FormulaExecutionLimitExceeded>()(
  'ASSESSMENT_FORMULA_EXECUTION_LIMIT_EXCEEDED',
  {
    phase: Schema.Literals(['typecheck', 'contract']),
    verdict: Schema.String,
  },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaExecutionLimitExceeded' },
) {}

export class FormulaContractInvalid extends Schema.TaggedError<FormulaContractInvalid>()(
  'ASSESSMENT_FORMULA_CONTRACT_INVALID',
  {
    issues: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
    /** the guest's own words when extraction itself threw - content, not copy */
    detail: Schema.optional(Schema.String),
  },
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
