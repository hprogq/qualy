import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import {
  BadRequest,
  boundedText,
  changed,
  expectedVersion,
  kebabCode,
  pageQuery,
  countedPageOf,
  pageOf,
  trimmedName,
} from '@qualy/api-kit/schema'
import { Authenticated } from '@qualy/plugin-auth/server/session-contract'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import {
  AccessInvalid,
  AdvanceInvalid,
  EntryActionRefused,
  EntryNotFound,
  EntryPayloadInvalid,
  ItemActionRefused,
  ItemChangeDecisionRequired,
  ItemConfigInvalid,
  ItemNotFound,
  MaterialRangeInvalid,
  ScoreGroupInvalid,
  ScoreGroupVersionConflict,
  BatchNoParticipants,
  BatchNotFound,
  ParticipantInvalid,
  ParticipantNotFound,
  AttachmentUnavailable,
  ReviewConflict,
  ReviewNotFound,
  BatchReadOnly,
  BatchReferenceInvalid,
  BatchStatusInvalid,
  PhaseNotFound,
  PlanInvalid,
  TemplateConflict,
  TemplateNotFound,
} from './server/errors.ts'

// The assessment endpoints, as definitions only: batches, the phase plan and
// its advancement, the derived timeline, and the tenant's phase templates.
// Paths are frozen (tools/tests/support/frozen-routes.ts) and follow the api
// discipline: product-domain first segment, nouns, no action segments, state
// as an idempotent subresource PUT.

const id = Schema.String.check(Schema.isUUID())

/** an instant on the wire; the service parses it and refuses the unreadable */
const isoInstant = Schema.String.check(Schema.isMaxLength(64))
/**
 * A calendar date, as the half-open material range states its bounds.
 *
 * The shape is not enough: `2026-02-31` matches it and is not a day. Left to
 * the pattern alone it travelled all the way to postgres, which refused it as
 * a database fault - a 500 for what is plainly a bad request. Checked by
 * round trip, because that is what "this date exists" means.
 */
const isRealDate = (value: string) => {
  const at = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value
}

export const isoDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value: string) => isRealDate(value) || 'must be a real calendar date'),
)

const materialRange = Schema.Struct({ start: isoDate, end: isoDate })

/**
 * The labels a reviewer picks a reason from, one list per act. Configured on
 * the batch; the chosen label is copied onto the review event, so these
 * lists are offer, not history.
 */
const actionAvailability = Schema.Struct({
  state: Schema.Literals(['available', 'blocked', 'hidden']),
  reason: Schema.NullOr(Schema.String),
})

const reviewReasons = Schema.Struct({
  reject: Schema.Array(Schema.String),
  escalate: Schema.Array(Schema.String),
})

const batchStatus = Schema.Literals(['draft', 'active', 'archived'])

/** where a batch has got to, as a list draws it: one line per stage */
const batchTimelineEntry = Schema.Struct({
  phaseId: Schema.String,
  displayName: Schema.String,
  status: Schema.Literals(['ended', 'current', 'future']),
  entry: Schema.Struct({
    kind: Schema.Literals(['entered', 'planned', 'pending']),
    at: Schema.NullOr(Schema.String),
  }),
})

// What a batch is to whoever is looking at it.
//
// Which organizational units it was drawn from is not here. It is a
// configuration decision, it names parts of the tree the reader may have no
// business knowing, and no screen needs it to say what this round is or where
// it has got to - the picker that chose them works from the options endpoint,
// not from the batch.
const batchFields = {
  id: Schema.String,
  name: Schema.String,
  descriptionMd: Schema.NullOr(Schema.String),
  participantCount: Schema.Number,
  materialRange,
  timezone: Schema.String,
  status: batchStatus,
  configRevision: Schema.Number,
  currentPhaseId: Schema.NullOr(Schema.String),
  currentPhaseName: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  /** whether this reader may change the batch, rather than only read it */
  manageable: Schema.Boolean,
}

/**
 * A batch as the list draws it. It carries the whole (small) timeline because
 * the list's job is to say where each batch has got to, and a card that only
 * knows the current stage's name cannot draw the run of them.
 */
const batchListView = Schema.Struct({
  ...batchFields,
  timeline: Schema.Array(batchTimelineEntry),
})

/**
 * One batch on its own; its plan and its people are their own requests.
 *
 * `capabilities` is who the reader is in this round - the standing the
 * workspace navigation filters by. Coarse on purpose, and free of the phase
 * gate: being a reviewer here does not come and go with the calendar.
 */
const batchView = Schema.Struct({
  ...batchFields,
  reviewReasons,
  capabilities: Schema.Struct({
    personal: Schema.Boolean,
    review: Schema.Boolean,
    record: Schema.Boolean,
    manage: Schema.Boolean,
  }),
})

const phaseView = Schema.Struct({
  id: Schema.String,
  ordinal: Schema.Number,
  phaseKey: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
  entryNote: Schema.String,
  plannedEntryAt: Schema.NullOr(Schema.String),
  actualEntryAt: Schema.NullOr(Schema.String),
  permissionProfile: Schema.Array(Schema.String),
  itemScope: Schema.Array(Schema.String),
  participantScope: Schema.Array(Schema.String),
  sourceTemplateId: Schema.NullOr(Schema.String),
  sourceTemplateVersion: Schema.NullOr(Schema.Number),
})

/**
 * One phase as a plan write states it: with an id it replaces that phase's
 * editable fields, without one it is an insertion at its position. Times are
 * deliberately absent - a plan write states structure, and when each phase
 * begins is committed one phase at a time through schedulePhase. The two
 * scopes are the supplementary-phase allowances; empty or absent means
 * unrestricted.
 */
const phaseSpec = Schema.Struct({
  id: Schema.optional(id),
  phaseKey: kebabCode,
  displayName: trimmedName(100),
  description: Schema.optional(boundedText(500)),
  /** what the phase is waiting for, while it has no time of its own */
  entryNote: Schema.optional(boundedText(200)),
  permissionProfile: Schema.optional(Schema.Array(Schema.String)),
  itemScope: Schema.optional(Schema.Array(id)),
  participantScope: Schema.optional(Schema.Array(id)),
})

