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

/**
 * The material range cannot move where it was asked to, because entries
 * already in review or approved carry dates that would fall outside it. The
 * entries are named: shrinking the window means dealing with what is in it,
 * not silently making history illegal.
 */
export class MaterialRangeInvalid extends Schema.TaggedErrorClass<MaterialRangeInvalid>()(
  'ASSESSMENT_MATERIAL_RANGE_INVALID',
  {
    /** live entries whose payloads would fall outside the candidate window */
    entries: Schema.Array(Schema.Struct({ entryId: Schema.String, itemId: Schema.String })),
    /** items whose configuration itself cannot live inside it */
    items: Schema.Array(Schema.Struct({ itemId: Schema.String, reason: Schema.String })),
  },
  { httpApiStatus: 422, identifier: 'AssessmentMaterialRangeInvalid' },
) {}

export class EntryNotFound extends Schema.TaggedErrorClass<EntryNotFound>()(
  'ASSESSMENT_ENTRY_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentEntryNotFound' },
) {}

/**
 * The resource policy said no: the action names itself and a stable reason.
 *
 * Deliberately one code for the whole matrix rather than one per row - what
 * varies is the reason, and a screen renders reasons, not codes.
 */
export class EntryActionRefused extends Schema.TaggedErrorClass<EntryActionRefused>()(
  'ASSESSMENT_ENTRY_ACTION_REFUSED',
  { action: Schema.String, reason: Schema.String },
  { httpApiStatus: 403, identifier: 'AssessmentEntryActionRefused' },
) {}

/** the filing itself cannot be read: field problems, named one by one */
export class EntryPayloadInvalid extends Schema.TaggedErrorClass<EntryPayloadInvalid>()(
  'ASSESSMENT_ENTRY_PAYLOAD_INVALID',
  {
    issues: Schema.Array(Schema.Struct({ field: Schema.String, reason: Schema.String })),
  },
  { httpApiStatus: 422, identifier: 'AssessmentEntryPayloadInvalid' },
) {}

/** the item lifecycle said no: the action names itself and a stable reason */
export class ItemActionRefused extends Schema.TaggedErrorClass<ItemActionRefused>()(
  'ASSESSMENT_ITEM_ACTION_REFUSED',
  { action: Schema.String, reason: Schema.String },
  { httpApiStatus: 403, identifier: 'AssessmentItemActionRefused' },
) {}

/**
 * Nothing here for this reader: absent, in another tenant, or simply not
 * theirs to see - the refusal never says which.
 */
export class AttachmentUnavailable extends Schema.TaggedErrorClass<AttachmentUnavailable>()(
  'ASSESSMENT_ATTACHMENT_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentAttachmentUnavailable' },
) {}

export class ReviewNotFound extends Schema.TaggedErrorClass<ReviewNotFound>()(
  'ASSESSMENT_REVIEW_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentReviewNotFound' },
) {}

/**
 * The round closed under the caller's hands: another reviewer's decision or
 * the submitter's withdrawal got there first. Not a refusal - they were
 * allowed to act - and not a validation problem: there is simply no open
 * round left to close.
 */
export class ReviewConflict extends Schema.TaggedErrorClass<ReviewConflict>()(
  'ASSESSMENT_REVIEW_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'AssessmentReviewConflict' },
) {}

export class ItemNotFound extends Schema.TaggedErrorClass<ItemNotFound>()(
  'ASSESSMENT_ITEM_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'AssessmentItemNotFound' },
) {}

/**
 * A configuration that cannot be accepted, with every reason at once.
 *
 * Issues carry a path into the submitted config and a stable reason word;
 * the browser turns reasons into sentences. `incompatible-entry` is the one
 * that names rows: the new form cannot read an entry that is in review or
 * approved, and the way forward is void-and-replace, never a save that
 * strands what it governs.
 */
export class ItemConfigInvalid extends Schema.TaggedErrorClass<ItemConfigInvalid>()(
  'ASSESSMENT_ITEM_CONFIG_INVALID',
  {
    issues: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
  },
  { httpApiStatus: 422, identifier: 'AssessmentItemConfigInvalid' },
) {}

/**
 * A configuration that is fine in itself and would disturb work already
 * under way, handed back with what it would disturb (§32.62).
 *
 * Not a refusal: the save is waiting for an answer, not being turned down.
 * The counts come with a token for the state they were counted from, and
 * the answer is only executed if that state has not moved since - a dialog
 * is open for as long as somebody thinks, and reviewers keep working.
 */
export class ItemChangeDecisionRequired extends Schema.TaggedErrorClass<ItemChangeDecisionRequired>()(
  'ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED',
  {
    currentRevisionId: Schema.NullOr(Schema.String),
    impactToken: Schema.String,
    form: Schema.Struct({
      changed: Schema.Boolean,
      inReview: Schema.Struct({ total: Schema.Number, incompatible: Schema.Number }),
      approved: Schema.Struct({ total: Schema.Number, incompatible: Schema.Number }),
    }),
    review: Schema.Struct({
      changed: Schema.Boolean,
      open: Schema.Number,
      blocked: Schema.Number,
      sameStageMappable: Schema.Number,
      stageRemoved: Schema.Number,
      /** mappable rounds whose walked-so-far differs under the new policy */
      pastChanged: Schema.Number,
    }),
  },
  { httpApiStatus: 409, identifier: 'AssessmentItemChangeDecisionRequired' },
) {}

/** a score-tree write that cannot be accepted, row by row */
export class ScoreGroupInvalid extends Schema.TaggedErrorClass<ScoreGroupInvalid>()(
  'ASSESSMENT_SCORE_GROUP_INVALID',
  {
    refusals: Schema.Array(
      Schema.Struct({
        reason: Schema.String,
        groupId: Schema.NullOr(Schema.String),
        index: Schema.optional(Schema.Number),
      }),
    ),
  },
  { httpApiStatus: 422, identifier: 'AssessmentScoreGroupInvalid' },
) {}

/**
 * The tree changed since the caller read it.
 *
 * A save sends every group, so omission is how it removes one: applied on top
 * of somebody else's save it would delete what that save added. The current
 * version travels with the refusal so a client can re-read and retry rather
 * than guess.
 */
export class ScoreGroupVersionConflict extends Schema.TaggedErrorClass<ScoreGroupVersionConflict>()(
  'ASSESSMENT_SCORE_GROUP_VERSION_CONFLICT',
  { currentVersion: Schema.Number },
  { httpApiStatus: 409, identifier: 'AssessmentScoreGroupVersionConflict' },
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
export type UpdateBatchError =
  BatchNotFound | BatchReadOnly | BatchReferenceInvalid | MaterialRangeInvalid | AccessDenied
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
