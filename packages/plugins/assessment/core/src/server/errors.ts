import { Schema } from 'effect'
import type { AccessDenied } from '@qualy/rbac-contract/effect'

// The ways the assessment api can refuse, in their own module below both the
// group that declares them and the layer that raises them. Codes are the
// stable wire contract; payloads carry only what a client may see - refusal
// reason enums and phase ids, never constraint names or sql details.

export class BatchNotFound extends Schema.TaggedErrorClass<BatchNotFound>()(
  'ASSESSMENT_BATCH_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentBatchNotFound' },
) {}

export class PhaseNotFound extends Schema.TaggedErrorClass<PhaseNotFound>()(
  'ASSESSMENT_PHASE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentPhaseNotFound' },
) {}

export class ParticipantNotFound extends Schema.TaggedErrorClass<ParticipantNotFound>()(
  'ASSESSMENT_PARTICIPANT_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentParticipantNotFound' },
) {}

/**
 * What a roster action can be refused for. Out-of-scope inclusion is refused
 * outright rather than warned about: manual inclusion beyond the scope is a
 * deferred capability (§27), not a loophole.
 */
export class ParticipantInvalid extends Schema.TaggedErrorClass<ParticipantInvalid>()(
  'ASSESSMENT_PARTICIPANT_INVALID',
  {
    reason: Schema.Literals([
      'batch-not-active',
      'user-not-found',
      'user-not-eligible',
      'user-out-of-scope',
      'already-included',
      'participant-not-active',
    ]),
  },
  { httpApiStatus: 422, identifier: 'AssessmentParticipantInvalid' },
) {}

export class TemplateNotFound extends Schema.TaggedErrorClass<TemplateNotFound>()(
  'ASSESSMENT_TEMPLATE_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentTemplateNotFound' },
) {}

export class TemplateConflict extends Schema.TaggedErrorClass<TemplateConflict>()(
  'ASSESSMENT_TEMPLATE_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentTemplateConflict' },
) {}

/** an archived batch answers reads and refuses every write */
export class BatchReadOnly extends Schema.TaggedErrorClass<BatchReadOnly>()(
  'ASSESSMENT_BATCH_READ_ONLY',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentBatchReadOnly' },
) {}

/** once a roster exists, where the batch points is not an ordinary field */
export class BatchScopeLocked extends Schema.TaggedErrorClass<BatchScopeLocked>()(
  'ASSESSMENT_BATCH_SCOPE_LOCKED',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentBatchScopeLocked' },
) {}

/**
 * A lifecycle move the batch is not in a position to make.
 *
 * `refusal` says which rule stood in the way, because the screen has a
 * different sentence for each: a batch cannot be archived before it has
 * reached its last phase, cannot be reopened without saying why, and cannot
 * be deleted once it has run.
 */
export class BatchStatusInvalid extends Schema.TaggedErrorClass<BatchStatusInvalid>()(
  'ASSESSMENT_BATCH_STATUS_INVALID',
  {
    from: Schema.String,
    to: Schema.String,
    refusal: Schema.optional(
      Schema.Literals([
        'wrong-status',
        'last-phase-not-entered',
        'reason-required',
        'phase-required',
        'already-started',
      ]),
    ),
  },
  { httpApiStatus: 409, identifier: 'AssessmentBatchStatusInvalid' },
) {}

/** a batch that can enroll nobody is a configuration mistake, not a roster */
export class BatchNoUserTypes extends Schema.TaggedErrorClass<BatchNoUserTypes>()(
  'ASSESSMENT_BATCH_NO_USER_TYPES',
  {},
  { httpApiStatus: 422, identifier: 'AssessmentBatchNoUserTypes' },
) {}

/** what a batch's references can be refused for: a named node or type that
 * does not exist here, an empty scope, or a nested selection (an ancestor
 * and its descendant both named - union semantics make it harmless, and
 * precisely therefore confusing, so it is refused outright) */
export class BatchReferenceInvalid extends Schema.TaggedErrorClass<BatchReferenceInvalid>()(
  'ASSESSMENT_BATCH_REFERENCE_INVALID',
  { reference: Schema.Literals(['scope-node', 'user-type', 'scope-empty', 'scope-nested']) },
  { httpApiStatus: 422, identifier: 'AssessmentBatchReferenceInvalid' },
) {}

/**
 * A plan edit the engine refused, verdicts attached. The reasons are the
 * engine's own enum; the ui explains each one, which is why this carries the
 * structured list rather than a sentence.
 */
export class PlanInvalid extends Schema.TaggedErrorClass<PlanInvalid>()(
  'ASSESSMENT_PLAN_INVALID',
  {
    refusals: Schema.Array(
      Schema.Struct({
        reason: Schema.String,
        phaseId: Schema.NullOr(Schema.String),
        blockingPhaseId: Schema.optional(Schema.String),
        code: Schema.optional(Schema.String),
        index: Schema.optional(Schema.Number),
      }),
    ),
  },
  { httpApiStatus: 422, identifier: 'AssessmentPlanInvalid' },
) {}

export class AdvanceInvalid extends Schema.TaggedErrorClass<AdvanceInvalid>()(
  'ASSESSMENT_ADVANCE_INVALID',
  {
    reason: Schema.Literals([
      'batch-not-active',
      'target-not-next',
      'force-required',
      'reason-required',
      // a publication boundary enters when its publication becomes effective,
      // and through nothing else; force is not a way around that invariant
      'publication-boundary',
    ]),
  },
  { httpApiStatus: 422, identifier: 'AssessmentAdvanceInvalid' },
) {}

/** what a template write can be refused by, keyed by constraint name */
export const templateConstraints: Record<string, () => TemplateConflict> = {
  uq_phase_templates_tenant_name: () => new TemplateConflict(),
}

/** and what a batch write can be refused by */
export const batchConstraints: Record<string, () => BatchReferenceInvalid> = {
  fk_assessment_batches_scope_node: () => new BatchReferenceInvalid({ reference: 'scope-node' }),
  fk_batch_user_types_type: () => new BatchReferenceInvalid({ reference: 'user-type' }),
}

export type CreateBatchError = BatchReferenceInvalid | AccessDenied
export type UpdateBatchError =
  BatchNotFound | BatchReadOnly | BatchScopeLocked | BatchReferenceInvalid | AccessDenied
export type SetBatchStatusError =
  BatchNotFound | BatchStatusInvalid | BatchNoUserTypes | PlanInvalid | AccessDenied

/** removing a draft that never ran; anything else is archived, not deleted */
export type DeleteBatchError = BatchNotFound | BatchStatusInvalid | AccessDenied
export type ReplacePlanError =
  BatchNotFound | BatchReadOnly | TemplateNotFound | PlanInvalid | AccessDenied
export type AdvancePhaseError = BatchNotFound | PhaseNotFound | AdvanceInvalid | AccessDenied

/**
 * Committing or withdrawing a phase's time; the plan's shape decides.
 *
 * The first commitment is also where a batch starts running, so it can be
 * refused for the reasons starting one used to be: nobody to enroll, or no
 * plan to run.
 */
export type SchedulePhaseError =
  BatchNotFound | BatchReadOnly | PhaseNotFound | PlanInvalid | BatchNoUserTypes | AccessDenied