const planWarning = Schema.Struct({
  reason: Schema.String,
  phaseId: Schema.NullOr(Schema.String),
  index: Schema.optional(Schema.Number),
})

// The plan as a reader sees it. No phaseKey: `stage-7` is the plan's internal
// handle for a row, meaningless to anybody reading a timeline, and a field
// nothing uses is a field somebody eventually starts depending on.
const timelineEntry = Schema.Struct({
  phaseId: Schema.String,
  displayName: Schema.String,
  /** why it has no time yet, in the words of whoever arranged the round */
  entryNote: Schema.String,
  status: Schema.Literals(['ended', 'current', 'future']),
  description: Schema.String,
  entry: Schema.Struct({
    kind: Schema.Literals(['entered', 'planned', 'pending']),
    at: Schema.NullOr(Schema.String),
  }),
})

const lineageStep = Schema.Struct({ nodeId: Schema.String, nodeTypeId: Schema.String })

const participantView = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  displayName: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  userTypeId: Schema.String,
  anchorNodeId: Schema.String,
  anchorPath: Schema.String,
  anchorLineage: Schema.Array(lineageStep),
  status: Schema.Literals(['active', 'excluded']),
  includedAt: Schema.String,
  excludedAt: Schema.NullOr(Schema.String),
})

/**
 * The degraded chain preview (real review policies wire in later): for each level
 * of the lineage being frozen, how many people hold any role anchored
 * exactly there. Zero is the number an administrator wants shouted.
 */
const chainPreview = Schema.Array(
  Schema.Struct({
    nodeId: Schema.String,
    nodeTypeId: Schema.String,
    holders: Schema.Number,
  }),
)

/** one accepted assignment, as the access page reads it */
const accessSourceView = Schema.Struct({
  sourceId: Schema.String,
  assignmentId: Schema.String,
  roleId: Schema.String,
  roleName: Schema.String,
  origin: Schema.Literals(['inherited', 'explicit']),
  orgNodeId: Schema.NullOr(Schema.String),
  coverage: Schema.NullOr(Schema.Literals(['self', 'subtree'])),
  accepted: Schema.Array(Schema.String),
  current: Schema.Array(Schema.String),
  active: Schema.Boolean,
})

const accessSubjectView = Schema.Struct({
  userId: Schema.String,
  displayName: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  sources: Schema.Array(accessSourceView),
  denied: Schema.Array(Schema.String),
  effective: Schema.Array(Schema.String),
  /** whether this caller may change this person's standing in the batch */
  manageable: Schema.Boolean,
})

/**
 * One difference between the organization and this batch.
 *
 * A single row type rather than three lists: the screen offers them for
 * selection one by one, and a page has to be able to end in the middle of a
 * kind. `id` is what accepting names - the assignment for a new grant, the
 * accepted source for a widening.
 */
const accessChangeView = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['new', 'widened', 'lapsed']),
  userId: Schema.String,
  displayName: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  roleName: Schema.String,
  permissions: Schema.Array(Schema.String),
})

const accessSyncPageView = Schema.Struct({
  items: Schema.Array(accessChangeView),
  nextCursor: Schema.NullOr(Schema.String),
  // both totals in the first answer: the page that asks whether anything
  // changed must not have to fetch every change to find out
  pendingTotal: Schema.Number,
  lapsedTotal: Schema.Number,
})

/**
 * A repeated query parameter, which is a list only when it repeats.
 *
 * `?a=1&a=2` arrives as an array and `?a=1` as a string - that is what
 * UrlParams.toRecord builds (repos/effect/packages/effect/src/unstable/http/
 * UrlParams.ts). A schema asking for an array therefore refused every request
 * that named exactly one thing, which is most of them.
 */
export const idList = Schema.Union([Schema.Array(id), id])

/** the query one import runs: units to look under, and which kinds of people */
const importSelection = Schema.Struct({
  orgNodeIds: Schema.Array(id),
  userTypeIds: Schema.Array(id),
})

const templateKind = Schema.Literals(['timeline', 'phase'])

const templateView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: templateKind,
  version: Schema.Number,
  phases: Schema.Array(phaseSpec),
})

/** a driver id: lowercase words joined by dots or dashes */
const itemTypeCode = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  Schema.isMaxLength(63),
)

/**
 * A signed amount as text; scoring never sees a JSON float.
 *
 * The integer part is bounded to what the numeric(12,4) column holds, so an
 * absurd magnitude is a 400 here rather than a database fault downstream.
 */
const decimalAmount = Schema.String.check(Schema.isPattern(/^-?\d{1,8}(?:\.\d{1,4})?$/))

/** validated jsonb, carried opaquely: the driver is the schema's owner */
const configJson = Schema.Unknown

const itemRevisionView = Schema.Struct({
  id: Schema.String,
  revisionNo: Schema.Number,
  entrySource: Schema.Literals(['student', 'administrative']),
  formConfig: configJson,
  scoringConfig: configJson,
  reviewPolicy: configJson,
  displayConfig: configJson,
  reason: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
})

const itemView = Schema.Struct({
  id: Schema.String,
  batchId: Schema.String,
  itemType: Schema.String,
  title: Schema.String,
  scoreGroupId: Schema.String,
  maxEntries: Schema.NullOr(Schema.Number),
  sortOrder: Schema.Number,
  status: Schema.Literals(['draft', 'active', 'voided']),
  currentRevision: Schema.NullOr(itemRevisionView),
  createdAt: Schema.String,
})

const scoreGroupView = Schema.Struct({
  id: Schema.String,
  /** the group this one adds up into; null is a top-level group */
  parentGroupId: Schema.NullOr(Schema.String),
  name: Schema.String,
  cap: Schema.NullOr(Schema.String),
  floor: Schema.NullOr(Schema.String),
  sortOrder: Schema.Number,
  itemCount: Schema.Number,
})

/**
 * An administrator's answer to an impact report.
 *
 * Two separate choices on purpose: what happens to the answers already
 * filed, and what happens to the reviews already running. Merged into one
 * "apply the new configuration" they would force a guess on whichever the
 * administrator did not mean.
 */
