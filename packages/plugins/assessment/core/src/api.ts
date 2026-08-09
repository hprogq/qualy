import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import {
  BadRequest,
  boundedText,
  changed,
  kebabCode,
  pageQuery,
  pageOf,
  trimmedName,
} from '@qualy/api-kit/schema'
import { Authenticated } from '@qualy/plugin-auth/server/session-contract'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import {
  AdvanceInvalid,
  BatchNoUserTypes,
  BatchNotFound,
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
/** a calendar date, as the half-open material range states its bounds */
const isoDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

const materialRange = Schema.Struct({ start: isoDate, end: isoDate })

const entryOffset = Schema.Struct({
  days: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  hours: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  minutes: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
})

const entryTrigger = Schema.Literals(['scheduled', 'manual', 'publication'])
const batchStatus = Schema.Literals(['draft', 'active', 'archived'])

const batchListView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  descriptionMd: Schema.NullOr(Schema.String),
  scopeNodeId: Schema.String,
  materialRange,
  timezone: Schema.String,
  status: batchStatus,
  configRevision: Schema.Number,
  currentPhaseId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
})

/** the detail adds what the list has no join for */
const batchView = Schema.Struct({
  ...batchListView.fields,
  userTypeIds: Schema.Array(Schema.String),
})

const phaseView = Schema.Struct({
  id: Schema.String,
  ordinal: Schema.Number,
  phaseKey: Schema.String,
  displayName: Schema.String,
  entryTrigger,
  plannedEntryAt: Schema.NullOr(Schema.String),
  actualEntryAt: Schema.NullOr(Schema.String),
  entryOffset: Schema.NullOr(entryOffset),
  estimatedEntryAt: Schema.NullOr(Schema.String),
  opensPublicationId: Schema.NullOr(Schema.String),
  permissionProfile: Schema.Array(Schema.String),
  sourceTemplateId: Schema.NullOr(Schema.String),
  sourceTemplateVersion: Schema.NullOr(Schema.Number),
})

/**
 * One phase as a plan write states it: with an id it replaces that phase's
 * editable fields, without one it is an insertion at its position. Entry
 * actuals and publication bindings are deliberately absent - the first is
 * written only by transitions, the second only by the publication workflow.
 */
const phaseSpec = Schema.Struct({
  id: Schema.optional(id),
  phaseKey: kebabCode,
  displayName: trimmedName(100),
  entryTrigger,
  plannedEntryAt: Schema.optional(Schema.NullOr(isoInstant)),
  entryOffset: Schema.optional(Schema.NullOr(entryOffset)),
  estimatedEntryAt: Schema.optional(Schema.NullOr(isoInstant)),
  permissionProfile: Schema.optional(Schema.Array(Schema.String)),
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
  entry: Schema.Struct({
    kind: Schema.Literals(['entered', 'planned', 'announced', 'estimated', 'pending']),
    at: Schema.NullOr(Schema.String),
  }),
})

const templateView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  phases: Schema.Array(phaseSpec),
})

export const assessmentApiGroup = HttpApiGroup.make('assessment')
  .add(
    HttpApiEndpoint.get('listBatches', '/assessment/batches', {
      query: Schema.Struct({ ...pageQuery, status: Schema.optional(batchStatus) }),
      success: pageOf(batchListView),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createBatch', '/assessment/batches', {
      payload: Schema.Struct({
        name: trimmedName(255),
        descriptionMd: Schema.optional(boundedText(65536)),
        scopeNodeId: id,
        materialRange,
        timezone: Schema.optional(trimmedName(63)),
        userTypeIds: Schema.Array(id),
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
          userTypeIds: Schema.optional(Schema.Array(id)),
          reason: Schema.optional(boundedText(500)),
        },
        ['name', 'descriptionMd', 'materialRange', 'timezone', 'userTypeIds'],
      ),
      success: Schema.Struct({ batch: batchView }),
      error: [BatchNotFound, BatchReadOnly, BatchReferenceInvalid, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('setBatchStatus', '/assessment/batches/:batchId/status', {
      params: Schema.Struct({ batchId: id }),
      payload: Schema.Struct({ status: Schema.Literals(['active', 'archived']) }),
      success: Schema.Struct({ batch: batchView }),
      error: [BatchNotFound, BatchStatusInvalid, BatchNoUserTypes, PlanInvalid, AccessDenied],
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
    // the plan as an idempotent replacement: named phases are edited, unnamed
    // ones inserted, and a template is copied server-side so its provenance
    // lands with it. Exactly one of the two fields.
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
    HttpApiEndpoint.get('listTemplates', '/assessment/phase-templates', {
      query: Schema.Struct({ ...pageQuery }),
      success: pageOf(templateView),
      error: [AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.post('createTemplate', '/assessment/phase-templates', {
      payload: Schema.Struct({
        name: trimmedName(100),
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
