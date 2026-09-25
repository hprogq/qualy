import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import {
  BadRequest,
  boundedText,
  changed,
  expectedVersion,
  kebabCode,
  MAX_CURSOR_LENGTH,
  pageQuery,
  countedPageOf,
  pageOf,
  trimmedName,
  uuidInput,
} from '@qualy/api-kit/schema'
import { Authenticated } from '@qualy/auth-contract/session'
import { BATCH_STAFF_CODES, PHASE_GATED_CODES } from './permissions.ts'

/**
 * One wake-up on a batch's live stream.
 *
 * `sync` opens every (re)connection: whatever happened while nobody was
 * listening, the answer is the same - read again. `heartbeat` keeps
 * middleboxes from reaping a quiet connection and means nothing.
 */
export const batchLiveEvent = Schema.Struct({
  kind: Schema.Literals([
    'sync',
    'heartbeat',
    'review-inbox-changed',
    'review-instance-changed',
    'entries-changed',
    'item-changed',
    'result-changed',
    'phase-changed',
    'plan-changed',
  ]),
})
export type BatchLiveEvent = typeof batchLiveEvent.Type
import { AccessDenied } from '@qualy/rbac-contract/effect'
import {
  AdministrativeRecordTargetsChanged,
  AdministrativeRecordRefused,
  AdministrativeRecordNotFound,
  AdministrativeRecordFilesNotShareable,
  AccessInvalid,
  AdvanceInvalid,
  EntryActionRefused,
  EntryNotFound,
  AdministrativeImportInvalid,
  AdministrativeImportNotFound,
  DeterminationRefused,
  EntryPayloadInvalid,
  ItemActionRefused,
  ItemChangeDecisionRequired,
  ItemConfigInvalid,
  ItemNotFound,
  ItemRevisionConflict,
  ItemScoringIncompatible,
  MaterialRangeInvalid,
  ScoreGroupInvalid,
  ScoreGroupVersionConflict,
  BatchNoParticipants,
  BatchNotFound,
  ParticipantInvalid,
  ParticipantNotFound,
  ParticipantPlacementChanged,
  AttachmentUnavailable,
  ReviewConflict,
  ScoringUnavailable,
  ReviewNotFound,
  BatchReadOnly,
  BatchReferenceInvalid,
  BatchStatusInvalid,
  PhaseNotFound,
  PlanInvalid,
  TemplateConflict,
  TemplateNotFound,
} from './errors.ts'

// The assessment endpoints, as definitions only: batches, the phase plan and
// its advancement, the derived timeline, and the tenant's phase templates.
// Paths are frozen (tools/tests/support/frozen-routes.ts) and follow the api
// discipline: product-domain first segment, nouns, no action segments, state
// as an idempotent subresource PUT.

/** an instant on the wire; the service parses it and refuses the unreadable */
const isoInstant = Schema.String.check(Schema.isMaxLength(64))
/**
 * A calendar date, as the half-open material range states its bounds.
 *
 * The shape is not enough: `2026-02-31` matches it and is not a day. Left to
 * the pattern alone it travelled all the way to postgres, which refused it as
 * a database fault - a 500 for what is plainly a bad request. Checked by
 * round trip, because that is what "this date exists" means - in PostgreSQL's
 * calendar too, which has no year 0: `0000-01-01` survives the round trip in
 * JavaScript and fails the `::date` cast.
 */
const isRealDate = (value: string) => {
  const at = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(at.getTime()) &&
    at.toISOString().slice(0, 10) === value &&
    at.getUTCFullYear() >= 1
  )
}

export const isoDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value: string) => isRealDate(value) || 'must be a real calendar date'),
)

const materialRange = Schema.Struct({ start: isoDate, end: isoDate })

/**
 * A zone written as a region name, which the platform can resolve.
 *
 * The value is bound into `AT TIME ZONE` wherever a round's day boundaries
 * are worked out. The platform and PostgreSQL do not read every spelling
 * alike: an offset such as `+08:00` is UTC+8 here and UTC-8 there (POSIX
 * signs run the other way), `+0800` is refused there outright, and legacy
 * aliases such as `CTT` resolve here and nowhere else. So only a region name
 * is taken at the door - `Asia/Shanghai`, `Etc/GMT-8`, or `UTC` - and the
 * service asks the database itself before the value is stored.
 */
const timeZoneName = trimmedName(63).check(
  Schema.makeFilter((value: string) => {
    if (value !== 'UTC' && !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) {
      return 'a time zone is written as a region name, such as Asia/Shanghai'
    }
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: value })
      return undefined
    } catch {
      return 'not a time zone this platform knows'
    }
  }),
)

/**
 * The labels a reviewer picks a reason from, one list per act. Configured on
 * the batch; the chosen label is copied onto the review event, so these
 * lists are offer, not history.
 */
const actionAvailability = Schema.Struct({
  state: Schema.Literals(['available', 'blocked', 'hidden']),
  reason: Schema.NullOr(Schema.String),
})

// Offered labels are matched against a TRIMMED submission at decision
// time, so the offer itself is canonical at the wire: trimmed, non-blank,
// bounded - a whitespace-only label would make its action impossible to
// ever carry out
const reviewReasonList = Schema.Array(trimmedName(100)).check(
  Schema.makeFilter((list: readonly string[]) => list.length <= 50 || 'at most 50 reasons'),
)
const reviewReasons = Schema.Struct({
  reject: reviewReasonList,
  escalate: reviewReasonList,
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
 * A round one person is or was in, as their own record lists it.
 *
 * The membership travels with the round because it is what the line is
 * about: being taken off the list ends what somebody may do in the round
 * and does not unsay that they were in it (§32.56), so an excluded row is
 * listed with the day it ended rather than dropped.
 */
const userBatchView = Schema.Struct({
  batch: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    status: batchStatus,
    materialRange,
    timezone: Schema.String,
    currentPhaseId: Schema.NullOr(Schema.String),
    currentPhaseName: Schema.NullOr(Schema.String),
    manageable: Schema.Boolean,
  }),
  membership: Schema.Struct({
    status: Schema.Literals(['active', 'excluded']),
    includedAt: Schema.String,
    excludedAt: Schema.NullOr(Schema.String),
    /** the unit they were admitted from, by its current name; null once it is gone */
    anchorNodeName: Schema.NullOr(Schema.String),
  }),
})

/** one claim of one person, across every round the reader may see it in */
const userEntryView = Schema.Struct({
  id: Schema.String,
  batchId: Schema.String,
  batchName: Schema.String,
  itemId: Schema.String,
  itemTitle: Schema.String,
  status: Schema.Literals([
    'draft',
    'in_review',
    'needs_revision',
    'approved',
    'rejected',
    'voided',
  ]),
  source: Schema.Literals(['self', 'proxy', 'record', 'import', 'system']),
  createdAt: Schema.String,
  updatedAt: Schema.String,
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
 * A repeated query parameter, which is a list only when it repeats.
 *
 * `?a=1&a=2` arrives as an array and `?a=1` as a string - that is what
 * UrlParams.toRecord builds (repos/effect/packages/effect/src/unstable/http/
 * UrlParams.ts). A schema asking for an array therefore refused every request
 * that named exactly one thing, which is most of them.
 */
export const idList = Schema.Union([Schema.Array(uuidInput), uuidInput])

/**
 * A list of ids, with the most one request may name.
 *
 * Every list built this way is walked rather than only stored: a position
 * read, an authorization question or a row written per element, most of it
 * inside one transaction. The request body's own ceiling is 2 MiB, which is
 * some fifty thousand ids - so without a bound the largest question anybody
 * may ask is decided by how long a uuid is. What a caller may send has to be
 * something the server can finish.
 */
const idsUpTo = (most: number) => Schema.Array(uuidInput).check(Schema.isMaxLength(most))

/** a repeated query parameter, with the most one request may name */
const idListUpTo = (most: number) => Schema.Union([idsUpTo(most), uuidInput])

/**
 * The most phases one plan may hold.
 *
 * A real round has a handful; fifty is room for every supplementary period a
 * year could need. Without it a plan write was bounded only by the request
 * body, and a few tens of thousands of phases held the batch lock while each
 * was reviewed against the plan and written - then made every batch list
 * that showed the round pay for the whole timeline again.
 */
export const MAX_PLAN_PHASES = 50

/**
 * The actions one phase opens. Each is one of the gate's own codes, so there
 * are never more than the gate knows; the service still names any it does
 * not recognize.
 */
const permissionProfileInput = Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(
  Schema.isMaxLength(PHASE_GATED_CODES.length),
)

/**
 * One phase as a plan write states it: with an id it replaces that phase's
 * editable fields, without one it is an insertion at its position. Times are
 * deliberately absent - a plan write states structure, and when each phase
 * begins is committed one phase at a time through schedulePhase. The two
 * scopes are the supplementary-phase allowances: empty means unrestricted,
 * and on a spec that names an existing phase an absent field leaves the
 * stored value alone, so a caller that echoes back a partial view of a plan
 * cannot blank what it never rendered.
 */
const phaseSpec = Schema.Struct({
  id: Schema.optional(uuidInput),
  phaseKey: kebabCode,
  displayName: trimmedName(100),
  description: Schema.optional(boundedText(500)),
  /** what the phase is waiting for, while it has no time of its own */
  entryNote: Schema.optional(boundedText(200)),
  permissionProfile: Schema.optional(permissionProfileInput),
  // as many people as one roster write may name, and more items than a
  // round carries
  itemScope: Schema.optional(idsUpTo(1000)),
  participantScope: Schema.optional(idsUpTo(5000)),
})

/** a whole plan, or a whole timeline template, as one write states it */
const phaseSpecs = Schema.Array(phaseSpec).check(Schema.isMaxLength(MAX_PLAN_PHASES))

/**
 * A template's phase as it is served. Only writes carry the ceilings above: a
 * template stored before them still has to be readable, and a response that
 * fails its own schema reaches the reader as a server fault.
 */
const storedPhaseSpec = Schema.Struct({
  ...phaseSpec.fields,
  permissionProfile: Schema.optional(Schema.Array(Schema.String)),
  itemScope: Schema.optional(Schema.Array(Schema.String)),
  participantScope: Schema.optional(Schema.Array(Schema.String)),
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

/** one unit of the organization as this round froze it, live wording */
const rosterUnitView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  parentId: Schema.NullOr(Schema.String),
})

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
  /**
   * Whether the organization still has them where this round does:
   * `changed` is a difference nobody has decided about yet, `unavailable`
   * an organization that has them nowhere. Never moves the round by itself.
   */
  placement: Schema.Literals(['current', 'changed', 'unavailable']),
})

/**
 * A placement as a reader may be told it: the units from the root down, each
 * named only where the reader's own management reaches, and the kind of
 * person. A unit beyond that reach is there by id with no name.
 */
const placementView = Schema.Struct({
  units: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.NullOr(Schema.String) })),
  userType: Schema.Struct({ id: Schema.String, name: Schema.NullOr(Schema.String) }),
})

