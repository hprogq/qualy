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

/** a round with nobody in it has nothing to start */
export class BatchNoParticipants extends Schema.TaggedErrorClass<BatchNoParticipants>()(
  'ASSESSMENT_BATCH_NO_PARTICIPANTS',
  {},
  { httpApiStatus: 422, identifier: 'AssessmentBatchNoParticipants' },
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

/**
 * A batch access write the model will not take.
 *
 * Delegation is the reason most of these exist: somebody may only hand out
 * authority they hold themselves, over people they already administer, and
 * only capabilities a batch is allowed to carry at all.
 */
export class AccessInvalid extends Schema.TaggedErrorClass<AccessInvalid>()(
  'ASSESSMENT_ACCESS_INVALID',
  {
    reason: Schema.Literals([
      'source-not-found',
      'source-not-explicit',
      'role-not-usable',
      'permission-not-known',
      'permission-not-delegatable',
      'permission-not-held',
      'node-out-of-reach',
      'node-out-of-batch',
      'node-not-found',
      'user-not-found',
      'expiry-in-past',
      // nobody edits their own standing: an administrator who can withdraw
      // their own authority can lock themselves out of the batch they are
      // responsible for, and nobody is left to undo it
      'self-adjustment',
    ]),
  },
  { httpApiStatus: 422, identifier: 'AssessmentAccessInvalid' },
) {}

/** what a template write can be refused by, keyed by constraint name */
export const templateConstraints: Record<string, () => TemplateConflict> = {
  uq_phase_templates_tenant_name: () => new TemplateConflict(),
}

/**
 * And what a batch write can be refused by.
 *
 * Empty: the scope columns and the user-type join both went when the roster
 * became the batch's only population (§32.45), and a translator for a
 * constraint no table has is a translator nothing can reach. The map stays
 * because the write path names it, and because the next foreign key a batch
 * write can violate belongs here.
 */
export const batchConstraints: Record<string, () => BatchReferenceInvalid> = {}

export type CreateBatchError = BatchReferenceInvalid | AccessDenied
export type UpdateBatchError = BatchNotFound | BatchReadOnly | BatchReferenceInvalid | AccessDenied
export type SetBatchStatusError =
  BatchNotFound | BatchStatusInvalid | BatchNoParticipants | PlanInvalid | AccessDenied

/** reading or changing who may work on a batch */
export type BatchAccessError = BatchNotFound | AccessInvalid | AccessDenied

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
  BatchNotFound | BatchReadOnly | PhaseNotFound | PlanInvalid | BatchNoParticipants | AccessDenied