const changeEffects = Schema.Struct({
  /** the state the report was drawn from; a stale one is refused */
  impactToken: Schema.String,
  form: Schema.optional(
    Schema.Struct({
      inReview: Schema.Literals(['keep', 'return']),
      approved: Schema.Literals(['keep', 'return']),
    }),
  ),
  review: Schema.optional(
    Schema.Struct({
      open: Schema.Literals(['keep', 'reroute-blocked', 'reroute-all']),
      /** a round whose current step the new policy no longer has */
      missingCurrentStage: Schema.Literals(['refuse', 'restart-route']),
    }),
  ),
})

const itemConfigPayload = Schema.Struct({
  entrySource: Schema.Literals(['student', 'administrative']),
  formConfig: configJson,
  scoringConfig: configJson,
  reviewPolicy: configJson,
  displayConfig: Schema.optional(configJson),
})

// bounded to the int4 columns they land in, for the same reason as amounts
const positiveCount = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(2_147_483_647),
)
const sortOrder = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(-2_147_483_648),
  Schema.isLessThanOrEqualTo(2_147_483_647),
)

const scoreGroupSpec = Schema.Struct({
  id: Schema.optional(id),
  /**
   * The group this one adds up into; null is top level.
   *
   * Stated rather than optional: a payload that left it out moved every group
   * it named to the top, so forgetting the field flattened the tree.
   */
  parentGroupId: Schema.NullOr(id),
  name: trimmedName(255),
  /**
   * Stated for the same reason as the parent: a set replacement reads an
   * absent limit as no limit, so leaving these out lifted every ceiling it
   * touched. Null is the way to say a group has none.
   */
  cap: Schema.NullOr(decimalAmount),
  floor: Schema.NullOr(decimalAmount),
  sortOrder: Schema.optional(sortOrder),
})

const entryRevisionView = Schema.Struct({
  id: Schema.String,
  revisionNo: Schema.Number,
  itemRevisionId: Schema.String,
  payload: configJson,
  note: Schema.NullOr(Schema.String),
  source: Schema.String,
  actorId: Schema.String,
  subjectId: Schema.String,
  attachments: Schema.Array(
    Schema.Struct({ attachmentId: Schema.String, position: Schema.Number }),
  ),
  createdAt: Schema.String,
})

const entryView = Schema.Struct({
  id: Schema.String,
  batchId: Schema.String,
  itemId: Schema.String,
  participantId: Schema.String,
  status: Schema.Literals([
    'draft',
    'in_review',
    /** sent back for more, which is not a rejection (§32.62) */
    'needs_revision',
    'approved',
    'rejected',
    'voided',
  ]),
  source: Schema.Literals(['self', 'proxy', 'record', 'import', 'system']),
  currentRevision: Schema.NullOr(entryRevisionView),
  currentReviewInstanceId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  /**
   * Each act in one of three states: offered, offered disabled with the
   * reason on hover, or not spoken of. Discovery through the same gate the
   * act itself answers to, so an enabled button is a call that goes through.
   */
  capabilities: Schema.Struct({
    edit: actionAvailability,
    submit: actionAvailability,
    withdraw: actionAvailability,
    appeal: actionAvailability,
    abandon: actionAvailability,
  }),
})

const reviewInboxItem = Schema.Struct({
  instanceId: Schema.String,
  entryId: Schema.String,
  batchId: Schema.String,
  batchName: Schema.String,
  itemId: Schema.String,
  itemTitle: Schema.String,
  participantName: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  /** the unit the participant stands in, for grouping and the unit filter */
  unitId: Schema.NullOr(Schema.String),
  unitName: Schema.NullOr(Schema.String),
  roundNo: Schema.Number,
  route: Schema.Literals(['normal', 'escalation']),
  /**
   * The filing itself, projected: the judged revision's own answers under
   * the question's real field labels, never a written summary. Attachment
   * fields stay out - the count stands in for them.
   */
  values: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
  attachmentCount: Schema.Number,
  submittedAt: Schema.String,
})

/** one step of a route, named by the id it keeps across policy edits */
const reviewStageView = Schema.Struct({
  id: Schema.String,
  index: Schema.Number,
  nodeName: Schema.NullOr(Schema.String),
  roleNames: Schema.Array(Schema.String),
  /** who holds those roles there today; null when this response left it unresolved */
  reviewers: Schema.NullOr(Schema.Array(Schema.String)),
  skipped: Schema.NullOr(Schema.String),
})

const reviewDetailView = Schema.Struct({
  id: Schema.String,
  state: Schema.Literals(['active', 'blocked', 'completed']),
  outcome: Schema.NullOr(Schema.String),
  roundNo: Schema.Number,
  entryId: Schema.String,
  batchId: Schema.String,
  itemId: Schema.String,
  itemTitle: Schema.String,
  participantName: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  unitName: Schema.NullOr(Schema.String),
  submittedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  /** exactly what is being judged: the revision the round froze, not the entry's latest */
  revision: Schema.Struct({
    revisionNo: Schema.Number,
    payload: configJson,
    note: Schema.NullOr(Schema.String),
    attachments: Schema.Array(
      Schema.Struct({ attachmentId: Schema.String, position: Schema.Number }),
    ),
  }),
  form: Schema.Struct({ itemType: Schema.String, formConfig: configJson }),
  /**
   * What stands around the judged filing: the question's own numbers, the
   * participant's other claims on it, and the previous round's conclusion
   * when there was one. Loaded for a page read; a decision response leaves
   * it null rather than paying for it inside the batch lock.
   */
  context: Schema.NullOr(
    Schema.Struct({
      worth: Schema.Struct({
        /** what one approved entry counts, when the question is a fixed amount */
        each: Schema.NullOr(Schema.String),
        maxEntries: Schema.NullOr(Schema.Number),
        groupName: Schema.NullOr(Schema.String),
        groupCap: Schema.NullOr(Schema.String),
        materialRange,
      }),
      /** every claim this participant has on this question, this one included */
      siblings: Schema.Array(
        Schema.Struct({
          entryId: Schema.String,
          /** its own answers, for reading one against another */
          values: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
          status: Schema.String,
          current: Schema.Boolean,
        }),
      ),
      /** how the previous round ended, shown so a resubmission is read against it */
      previous: Schema.NullOr(
        Schema.Struct({
          kind: Schema.String,
          reason: Schema.NullOr(Schema.String),
          comment: Schema.NullOr(Schema.String),
          actorName: Schema.NullOr(Schema.String),
          at: Schema.String,
        }),
      ),
    }),
  ),
  /** where the round stands, and what both routes are */
  chain: Schema.Struct({
    route: Schema.Literals(['normal', 'escalation']),
    stageId: Schema.String,
    normal: Schema.Array(reviewStageView),
    escalation: Schema.Array(reviewStageView),
    /** what this reader may say here, already narrowed by route and position */
    decisions: Schema.Array(Schema.String),
  }),
  events: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      actorId: Schema.NullOr(Schema.String),
      actorName: Schema.NullOr(Schema.String),
      reason: Schema.NullOr(Schema.String),
      comment: Schema.NullOr(Schema.String),
      suggestedPayload: configJson,
      at: Schema.String,
    }),
  ),
  capabilities: Schema.Struct({ canDecide: Schema.Boolean }),
})