/** one member whose placement in the round and in the organization differ */
const placementDifferenceView = Schema.Struct({
  participantId: Schema.String,
  displayName: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  /** a difference to decide about, or an organization that has them nowhere */
  standing: Schema.Literals(['changed', 'unavailable']),
  /** why there is nothing to sync to, for an unavailable one */
  unavailable: Schema.NullOr(Schema.Literals(['gone', 'disabled', 'unplaced'])),
  /** what differs, all of it: somebody can move and change kind at once */
  changes: Schema.Array(Schema.Literals(['placement', 'ancestry', 'user-type'])),
  /** where this round has them */
  frozen: placementView,
  /** where the organization has them; null when there is nowhere, or it is beyond the reader */
  current: Schema.NullOr(placementView),
  /** the organization has them somewhere this reader does not manage */
  currentBeyondReach: Schema.Boolean,
  /** whether this reader may take the organization's placement into the round */
  canSync: Schema.Boolean,
  /** what a decision about this row carries back; null where there is nothing to decide */
  observedFingerprint: Schema.NullOr(Schema.String),
})

/**
 * The degraded chain preview (real review policies wire in later): for each level
 * of the lineage being frozen, how many people hold any role anchored
 * exactly there. Zero is the number an administrator wants shouted.
 */

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
 * How a bulk administrative act found its people.
 *
 * Kept as history once the act is written and never resolved again: it says
 * the selection that was made, not who the act applies to (§32.78).
 */
const recordTargetInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('people'), participantIds: idList }),
  Schema.Struct({
    kind: Schema.Literal('organization'),
    orgNodeIds: idList,
    userTypeIds: idList,
  }),
])

const recordBlockerView = Schema.Struct({
  participantId: Schema.String,
  userId: Schema.String,
  displayName: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  reason: Schema.String,
})

const recordOperationView = Schema.Struct({
  id: Schema.String,
  itemId: Schema.String,
  itemTitle: Schema.String,
  targetKind: Schema.String,
  recordedCount: Schema.Number,
  voidedCount: Schema.Number,
  actorName: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
})

/** the query one import runs: units to look under, and which kinds of people */
const importSelection = Schema.Struct({
  // each unit is asked about on its own before anything is read
  orgNodeIds: idsUpTo(200),
  userTypeIds: idsUpTo(50),
})

const templateKind = Schema.Literals(['timeline', 'phase'])

const templateView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: templateKind,
  version: Schema.Number,
  phases: Schema.Array(storedPhaseSpec),
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

/** what a stored file is and how to fetch it, as both attachment doors say it */
const attachmentDescriptor = Schema.Struct({
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
})

/** one door a question's records come in through */
const entryChannel = Schema.Literals(['participant', 'administrative'])

const itemRevisionView = Schema.Struct({
  id: Schema.String,
  revisionNo: Schema.Number,
  /** the doors open on this configuration; none for a derived question */
  entryChannels: Schema.Array(entryChannel),
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
  /** why it was withdrawn, for the paper to say so where it stands */
  voidReason: Schema.NullOr(Schema.String),
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
      /**
       * Where migrated rounds land: at their current step (the default), or
       * at the start of their own route - a full re-review under the new
       * policy. Route, not process: a round already in escalation restarts
       * escalation, because why it got there is a fact this edit cannot
       * unmake.
       */
      landing: Schema.optional(Schema.Literals(['current-stage', 'route-start'])),
    }),
  ),
})

const itemConfigPayload = Schema.Struct({
  entryChannels: Schema.Array(entryChannel),
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

/** the most groups one paper's tree may hold */
export const MAX_SCORE_GROUPS = 200

const scoreGroupSpec = Schema.Struct({
  id: Schema.optional(uuidInput),
  /**
   * The group this one adds up into; null is top level.
   *
   * Stated rather than optional: a payload that left it out moved every group
   * it named to the top, so forgetting the field flattened the tree.
   */
  parentGroupId: Schema.NullOr(uuidInput),
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

/**
 * One asked-for piece of a supplement (§32.65 ⑤). The builder is
 * deliberately this small - a text answer or files, nothing else - so an ask
 * for more backing can never grow into a second form the filing was not
 * written under.
 */
const supplementRequirement = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(['text', 'file']),
  required: Schema.Boolean,
})

/** one ask a round made beyond the filing, with its answer when one came */
const reviewSupplementView = Schema.Struct({
  id: Schema.String,
  requestNo: Schema.Number,
  status: Schema.Literals(['open', 'answered', 'cancelled', 'superseded']),
  instructions: Schema.String,
  requirements: Schema.Array(supplementRequirement),
  requestedBy: Schema.String,
  requestedByName: Schema.NullOr(Schema.String),
  requestedAt: Schema.String,
  answeredAt: Schema.NullOr(Schema.String),
  cancelledAt: Schema.NullOr(Schema.String),
  response: Schema.NullOr(
    Schema.Struct({
      payload: configJson,
      attachments: Schema.Array(
        Schema.Struct({ attachmentId: Schema.String, position: Schema.Number }),
      ),
      respondedAt: Schema.String,
    }),
  ),
})

/** the standings an administrative fact can currently be in */
const administrativeStatus = Schema.Literals([
  'draft',
  'in_review',
  'needs_revision',
  'approved',
  'rejected',
  'voided',
])

/** what is wrong with one row, or with the file as a whole */
const importIssue = Schema.Struct({
  severity: Schema.Literals(['error', 'warning']),
  /** the field it is about, when it is about one */
  field: Schema.NullOr(Schema.String),
  reason: Schema.String,
  /** a calculator's own words, when the refusal is its */
  detail: Schema.optional(Schema.String),
})

/**
 * One row of the workbook as the server reads it.
 *
 * `matchedParticipant` is null for every refusal a business number can earn
 * - unknown, excluded, out of the caller's reach - deliberately: telling
 * them apart would make the import door a directory of other people's
 * students, readable a spreadsheet at a time.
 */
const importPreviewRow = Schema.Struct({
  rowNo: Schema.Number,
  businessNo: Schema.String,
  /** what the file calls them, for the reader to check against the match */
  displayNameFromFile: Schema.String,
  matchedParticipant: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      displayName: Schema.String,
      businessNo: Schema.NullOr(Schema.String),
    }),
  ),
  payloadPreview: configJson,
  recognitionPreview: configJson,
  basis: Schema.String,
  issues: Schema.Array(importIssue),
})

/** one row of the administrative record book */
const administrativeEntryView = Schema.Struct({
  entryId: Schema.String,
  participant: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    displayName: Schema.String,
    businessNo: Schema.NullOr(Schema.String),
  }),
  item: Schema.Struct({ id: Schema.String, title: Schema.String }),
  source: Schema.Literals(['record', 'import']),
  status: administrativeStatus,
  revision: Schema.Struct({
    id: Schema.String,
    payload: configJson,
    /** the basis, which an administrative fact is never written without */
    note: Schema.NullOr(Schema.String),
    actorId: Schema.String,
    actorName: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
  }),
  recognition: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      /** the question version this determination was judged under */
      itemRevisionId: Schema.String,
      values: configJson,
      /** that version's own fields, in the order it declares them */
      fields: Schema.Array(Schema.Struct({ id: Schema.String, schema: configJson })),
      /**
       * Who settled it and when, which is not who filed the fact.
       *
       * They are the same hand for a record written in one act, and they
       * part the moment an appeal re-determines one: the record stays as
       * the office wrote it while somebody else decides what it is
       * recognised as. Read off the determination's own row, because a
       * screen borrowing the filing's author says the office decided
       * something it did not.
       */
      source: Schema.Literals(['review', 'record', 'import', 'system', 'redetermination']),
      actorName: Schema.NullOr(Schema.String),
      createdAt: Schema.String,
    }),
  ),
  /** the bulk act it arrived in, when it arrived in one */
  importId: Schema.NullOr(Schema.String),
  operationId: Schema.NullOr(Schema.String),
})

const personRef = Schema.Struct({ id: Schema.String, name: Schema.String })

const importStanding = Schema.Struct({
  approved: Schema.Number,
  inReview: Schema.Number,
  rejected: Schema.Number,
  voided: Schema.Number,
  /** anything else, so the parts always add up to what was imported */
  other: Schema.Number,
})

/**
 * One import, as the history lists it.
 *
 * What it currently comes to is counted from its entries whenever somebody
 * asks rather than stored on the import: the entries already know, and a
 * second copy is a copy that can disagree with them.
 */
/**
 * The original file's identity, behind the same reach its contents are.
 *
 * A workbook's name carries what the workbook does - 软件2301张三李四处分名单.xlsx
 * names people as plainly as the rows inside it - so it belongs with the rows
 * rather than with the fact that an import happened. A shape rather than a
 * nullable string, so a screen written later cannot print it without first
 * asking whether it is there.
 */
const administrativeImportSource = Schema.Union([
  Schema.Struct({ available: Schema.Literal(false) }),
  Schema.Struct({
    available: Schema.Literal(true),
    /** the workbook's name as it was uploaded */
    filename: Schema.String,
    /** decimal bytes */
    size: Schema.String,
    /** what the store verified the original to be when it was imported */
    integrity: Schema.NullOr(Schema.Struct({ algorithm: Schema.String, value: Schema.String })),
  }),
])

const administrativeImportView = Schema.Struct({
  id: Schema.String,
  item: Schema.Struct({ id: Schema.String, title: Schema.String }),
  source: administrativeImportSource,
  actor: Schema.NullOr(personRef),
  createdAt: Schema.String,
  importedCount: Schema.Number,
  standing: importStanding,
})

/** one import, whole: what it was, what it did, and what it comes to now */
const administrativeImportDetail = Schema.Struct({
  id: Schema.String,
  batchId: Schema.String,
  item: Schema.Struct({ id: Schema.String, title: Schema.String }),
  /** the question version every row of it answered */
  itemRevision: Schema.Struct({ id: Schema.String, revisionNo: Schema.Number }),
  source: administrativeImportSource,
  actor: Schema.NullOr(personRef),
  createdAt: Schema.String,
  defaultBasis: Schema.NullOr(Schema.String),
  importedCount: Schema.Number,
  standing: importStanding,
  reversals: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      actor: Schema.NullOr(personRef),
      reason: Schema.NullOr(Schema.String),
      /** how many were still in effect and were withdrawn by it */
      affectedCount: Schema.Number,
      createdAt: Schema.String,
    }),
  ),
  capabilities: Schema.Struct({ reverse: Schema.Boolean }),
})

