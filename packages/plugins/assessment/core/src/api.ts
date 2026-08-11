import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import {
  BadRequest,
  boundedText,
  changed,
  kebabCode,
  pageQuery,
  countedPageOf,
  pageOf,
  trimmedName,
} from '@qualy/api-kit/schema'
import { Authenticated } from '@qualy/plugin-auth/server/session-contract'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import {
  AdvanceInvalid,
  BatchNoUserTypes,
  BatchNotFound,
  ParticipantInvalid,
  ParticipantNotFound,
  BatchReadOnly,
  BatchReferenceInvalid,
  BatchScopeLocked,
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
/** a calendar date, as the half-open material range states its bounds */
const isoDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

const materialRange = Schema.Struct({ start: isoDate, end: isoDate })

const batchStatus = Schema.Literals(['draft', 'active', 'archived'])

const batchListView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  descriptionMd: Schema.NullOr(Schema.String),
  scopeNodeIds: Schema.Array(Schema.String),
  participantCount: Schema.Number,
  materialRange,
  timezone: Schema.String,
  status: batchStatus,
  configRevision: Schema.Number,
  anchorAutoSync: Schema.Boolean,
  currentPhaseId: Schema.NullOr(Schema.String),
  currentPhaseName: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
})

/** the detail adds what the list has no join for */
const batchView = Schema.Struct({
  ...batchListView.fields,
  userTypeIds: Schema.Array(Schema.String),
  participantCount: Schema.Number,
})

const phaseView = Schema.Struct({
  id: Schema.String,
  ordinal: Schema.Number,
  phaseKey: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
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
  permissionProfile: Schema.optional(Schema.Array(Schema.String)),
  itemScope: Schema.optional(Schema.Array(id)),
  participantScope: Schema.optional(Schema.Array(id)),
})

const planWarning = Schema.Struct({
  reason: Schema.String,
  phaseId: Schema.NullOr(Schema.String),
  index: Schema.optional(Schema.Number),
})

const timelineEntry = Schema.Struct({
  phaseId: Schema.String,
  phaseKey: Schema.String,
  displayName: Schema.String,
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
 * The degraded chain preview (M3 wires real review policies): for each level
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

const otherBatch = Schema.Struct({ batchId: Schema.String, name: Schema.String })

const rosterDiff = Schema.Struct({
  newArrivals: Schema.Array(
    Schema.Struct({
      userId: Schema.String,
      displayName: Schema.String,
      businessNo: Schema.NullOr(Schema.String),
      userTypeId: Schema.String,
      nodeId: Schema.String,
      nodePath: Schema.String,
      activeElsewhere: Schema.Array(otherBatch),
    }),
  ),
  departed: Schema.Array(
    Schema.Struct({
      participantId: Schema.String,
      userId: Schema.String,
      displayName: Schema.String,
      frozenPath: Schema.String,
      livePath: Schema.String,
    }),
  ),
  anchorChanged: Schema.Array(
    Schema.Struct({
      participantId: Schema.String,
      userId: Schema.String,
      displayName: Schema.String,
      from: Schema.Struct({ nodeId: Schema.String, path: Schema.String }),
      to: Schema.Struct({ nodeId: Schema.String, path: Schema.String }),
    }),
  ),
  userTypeChanged: Schema.Array(
    Schema.Struct({
      participantId: Schema.String,
      userId: Schema.String,
      displayName: Schema.String,
      from: Schema.String,
      to: Schema.String,
      toEnrolled: Schema.Boolean,
    }),
  ),
  scopeIntegrity: Schema.Array(Schema.Struct({ nodeId: Schema.String })),
})

const templateKind = Schema.Literals(['timeline', 'phase'])

const templateView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: templateKind,
  version: Schema.Number,
  phases: Schema.Array(phaseSpec),
})

export const assessmentApiGroup = HttpApiGroup.make('assessment')
  .add(
    HttpApiEndpoint.get('listBatches', '/assessment/batches', {
      query: Schema.Struct({
        ...pageQuery,
        status: Schema.optional(batchStatus),
        q: Schema.optional(boundedText(100)),
      }),
      success: countedPageOf(batchListView),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createBatch', '/assessment/batches', {
      payload: Schema.Struct({
        name: trimmedName(255),
        descriptionMd: Schema.optional(boundedText(65536)),
        scopeNodeIds: Schema.Array(id),
        materialRange,
        timezone: Schema.optional(trimmedName(63)),
        userTypeIds: Schema.Array(id),
        anchorAutoSync: Schema.optional(Schema.Boolean),
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
          // repointable while the batch is a draft; a roster freezes it
          scopeNodeIds: Schema.optional(Schema.Array(id)),
          materialRange: Schema.optional(materialRange),
          timezone: Schema.optional(trimmedName(63)),
          userTypeIds: Schema.optional(Schema.Array(id)),
          anchorAutoSync: Schema.optional(Schema.Boolean),
          reason: Schema.optional(boundedText(500)),
        },
        [
          'name',
          'descriptionMd',
          'scopeNodeIds',
          'materialRange',
          'timezone',
          'userTypeIds',
          'anchorAutoSync',
        ],
      ),
      success: Schema.Struct({ batch: batchView }),
      error: [
        BatchNotFound,
        BatchReadOnly,
        BatchScopeLocked,
        BatchReferenceInvalid,
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
      error: [BatchNotFound, BatchStatusInvalid, BatchNoUserTypes, PlanInvalid, AccessDenied],
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
        BatchNoUserTypes,
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
      error: [BatchNotFound],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.get('listParticipants', '/assessment/batches/:batchId/participants', {
      params: Schema.Struct({ batchId: id }),
      query: Schema.Struct({
        ...pageQuery,
        status: Schema.optional(Schema.Literals(['active', 'excluded'])),
      }),
      success: pageOf(participantView),
      error: [BatchNotFound, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    // inclusion is explicit, never automatic: the diff lists who could join,
    // a person decides. The response carries the double-participation warning
    // and the chain preview the decision needs.
    HttpApiEndpoint.post('includeParticipant', '/assessment/batches/:batchId/participants', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Struct({ userId: id }),
      success: Schema.Struct({
        participant: participantView,
        activeElsewhere: Schema.Array(otherBatch),
        chainPreview,
      }),
      error: [BatchNotFound, BatchReadOnly, ParticipantInvalid, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // the on-read derivation (§32.35): opening the panel computes it, the
    // badge counts the same rows, nothing is stored
    HttpApiEndpoint.get('getRosterDiff', '/assessment/batches/:batchId/roster-diff', {
      params: Schema.Struct({ batchId: id }),
      success: Schema.Struct({ diff: rosterDiff }),
      error: [BatchNotFound, AccessDenied],
    }).middleware(Authenticated),
  )
  .add(
    // exclusion keeps the row and everything hanging off it; re-inclusion is
    // the same door in the other direction
    HttpApiEndpoint.put(
      'setParticipantStatus',
      '/assessment/batches/:batchId/participants/:participantId/status',
      {
        params: Schema.Struct({ batchId: id, participantId: id }),
        payload: Schema.Struct({ status: Schema.Literals(['active', 'excluded']) }),
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
    // applying an anchor change refreezes the whole snapshot - position,
    // lineage and type - from where the person lives now; in-flight work
    // keeps its snapshotted chain untouched
    HttpApiEndpoint.put(
      'applyParticipantAnchor',
      '/assessment/batches/:batchId/participants/:participantId/anchor',
      {
        params: Schema.Struct({ batchId: id, participantId: id }),
        success: Schema.Struct({ participant: participantView, chainPreview }),
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
            path: Schema.String,
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