const breakdownLine = Schema.Struct({
  lineId: Schema.String,
  kind: Schema.Literals([
    'entry',
    'entry-not-counted',
    'excluded-evidence',
    'item-voided',
    'group-adjustment',
  ]),
  label: Schema.String,
  value: Schema.String,
  itemId: Schema.optional(Schema.String),
  provenance: Schema.optional(
    Schema.Struct({
      entryId: Schema.optional(Schema.String),
      entryRevisionId: Schema.optional(Schema.String),
      calculatorRef: Schema.optional(Schema.String),
    }),
  ),
})

const myResultView = Schema.Struct({
  /** always provisional in M2; publication modes arrive with publication */
  mode: Schema.Literals(['provisional']),
  total: Schema.String,
  // flat with a parent id rather than nested: the tree is one line of client
  // code to rebuild, and a recursive wire schema is not
  groups: Schema.Array(
    Schema.Struct({
      groupId: Schema.String,
      parentGroupId: Schema.NullOr(Schema.String),
      depth: Schema.Number,
      name: Schema.String,
      itemsTotal: Schema.String,
      childrenTotal: Schema.String,
      raw: Schema.String,
      final: Schema.String,
      cap: Schema.NullOr(Schema.String),
      floor: Schema.NullOr(Schema.String),
    }),
  ),
  lines: Schema.Array(breakdownLine),
})