/** one row of an import, and the fact it became */
const administrativeImportRowView = Schema.Struct({
  rowNo: Schema.Number,
  entryId: Schema.String,
  participant: Schema.Struct({
    id: Schema.String,
    displayName: Schema.String,
    businessNo: Schema.NullOr(Schema.String),
  }),
  /** what the file said, kept as it was written */
  businessNoSnapshot: Schema.NullOr(Schema.String),
  displayNameSnapshot: Schema.NullOr(Schema.String),
  status: administrativeStatus,
  recognition: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      itemRevisionId: Schema.String,
      values: configJson,
      fields: Schema.Array(Schema.Struct({ id: Schema.String, schema: configJson })),
    }),
  ),
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
   * The reviewer's open ask for more backing, when this claim's round is
   * waiting on one. The ask itself is the whole capability to answer -
   * deliberately not phase-gated (§32.65 ⑤).
   */
  supplement: Schema.NullOr(
    Schema.Struct({
      requestId: Schema.String,
      instanceId: Schema.String,
      requestNo: Schema.Number,
      instructions: Schema.String,
      requirements: Schema.Array(supplementRequirement),
      requestedByName: Schema.NullOr(Schema.String),
      requestedAt: Schema.String,
    }),
  ),
  /**
   * The last word said against it, while it is waiting on its owner: the
   * sentence that came with the rejection, or with an administrator sending
   * it back. A status word without it is an instruction with the instruction
   * missing.
   */
  refusal: Schema.NullOr(
    Schema.Struct({
      kind: Schema.String,
      reason: Schema.NullOr(Schema.String),
      comment: Schema.NullOr(Schema.String),
      /** the reviewer's suggested rewrite, applied only by the owner's hand */
      suggestedPayload: configJson,
      actorName: Schema.NullOr(Schema.String),
      at: Schema.String,
    }),
  ),
  /**
   * A round running right now, and what opened it.
   *
   * The claim's own status cannot say so: an appeal leaves it standing where
   * it stood (§32.21), so a card would read "已认定" all through the appeal
   * it is the subject of.
   */
  openRound: Schema.NullOr(
    Schema.Struct({ origin: Schema.Literals(['initial', 'appeal', 'reopen', 'reroute']) }),
  ),
  /**
   * What the claim currently stands recognised as, under the question
   * version that judged it. Only while the claim stands on it: a claim back
   * under review has no conclusion to show (§32.85). Null where nothing has
   * been determined, and on the write paths.
   */
  recognition: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      source: Schema.Literals(['review', 'record', 'import', 'system', 'redetermination']),
      /** the filing version it judged; a later one means it judged older material */
      entryRevisionId: Schema.String,
      /** opaque ids with the frozen schemas that name them, in order */
      fields: Schema.Array(Schema.Struct({ id: Schema.String, schema: configJson })),
      values: configJson,
      createdAt: Schema.String,
      /** null where this reader is not told who determined it */
      actorName: Schema.NullOr(Schema.String),
      /** a sitting of several reviewers determined it, not one person */
      byPanel: Schema.Boolean,
    }),
  ),
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
   * the question's real field labels, never a written summary. A field that
   * asks for files keeps its place and carries how many were filed under it
   * (`files`) rather than being folded into one count at the end of the row.
   */
  values: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      value: Schema.String,
      files: Schema.NullOr(Schema.Number),
    }),
  ),
  attachmentCount: Schema.Number,
  submittedAt: Schema.String,
})

/** one step of a route, named by the id it keeps across policy edits */
const reviewStageView = Schema.Struct({
  id: Schema.String,
  index: Schema.Number,
  /** a step this reader is not told about: only that it is there */
  veiled: Schema.Boolean,
  /** the administrator's name for the step, when the policy carries one */
  label: Schema.NullOr(Schema.String),
  nodeName: Schema.NullOr(Schema.String),
  roleNames: Schema.Array(Schema.String),
  /** who holds those roles there today; null when this response left it unresolved */
  reviewers: Schema.NullOr(Schema.Array(Schema.String)),
  skipped: Schema.NullOr(Schema.String),
  /**
   * What a concluded sitting at this step said, judgment by judgment - the
   * evidence the judge after it reads. Null where none concluded; an open
   * sitting's ballots are sealed and never appear.
   */
  opinions: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        who: Schema.NullOr(Schema.String),
        decision: Schema.Literals(['approve', 'reject']),
        reason: Schema.NullOr(Schema.String),
        comment: Schema.NullOr(Schema.String),
        at: Schema.String,
      }),
    ),
  ),
})

/** one act of the workbench: offered, or blocked with a stable reason code */
const reviewActionView = Schema.Struct({
  state: Schema.Literals(['available', 'blocked']),
  reason: Schema.NullOr(Schema.String),
})

