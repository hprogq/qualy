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
  /**
   * an unexpected crash while running, as the engine reported it; or one of
   * the host's own verdicts, as a token from ../report-codes.ts
   */
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
 * A published version whose stored record cannot be run as it stands.
 *
 * Its artifact or its contract no longer matches the hashes it was frozen
 * with, or this build holds no evidence it executes that record faithfully.
 * The version can still be read; it cannot be tried. Which of those it was
 * goes to the log, not to the wire.
 */
export class FormulaVersionUnrunnable extends Schema.TaggedError<FormulaVersionUnrunnable>()(
  'ASSESSMENT_FORMULA_VERSION_UNRUNNABLE',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentFormulaVersionUnrunnable' },
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

/**
 * The draft revision asked for is not one this function has.
 */
export class FormulaDraftRevisionNotFound extends Schema.TaggedError<FormulaDraftRevisionNotFound>()(
  'ASSESSMENT_FORMULA_DRAFT_REVISION_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentFormulaDraftRevisionNotFound' },
) {}

/**
 * Another publication of this formula already carries the name.
 *
 * A publication is told apart by its name; two wearing one name leave the
 * reader nothing but the number the name was meant to replace.
 */
export class FormulaReleaseNameTaken extends Schema.TaggedError<FormulaReleaseNameTaken>()(
  'ASSESSMENT_FORMULA_RELEASE_NAME_TAKEN',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentFormulaReleaseNameTaken' },
) {}

/**
 * This draft is already published, exactly as it stands.
 *
 * Publication is idempotent over what a version executes, so the same source,
 * the same examples and the same toolchain answer with the version that
 * exists rather than minting a second one that scores identically. A retried
 * request is that answer; a deliberate press with a different name is this
 * refusal, because renaming a publication is its own act and a new version
 * claiming a rule changed when it did not is worse than being told no.
 */
export class FormulaVersionUnchanged extends Schema.TaggedError<FormulaVersionUnchanged>()(
  'ASSESSMENT_FORMULA_VERSION_UNCHANGED',
  { versionNo: Schema.Number, releaseName: Schema.NullOr(Schema.String) },
  { httpApiStatus: 409, identifier: 'AssessmentFormulaVersionUnchanged' },
) {}

/**
 * A version's name or notes moved while somebody was rewriting them.
 *
 * The same reason the audience has a token: two windows open on one
 * publication must not let the later save swallow the earlier one without
 * either author knowing.
 */
export class FormulaVersionInfoConflict extends Schema.TaggedError<FormulaVersionInfoConflict>()(
  'ASSESSMENT_FORMULA_VERSION_INFO_CONFLICT',
  { metadataRevision: Schema.Number },
  { httpApiStatus: 409, identifier: 'AssessmentFormulaVersionInfoConflict' },
) {}

/**
 * A formula's name or description moved while somebody was editing them.
 *
 * Its own refusal rather than a draft conflict, because they are its own
 * fact: renaming a formula publishes nothing and leaves the source and the
 * examples exactly where they were, so a draft revision has nothing to say
 * about whether a rename is stale.
 */
export class FormulaDetailsConflict extends Schema.TaggedError<FormulaDetailsConflict>()(
  'ASSESSMENT_FORMULA_DETAILS_CONFLICT',
  { detailsRevision: Schema.Number },
  { httpApiStatus: 409, identifier: 'AssessmentFormulaDetailsConflict' },
) {}

export class FormulaFunctionArchived extends Schema.TaggedError<FormulaFunctionArchived>()(
  'ASSESSMENT_FORMULA_FUNCTION_ARCHIVED',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentFormulaFunctionArchived' },
) {}

/**
 * A formula that has been published cannot be deleted.
 *
 * A publication is what questions are scored by and what other people may
 * have copied: once one exists, the formula's history is somebody else's
 * fact too, and taking it away is not the author's alone. Archiving is what
 * stops it being used from here on.
 */
export class FormulaFunctionPublished extends Schema.TaggedError<FormulaFunctionPublished>()(
  'ASSESSMENT_FORMULA_FUNCTION_PUBLISHED',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentFormulaFunctionPublished' },
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

/**
 * The examples are more than a draft may carry.
 *
 * Every saved state of a draft is kept whole, so what one save may hold is
 * what every revision after it may hold too. The source has had its ceiling
 * from the start; the examples are held to one of their own.
 */
export class FormulaTestsTooLarge extends Schema.TaggedError<FormulaTestsTooLarge>()(
  'ASSESSMENT_FORMULA_TESTS_TOO_LARGE',
  { limit: Schema.Number },
  { httpApiStatus: 422, identifier: 'AssessmentFormulaTestsTooLarge' },
) {}

/**
 * This person already has as much formula work under way as one person
 * gets at a time, or has saved faster than a draft may be saved.
 *
 * Nothing was done; the same request can simply be sent again shortly.
 */
export class FormulaAuthoringBusy extends Schema.TaggedError<FormulaAuthoringBusy>()(
  'ASSESSMENT_FORMULA_AUTHORING_BUSY',
  {},
  { httpApiStatus: 429, identifier: 'AssessmentFormulaAuthoringBusy' },
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