export const assessmentApiGroup = HttpApiGroup.make('assessment')
  .add(
    // the rounds nobody can act on: an appointment away from moving again
    HttpApiEndpoint.get('reviewAlerts', '/assessment/batches/:batchId/review-alerts', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({
        groups: Schema.Array(
          Schema.Struct({
            nodeId: Schema.String,
            nodeName: Schema.String,
            roleNames: Schema.Array(Schema.String),
            waiting: Schema.Number,
          }),
        ),
      }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // whether a review stage as composed has anybody in it, unit by unit
    HttpApiEndpoint.get('reviewCoverage', '/assessment/batches/:batchId/review-coverage', {
      params: Schema.Struct({ batchId: id }),
      query: Schema.Struct({ nodeTypeId: id, roleIds: idList }),
      success: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            reviewers: Schema.Number,
          }),
        ),
      }),
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // what a question's configuration may point at, for whoever runs the round
    HttpApiEndpoint.get('itemOptions', '/assessment/batches/:batchId/item-options', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({
        orgTypes: Schema.Array(
          Schema.Struct({ id: Schema.String, code: Schema.String, name: Schema.String }),
        ),
        roles: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
      }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // gone without ceremony: only for questions nothing ever happened to
    HttpApiEndpoint.delete('deleteItem', '/assessment/items/:itemId', {
      params: Schema.Struct({ itemId: id }),
      success: Schema.Struct({}),
      error: [ItemNotFound, BatchReadOnly, ItemActionRefused, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // voiding keeps every record and stops the counting; restoring reopens
    // the question for new work and revives nothing. Putting a question on
    // the round answers for its configuration too, so it refuses the way a
    // save of that configuration would
    HttpApiEndpoint.put('setItemStatus', '/assessment/items/:itemId/status', {
      params: Schema.Struct({ itemId: id }),
      payload: Schema.Union([
        Schema.Struct({ status: Schema.Literals(['voided']), reason: boundedText(500) }),
        Schema.Struct({ status: Schema.Literals(['active']) }),
      ]),
      success: Schema.Struct({ item: itemView }),
      error: [
        ItemNotFound,
        BatchReadOnly,
        ItemActionRefused,
        ItemConfigInvalid,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // the caller's own standing in the round, computed on request by the
    // one scorer; never anybody else's through this path
    HttpApiEndpoint.get('getMyResult', '/assessment/batches/:batchId/my-result', {
      params: Schema.Struct({ batchId: id }),
      success: myResultView,
      error: [BatchNotFound, ParticipantNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the caller's own queue; there is nothing here to name or filter by
    // another person, so the path carries no batch and no user
    HttpApiEndpoint.get('listReviewInbox', '/assessment/review/inbox', {
      query: Schema.Struct({
        ...pageQuery,
        /** narrow the queue to one batch; the workbench always asks this way */
        batchId: Schema.optional(id),
      }),
      success: Schema.Struct({
        items: Schema.Array(reviewInboxItem),
        nextCursor: Schema.NullOr(Schema.String),
        /**
         * Decisions this reader recorded today, on the batch's own calendar.
         * Zero when the queue was asked for without a batch - a day belongs
         * to a timezone, and only a batch has one.
         */
        handledToday: Schema.Number,
      }),
      error: [BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getReviewInstance', '/assessment/review/instances/:instanceId', {
      params: Schema.Struct({ instanceId: id }),
      success: Schema.Struct({ review: reviewDetailView }),
      error: [ReviewNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('decideReview', '/assessment/review/instances/:instanceId/decisions', {
      params: Schema.Struct({ instanceId: id }),
      payload: Schema.Struct({
        decision: Schema.Literals(['approve', 'reject', 'escalate', 'comment']),
        /**
         * One of the batch's configured reason labels, for reject and
         * escalate. Required exactly when the batch configured a list for
         * that act; free text stays in `comment`.
         */
        reason: Schema.optional(trimmedName(100)),
        comment: Schema.optional(boundedText(2000)),
        suggestedPayload: Schema.optional(configJson),
      }),
      success: Schema.Struct({ review: reviewDetailView }),
      error: [
        ReviewNotFound,
        ReviewConflict,
        BatchReadOnly,
        EntryActionRefused,
        EntryPayloadInvalid,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // permission to put one file in, for one question of one round; the
    // grant is provider-shaped and the page never looks inside it
    HttpApiEndpoint.post('prepareAttachmentUpload', '/assessment/attachments/uploads', {
      payload: Schema.Struct({
        batchId: id,
        itemId: id,
        filename: trimmedName(255),
        declaredMime: boundedText(127),
        /** decimal bytes; a string because numbers this size deserve exactness */
        size: Schema.String.check(Schema.isPattern(/^[1-9]\d{0,11}$/)),
      }),
      success: Schema.Struct({
        reservationId: Schema.String,
        attachmentId: Schema.String,
        grant: Schema.Struct({ driver: Schema.String, payload: configJson }),
        expiresAt: Schema.String,
      }),
      error: [ItemNotFound, EntryActionRefused, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // the bytes have arrived; the ticket becomes a staged file
    HttpApiEndpoint.post(
      'completeAttachmentUpload',
      '/assessment/attachments/uploads/:reservationId/complete',
      {
        params: Schema.Struct({ reservationId: id }),
        success: Schema.Struct({
          id: Schema.String,
          filename: Schema.String,
          declaredMime: Schema.String,
          size: Schema.String,
          status: Schema.String,
        }),
        error: [AttachmentUnavailable, EntryActionRefused, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    // what the file is and how to fetch it: a short-lived url for stores
    // that sign their own, or this api's own content door
    HttpApiEndpoint.get('describeAttachment', '/assessment/attachments/:attachmentId', {
      params: Schema.Struct({ attachmentId: id }),
      success: Schema.Struct({
        id: Schema.String,
        filename: Schema.String,
        declaredMime: Schema.String,
        size: Schema.String,
        status: Schema.String,
        delivery: Schema.Union([
          Schema.Struct({
            kind: Schema.Literals(['redirect']),
            url: Schema.String,
            expiresInSeconds: Schema.Number,
          }),
          Schema.Struct({ kind: Schema.Literals(['content']) }),
        ]),
      }),
      error: [AttachmentUnavailable, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the bytes themselves, for deployments whose store has no public door
    HttpApiEndpoint.get('getAttachmentContent', '/assessment/attachments/:attachmentId/content', {
      params: Schema.Struct({ attachmentId: id }),
      success: HttpApiSchema.StreamUint8Array(),
      error: [AttachmentUnavailable, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the way back in after a refresh: everything the caller has filed in
    // this round, whatever state it is in now
    HttpApiEndpoint.get('listMyEntries', '/assessment/batches/:batchId/my-entries', {
      params: Schema.Struct({ batchId: id }),
      query: Schema.Struct(pageQuery),
      success: Schema.Struct({
        /** the caller's own membership row: what a first filing names */
        participantId: Schema.String,
        entries: Schema.Array(entryView),
        nextCursor: Schema.NullOr(Schema.String),
      }),
      error: [BatchNotFound, ParticipantNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // the whole account of one claim: every revision as written, every
    // round it went through, every word said in them
    HttpApiEndpoint.get('getEntryHistory', '/assessment/entries/:entryId/revisions', {
      params: Schema.Struct({ entryId: id }),
      success: Schema.Struct({
        entry: entryView,
        revisions: Schema.Array(
          Schema.Struct({
            ...entryRevisionView.fields,
            /** the form this version was written under, for reading it back */
            formConfig: configJson,
          }),
        ),
        /** what happened to the claim that no round explains (§32.62) */
        events: Schema.Array(
          Schema.Struct({
            kind: Schema.String,
            actorId: Schema.NullOr(Schema.String),
            actorName: Schema.NullOr(Schema.String),
            reason: Schema.NullOr(Schema.String),
            at: Schema.String,
          }),
        ),
        rounds: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            roundNo: Schema.Number,
            state: Schema.String,
            outcome: Schema.NullOr(Schema.String),
            revisionId: Schema.String,
            /** how the round began, so a trail can say it in words */
            origin: Schema.String,
            supersedesInstanceId: Schema.NullOr(Schema.String),
            appealedInstanceId: Schema.NullOr(Schema.String),
            submittedAt: Schema.String,
            completedAt: Schema.NullOr(Schema.String),
            events: Schema.Array(
              Schema.Struct({
                kind: Schema.String,
                actorId: Schema.NullOr(Schema.String),
                actorName: Schema.NullOr(Schema.String),
                reason: Schema.NullOr(Schema.String),
                comment: Schema.NullOr(Schema.String),
                suggestedPayload: configJson,
                at: Schema.String,
              }),
            ),
          }),
        ),
      }),
      error: [EntryNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createEntry', '/assessment/entries', {
      payload: Schema.Struct({
        itemId: id,
        participantId: id,
        payload: configJson,
        note: Schema.optional(boundedText(500)),
      }),
      success: Schema.Struct({ entry: entryView }),
      error: [
        ItemNotFound,
        BatchNotFound,
        BatchReadOnly,
        EntryActionRefused,
        EntryPayloadInvalid,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getEntry', '/assessment/entries/:entryId', {
      params: Schema.Struct({ entryId: id }),
      success: Schema.Struct({ entry: entryView }),
      error: [EntryNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('reviseEntry', '/assessment/entries/:entryId/revisions', {
      params: Schema.Struct({ entryId: id }),
      payload: Schema.Struct({
        payload: configJson,
        note: Schema.optional(boundedText(500)),
      }),
      success: Schema.Struct({ entry: entryView }),
      error: [
        EntryNotFound,
        BatchReadOnly,
        EntryActionRefused,
        EntryPayloadInvalid,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setEntryStatus', '/assessment/entries/:entryId/status', {
      params: Schema.Struct({ entryId: id }),
      /** submit is in_review, withdraw is draft, abandoning the claim is voided */
      payload: Schema.Struct({ status: Schema.Literals(['in_review', 'draft', 'voided']) }),
      success: Schema.Struct({ entry: entryView }),
      error: [EntryNotFound, BatchReadOnly, EntryActionRefused, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // What somebody who may change the round's arrangements can do to a claim
    // without pretending to be its reviewer. Judging stays behind
    // decideReview, which keeps asking whether the caller really holds the
    // level the round is standing at (§32.62).
    HttpApiEndpoint.post('interveneOnEntry', '/assessment/entries/:entryId/interventions', {
      params: Schema.Struct({ entryId: id }),
      payload: Schema.Struct({
        kind: Schema.Literals(['return-for-revision']),
        /** what the person filing it has to act on; never optional */
        reason: boundedText(500),
      }),
      success: Schema.Struct({ entry: entryView }),
      error: [EntryNotFound, BatchReadOnly, EntryActionRefused, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // Contesting a decision, anchored on the decision itself. An entry can
    // carry several finished rounds, and "I disagree" has to say with what.
    HttpApiEndpoint.post('appealReview', '/assessment/review/instances/:instanceId/appeals', {
      params: Schema.Struct({ instanceId: id }),
      payload: Schema.Struct({ reason: boundedText(2000) }),
      success: Schema.Struct({ review: reviewDetailView }),
      error: [
        ReviewNotFound,
        BatchNotFound,
        BatchReadOnly,
        EntryActionRefused,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listItems', '/assessment/batches/:batchId/items', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({
        items: Schema.Array(itemView),
        capabilities: Schema.Struct({ canManage: Schema.Boolean }),
      }),
      error: [AccessDenied, BatchNotFound],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createItem', '/assessment/batches/:batchId/items', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Struct({
        itemType: itemTypeCode,
        title: trimmedName(255),
        scoreGroupId: id,
        maxEntries: Schema.optional(Schema.NullOr(positiveCount)),
        sortOrder: Schema.optional(sortOrder),
        config: itemConfigPayload,
      }),
      success: Schema.Struct({ item: itemView }),
      error: [AccessDenied, BatchNotFound, BatchReadOnly, ItemConfigInvalid, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getItem', '/assessment/items/:itemId', {
      params: Schema.Struct({ itemId: id }),
      success: Schema.Struct({
        item: itemView,
        capabilities: Schema.Struct({ canManage: Schema.Boolean }),
      }),
      error: [AccessDenied, ItemNotFound],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateItem', '/assessment/items/:itemId', {
      params: Schema.Struct({ itemId: id }),
      payload: changed(
        {
          title: Schema.optional(trimmedName(255)),
          scoreGroupId: Schema.optional(id),
          maxEntries: Schema.optional(Schema.NullOr(positiveCount)),
          sortOrder: Schema.optional(sortOrder),
          config: Schema.optional(itemConfigPayload),
          reason: Schema.optional(boundedText(500)),
          /**
           * Which version this edit was composed against. Two administrators
           * with the same question open would otherwise both save, and the
           * second would be answering an impact report drawn from a state
           * that no longer exists.
           */
          expectedRevisionId: Schema.optional(Schema.NullOr(id)),
          /**
           * What should happen to work already under way. Absent on the
           * first pass: a save that would disturb something comes back with
           * the impact report and is sent again with this filled in.
           */
          effects: Schema.optional(changeEffects),
        },
        ['title', 'scoreGroupId', 'maxEntries', 'sortOrder', 'config'],
      ),
      success: Schema.Struct({ item: itemView }),
      error: [
        AccessDenied,
        ItemNotFound,
        BatchNotFound,
        BatchReadOnly,
        ItemChangeDecisionRequired,
        ItemConfigInvalid,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listScoreGroups', '/assessment/batches/:batchId/score-groups', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({
        groups: Schema.Array(scoreGroupView),
        /** what a save of this tree has to state it was composed against */
        version: Schema.Number,
        capabilities: Schema.Struct({ canManage: Schema.Boolean }),
      }),
      error: [AccessDenied, BatchNotFound],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('replaceScoreGroups', '/assessment/batches/:batchId/score-groups', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Struct({
        groups: Schema.Array(scoreGroupSpec),
        expectedVersion,
        /** why, when a cap or floor moves on a running round */
        reason: Schema.optional(boundedText(500)),
      }),
      success: Schema.Struct({ groups: Schema.Array(scoreGroupView), version: Schema.Number }),
      error: [
        AccessDenied,
        BatchNotFound,
        BatchReadOnly,
        ScoreGroupInvalid,
        ScoreGroupVersionConflict,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listBatches', '/assessment/batches', {
      query: Schema.Struct({
        ...pageQuery,
        status: Schema.optional(batchStatus),
        q: Schema.optional(boundedText(100)),
      }),
      success: Schema.Struct({
        ...countedPageOf(batchListView).fields,
        // whether this reader may start a round at all, rather than only read
        // the ones they are in: the control that opens the form is not drawn
        // for somebody the api would refuse
        capabilities: Schema.Struct({ create: Schema.Boolean }),
      }),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createBatch', '/assessment/batches', {
      payload: Schema.Struct({
        name: trimmedName(255),
        descriptionMd: Schema.optional(boundedText(65536)),
        materialRange,
        timezone: Schema.optional(trimmedName(63)),
        // where the first people come from: a query run once, not a scope the
        // batch keeps and has to be reconciled against afterwards
        import: importSelection,
      }),
      success: Schema.Struct({ batch: batchView }),
      error: [AccessDenied, BatchReferenceInvalid, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getBatch', '/assessment/batches/:batchId', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({ batch: batchView }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateBatch', '/assessment/batches/:batchId', {
      params: Schema.Struct({ batchId: id }),
      payload: changed(
        {
          name: Schema.optional(trimmedName(255)),
          descriptionMd: Schema.optional(Schema.NullOr(boundedText(65536))),
          materialRange: Schema.optional(materialRange),
          timezone: Schema.optional(trimmedName(63)),
          reviewReasons: Schema.optional(
            Schema.Struct({
              reject: Schema.Array(trimmedName(100)).check(Schema.isMaxLength(30)),
              escalate: Schema.Array(trimmedName(100)).check(Schema.isMaxLength(30)),
            }),
          ),
          reason: Schema.optional(boundedText(500)),
        },
        ['name', 'descriptionMd', 'materialRange', 'timezone', 'reviewReasons'],
      ),
      success: Schema.Struct({ batch: batchView }),
      error: [
        BatchNotFound,
        BatchReadOnly,
        BatchReferenceInvalid,
        MaterialRangeInvalid,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // Closing a batch, and opening a closed one again. Starting is not here:
    // a batch starts by having its first phase scheduled. Reopening always
    // brings the phase it continues into, because the round that follows an
    // archive is a new period, not the old one resumed.
    HttpApiEndpoint.put('setBatchStatus', '/assessment/batches/:batchId/status', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Union([
        Schema.Struct({
          status: Schema.Literal('archived'),
          reason: Schema.optional(boundedText(500)),
        }),
        Schema.Struct({
          status: Schema.Literal('active'),
          reason: boundedText(500),
          phase: Schema.Struct({
            displayName: trimmedName(120),
            description: Schema.optional(boundedText(500)),
            permissionProfile: Schema.optional(Schema.Array(Schema.String)),
          }),
          /** null starts the new phase now; an instant schedules it */
          plannedEntryAt: Schema.NullOr(isoInstant),
        }),
      ]),
      success: Schema.Struct({ batch: batchView }),
      error: [
        BadRequest,
        BatchNotFound,
        BatchStatusInvalid,
        BatchNoParticipants,
        PlanInvalid,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // Who may work on this batch. Not "roles": a role is the tenant's word for
    // what somebody generally does, and this is what this batch accepted of it.
    HttpApiEndpoint.get('listAccess', '/assessment/batches/:batchId/access', {
      params: Schema.Struct({ batchId: id }),
      query: Schema.Struct(pageQuery),
      // paged over people, not over the rows behind them: a limit on sources
      // would show one of somebody's two roles and call it their standing
      success: Schema.Struct({
        staff: Schema.Array(accessSubjectView),
        nextCursor: Schema.NullOr(Schema.String),
      }),
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // what the organization now offers that this batch has not accepted, and
    // what has already lapsed; a preview because widening needs a decision
    HttpApiEndpoint.get('previewAccessSync', '/assessment/batches/:batchId/access/sync', {
      params: Schema.Struct({ batchId: id }),
      query: Schema.Struct(pageQuery),
      success: accessSyncPageView,
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // Only what was chosen, and only as much of it as the organization still
    // offers: the selection narrows the change, it cannot invent one.
    HttpApiEndpoint.post('applyAccessSync', '/assessment/batches/:batchId/access/sync', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Struct({
        accept: Schema.Array(
          Schema.Struct({
            kind: Schema.Literals(['new', 'widened']),
            id,
            permissions: Schema.Array(Schema.String),
          }),
        ),
      }),
      success: Schema.Struct({ merged: Schema.Number, cleared: Schema.Number }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // one capability, for one person, in this batch: idempotent by nature
    HttpApiEndpoint.put(
      'setAccessDeny',
      '/assessment/batches/:batchId/access/:userId/permissions/:permission',
      {
        params: Schema.Struct({ batchId: id, userId: id, permission: Schema.String }),
        payload: Schema.Struct({
          denied: Schema.Boolean,
          reason: Schema.optional(boundedText(500)),
        }),
        success: Schema.Struct({ staff: Schema.Array(accessSubjectView) }),
        error: [BatchNotFound, AccessInvalid, AccessDenied],
      },
    ).middleware(Authenticated),
  )
  .add(
    // What bringing somebody in can be: the units this round's people stand
    // in, and - once a person and a unit are named - the roles this caller
    // could actually give them there. Served from this domain so the screen
    // needs no authority over the tenant's roles beyond its own.
    HttpApiEndpoint.get('staffOptions', '/assessment/batches/:batchId/staff-options', {
      params: Schema.Struct({ batchId: id }),
      query: Schema.Struct({
        userId: Schema.optional(id),
        orgNodeId: Schema.optional(id),
      }),
      success: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            /** null for a unit whose parent is not one of this batch's own */
            parentId: Schema.NullOr(Schema.String),
            orgTypeId: Schema.String,
          }),
        ),
        // refused roles come back too, with why: a screen that says what to
        // change is worth more than a shorter list
        roles: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            refusal: Schema.NullOr(
              Schema.Literals(['user-type', 'authority', 'unavailable', 'beyond-batch']),
            ),
          }),
        ),
      }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // somebody brought in for this round: an ordinary assignment confined to
    // this batch, accepted into it in the same breath
    HttpApiEndpoint.post('addStaff', '/assessment/batches/:batchId/access', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Struct({
        // both sides are sets: one person over two classes and two people over
        // one are the same errand, and doing either one pair at a time is a
        // sequence of writes somebody can be interrupted halfway through
        userIds: Schema.Array(id),
        orgNodeIds: Schema.Array(id),
        roleId: id,
        validUntil: Schema.optional(isoInstant),
      }),
      success: Schema.Struct({ staff: Schema.Array(accessSubjectView) }),
      error: [BadRequest, BatchNotFound, AccessInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('removeStaff', '/assessment/batches/:batchId/access/sources/:sourceId', {
      params: Schema.Struct({ batchId: id, sourceId: id }),
      success: Schema.Struct({ staff: Schema.Array(accessSubjectView) }),
      error: [BatchNotFound, AccessInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // A draft nobody ever started. Anything that ran is archived, never
    // deleted: the history is the point.
    HttpApiEndpoint.delete('deleteBatch', '/assessment/batches/:batchId', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: [BatchNotFound, BatchStatusInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getPhases', '/assessment/batches/:batchId/phases', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({ phases: Schema.Array(phaseView) }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the plan's structure as an idempotent replacement: named phases are
    // edited, unnamed ones inserted, and a timeline template appends its
    // phases to the end, copied server-side so its provenance lands with
    // them. Times are not part of it. Exactly one of the two fields.
    HttpApiEndpoint.put('putPhases', '/assessment/batches/:batchId/phases', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Struct({
        fromTemplateId: Schema.optional(id),
        phases: Schema.optional(Schema.Array(phaseSpec)),
      }).check(
        Schema.makeFilter(
          (value: { fromTemplateId?: string; phases?: readonly unknown[] }) =>
            (value.fromTemplateId === undefined) !== (value.phases === undefined) ||
            'exactly one of fromTemplateId and phases must be present',
        ),
      ),
      success: Schema.Struct({
        phases: Schema.Array(phaseView),
        warnings: Schema.Array(planWarning),
      }),
      error: [
        BatchNotFound,
        BatchReadOnly,
        TemplateNotFound,
        PlanInvalid,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // when a phase is due to begin, as an idempotent sub-resource: a time
    // schedules it, null withdraws the schedule. Time is committed from the
    // top of the plan down and withdrawn from the bottom up (32.41)
    HttpApiEndpoint.put('schedulePhase', '/assessment/batches/:batchId/phases/:phaseId/schedule', {
      params: Schema.Struct({ batchId: id, phaseId: id }),
      payload: Schema.Struct({ plannedEntryAt: Schema.NullOr(isoInstant) }),
      success: Schema.Struct({ phases: Schema.Array(phaseView) }),
      error: [
        BatchNotFound,
        BatchReadOnly,
        PhaseNotFound,
        PlanInvalid,
        // the first time a phase is given a time, the batch starts running,
        // and a batch that can enroll nobody may not
        BatchNoParticipants,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // advancement replaces which phase is current, one boundary at a time
    HttpApiEndpoint.put('advancePhase', '/assessment/batches/:batchId/phase', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Struct({
        to: id,
        force: Schema.optional(Schema.Boolean),
        reason: Schema.optional(boundedText(500)),
      }),
      success: Schema.Struct({ phases: Schema.Array(phaseView) }),
      error: [BatchNotFound, PhaseNotFound, AdvanceInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getTimeline', '/assessment/batches/:batchId/timeline', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({ timeline: Schema.Array(timelineEntry) }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listParticipants', '/assessment/batches/:batchId/participants', {
      params: Schema.Struct({ batchId: id }),
      query: Schema.Struct({
        ...pageQuery,
        status: Schema.optional(Schema.Literals(['active', 'excluded'])),
        /** narrowed to the people this round admitted from these units */
        orgNodeIds: Schema.optional(idList),
        /** that unit only, or everything under it; under it when absent */
        orgScope: Schema.optional(Schema.Literals(['self', 'subtree'])),
      }),
      success: pageOf(participantView),
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // Adding people, by name of the people themselves. Importing from the
    // organization resolves its units to people first, so there is one way in
    // and it takes user ids.
    HttpApiEndpoint.post('addParticipants', '/assessment/batches/:batchId/participants', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Struct({ userIds: Schema.Array(id) }),
      success: Schema.Struct({ added: Schema.Number, skipped: Schema.Number }),
      error: [BatchNotFound, BatchReadOnly, ParticipantInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // how many people a selection would add, so the number can be confirmed
    // before anybody is added
    HttpApiEndpoint.get('previewImport', '/assessment/batches/:batchId/import-candidates', {
      params: Schema.Struct({ batchId: id }),
      query: Schema.Struct({
        orgNodeIds: idList,
        userTypeIds: idList,
      }),
      success: Schema.Struct({ candidates: Schema.Number }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // An import is an act, and the record of it is history: it says what was
    // asked for and how many people it added, and nothing reads it to decide
    // anything afterwards.
    HttpApiEndpoint.post('importParticipants', '/assessment/batches/:batchId/participant-imports', {
      params: Schema.Struct({ batchId: id }),
      payload: importSelection,
      success: Schema.Struct({ added: Schema.Number }),
      error: [
        BatchNotFound,
        BatchReadOnly,
        BatchReferenceInvalid,
        ParticipantInvalid,
        AccessDenied,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listImports', '/assessment/batches/:batchId/participant-imports', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({
        imports: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            // named, not identified: what was asked for is readable history,
            // and a unit the reader may not reach is not named at all
            units: Schema.Array(Schema.String),
            userTypes: Schema.Array(Schema.String),
            importedCount: Schema.Number,
            actorId: Schema.NullOr(Schema.String),
            occurredAt: Schema.String,
          }),
        ),
      }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // taking somebody out keeps the row and everything hanging off it;
    // bringing them back is the same door in the other direction
    HttpApiEndpoint.put(
      'setParticipantStatus',
      '/assessment/batches/:batchId/participants/:participantId/status',
      {
        params: Schema.Struct({ batchId: id, participantId: id }),
        payload: Schema.Struct({
          status: Schema.Literals(['active', 'excluded']),
          reason: Schema.optional(boundedText(500)),
        }),
        success: Schema.Struct({ participant: participantView }),
        error: [
          BatchNotFound,
          BatchReadOnly,
          ParticipantNotFound,
          ParticipantInvalid,
          AccessDenied,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    // The options a batch form needs, served from this domain: an
    // administrator holds assessment.batch.manage and should not have to
    // hold org and iam read permissions to fill in a form (§22).
    HttpApiEndpoint.get('listScopeOptions', '/assessment/scope-options', {
      success: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            /** null for a root, or for a node whose parent is out of reach */
            parentId: Schema.NullOr(Schema.String),
            depth: Schema.Number,
            orgTypeId: Schema.String,
          }),
        ),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listUserTypeOptions', '/assessment/user-type-options', {
      success: Schema.Struct({
        userTypes: Schema.Array(
          Schema.Struct({ id: Schema.String, code: Schema.String, name: Schema.String }),
        ),
      }),
      error: [AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listTemplates', '/assessment/phase-templates', {
      query: Schema.Struct({ ...pageQuery, kind: Schema.optional(templateKind) }),
      success: pageOf(templateView),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createTemplate', '/assessment/phase-templates', {
      payload: Schema.Struct({
        name: trimmedName(100),
        kind: Schema.optional(templateKind),
        phases: Schema.Array(phaseSpec),
      }),
      success: Schema.Struct({ template: templateView }),
      error: [AccessDenied, TemplateConflict, PlanInvalid, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateTemplate', '/assessment/phase-templates/:templateId', {
      params: Schema.Struct({ templateId: id }),
      payload: changed(
        {
          name: Schema.optional(trimmedName(100)),
          phases: Schema.optional(Schema.Array(phaseSpec)),
        },
        ['name', 'phases'],
      ),
      success: Schema.Struct({ template: templateView }),
      error: [TemplateNotFound, TemplateConflict, PlanInvalid, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteTemplate', '/assessment/phase-templates/:templateId', {
      params: Schema.Struct({ templateId: id }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [TemplateNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