const reviewDetailView = Schema.Struct({
  id: Schema.String,
  state: Schema.Literals(['active', 'blocked', 'awaiting_supplement', 'completed']),
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
          values: Schema.Array(
            Schema.Struct({
              label: Schema.String,
              value: Schema.String,
              files: Schema.NullOr(Schema.Number),
            }),
          ),
          status: Schema.String,
          current: Schema.Boolean,
        }),
      ),
      /** how the previous round ended, shown so a resubmission is read against it */
      previous: Schema.NullOr(
        Schema.Struct({
          roundNo: Schema.Number,
          kind: Schema.String,
          reason: Schema.NullOr(Schema.String),
          comment: Schema.NullOr(Schema.String),
          actorName: Schema.NullOr(Schema.String),
          at: Schema.String,
        }),
      ),
      /** the version just before the judged one, for the default comparison */
      previousRevision: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
          revisionNo: Schema.Number,
          formConfig: configJson,
          payload: configJson,
        }),
      ),
      /** the rounds before that, one line each */
      earlier: Schema.Array(
        Schema.Struct({
          roundNo: Schema.Number,
          kind: Schema.String,
          reason: Schema.NullOr(Schema.String),
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
  }),
  /**
   * The workbench's four acts, each offered or carrying the reason it is
   * not. Always all four: the bar never hides an act, it explains one.
   */
  actions: Schema.Struct({
    approve: reviewActionView,
    reject: reviewActionView,
    escalate: reviewActionView,
    supplement: reviewActionView,
    /**
     * Whether a rejection said here reaches the person who filed, rather
     * than moving the round on to the next judge. Advice for them rides
     * only the first kind, so this is what says whether to offer it.
     */
    rejectionReturns: Schema.Boolean,
    /**
     * Whether an approval said here concludes the round. At a middle step
     * of the escalation route it is an opinion the next step starts from.
     */
    approvalConcludes: Schema.Boolean,
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
  /** what this round asked for beyond the filing, and what came back */
  supplements: Schema.Array(reviewSupplementView),
  /**
   * The form this user fills or confirms if they approve now.
   *
   * Null only says there is no form to act on - the contract is empty, the
   * round is not this reader's to decide, or it is decided. It is not a
   * statement about who may read a recognition.
   */
  recognitionForm: Schema.NullOr(
    Schema.Struct({
      /** opaque recognition ids with their frozen schemas, in display order */
      fields: Schema.Array(Schema.Struct({ id: Schema.String, schema: configJson })),
      seed: configJson,
      /** what the filing says each determination should be, whatever the round opens on */
      filed: configJson,
      /** determination id -> the payload key of the filed field it takes its value from */
      sources: Schema.Record(Schema.String, Schema.String),
      locked: Schema.NullOr(Schema.Struct({ values: configJson, hash: Schema.String })),
    }),
  ),
  capabilities: Schema.Struct({
    canDecide: Schema.Boolean,
    canCancelSupplement: Schema.Boolean,
    canAnswerSupplement: Schema.Boolean,
  }),
})

const breakdownLine = Schema.Struct({
  lineId: Schema.String,
  kind: Schema.Literals([
    'entry',
    'entry-not-counted',
    'excluded-evidence',
    'item-voided',
    'group-adjustment',
    'derived',
  ]),
  label: Schema.String,
  value: Schema.String,
  itemId: Schema.optional(Schema.String),
  provenance: Schema.optional(
    Schema.Struct({
      entryId: Schema.optional(Schema.String),
      entryRevisionId: Schema.optional(Schema.String),
      /** which determination this line's amount was computed from */
      entryRecognitionId: Schema.optional(Schema.String),
      calculatorRef: Schema.optional(Schema.String),
    }),
  ),
})

/**
 * What one claim currently stands recognised as.
 *
 * Only ever read beside a claim somebody administers. The values are the
 * determination itself - the level, the grade, whatever the question's rule
 * asked of it - and never an amount: what a determination is worth is the
 * ledger's to say, from the arithmetic in force, and a second number here
 * would be a second answer to the same question.
 */
const recognitionView = Schema.Struct({
  id: Schema.String,
  source: Schema.Literals(['review', 'record', 'import', 'system', 'redetermination']),
  /** the filing this determination judged, which is not always the current one */
  entryRevisionId: Schema.String,
  values: configJson,
  createdAt: Schema.Number,
  createdByName: Schema.NullOr(Schema.String),
  /** a sitting of several reviewers determined it, not one person */
  byPanel: Schema.Boolean,
})

/** one claim as a staff account reads it: the claim, and where it stands */
const participantEntryView = Schema.Struct({
  entry: entryView,
  /** what this reader may do to correct the claim's conclusion */
  corrections: Schema.Struct({
    reopen: actionAvailability,
    redetermine: actionAvailability,
  }),
  recognition: Schema.NullOr(recognitionView),
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
      params: Schema.Struct({ batchId: uuidInput }),
      success: Schema.Struct({
        groups: Schema.Array(
          Schema.Struct({
            /**
             * Nothing when the step resolved to no unit at all: a duty this
             * participant's lineage carries that nobody anywhere holds. The
             * round stops there rather than stepping over it (§32.62), so it
             * has no unit to name.
             */
            nodeId: Schema.NullOr(Schema.String),
            nodeName: Schema.NullOr(Schema.String),
            roleNames: Schema.Array(Schema.String),
            /** why these wait: a staffing gap and a conflict rule read differently */
            reason: Schema.Literals([
              'no-assignee',
              'no-independent-reviewer',
              'panel-seat-unfilled',
            ]),
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
      params: Schema.Struct({ batchId: uuidInput }),
      query: Schema.Struct({ nodeTypeId: uuidInput, roleIds: idList }),
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
    // What a save would say about a whole candidate question, asked while it
    // is still being composed. The same gauntlet a save runs, under the same
    // lock, writing nothing; every reason comes back at once, each with the
    // path into the configuration it is about, so a screen can put each one
    // where the thing it names is drawn. A candidate that is fine answers
    // with an empty list, which is a success and not an absence.
    HttpApiEndpoint.post('checkItem', '/assessment/batches/:batchId/item-checks', {
      params: Schema.Struct({ batchId: uuidInput }),
      payload: Schema.Struct({
        /** the question being edited, when there is one */
        itemId: Schema.optional(uuidInput),
        itemType: itemTypeCode,
        scoreGroupId: uuidInput,
        config: itemConfigPayload,
      }),
      success: Schema.Struct({
        issues: Schema.Array(
          Schema.Struct({
            path: Schema.String,
            reason: Schema.String,
            /** the draft handle of a determination a save has not named yet */
            handle: Schema.optional(Schema.String),
            count: Schema.optional(Schema.Number),
            values: Schema.optional(Schema.Array(Schema.String)),
          }),
        ),
        /** what each determination already holds, and so may not be narrowed away from */
        standing: Schema.Array(
          Schema.Struct({
            recognitionId: Schema.String,
            records: Schema.Number,
            openRounds: Schema.Number,
            determined: Schema.Array(Schema.String),
          }),
        ),
      }),
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // what a candidate's arithmetic would need, before anything is saved:
    // the real compile a save would run, so a screen never offers a binding
    // the save is about to refuse
    HttpApiEndpoint.post('previewScoring', '/assessment/batches/:batchId/scoring-preview', {
      params: Schema.Struct({ batchId: uuidInput }),
      payload: Schema.Struct({
        itemType: Schema.String,
        formConfig: Schema.Unknown,
        calculator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
        /** the question being edited, when there is one: the server reads
         *  ITS frozen plan for the binding being continued */
        itemId: Schema.optional(uuidInput),
      }),
      success: Schema.Struct({
        calculator: Schema.Struct({ ref: Schema.String, contractHash: Schema.String }),
        inputSchema: Schema.Unknown,
        outputSchema: Schema.Unknown,
        /** how the form stands, which is a separate question from the
         *  calculator's: a question is composed by naming the arithmetic
         *  first, and its parameters are what the form is then built from */
        form: Schema.Struct({
          valid: Schema.Boolean,
          issues: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
        }),
        bindableFields: Schema.Array(
          Schema.Struct({
            fieldId: Schema.String,
            payloadKey: Schema.String,
            schema: Schema.Unknown,
            always: Schema.Boolean,
          }),
        ),
      }),
      error: [BatchNotFound, AccessDenied, ItemConfigInvalid],
    }).middleware(Authenticated),
  )
  .add(
    // what a question's configuration may point at, for whoever runs the round
    HttpApiEndpoint.get('itemOptions', '/assessment/batches/:batchId/item-options', {
      params: Schema.Struct({ batchId: uuidInput }),
      success: Schema.Struct({
        orgTypes: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
        roles: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
      }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // gone without ceremony: only for questions nothing ever happened to
    HttpApiEndpoint.delete('deleteItem', '/assessment/items/:itemId', {
      params: Schema.Struct({ itemId: uuidInput }),
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
      params: Schema.Struct({ itemId: uuidInput }),
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
        ItemScoringIncompatible,
        ItemRevisionConflict,
        ScoringUnavailable,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // the caller's own standing in the round, computed on request by the
    // one scorer; never anybody else's through this path
    HttpApiEndpoint.get('getMyResult', '/assessment/batches/:batchId/me/result', {
      params: Schema.Struct({ batchId: uuidInput }),
      success: myResultView,
      error: [BatchNotFound, ParticipantNotFound, ScoringUnavailable, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the caller's own queue; there is nothing here to name or filter by
    // another person, so the path carries no batch and no user
    HttpApiEndpoint.get('listReviewInbox', '/assessment/review/inbox', {
      query: Schema.Struct({
        ...pageQuery,
        /** narrow the queue to one batch; the workbench always asks this way */
        batchId: Schema.optional(uuidInput),
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
        /**
         * Whether the phase of the moment opens judging in the batch asked
         * about. While it does not, the queue is empty however much is
         * waiting, and says so instead of promising work. Always true when
         * the queue was asked for across batches.
         */
        judging: Schema.Boolean,
      }),
      error: [BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // What this reviewer's step is waiting on somebody else for: its own
    // list, because the queue is what can be decided now and a round paused
    // for material cannot (§32.65 ⑤).
    HttpApiEndpoint.get('listAwaitingSupplements', '/assessment/review/supplement-requests', {
      query: Schema.Struct({ ...pageQuery, batchId: uuidInput }),
      success: Schema.Struct({
        items: Schema.Array(
          Schema.Struct({
            requestId: Schema.String,
            instanceId: Schema.String,
            entryId: Schema.String,
            requestNo: Schema.Number,
            /** open: still with the person who filed. answered: back here. */
            status: Schema.Literals(['open', 'answered']),
            participantName: Schema.String,
            businessNo: Schema.NullOr(Schema.String),
            itemTitle: Schema.String,
            /** what was asked for, by label, for the one line that says it */
            asks: Schema.Array(Schema.String),
            requestedAt: Schema.String,
            answeredAt: Schema.NullOr(Schema.String),
          }),
        ),
        nextCursor: Schema.NullOr(Schema.String),
      }),
      error: [BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getReviewInstance', '/assessment/review/instances/:instanceId', {
      params: Schema.Struct({ instanceId: uuidInput }),
      success: Schema.Struct({ review: reviewDetailView }),
      error: [ReviewNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // what a determination would come to, asked while it is being written:
    // the same judge and the same arithmetic the decision runs, so a screen
    // can say "3.50" or "the rule refuses this" before anything is staged
    HttpApiEndpoint.post(
      'previewDetermination',
      '/assessment/review/instances/:instanceId/determination-previews',
      {
        params: Schema.Struct({ instanceId: uuidInput }),
        payload: Schema.Struct({ values: configJson }),
        success: Schema.Struct({
          issues: Schema.Array(
            Schema.Struct({ recognitionId: Schema.String, reason: Schema.String }),
          ),
          amount: Schema.NullOr(Schema.String),
          refusal: Schema.NullOr(Schema.String),
        }),
        error: [ReviewNotFound, ScoringUnavailable, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('decideReview', '/assessment/review/instances/:instanceId/decisions', {
      params: Schema.Struct({ instanceId: uuidInput }),
      payload: Schema.Struct({
        decision: Schema.Literals(['approve', 'reject', 'escalate']),
        /**
         * One of the batch's configured reason labels, for reject and
         * escalate. Required exactly when the batch configured a list for
         * that act; free text stays in `comment`.
         */
        reason: Schema.optional(trimmedName(100)),
        comment: Schema.optional(boundedText(2000)),
        suggestedPayload: Schema.optional(configJson),
        // what this approval determines, for questions that ask anything.
        // Absent is the normal case today: no installed calculator asks for
        // a recognised fact, so the server determines the empty one itself
        recognition: Schema.optional(
          Schema.Struct({
            values: configJson,
            /** why the determination CHANGED; required only when it did */
            reason: Schema.optional(boundedText(2000)),
          }),
        ),
      }),
      success: Schema.Struct({ review: reviewDetailView }),
      error: [
        ReviewNotFound,
        ReviewConflict,
        ItemRevisionConflict,
        BatchReadOnly,
        EntryActionRefused,
        EntryPayloadInvalid,
        DeterminationRefused,
        ScoringUnavailable,
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
        batchId: uuidInput,
        itemId: uuidInput,
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
        params: Schema.Struct({ reservationId: uuidInput }),
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
    // Many files at once, for a screen that cites many: one crossing instead
    // of one per file. A keyed multi-get rather than an open collection, so
    // it is bounded by the ids asked for and carries no cursor; ids the
    // reader may not touch are omitted, indistinguishable from absent ones.
    HttpApiEndpoint.get('listAttachmentDescriptors', '/assessment/attachments', {
      query: Schema.Struct({ id: Schema.ArrayEnsure(uuidInput) }),
      success: Schema.Struct({ attachments: Schema.Array(attachmentDescriptor) }),
      error: [BadRequest, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // what the file is and how to fetch it: a short-lived url for stores
    // that sign their own, or this api's own content door
    HttpApiEndpoint.get('describeAttachment', '/assessment/attachments/:attachmentId', {
      params: Schema.Struct({ attachmentId: uuidInput }),
      success: attachmentDescriptor,
      error: [AttachmentUnavailable, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the bytes themselves, for deployments whose store has no public door
    HttpApiEndpoint.get('getAttachmentContent', '/assessment/attachments/:attachmentId/content', {
      params: Schema.Struct({ attachmentId: uuidInput }),
      success: HttpApiSchema.StreamUint8Array(),
      error: [AttachmentUnavailable, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the way back in after a refresh: everything the caller has filed in
    // this round, whatever state it is in now
    HttpApiEndpoint.get('listMyEntries', '/assessment/batches/:batchId/me/entries', {
      params: Schema.Struct({ batchId: uuidInput }),
      query: Schema.Struct(pageQuery),
      success: Schema.Struct({
        /** the caller's own membership row: what a first filing names */
        participantId: Schema.String,
        entries: Schema.Array(entryView),
        /**
         * The phase gate's word on filing into each active question, before
         * any claim exists - so the "file a claim" press and the submit half
         * of the dialog render the refusal instead of discovering it. Per
         * item, because a scoped supplementary phase admits some questions
         * and not others. Structural reasons (quota, entry source, a voided
         * item) stay with the screen; these rows answer for the phase.
         */
        filing: Schema.Array(
          Schema.Struct({
            itemId: Schema.String,
            create: actionAvailability,
            submit: actionAvailability,
          }),
        ),
        nextCursor: Schema.NullOr(Schema.String),
        /**
         * The unread dots (§32.72): questions where something changed FOR
         * this reader since they last looked. Not on entryView, on purpose -
         * that view also reaches reviewers and administrators, and whether
         * the owner has read their news is nobody else's field.
         */
        attention: Schema.Struct({ unreadItemIds: Schema.Array(Schema.String) }),
      }),
      error: [BatchNotFound, ParticipantNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    /**
     * The owner has looked at one question's claims. Idempotent, gate-free
     * (a look is not a business act), archived batches included; touching
     * only the caller's own participant row is the whole authorization.
     */
    HttpApiEndpoint.put('markMyEntryRead', '/assessment/batches/:batchId/me/items/:itemId/read', {
      params: Schema.Struct({ batchId: uuidInput, itemId: uuidInput }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [BatchNotFound, ParticipantNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    /**
     * The reader's desk on this batch, one branch per standing they hold
     * (§32.73). A branch the reader does not have is null - "not a
     * participant" and "a participant with nothing to do" are different
     * facts, and neither is an error. Draft work is deliberately absent
     * from the participant branch: drafts are the owner's own doing, not
     * something the round asked of them.
     */
    HttpApiEndpoint.get('getMyOverview', '/assessment/batches/:batchId/me/overview', {
      params: Schema.Struct({ batchId: uuidInput }),
      success: Schema.Struct({
        participant: Schema.NullOr(
          Schema.Struct({
            /** the questions with changes their owner has not looked at */
            unreadItemIds: Schema.Array(Schema.String),
            actions: Schema.Array(
              Schema.Struct({
                kind: Schema.Literals(['supplement', 'revision']),
                entryId: Schema.String,
                itemId: Schema.String,
                itemTitle: Schema.String,
                at: Schema.String,
                who: Schema.NullOr(Schema.String),
                summary: Schema.NullOr(Schema.String),
              }),
            ),
          }),
        ),
        reviewer: Schema.NullOr(
          Schema.Struct({
            /** claims standing in this reviewer's queue right now */
            pendingCount: Schema.Number,
            /** asks this reviewer sent that have come back answered */
            answeredAskCount: Schema.Number,
            /** the queue split by score group, for the row's second line */
            queueGroups: Schema.Array(Schema.Struct({ name: Schema.String, count: Schema.Number })),
            /** who answered which question, newest first */
            answeredAsks: Schema.Array(
              Schema.Struct({ who: Schema.NullOr(Schema.String), itemTitle: Schema.String }),
            ),
          }),
        ),
      }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    /**
     * What this reader has to do in every round under way, one row each.
     *
     * Its own endpoint rather than a column on the batch list: that list is
     * paged and filtered, and a reader's standing is not a fact about the
     * batch - computing it for every row of every page would make a list of
     * rounds pay for a question only the card above it asks.
     *
     * Both halves are null for a reader the half is not about, and present
     * - nought included - for one it is: "not your job" and "your job,
     * nothing pending" are different answers, and only the first means
     * there is no line to draw. So `reviewsWaiting` is null for somebody
     * who does not judge in that round, and `myEntries` is null for
     * somebody who is not on its roster; a participant who has filed
     * nothing yet gets all noughts, which is a line worth drawing. The
     * path carries no batch and no user for the same reason the review
     * queue's does not: there is nothing here to ask on somebody else's
     * behalf.
     */
    HttpApiEndpoint.get('listMyStanding', '/assessment/standing', {
      success: Schema.Struct({
        items: Schema.Array(
          Schema.Struct({
            batchId: Schema.String,
            /**
             * this reader's own filings, each counted once under what it is
             * waiting for, and whether a new one can be started now, at a
             * later stage, or not again
             */
            myEntries: Schema.NullOr(
              Schema.Struct({
                toAnswer: Schema.Number,
                toFix: Schema.Number,
                draft: Schema.Number,
                rejected: Schema.Number,
                submitted: Schema.Number,
                approved: Schema.Number,
                filing: Schema.Literals(['open', 'upcoming', 'closed']),
              }),
            ),
            reviewsWaiting: Schema.NullOr(Schema.Number),
          }),
        ),
      }),
    }).middleware(Authenticated),
  )
  .add(
    /**
     * What happened around this user in the batch lately, newest first and
     * in business words: their own claims' story as a participant, their
     * own review acts as a reviewer - never raw event kinds, and never the
     * shared queue's traffic. One claim's or one round's full history
     * stays on that object's own page.
     */
    HttpApiEndpoint.get('listMyActivity', '/assessment/batches/:batchId/me/activity', {
      params: Schema.Struct({ batchId: uuidInput }),
      query: Schema.Struct({
        ...pageQuery,
        perspective: Schema.optional(Schema.Literals(['participant', 'reviewer'])),
      }),
      success: Schema.Struct({
        items: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            /** which of the reader's standings this row spoke to */
            perspective: Schema.Literals(['participant', 'reviewer']),
            kind: Schema.Literals([
              'entry-created',
              'entry-revised',
              'entry-submitted',
              'entry-withdrawn',
              'entry-abandoned',
              'entry-voided',
              'entry-voided-with-item',
              'review-approved',
              'review-rejected',
              'review-escalated',
              'appeal-filed',
              'supplement-requested',
              'supplement-submitted',
              'supplement-cancelled',
              'revision-required',
              'review-stage-approved',
              'review-opinion-rejected',
              'supplement-answered',
              'review-vote-approved',
              'review-vote-rejected',
            ]),
            entryId: Schema.String,
            itemId: Schema.String,
            itemTitle: Schema.String,
            /** whose claim it is, on rows about somebody else's work */
            subjectName: Schema.NullOr(Schema.String),
            /**
             * The way back into the round, only while this reader may
             * still open it - the server judges by the same rule the
             * queue reads with, so a link here never lands on a refusal.
             */
            instanceId: Schema.NullOr(Schema.String),
            /** the claim's identity line, in the shared projection (§32.74) */
            summary: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
            actorName: Schema.NullOr(Schema.String),
            reason: Schema.NullOr(Schema.String),
            comment: Schema.NullOr(Schema.String),
            at: Schema.String,
          }),
        ),
        nextCursor: Schema.NullOr(Schema.String),
      }),
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // the whole account of one claim: every revision as written, every
    // round it went through, every word said in them
    HttpApiEndpoint.get('getEntryHistory', '/assessment/entries/:entryId/revisions', {
      params: Schema.Struct({ entryId: uuidInput }),
      success: Schema.Struct({
        /** false where the phase keeps from the participant who judged the claim */
        reviewersShown: Schema.Boolean,
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
            /** the determination contested, where no round produced it */
            appealedRecognitionId: Schema.NullOr(Schema.String),
            /**
             * What a round that revisited a conclusion did to it, derived by
             * the system from where the claim stood before and after; null
             * for every other round
             */
            effect: Schema.NullOr(
              Schema.Literals(['upheld', 'corrected', 'revoked', 'overturned']),
            ),
            submittedAt: Schema.String,
            completedAt: Schema.NullOr(Schema.String),
            events: Schema.Array(
              Schema.Struct({
                kind: Schema.String,
                actorId: Schema.NullOr(Schema.String),
                actorName: Schema.NullOr(Schema.String),
                /**
                 * The round itself reached this, rather than a person: a
                 * sitting that concluded on its quorum. Distinct from a
                 * person whose name this reader is not told (§32.85), which
                 * is a judge all the same.
                 */
                byRound: Schema.Boolean,
                reason: Schema.NullOr(Schema.String),
                comment: Schema.NullOr(Schema.String),
                suggestedPayload: configJson,
                at: Schema.String,
              }),
            ),
            /** what this round asked for beyond the filing, and what came back */
            supplements: Schema.Array(reviewSupplementView),
          }),
        ),
      }),
      error: [EntryNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createEntry', '/assessment/entries', {
      payload: Schema.Struct({
        itemId: uuidInput,
        participantId: uuidInput,
        /**
         * Which version of the question the screen was drawn from.
         *
         * Optional because not every caller draws a form - but whoever does
         * must send it, or an answer written against yesterday's rules is
         * filed against today's without anybody being told.
         */
        expectedItemRevisionId: Schema.optional(uuidInput),
        payload: configJson,
        note: Schema.optional(boundedText(500)),
        /**
         * What the office determines by recording this.
         *
         * Only for an administrative record, which is approved the moment it
         * is written: the member of staff filing it is its author, so they
         * are the one who says what it is recognised as. Absent means "the
         * defaults the plan seeds from the material", which is the whole
         * answer for a question that asks nothing.
         */
        recognition: Schema.optional(Schema.Struct({ values: configJson })),
      }),
      success: Schema.Struct({ entry: entryView }),
      error: [
        ItemNotFound,
        ItemRevisionConflict,
        BatchNotFound,
        BatchReadOnly,
        EntryActionRefused,
        EntryPayloadInvalid,
        DeterminationRefused,
        ScoringUnavailable,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getEntry', '/assessment/entries/:entryId', {
      params: Schema.Struct({ entryId: uuidInput }),
      success: Schema.Struct({ entry: entryView }),
      error: [EntryNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('reviseEntry', '/assessment/entries/:entryId/revisions', {
      params: Schema.Struct({ entryId: uuidInput }),
      payload: Schema.Struct({
        /** the version of the question this revision answers; see createEntry */
        expectedItemRevisionId: Schema.optional(uuidInput),
        /**
         * The version of the claim the screen was drawn from. Another tab
         * or device can have saved since, and writing on top of that
         * without knowing would replace it unseen.
         */
        expectedEntryRevisionId: Schema.optional(uuidInput),
        payload: configJson,
        note: Schema.optional(boundedText(500)),
      }),
      success: Schema.Struct({ entry: entryView }),
      error: [
        EntryNotFound,
        ItemRevisionConflict,
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
      params: Schema.Struct({ entryId: uuidInput }),
      /** submit is in_review, withdraw is draft, abandoning the claim is voided */
      payload: Schema.Struct({
        status: Schema.Literals(['in_review', 'draft', 'voided']),
        /**
         * The version of the question the screen showed when the press
         * happened - not the one the draft was written under. Handing a
         * filing on is a decision about today's rules, and this says which
         * rules the person deciding had in front of them.
         */
        expectedItemRevisionId: Schema.optional(uuidInput),
        /** the version of the claim the screen showed, for handing on exactly that */
        expectedEntryRevisionId: Schema.optional(uuidInput),
      }),
      success: Schema.Struct({ entry: entryView }),
      error: [
        EntryNotFound,
        ItemRevisionConflict,
        BatchReadOnly,
        EntryActionRefused,
        DeterminationRefused,
        ScoringUnavailable,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // What somebody who may change the round's arrangements can do to a claim
    // without pretending to be its reviewer. Judging stays behind
    // decideReview, which keeps asking whether the caller really holds the
    // level the round is standing at (§32.62).
    HttpApiEndpoint.post('interveneOnEntry', '/assessment/entries/:entryId/interventions', {
      params: Schema.Struct({ entryId: uuidInput }),
      payload: Schema.Struct({
        kind: Schema.Literals(['return-for-revision', 'void']),
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
    // by the claim, not by the round: an administrative record has no round
    // and is still a decision its subject may disagree with
    HttpApiEndpoint.post('appealEntry', '/assessment/entries/:entryId/appeals', {
      params: Schema.Struct({ entryId: uuidInput }),
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
    // Correcting a concluded claim outside any round: the same question a
    // reviewer answers - yes or no, and when yes what it is recognised as -
    // compared by the server with where the claim stands. A round still
    // contesting the claim ends with it.
    HttpApiEndpoint.post('redetermineEntry', '/assessment/entries/:entryId/redeterminations', {
      params: Schema.Struct({ entryId: uuidInput }),
      payload: Schema.Struct({
        decision: Schema.Literals(['approve', 'reject']),
        recognition: Schema.optional(Schema.Struct({ values: configJson })),
        /** why it is being corrected; kept with the claim's own record */
        reason: boundedText(500),
      }),
      success: Schema.Struct({
        redetermination: Schema.Struct({
          kind: Schema.Literals([
            'recognition-corrected',
            'approval-revoked',
            'rejection-overturned',
          ]),
          status: Schema.Literals(['approved', 'rejected']),
          /** whether a round contesting the claim was ended by it */
          endedRound: Schema.Boolean,
        }),
      }),
      error: [
        EntryNotFound,
        BatchReadOnly,
        EntryActionRefused,
        EntryPayloadInvalid,
        ItemRevisionConflict,
        DeterminationRefused,
        ScoringUnavailable,
        AccessDenied,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    // Staff contesting a claim's conclusion on its participant's behalf: a
    // round on the whole escalation route, as an appeal walks it, that does
    // not spend the participant's own appeal
    HttpApiEndpoint.post('reopenEntry', '/assessment/entries/:entryId/reopenings', {
      params: Schema.Struct({ entryId: uuidInput }),
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
    // asking for more backing without moving the round: the reviewer's half
    // of the supplement exchange (§32.65 ⑤). Keys are assigned server-side.
    HttpApiEndpoint.post(
      'requestSupplement',
      '/assessment/review/instances/:instanceId/supplement-requests',
      {
        params: Schema.Struct({ instanceId: uuidInput }),
        payload: Schema.Struct({
          instructions: boundedText(2000),
          // A ceiling on the body only. The rule (a handful of pieces) is the
          // service's, answered as a field issue the dialog can show.
          requirements: Schema.Array(
            Schema.Struct({
              label: trimmedName(100),
              kind: Schema.Literals(['text', 'file']),
              required: Schema.Boolean,
            }),
          ).check(Schema.isMaxLength(32)),
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
      },
    ).middleware(Authenticated),
  )
  .add(
    // taking the ask back; the round returns to the queue as it stood
    HttpApiEndpoint.put(
      'cancelSupplement',
      '/assessment/review/supplement-requests/:requestId/status',
      {
        params: Schema.Struct({ requestId: uuidInput }),
        payload: Schema.Struct({ status: Schema.Literals(['cancelled']) }),
        success: Schema.Struct({ review: reviewDetailView }),
        error: [
          ReviewNotFound,
          ReviewConflict,
          BatchReadOnly,
          EntryActionRefused,
          AccessDenied,
          BadRequest,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    // the participant's half: the answer, keyed by the ask's own pieces
    HttpApiEndpoint.post(
      'answerSupplement',
      '/assessment/review/supplement-requests/:requestId/responses',
      {
        params: Schema.Struct({ requestId: uuidInput }),
        payload: Schema.Struct({ payload: configJson }),
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
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listItems', '/assessment/batches/:batchId/items', {
      params: Schema.Struct({ batchId: uuidInput }),
      success: Schema.Struct({
        items: Schema.Array(itemView),
        capabilities: Schema.Struct({ canManage: Schema.Boolean }),
      }),
      error: [AccessDenied, BatchNotFound],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createItem', '/assessment/batches/:batchId/items', {
      params: Schema.Struct({ batchId: uuidInput }),
      payload: Schema.Struct({
        itemType: itemTypeCode,
        title: trimmedName(255),
        scoreGroupId: uuidInput,
        maxEntries: Schema.optional(Schema.NullOr(positiveCount)),
        sortOrder: Schema.optional(sortOrder),
        config: itemConfigPayload,
      }),
      success: Schema.Struct({ item: itemView }),
      error: [AccessDenied, BatchNotFound, BatchReadOnly, ItemConfigInvalid, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // What a registrar's screen needs to collect a determination: the
    // frozen fields and the default map. Never the execution plan.
    HttpApiEndpoint.get(
      'getRecognitionContract',
      '/assessment/items/:itemId/recognition-contract',
      {
        params: Schema.Struct({ itemId: uuidInput }),
        success: Schema.Struct({
          contract: Schema.NullOr(
            Schema.Struct({
              itemRevisionId: uuidInput,
              /** opaque recognition ids with their frozen schemas, in display order */
              fields: Schema.Array(Schema.Struct({ id: Schema.String, schema: configJson })),
              defaults: Schema.Array(
                Schema.Struct({
                  recognitionId: Schema.String,
                  /** the payload address the pre-fill reads from */
                  payloadKey: Schema.String,
                  assignment: Schema.Union([
                    Schema.Struct({ kind: Schema.Literal('direct') }),
                    Schema.Struct({
                      kind: Schema.Literal('convert'),
                      converter: Schema.Literal('integer-to-decimal@1'),
                    }),
                  ]),
                }),
              ),
            }),
          ),
        }),
        error: [ItemNotFound, AccessDenied],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getItem', '/assessment/items/:itemId', {
      params: Schema.Struct({ itemId: uuidInput }),
      success: Schema.Struct({
        item: itemView,
        capabilities: Schema.Struct({ canManage: Schema.Boolean }),
      }),
      error: [AccessDenied, ItemNotFound],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateItem', '/assessment/items/:itemId', {
      params: Schema.Struct({ itemId: uuidInput }),
      payload: changed(
        {
          title: Schema.optional(trimmedName(255)),
          /** what kind of question this is; only a draft nothing was filed into may change it */
          itemType: Schema.optional(itemTypeCode),
          scoreGroupId: Schema.optional(uuidInput),
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
          expectedRevisionId: Schema.optional(Schema.NullOr(uuidInput)),
          /**
           * What should happen to work already under way. Absent on the
           * first pass: a save that would disturb something comes back with
           * the impact report and is sent again with this filled in.
           */
          effects: Schema.optional(changeEffects),
        },
        ['title', 'itemType', 'scoreGroupId', 'maxEntries', 'sortOrder', 'config'],
      ),
      success: Schema.Struct({ item: itemView }),
      error: [
        AccessDenied,
        ItemNotFound,
        BatchNotFound,
        BatchReadOnly,
        ItemChangeDecisionRequired,
        ItemConfigInvalid,
        ItemScoringIncompatible,
        ScoringUnavailable,
        BadRequest,
      ],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listScoreGroups', '/assessment/batches/:batchId/score-groups', {
      params: Schema.Struct({ batchId: uuidInput }),
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
      params: Schema.Struct({ batchId: uuidInput }),
      payload: Schema.Struct({
        // the whole tree, every time: a real paper has a few dozen groups,
        // and each one is checked against its ancestors and written under
        // the batch lock
        groups: Schema.Array(scoreGroupSpec).check(Schema.isMaxLength(MAX_SCORE_GROUPS)),
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
        /** how many of each kind the search matches, for the filter chips */
        statusCounts: Schema.Struct({
          draft: Schema.Number,
          active: Schema.Number,
          archived: Schema.Number,
        }),
        // whether this reader may start a round at all, rather than only read
        // the ones they are in: the control that opens the form is not drawn
        // for somebody the api would refuse
        capabilities: Schema.Struct({ create: Schema.Boolean }),
      }),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    /**
     * The rounds one person took part in, for their record.
     *
     * Roster membership, not authority: which rounds somebody helped run is
     * a different question, answered by the grants screen through the
     * presenter this plugin registers. Rows are the rounds the READER may
     * see - administering them, working on them, or being in them - with
     * the person's membership in each.
     */
    HttpApiEndpoint.get('listUserBatches', '/assessment/users/:userId/batches', {
      params: Schema.Struct({ userId: uuidInput }),
      query: Schema.Struct(pageQuery),
      success: pageOf(userBatchView),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    /**
     * The rounds the reader is in, for their own account. The same rows as a
     * person's record, asked about the one person who needs no authority to
     * ask: there is no user id to name anybody else by.
     */
    HttpApiEndpoint.get('listMyBatches', '/assessment/me/batches', {
      query: Schema.Struct(pageQuery),
      success: pageOf(userBatchView),
      error: [BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    /**
     * What one person filed, across the rounds the reader administers or
     * works on. Fellow participants see nothing here: a claim is its owner's
     * and the round's staff's, never the room's.
     */
    HttpApiEndpoint.get('listUserEntries', '/assessment/users/:userId/entries', {
      params: Schema.Struct({ userId: uuidInput }),
      query: Schema.Struct(pageQuery),
      success: pageOf(userEntryView),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createBatch', '/assessment/batches', {
      payload: Schema.Struct({
        name: trimmedName(255),
        descriptionMd: Schema.optional(boundedText(65536)),
        materialRange,
        timezone: Schema.optional(timeZoneName),
        // where the first people come from: a query run once, not a scope the
        // batch keeps and has to be reconciled against afterwards
        import: importSelection,
      }),
      success: Schema.Struct({ batch: batchView }),
      error: [AccessDenied, BatchReferenceInvalid, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // What a browser holding this batch open is told, as it happens: that
    // something it may be caching has changed, and nothing else. No ids, no
    // payloads - an event names a region of the screen to re-read, and the
    // re-read goes through the same authorized endpoints as everything else.
    // Nothing rides this stream that its holder was not already entitled to
    // ask for.
    HttpApiEndpoint.get('watchBatch', '/assessment/batches/:batchId/events', {
      params: Schema.Struct({ batchId: uuidInput }),
      success: HttpApiSchema.StreamSse({ data: batchLiveEvent }),
      error: [AccessDenied],
    }).middleware(Authenticated),
    HttpApiEndpoint.get('getBatch', '/assessment/batches/:batchId', {
      params: Schema.Struct({ batchId: uuidInput }),
      success: Schema.Struct({ batch: batchView }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateBatch', '/assessment/batches/:batchId', {
      params: Schema.Struct({ batchId: uuidInput }),
      payload: changed(
        {
          name: Schema.optional(trimmedName(255)),
          descriptionMd: Schema.optional(Schema.NullOr(boundedText(65536))),
          materialRange: Schema.optional(materialRange),
          timezone: Schema.optional(timeZoneName),
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
      params: Schema.Struct({ batchId: uuidInput }),
      payload: Schema.Union([
        Schema.Struct({
          status: Schema.Literal('archived'),
          reason: Schema.optional(boundedText(500)),
        }),
        Schema.Struct({
          status: Schema.Literal('active'),
          reason: boundedText(500),
          phase: Schema.Struct({
            // the column every other phase name is written to
            displayName: trimmedName(100),
            description: Schema.optional(boundedText(500)),
            permissionProfile: Schema.optional(permissionProfileInput),
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
      params: Schema.Struct({ batchId: uuidInput }),
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
      params: Schema.Struct({ batchId: uuidInput }),
      query: Schema.Struct(pageQuery),
      success: accessSyncPageView,
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // Only what was chosen, and only as much of it as the organization still
    // offers: the selection narrows the change, it cannot invent one.
    HttpApiEndpoint.post('applyAccessSync', '/assessment/batches/:batchId/access/sync', {
      params: Schema.Struct({ batchId: uuidInput }),
      payload: Schema.Struct({
        // as many changes as a roster has people, each carrying at most the
        // capabilities a batch accepts at all: what one sync can merge is
        // bounded by the round, not by the request body
        accept: Schema.Array(
          Schema.Struct({
            kind: Schema.Literals(['new', 'widened']),
            id: uuidInput,
            permissions: Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(
              Schema.isMaxLength(BATCH_STAFF_CODES.length),
            ),
          }),
        ).check(Schema.isMaxLength(5000)),
      }),
      success: Schema.Struct({ merged: Schema.Number, cleared: Schema.Number }),
      error: [BatchNotFound, BatchReadOnly, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // one capability, for one person, in this batch: idempotent by nature
    HttpApiEndpoint.put(
      'setAccessDeny',
      '/assessment/batches/:batchId/access/:userId/permissions/:permission',
      {
        params: Schema.Struct({ batchId: uuidInput, userId: uuidInput, permission: Schema.String }),
        payload: Schema.Struct({
          denied: Schema.Boolean,
          reason: Schema.optional(boundedText(500)),
        }),
        success: Schema.Struct({ staff: Schema.Array(accessSubjectView) }),
        error: [BatchNotFound, BatchReadOnly, AccessInvalid, AccessDenied],
      },
    ).middleware(Authenticated),
  )
  .add(
    // What bringing somebody in can be: the units this round's people stand
    // in, and - once a person and a unit are named - the roles this caller
    // could actually give them there. Served from this domain so the screen
    // needs no authority over the tenant's roles beyond its own.
    HttpApiEndpoint.get('staffOptions', '/assessment/batches/:batchId/staff-options', {
      params: Schema.Struct({ batchId: uuidInput }),
      // the whole selection, because the write applies the role to every
      // pair of it at once: a list answering for one person in one unit
      // promises roles the write then refuses, and refuses all of it
      query: Schema.Struct({
        // as many as the write takes; each pair is asked about on its own
        userIds: Schema.optional(idListUpTo(200)),
        orgNodeIds: Schema.optional(idListUpTo(200)),
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
              Schema.Literals([
                'user-type',
                'authority',
                'self-escalation',
                'unavailable',
                'beyond-batch',
              ]),
            ),
          }),
        ),
      }),
      error: [BatchNotFound, AccessInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // somebody brought in for this round: an ordinary assignment confined to
    // this batch, accepted into it in the same breath
    HttpApiEndpoint.post('addStaff', '/assessment/batches/:batchId/access', {
      params: Schema.Struct({ batchId: uuidInput }),
      payload: Schema.Struct({
        // both sides are sets: one person over two classes and two people over
        // one are the same errand, and doing either one pair at a time is a
        // sequence of writes somebody can be interrupted halfway through.
        // Every PAIR is an assignment written inside one transaction, so the
        // two bounds multiply - the server caps the product as well.
        userIds: idsUpTo(200),
        orgNodeIds: idsUpTo(200),
        roleId: uuidInput,
        validUntil: Schema.optional(isoInstant),
      }),
      success: Schema.Struct({ staff: Schema.Array(accessSubjectView) }),
      error: [BadRequest, BatchNotFound, BatchReadOnly, AccessInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('removeStaff', '/assessment/batches/:batchId/access/sources/:sourceId', {
      params: Schema.Struct({ batchId: uuidInput, sourceId: uuidInput }),
      success: Schema.Struct({ staff: Schema.Array(accessSubjectView) }),
      error: [BatchNotFound, AccessInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // A draft nobody ever started. Anything that ran is archived, never
    // deleted: the history is the point.
    HttpApiEndpoint.delete('deleteBatch', '/assessment/batches/:batchId', {
      params: Schema.Struct({ batchId: uuidInput }),
      success: Schema.Struct({ deleted: Schema.Boolean }),
      error: [BatchNotFound, BatchStatusInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getPhases', '/assessment/batches/:batchId/phases', {
      params: Schema.Struct({ batchId: uuidInput }),
      success: Schema.Struct({
        phases: Schema.Array(phaseView),
        /** the plan's structure as read; a whole-plan write hands it back */
        planFingerprint: Schema.String,
      }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the plan's structure as an idempotent replacement: named phases are
    // edited, unnamed ones inserted, and a timeline template appends its
    // phases to the end, copied server-side so its provenance lands with
    // them. Times are not part of it. Exactly one of the two fields.
    HttpApiEndpoint.put('putPhases', '/assessment/batches/:batchId/phases', {
      params: Schema.Struct({ batchId: uuidInput }),
      payload: Schema.Struct({
        fromTemplateId: Schema.optional(uuidInput),
        phases: Schema.optional(phaseSpecs),
        /**
         * The fingerprint of the plan these phases were edited from. A plan
         * that has changed since is refused rather than overwritten; absent,
         * the write is taken as it stands.
         */
        expectedPlanFingerprint: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
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
      params: Schema.Struct({ batchId: uuidInput, phaseId: uuidInput }),
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
      params: Schema.Struct({ batchId: uuidInput }),
      payload: Schema.Struct({
        to: uuidInput,
        force: Schema.optional(Schema.Boolean),
        reason: Schema.optional(boundedText(500)),
      }),
      success: Schema.Struct({ phases: Schema.Array(phaseView) }),
      error: [BatchNotFound, PhaseNotFound, AdvanceInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('getTimeline', '/assessment/batches/:batchId/timeline', {
      params: Schema.Struct({ batchId: uuidInput }),
      success: Schema.Struct({ timeline: Schema.Array(timelineEntry) }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    /**
     * The workbook a recorder fills in, for one question as it stands today.
     *
     * Built rather than stored: a template is a projection of the question's
     * current version, and a stored one is a copy that goes stale the moment
     * somebody edits the paper. The version it was built from rides inside
     * it, which is what lets the import refuse a file filled in against a
     * question that has since moved.
     */
    HttpApiEndpoint.get(
      'administrativeImportTemplate',
      '/assessment/items/:itemId/administrative-import-template',
      {
        params: Schema.Struct({ itemId: uuidInput }),
        success: HttpApiSchema.StreamUint8Array(),
        error: [ItemNotFound, EntryActionRefused, AccessDenied],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * A door for the workbook itself, separate from the one evidence uses.
     *
     * An import's source file is not material backing a claim: nothing cites
     * it, the attachment authorizer would not know what to make of it, and
     * putting it through the evidence door would mean pretending it is
     * evidence to get it stored.
     */
    HttpApiEndpoint.post(
      'prepareAdministrativeImportUpload',
      '/assessment/batches/:batchId/administrative-import-uploads',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        payload: Schema.Struct({
          itemId: uuidInput,
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
        error: [
          BatchNotFound,
          ItemNotFound,
          BatchReadOnly,
          EntryActionRefused,
          AdministrativeImportInvalid,
          AccessDenied,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    // the bytes have arrived; the ticket becomes a staged file, bound to
    // nothing until an import actually succeeds
    HttpApiEndpoint.post(
      'completeAdministrativeImportUpload',
      '/assessment/administrative-import-uploads/:reservationId/complete',
      {
        params: Schema.Struct({ reservationId: uuidInput }),
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
    /**
     * What this file would do, worked out and thrown away.
     *
     * A preview creates no import: an import is a thing that happened, and
     * nothing has happened yet. The server re-reads the workbook from the
     * staged file rather than taking the browser's word for what is in it -
     * otherwise the original kept as provenance and the rows actually
     * written are two different documents.
     */
    HttpApiEndpoint.post(
      'previewAdministrativeImport',
      '/assessment/batches/:batchId/administrative-import-previews',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        payload: Schema.Struct({
          attachmentId: uuidInput,
          itemId: uuidInput,
          expectedItemRevisionId: uuidInput,
          defaultBasis: Schema.optional(boundedText(500)),
        }),
        success: Schema.Struct({
          item: Schema.Struct({
            id: Schema.String,
            title: Schema.String,
            revisionId: Schema.String,
          }),
          summary: Schema.Struct({
            rows: Schema.Number,
            valid: Schema.Number,
            warnings: Schema.Number,
            errors: Schema.Number,
          }),
          rows: Schema.Array(importPreviewRow),
          /** whether committing is offered at all; warnings do not withhold it */
          canCommit: Schema.Boolean,
        }),
        error: [
          BatchNotFound,
          ItemNotFound,
          ItemRevisionConflict,
          BatchReadOnly,
          EntryActionRefused,
          AttachmentUnavailable,
          AdministrativeImportInvalid,
          ScoringUnavailable,
          AccessDenied,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * The import itself: every row, or none of them.
     *
     * Takes no rows from the client. The preview is a courtesy to the person
     * filling the file in, never an authorization to write what it said - so
     * the server opens the stored workbook again, parses it again, judges it
     * again, and only then writes. All-or-nothing on purpose: an import that
     * skipped the rows it could not manage is an import nobody can explain
     * afterwards.
     */
    HttpApiEndpoint.post(
      'commitAdministrativeImport',
      '/assessment/batches/:batchId/administrative-imports',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        payload: Schema.Struct({
          attachmentId: uuidInput,
          itemId: uuidInput,
          expectedItemRevisionId: uuidInput,
          defaultBasis: Schema.optional(boundedText(500)),
          /** the reader has seen the warnings and still wants this */
          confirmWarnings: Schema.optional(Schema.Boolean),
        }),
        success: Schema.Struct({
          importId: Schema.String,
          importedCount: Schema.Number,
        }),
        error: [
          BatchNotFound,
          ItemNotFound,
          ItemRevisionConflict,
          BatchReadOnly,
          EntryActionRefused,
          AttachmentUnavailable,
          AdministrativeImportInvalid,
          DeterminationRefused,
          ScoringUnavailable,
          AccessDenied,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * The imports of this round, to anybody who may record in it.
     *
     * An import is the round's record - the office decided these facts, the
     * uploader is its provenance - so its history is the round's, whoever
     * made it and whatever became of them. Reading the names in one is a
     * narrower door: the rows and the file ask that the reader reach every
     * person the import names.
     */
    HttpApiEndpoint.get(
      'listAdministrativeImports',
      '/assessment/batches/:batchId/administrative-imports',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        query: Schema.Struct({ ...pageQuery }),
        success: pageOf(administrativeImportView),
        error: [BatchNotFound, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * One import, read by the same rule as the history. An import in a
     * round this reader may not record in answers exactly as one that never
     * existed.
     */
    HttpApiEndpoint.get('getAdministrativeImport', '/assessment/administrative-imports/:importId', {
      params: Schema.Struct({ importId: uuidInput }),
      success: administrativeImportDetail,
      error: [AdministrativeImportNotFound],
    }).middleware(Authenticated),
  )
  .add(
    // the file's rows in the file's own order, each with the fact it became
    HttpApiEndpoint.get(
      'listAdministrativeImportRows',
      '/assessment/administrative-imports/:importId/rows',
      {
        params: Schema.Struct({ importId: uuidInput }),
        query: Schema.Struct({ ...pageQuery }),
        success: pageOf(administrativeImportRowView),
        error: [AdministrativeImportNotFound, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * The original workbook: what it is and how to fetch it.
     *
     * The import's own door, not the evidence one. Nothing cites this file,
     * and the evidence authorizer would have to pretend it is material to
     * let anybody read it.
     */
    HttpApiEndpoint.get(
      'describeAdministrativeImportSource',
      '/assessment/administrative-imports/:importId/source',
      {
        params: Schema.Struct({ importId: uuidInput }),
        success: attachmentDescriptor,
        error: [AdministrativeImportNotFound, AccessDenied, AttachmentUnavailable],
      },
    ).middleware(Authenticated),
  )
  .add(
    // the bytes of it, for deployments whose store has no public door
    HttpApiEndpoint.get(
      'getAdministrativeImportSourceContent',
      '/assessment/administrative-imports/:importId/source/content',
      {
        params: Schema.Struct({ importId: uuidInput }),
        success: HttpApiSchema.StreamUint8Array(),
        error: [AdministrativeImportNotFound, AccessDenied, AttachmentUnavailable],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * Withdrawing what is left of an import, all of it or none.
     *
     * A reversal is a thing that happens to an import, not the import
     * going away: the import stays, the facts it created stay as history,
     * and each of them is withdrawn exactly the way a single one is.
     */
    HttpApiEndpoint.post(
      'reverseAdministrativeImport',
      '/assessment/administrative-imports/:importId/reversals',
      {
        params: Schema.Struct({ importId: uuidInput }),
        payload: Schema.Struct({ reason: boundedText(500) }),
        success: Schema.Struct({ affectedCount: Schema.Number }),
        error: [
          AdministrativeImportNotFound,
          BatchReadOnly,
          EntryActionRefused,
          AdministrativeImportInvalid,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * The book of what the institution has recorded in this round.
     *
     * Its own read rather than the general claim list with a filter: the
     * question here is "what has been decided", and the answer wants the
     * person, the question, who signed it and what it was determined to be -
     * none of which a claim-centred view carries. Only `record` and `import`
     * are ever in it.
     *
     * The determination's fields come from the question version it was
     * judged under, never the question as it stands today: a determination
     * read through a schema it was not made against is a determination
     * misread.
     */
    HttpApiEndpoint.get(
      'listAdministrativeEntries',
      '/assessment/batches/:batchId/administrative-entries',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        query: Schema.Struct({
          ...pageQuery,
          /** a name or a business number of the person it is about */
          q: Schema.optional(boundedText(100)),
          /** one fact, for a screen opened on it by address */
          entryId: Schema.optional(uuidInput),
          itemId: Schema.optional(uuidInput),
          source: Schema.optional(Schema.Literals(['record', 'import'])),
          status: Schema.optional(administrativeStatus),
          orgNodeIds: Schema.optional(idList),
          orgScope: Schema.optional(Schema.Literals(['self', 'subtree'])),
        }),
        success: Schema.Struct({
          entries: Schema.Array(administrativeEntryView),
          nextCursor: Schema.NullOr(Schema.String),
        }),
        error: [BatchNotFound, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listParticipants', '/assessment/batches/:batchId/participants', {
      params: Schema.Struct({ batchId: uuidInput }),
      query: Schema.Struct({
        ...pageQuery,
        status: Schema.optional(Schema.Literals(['active', 'excluded'])),
        /** a name or a business number; matched in sql, so the walk holds */
        q: Schema.optional(boundedText(100)),
        /** narrowed to the people this round admitted from these units */
        orgNodeIds: Schema.optional(idList),
        /** that unit only, or everything under it; under it when absent */
        orgScope: Schema.optional(Schema.Literals(['self', 'subtree'])),
        /** the kind of person this round froze them as, not what they are now */
        userTypeId: Schema.optional(uuidInput),
      }),
      success: pageOf(participantView),
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    /**
     * Who one administrative finding would reach, and what would refuse it.
     *
     * Arithmetic, not history: nothing is written, and the fingerprint it
     * returns is what the confirmation carries back so the act lands on the
     * people somebody actually looked at.
     */
    HttpApiEndpoint.post(
      'previewAdministrativeRecord',
      '/assessment/batches/:batchId/administrative-record-previews',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        payload: Schema.Struct({
          itemId: uuidInput,
          expectedItemRevisionId: uuidInput,
          target: recordTargetInput,
          excludedParticipantIds: Schema.optional(idList),
          payload: Schema.Record(Schema.String, Schema.Unknown),
          recognition: Schema.optional(
            Schema.Struct({ values: Schema.Record(Schema.String, Schema.Unknown) }),
          ),
          basis: boundedText(500),
        }),
        success: Schema.Struct({
          item: Schema.Struct({
            id: Schema.String,
            title: Schema.String,
            revisionId: Schema.String,
          }),
          requestedCount: Schema.Number,
          eligibleCount: Schema.Number,
          blocked: Schema.Array(recordBlockerView),
          targetFingerprint: Schema.String,
        }),
        error: [
          BatchNotFound,
          BatchReadOnly,
          AccessDenied,
          ItemNotFound,
          ItemRevisionConflict,
          DeterminationRefused,
          EntryPayloadInvalid,
          // a selection past the ceiling: refused here as well as at the
          // write, so a reader is never shown a set the write would refuse
          AdministrativeRecordRefused,
          ScoringUnavailable,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * What one determination being composed would score, asked while the
     * office is still typing it: no targets, no filing, nothing written.
     * The formula's refusal and a value the contract will not take are met
     * here rather than on the press that files the act for everybody.
     */
    HttpApiEndpoint.post(
      'previewRecordDetermination',
      '/assessment/batches/:batchId/record-determination-previews',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        payload: Schema.Struct({ itemId: uuidInput, values: configJson }),
        success: Schema.Struct({
          issues: Schema.Array(
            Schema.Struct({ recognitionId: Schema.String, reason: Schema.String }),
          ),
          amount: Schema.NullOr(Schema.String),
          refusal: Schema.NullOr(Schema.String),
        }),
        error: [BatchNotFound, AccessDenied, ItemNotFound, ScoringUnavailable],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * The act itself: every confirmed person or none of them.
     *
     * The fingerprint names the set that was confirmed and the exclusions
     * say who the caller dropped, which is what lets the server rebuild
     * exactly that set and refuse if it has moved.
     */
    HttpApiEndpoint.post(
      'recordAdministrativeBatch',
      '/assessment/batches/:batchId/administrative-records',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        payload: Schema.Struct({
          itemId: uuidInput,
          expectedItemRevisionId: uuidInput,
          target: recordTargetInput,
          excludedParticipantIds: Schema.optional(idList),
          expectedTargetFingerprint: boundedText(200),
          /**
           * The press this act comes of, minted by the screen that confirmed
           * it. A retry of the same press is answered with the act it
           * already became rather than writing a second one: the fingerprint
           * above says the same PEOPLE were confirmed, which succeeding does
           * not change.
           */
          idempotencyKey: uuidInput,
          payload: Schema.Record(Schema.String, Schema.Unknown),
          recognition: Schema.optional(
            Schema.Struct({ values: Schema.Record(Schema.String, Schema.Unknown) }),
          ),
          basis: boundedText(500),
        }),
        success: Schema.Struct({ operationId: Schema.String, recordedCount: Schema.Number }),
        error: [
          BatchNotFound,
          BatchReadOnly,
          AccessDenied,
          ItemNotFound,
          ItemRevisionConflict,
          DeterminationRefused,
          EntryPayloadInvalid,
          ScoringUnavailable,
          AdministrativeRecordTargetsChanged,
          AdministrativeRecordFilesNotShareable,
          AdministrativeRecordRefused,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get(
      'listAdministrativeRecords',
      '/assessment/batches/:batchId/administrative-records',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        query: Schema.Struct({ ...pageQuery }),
        success: Schema.Struct({
          items: Schema.Array(recordOperationView),
          nextCursor: Schema.NullOr(Schema.String),
        }),
        error: [BatchNotFound, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get(
      'getAdministrativeRecord',
      '/assessment/administrative-records/:operationId',
      {
        params: Schema.Struct({ operationId: uuidInput }),
        /**
         * Where the list of people resumes. An act may name thousands, and
         * the detail used to take the first five hundred and say nothing
         * about the rest - a receipt where a record was asked for.
         */
        query: Schema.Struct({
          rowsCursor: Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_CURSOR_LENGTH))),
        }),
        success: Schema.Struct({
          id: Schema.String,
          batchId: Schema.String,
          itemId: Schema.String,
          itemTitle: Schema.String,
          itemRevisionId: Schema.String,
          targetKind: Schema.String,
          recordedCount: Schema.Number,
          voidedCount: Schema.Number,
          createdAt: Schema.String,
          /** who settled it; the act's own row is the only place this is written */
          actorName: Schema.NullOr(Schema.String),
          /** non-null when there are more people than this page carries */
          rowsNextCursor: Schema.NullOr(Schema.String),
          rows: Schema.Array(
            Schema.Struct({
              entryId: Schema.String,
              participantId: Schema.String,
              displayName: Schema.String,
              businessNo: Schema.NullOr(Schema.String),
              status: Schema.String,
            }),
          ),
          events: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              kind: Schema.String,
              reason: Schema.NullOr(Schema.String),
              affectedCount: Schema.Number,
              actorName: Schema.NullOr(Schema.String),
              createdAt: Schema.String,
            }),
          ),
        }),
        error: [AdministrativeRecordNotFound, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    /** taking a whole act back, along the rows it actually wrote */
    HttpApiEndpoint.post(
      'reverseAdministrativeRecord',
      '/assessment/administrative-records/:operationId/reversals',
      {
        params: Schema.Struct({ operationId: uuidInput }),
        payload: Schema.Struct({ reason: boundedText(500) }),
        success: Schema.Struct({ affectedCount: Schema.Number }),
        error: [
          AdministrativeRecordNotFound,
          BatchReadOnly,
          EntryActionRefused,
          AdministrativeRecordRefused,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * The units this round's people were admitted from, as it froze them.
     *
     * A tree to find people in, not the organization itself: it holds only
     * what appears in some participant's frozen lineage, so it answers "where
     * are this round's people" rather than "what does the university look
     * like today". Names come from the live nodes, because a renamed
     * department should read as its new name.
     */
    HttpApiEndpoint.get('listRosterUnits', '/assessment/batches/:batchId/roster-units', {
      params: Schema.Struct({ batchId: uuidInput }),
      query: Schema.Struct({
        userTypeId: Schema.optional(uuidInput),
      }),
      success: Schema.Struct({ units: Schema.Array(rosterUnitView) }),
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // Adding people, by name of the people themselves. Importing from the
    // organization resolves its units to people first, so there is one way in
    // and it takes user ids.
    HttpApiEndpoint.post('addParticipants', '/assessment/batches/:batchId/participants', {
      params: Schema.Struct({ batchId: uuidInput }),
      // people named one at a time by somebody reading a list; the bulk way
      // in is importing from the organization, which names units instead
      payload: Schema.Struct({ userIds: idsUpTo(500) }),
      success: Schema.Struct({ added: Schema.Number, skipped: Schema.Number }),
      error: [BatchNotFound, BatchReadOnly, ParticipantInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // how many people a selection would add, so the number can be confirmed
    // before anybody is added
    HttpApiEndpoint.get('previewImport', '/assessment/batches/:batchId/import-candidates', {
      params: Schema.Struct({ batchId: uuidInput }),
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
      params: Schema.Struct({ batchId: uuidInput }),
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
      params: Schema.Struct({ batchId: uuidInput }),
      query: Schema.Struct({ ...pageQuery }),
      success: Schema.Struct({
        nextCursor: Schema.NullOr(Schema.String),
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
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // taking somebody out keeps the row and everything hanging off it;
    // bringing them back is the same door in the other direction
    HttpApiEndpoint.put(
      'setParticipantStatus',
      '/assessment/batches/:batchId/participants/:participantId/status',
      {
        params: Schema.Struct({ batchId: uuidInput, participantId: uuidInput }),
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
    // Where the organization now has members somewhere other than the round
    // does. Derived on read and never applied by itself: the round moves
    // only when somebody decides to (§32.86).
    HttpApiEndpoint.get(
      'listParticipantPlacements',
      '/assessment/batches/:batchId/participant-placements',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        query: Schema.Struct(pageQuery),
        success: Schema.Struct({
          items: Schema.Array(placementDifferenceView),
          nextCursor: Schema.NullOr(Schema.String),
          // both totals in the first answer, so the roster can say whether
          // anything needs deciding without walking every page
          changedTotal: Schema.Number,
          unavailableTotal: Schema.Number,
        }),
        error: [BatchNotFound, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    // A decision per member, all of them or none: sync takes the placement
    // that was shown, keep leaves the round's and records that it was shown.
    // The placement itself is never sent - the server reads it again - and
    // the fingerprint makes sure it is still the one that was looked at.
    HttpApiEndpoint.patch(
      'reconcileParticipantPlacements',
      '/assessment/batches/:batchId/participant-placements',
      {
        params: Schema.Struct({ batchId: uuidInput }),
        payload: Schema.Struct({
          decisions: Schema.Array(
            Schema.Struct({
              participantId: uuidInput,
              observedFingerprint: Schema.String.check(Schema.isMaxLength(64)),
              decision: Schema.Literals(['sync', 'keep']),
            }),
          ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
          reason: Schema.optional(boundedText(500)),
        }),
        success: Schema.Struct({ synced: Schema.Number, kept: Schema.Number }),
        error: [
          BatchNotFound,
          BatchReadOnly,
          ParticipantNotFound,
          ParticipantInvalid,
          ParticipantPlacementChanged,
          AccessDenied,
        ],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * One person on this roster, by name of the membership row.
     *
     * The staff account is addressable - the participant is in the url, so
     * a reload or a shared link lands on the same person - and an address
     * has to be readable without walking the roster to the page they happen
     * to be on. Administering the roster is the door; the same door the
     * list itself is behind.
     */
    HttpApiEndpoint.get(
      'getParticipant',
      '/assessment/batches/:batchId/participants/:participantId',
      {
        params: Schema.Struct({ batchId: uuidInput, participantId: uuidInput }),
        success: Schema.Struct({ participant: participantView }),
        error: [BatchNotFound, ParticipantNotFound, AccessDenied],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * One person's claims, and what each currently stands recognised as.
     *
     * Not the participant's own page with a different subject: the filing
     * gates and the unread marks that page carries are the owner's working
     * state, and an account being checked has neither. The determination is
     * here instead, which is what a reader checking one needs and the owner
     * never asked for.
     */
    HttpApiEndpoint.get(
      'listParticipantEntries',
      '/assessment/batches/:batchId/participants/:participantId/entries',
      {
        params: Schema.Struct({ batchId: uuidInput, participantId: uuidInput }),
        query: Schema.Struct(pageQuery),
        success: Schema.Struct({
          participantId: Schema.String,
          entries: Schema.Array(participantEntryView),
          nextCursor: Schema.NullOr(Schema.String),
        }),
        error: [BatchNotFound, ParticipantNotFound, AccessDenied, BadRequest],
      },
    ).middleware(Authenticated),
  )
  .add(
    /**
     * One person's standing, computed the way their own page computes it.
     *
     * The same view shape as `getMyResult` on purpose: an administrator
     * checking a total and the participant reading it must not be given two
     * explanations of one number.
     */
    HttpApiEndpoint.get(
      'getParticipantResult',
      '/assessment/batches/:batchId/participants/:participantId/result',
      {
        params: Schema.Struct({ batchId: uuidInput, participantId: uuidInput }),
        success: myResultView,
        error: [BatchNotFound, ParticipantNotFound, ScoringUnavailable, AccessDenied],
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
        phases: phaseSpecs,
      }),
      success: Schema.Struct({ template: templateView }),
      error: [AccessDenied, TemplateConflict, PlanInvalid, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.patch('updateTemplate', '/assessment/phase-templates/:templateId', {
      params: Schema.Struct({ templateId: uuidInput }),
      payload: changed(
        {
          name: Schema.optional(trimmedName(100)),
          phases: Schema.optional(phaseSpecs),
        },
        ['name', 'phases'],
      ),
      success: Schema.Struct({ template: templateView }),
      error: [TemplateNotFound, TemplateConflict, PlanInvalid, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.delete('deleteTemplate', '/assessment/phase-templates/:templateId', {
      params: Schema.Struct({ templateId: uuidInput }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [TemplateNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
