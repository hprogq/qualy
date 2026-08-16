import { Effect, Result } from 'effect'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import type { AttachmentMeta } from '@qualy/plugin-storage/server'
import type { AttachmentRef, ItemTypeDriver } from '../plugin.ts'
import type { GateContext } from '../phase/gate.ts'
import {
  BatchNotFound,
  BatchReadOnly,
  EntryActionRefused,
  EntryNotFound,
  EntryPayloadInvalid,
  ItemNotFound,
  ParticipantNotFound,
} from '../server/errors.ts'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { cursorUnusable, type BadRequest, pageSize } from '@qualy/api-kit/schema'
import { participantRowByUser } from '../scoring/db.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import { itemOf, revisionOf, type ItemRevisionRow, type ItemRow } from '../item/db.ts'
import {
  attachmentsOfRevisions,
  cancelReviewInstance,
  entriesOfParticipantPage,
  entryAttachmentHistory,
  entryCreatedIso,
  entryEventsOf,
  entryRevisionsOf,
  eventsOfRounds,
  roundsOfEntry,
  lockAttachments,
  entryCountOf,
  entryOf,
  entryRevisionOf,
  insertEntry,
  insertEntryEvent,
  insertEntryRevision,
  insertReviewEvent,
  insertReviewInstance,
  insertRevisionAttachments,
  nextEntryRevisionNo,
  nextRoundNo,
  nodePathOf,
  participantOf,
  revisionAttachmentsOf,
  setEntryState,
  staffReachesParticipant,
  type EntryRow,
  type ParticipantAnchor,
} from './db.ts'
import { enterableFrom, holdersOf, readPolicy, resolvePolicy } from '../review/chain.ts'

// One person's claim on one question: created, revised, submitted, withdrawn.
//
// Everything here answers to one rule: the server decides who is speaking.
// The client never submits a source, an actor or a subject - the route, the
// item's entry source and the caller's own standing derive all three - and
// the resource policy below is the third authorization layer, asked after
// authority (is this person anyone here) and the phase gate (is this act
// open now).
//
// Attachments cross into storage inside the same transaction that writes the
// revision: a payload that cites a file and the row that binds the file are
// one fact, or neither is.

export interface EntryRevisionView {
  readonly id: string
  readonly revisionNo: number
  readonly itemRevisionId: string
  readonly payload: unknown
  readonly note: string | null
  readonly source: string
  readonly actorId: string
  readonly subjectId: string
  readonly attachments: readonly { attachmentId: string; position: number }[]
  readonly createdAt: number
}

export interface EntryView {
  readonly id: string
  readonly batchId: string
  readonly itemId: string
  readonly participantId: string
  readonly status: EntryRow['status']
  readonly source: EntryRow['source']
  readonly currentRevision: EntryRevisionView | null
  readonly currentReviewInstanceId: string | null
  readonly createdAt: number
  readonly capabilities: {
    readonly canEdit: boolean
    readonly canSubmit: boolean
    readonly canWithdraw: boolean
    /** a decision has been made and it is this person's to contest (§32.63) */
    readonly canAppeal: boolean
  }
}

export interface CreateEntryInput {
  readonly itemId: string
  readonly participantId: string
  readonly payload: unknown
  readonly note?: string
}

export type CreateEntryError =
  | ItemNotFound
  | BatchNotFound
  | BatchReadOnly
  | EntryActionRefused
  | EntryPayloadInvalid
  | AccessDenied
export type ReviseEntryError =
  EntryNotFound | BatchReadOnly | EntryActionRefused | EntryPayloadInvalid
export type EntryStatusError = EntryNotFound | BatchReadOnly | EntryActionRefused

/**
 * What an administrator may do to a claim without pretending to be its
 * reviewer.
 *
 * Sending one back is not a rejection and not a decision: it is the round's
 * own arrangements changing under a claim, and the person who may change
 * those arrangements saying so. Judging stays with whoever actually holds
 * the level - `decideReview` still refuses anybody else, administrator or
 * not (§32.62).
 */
export interface InterveneInput {
  readonly kind: 'return-for-revision'
  readonly reason: string
}

export type InterveneError = EntryNotFound | BatchReadOnly | EntryActionRefused | AccessDenied

export interface EntryRoundView {
  readonly id: string
  readonly roundNo: number
  readonly state: string
  readonly outcome: string | null
  readonly revisionId: string
  readonly submittedAt: number
  readonly completedAt: number | null
  readonly events: readonly {
    readonly kind: string
    readonly actorId: string | null
    readonly actorName: string | null
    readonly comment: string | null
    readonly suggestedPayload: unknown
    readonly at: number
  }[]
}

export interface EntryHistoryView {
  readonly entry: EntryView
  readonly revisions: readonly (EntryRevisionView & {
    /**
     * The form this version was written under. History is read through the
     * configuration it cited, never today's - and without it a reader meets
     * the payload's internal keys instead of the questions they answered.
     */
    readonly formConfig: unknown
  })[]
  readonly rounds: readonly EntryRoundView[]
  /**
   * What happened to the claim that no round explains - being sent back
   * because the question changed, most of all. Its own list rather than a
   * pseudo-round, because there is no round to put it in and it is not a
   * decision anybody made about the evidence.
   */
  readonly events: readonly {
    readonly kind: string
    readonly actorId: string | null
    readonly actorName: string | null
    readonly reason: string | null
    readonly at: number
  }[]
}

export interface EntryMethods {
  readonly listMyEntries: (
    tenantId: string,
    batchId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) => Effect.Effect<
    { participantId: string; entries: readonly EntryView[]; nextCursor: string | null },
    BatchNotFound | ParticipantNotFound | AccessDenied | BadRequest
  >
  readonly getEntryHistory: (
    tenantId: string,
    entryId: string,
    as: Principal,
  ) => Effect.Effect<EntryHistoryView, EntryNotFound>
  readonly createEntry: (
    tenantId: string,
    input: CreateEntryInput,
    as: Principal,
  ) => Effect.Effect<EntryView, CreateEntryError>
  readonly getEntry: (
    tenantId: string,
    entryId: string,
    as: Principal,
  ) => Effect.Effect<EntryView, EntryNotFound>
  readonly appendEntryRevision: (
    tenantId: string,
    entryId: string,
    input: { payload: unknown; note?: string },
    as: Principal,
  ) => Effect.Effect<EntryView, ReviseEntryError>
  readonly setEntryStatus: (
    tenantId: string,
    entryId: string,
    to: 'in_review' | 'draft',
    as: Principal,
  ) => Effect.Effect<EntryView, EntryStatusError>
  readonly interveneOnEntry: (
    tenantId: string,
    entryId: string,
    input: InterveneInput,
    as: Principal,
  ) => Effect.Effect<EntryView, InterveneError>
}

type ActionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly layer: string; readonly reason: string }

export interface EntryDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  /** the first two layers: authority in the batch, then the phase gate */
  readonly authorize: (
    principal: Principal,
    code: string,
    batchId: string,
    ctx?: GateContext,
  ) => Effect.Effect<ActionDecision, BatchNotFound>
  readonly requireRosterReach: (
    as: Principal,
    tenantId: string,
    batchId: string,
  ) => Effect.Effect<void, AccessDenied>
  /** the same visibility every batch read passes through */
  readonly requireBatchVisible: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<void, AccessDenied>
  readonly parseRange: (text: string) => { start: string; end: string }
  readonly itemTypes: ReadonlyMap<string, ItemTypeDriver>
  /** the two storage doors this module walks through, typed to what it uses */
  readonly storage: {
    readonly metadata: (input: {
      readonly tenantId: string
      readonly attachmentId: string
    }) => Effect.Effect<AttachmentMeta, unknown>
    readonly bind: (input: {
      readonly tenantId: string
      readonly attachmentId: string
      readonly ownerUserId: string
    }) => Effect.Effect<AttachmentMeta, unknown>
  }
}

const refuse = (action: string, reason: string) => new EntryActionRefused({ action, reason })

export const makeEntryMethods = (deps: EntryDeps): EntryMethods => {
  const { withDb, storage } = deps

  const driverOf = (item: ItemRow) => deps.itemTypes.get(item.itemType)

  /**
   * A payload through its driver: decoded against the exact configuration
   * the revision will cite, dates held to the round.
   */
  const decodePayload = (
    driver: ItemTypeDriver,
    revision: ItemRevisionRow,
    payload: unknown,
    materialRange: { start: string; end: string },
  ) =>
    Effect.result(driver.decodePayload(revision.formConfig, payload, { materialRange })).pipe(
      Effect.flatMap((decoded) =>
        Result.isFailure(decoded)
          ? Effect.fail(
              new EntryPayloadInvalid({
                issues: (
                  decoded.failure as { issues?: readonly { field: string; reason: string }[] }
                ).issues ?? [{ field: '', reason: 'unreadable' }],
              }),
            )
          : Effect.succeed(decoded.success),
      ),
    )

  /**
   * The attachments a payload cites, held to storage's own facts and bound
   * in the caller's transaction.
   *
   * Trust runs one way: the driver names what the payload claims, storage
   * says what actually exists - who uploaded it, how large it really is,
   * what state it is in. A staged file must be the actor's own; a bound one
   * may only be cited again by the entry that already cites it; nothing
   * retired is ever cited anew.
   */
  const bindAttachments = (input: {
    tenantId: string
    entryId: string | null
    actorId: string
    refs: readonly AttachmentRef[]
  }) =>
    Effect.gen(function* () {
      const issues: { field: string; reason: string }[] = []

      // one file, one field: a duplicate across fields would collide in the
      // relation's key anyway, and quietly picking a field for it would make
      // "which claim does this document back" a matter of iteration order
      const counted = new Map<string, number>()
      for (const ref of input.refs) {
        counted.set(ref.attachmentId, (counted.get(ref.attachmentId) ?? 0) + 1)
      }
      for (const ref of input.refs) {
        if ((counted.get(ref.attachmentId) ?? 0) > 1) {
          issues.push({ field: ref.field, reason: 'duplicate-attachment' })
        }
      }
      if (issues.length > 0) return yield* Effect.fail(new EntryPayloadInvalid({ issues }))

      // serialize across batches before reading anything: batch locks do not
      // cover two rounds citing one file at the same moment
      yield* lockAttachments(
        input.tenantId,
        input.refs.map((ref) => ref.attachmentId),
      )
      const toBind: { attachmentId: string; ownerUserId: string }[] = []
      const history =
        input.entryId === null
          ? new Set<string>()
          : yield* entryAttachmentHistory(input.tenantId, input.entryId)

      for (const ref of input.refs) {
        const meta = yield* Effect.result(
          storage.metadata({ tenantId: input.tenantId, attachmentId: ref.attachmentId }),
        )
        if (Result.isFailure(meta)) {
          issues.push({ field: ref.field, reason: 'attachment-not-found' })
          continue
        }
        const attachment = meta.success
        if (attachment.status === 'retired') {
          issues.push({ field: ref.field, reason: 'attachment-retired' })
          continue
        }
        // the field's current rules hold for every citation, re-used ones
        // included: a limit tightened after the first upload is a limit, not
        // a suggestion grandfathered away
        if (ref.maxFileBytes !== undefined && attachment.size > BigInt(ref.maxFileBytes)) {
          issues.push({ field: ref.field, reason: 'attachment-too-large' })
          continue
        }
        if (
          ref.accept !== undefined &&
          !acceptable(ref.accept, attachment.declaredMime, attachment.filename)
        ) {
          issues.push({ field: ref.field, reason: 'attachment-type' })
          continue
        }
        if (attachment.status === 'bound') {
          // reuse is an entry keeping its own history, never borrowing
          // another's (assessment-design §5.14)
          if (!history.has(ref.attachmentId)) {
            issues.push({ field: ref.field, reason: 'attachment-cross-entry' })
          }
          continue
        }
        if (attachment.ownerUserId !== input.actorId) {
          issues.push({ field: ref.field, reason: 'attachment-not-yours' })
          continue
        }
        toBind.push({ attachmentId: ref.attachmentId, ownerUserId: attachment.ownerUserId })
      }
      if (issues.length > 0) return yield* Effect.fail(new EntryPayloadInvalid({ issues }))
      for (const target of toBind) {
        const bound = yield* Effect.result(
          storage.bind({
            tenantId: input.tenantId,
            attachmentId: target.attachmentId,
            ownerUserId: target.ownerUserId,
          }),
        )
        if (Result.isFailure(bound)) {
          return yield* Effect.fail(
            new EntryPayloadInvalid({ issues: [{ field: '', reason: 'attachment-unavailable' }] }),
          )
        }
      }
    })

  /** the product's accept list: mime names, `type/*` families, `.ext` suffixes */
  const acceptable = (accept: readonly string[], mime: string, filename: string) =>
    accept.some((entry) =>
      entry.startsWith('.')
        ? filename.toLowerCase().endsWith(entry.toLowerCase())
        : entry.endsWith('/*')
          ? mime.toLowerCase().startsWith(entry.slice(0, -1).toLowerCase())
          : mime.toLowerCase() === entry.toLowerCase(),
    )

  const view = (
    entry: EntryRow,
    revision: EntryRevisionView | null,
    as: Principal,
    participant: ParticipantAnchor | null,
  ): EntryView => {
    const own = participant !== null && participant.userId === as.userId
    const active = own && participant.status === 'active'
    return {
      id: entry.id,
      batchId: entry.batchId,
      itemId: entry.itemId,
      participantId: entry.participantId,
      status: entry.status,
      source: entry.source,
      currentRevision: revision,
      currentReviewInstanceId: entry.currentReviewInstanceId,
      createdAt: entry.createdAt,
      // discovery, not authorization: what the screen may offer, decided by
      // ownership and state alone. The gate is asked again at the act.
      capabilities: {
        canEdit:
          active &&
          (entry.status === 'draft' ||
            entry.status === 'rejected' ||
            entry.status === 'needs_revision'),
        canSubmit: active && entry.status === 'draft',
        canWithdraw: active && entry.status === 'in_review',
        // there has to be a decision to disagree with, and a round to name
        canAppeal:
          active &&
          (entry.status === 'approved' || entry.status === 'rejected') &&
          entry.currentReviewInstanceId !== null,
      },
    }
  }

  const revisionView = (tenantId: string, revisionId: string | null) =>
    Effect.gen(function* () {
      if (revisionId === null) return null
      const revision = yield* entryRevisionOf(tenantId, revisionId)
      if (revision === null) return null
      const attachments = yield* revisionAttachmentsOf(tenantId, revisionId)
      return {
        id: revision.id,
        revisionNo: revision.revisionNo,
        itemRevisionId: revision.itemRevisionId,
        payload: revision.payload,
        note: revision.note,
        source: revision.source,
        actorId: revision.actorId,
        subjectId: revision.subjectId,
        attachments,
        createdAt: revision.createdAt,
      } satisfies EntryRevisionView
    })

  /** everything several methods reload: the entry with its item and person */
  const loadEntry = (tenantId: string, entryId: string) =>
    Effect.gen(function* () {
      const entry = yield* entryOf(tenantId, entryId)
      if (entry === null) return null
      const item = yield* itemOf(tenantId, entry.itemId)
      const participant = yield* participantOf(tenantId, entry.batchId, entry.participantId)
      return { entry, item: item!, participant: participant! }
    })

  const createEntry: EntryMethods['createEntry'] = Effect.fn('Assessment.createEntry')(
    function* (tenantId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            // the first read only locates the batch; nothing else read
            // before the lock may be trusted - a void can land between the
            // read and the lock, and its whole point is that no new work
            // starts after it
            const located = yield* itemOf(tenantId, input.itemId)
            if (located === null) return yield* new ItemNotFound()
            const locked = yield* lockBatch(tenantId, located.batchId)
            if (!locked) return yield* new BatchNotFound()
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            const item = (yield* itemOf(tenantId, input.itemId))!
            const participant = yield* participantOf(tenantId, item.batchId, input.participantId)
            if (participant === null) return yield* refuse('create', 'participant-not-found')
            if (participant.status !== 'active') {
              return yield* refuse('create', 'participant-not-active')
            }
            if (item.status !== 'active') return yield* refuse('create', 'item-not-active')
            const revision =
              item.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, item.currentRevisionId)
            if (revision === null) return yield* refuse('create', 'item-not-configured')

            // who is filing is the item's decision, never the caller's: a
            // student question takes the participant themselves, an
            // administrative one takes staff whose accepted authority covers
            // this participant's frozen anchor
            const administrative = revision.entrySource === 'administrative'
            const code = administrative ? 'assessment.entry.record' : 'assessment.entry.create'
            if (!administrative && participant.userId !== as.userId) {
              return yield* refuse('create', 'not-your-participant')
            }
            const decision = yield* deps.authorize(as, code, item.batchId, {
              itemId: item.id,
              participantId: participant.id,
            })
            if (!decision.allowed) return yield* refuse('create', decision.reason)
            if (administrative) {
              const reaches = yield* staffReachesParticipant({
                tenantId,
                batchId: item.batchId,
                userId: as.userId,
                permissionCode: code,
                participant,
              })
              if (!reaches) return yield* refuse('create', 'participant-out-of-reach')
              // the basis is the record: an administrative fact without its
              // document reference is an assertion nobody can check
              if ((input.note ?? '').trim() === '') {
                return yield* refuse('create', 'basis-required')
              }
            }

            if (item.maxEntries !== null) {
              const count = yield* entryCountOf(tenantId, item.id, participant.id)
              if (count >= item.maxEntries) return yield* refuse('create', 'max-entries-reached')
            }

            const batch = yield* oneBatch(tenantId, item.batchId)
            const materialRange = deps.parseRange(String(batch!.materialRange))
            const driver = driverOf(item)
            if (driver === undefined) return yield* refuse('create', 'item-type-not-installed')
            const decoded = yield* decodePayload(driver, revision, input.payload, materialRange)

            const entryId = yield* insertEntry({
              tenantId,
              batchId: item.batchId,
              itemId: item.id,
              participantId: participant.id,
              source: administrative ? 'record' : 'self',
              status: administrative ? 'approved' : 'draft',
            })
            const revisionId = yield* insertEntryRevision({
              tenantId,
              entryId,
              itemId: item.id,
              itemRevisionId: revision.id,
              revisionNo: 1,
              payload: decoded,
              actorId: as.userId,
              subjectId: participant.userId,
              source: administrative ? 'record' : 'self',
              note: input.note?.trim() || null,
            })
            const refs = driver.attachmentRefs(revision.formConfig, decoded)
            yield* bindAttachments({ tenantId, entryId: null, actorId: as.userId, refs })
            yield* insertRevisionAttachments(
              tenantId,
              revisionId,
              refs.map((ref, position) => ({ attachmentId: ref.attachmentId, position })),
            )
            yield* setEntryState({
              tenantId,
              entryId,
              from: [administrative ? 'approved' : 'draft'],
              to: administrative ? 'approved' : 'draft',
              currentRevisionId: revisionId,
            })
            const entry = (yield* entryOf(tenantId, entryId))!
            return view(entry, yield* revisionView(tenantId, revisionId), as, participant)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const getEntry: EntryMethods['getEntry'] = Effect.fn('Assessment.getEntry')(
    function* (tenantId, entryId, as) {
      return yield* withDb(
        Effect.gen(function* () {
          const loaded = yield* loadEntry(tenantId, entryId)
          if (loaded === null) return yield* new EntryNotFound()
          const { entry, participant } = loaded
          // the owner reads their own history whatever their standing now
          // (§32.56); everyone else needs administrative reach, and learns
          // nothing - not even existence - without it
          if (participant.userId !== as.userId) {
            const reach = yield* Effect.result(deps.requireRosterReach(as, tenantId, entry.batchId))
            if (Result.isFailure(reach)) return yield* new EntryNotFound()
          }
          return view(
            entry,
            yield* revisionView(tenantId, entry.currentRevisionId),
            as,
            participant,
          )
        }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const appendEntryRevision: EntryMethods['appendEntryRevision'] = Effect.fn(
    'Assessment.appendEntryRevision',
  )(function* (tenantId, entryId, input, as) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const located = yield* entryOf(tenantId, entryId)
          if (located === null) return yield* new EntryNotFound()
          const locked = yield* lockBatch(tenantId, located.batchId)
          if (locked!.status === 'archived') return yield* new BatchReadOnly()
          // only what was read under the lock is trusted; the locate read
          // races with voids by design
          const { entry, item, participant } = (yield* loadEntry(tenantId, entryId))!
          // editing is the subject's own act, always: proxies file once and
          // hold nothing afterwards, staff records are corrected by voiding
          if (participant.userId !== as.userId) return yield* refuse('edit', 'not-your-entry')
          if (participant.status !== 'active')
            return yield* refuse('edit', 'participant-not-active')
          if (entry.source === 'record' || entry.source === 'import') {
            return yield* refuse('edit', 'entry-not-editable')
          }
          if (
            entry.status !== 'draft' &&
            entry.status !== 'rejected' &&
            entry.status !== 'needs_revision'
          ) {
            return yield* refuse('edit', 'entry-not-editable')
          }
          if (item.status !== 'active') return yield* refuse('edit', 'item-not-active')
          const revision =
            item.currentRevisionId === null
              ? null
              : yield* revisionOf(tenantId, item.currentRevisionId)
          if (revision === null || revision.entrySource !== 'student') {
            return yield* refuse('edit', 'entry-not-editable')
          }
          const decision = yield* deps
            .authorize(as, 'assessment.entry.edit', entry.batchId, {
              itemId: item.id,
              participantId: participant.id,
            })
            .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))
          if (!decision.allowed) return yield* refuse('edit', decision.reason)

          const batch = yield* oneBatch(tenantId, entry.batchId)
          const materialRange = deps.parseRange(String(batch!.materialRange))
          const driver = driverOf(item)
          if (driver === undefined) return yield* refuse('edit', 'item-type-not-installed')
          const decoded = yield* decodePayload(driver, revision, input.payload, materialRange)
          const revisionNo = yield* nextEntryRevisionNo(tenantId, entryId)
          const revisionId = yield* insertEntryRevision({
            tenantId,
            entryId,
            itemId: item.id,
            itemRevisionId: revision.id,
            revisionNo,
            payload: decoded,
            actorId: as.userId,
            subjectId: participant.userId,
            source: 'self',
            note: input.note?.trim() || null,
          })
          const refs = driver.attachmentRefs(revision.formConfig, decoded)
          yield* bindAttachments({ tenantId, entryId, actorId: as.userId, refs })
          yield* insertRevisionAttachments(
            tenantId,
            revisionId,
            refs.map((ref, position) => ({ attachmentId: ref.attachmentId, position })),
          )
          // a rejected entry, or one an administrator sent back, re-enters
          // work through its next revision
          yield* setEntryState({
            tenantId,
            entryId,
            from: ['draft', 'rejected', 'needs_revision'],
            to: 'draft',
            currentRevisionId: revisionId,
          })
          const written = (yield* entryOf(tenantId, entryId))!
          return view(written, yield* revisionView(tenantId, revisionId), as, participant)
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

  const setEntryStatus: EntryMethods['setEntryStatus'] = Effect.fn('Assessment.setEntryStatus')(
    function* (tenantId, entryId, to, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const located = yield* entryOf(tenantId, entryId)
            if (located === null) return yield* new EntryNotFound()
            const locked = yield* lockBatch(tenantId, located.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
            const { entry, item, participant } = (yield* loadEntry(tenantId, entryId))!
            const action = to === 'in_review' ? 'submit' : 'withdraw'
            if (participant.userId !== as.userId) return yield* refuse(action, 'not-your-entry')
            if (participant.status !== 'active') {
              return yield* refuse(action, 'participant-not-active')
            }
            const code =
              to === 'in_review' ? 'assessment.entry.submit' : 'assessment.entry.withdraw'
            const decision = yield* deps
              .authorize(as, code, entry.batchId, {
                itemId: item.id,
                participantId: participant.id,
              })
              .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))
            if (!decision.allowed) return yield* refuse(action, decision.reason)

            if (to === 'in_review') {
              if (entry.status !== 'draft') return yield* refuse(action, 'entry-not-submittable')
              if (item.status !== 'active') return yield* refuse(action, 'item-not-active')
              if (entry.currentRevisionId === null) {
                return yield* refuse(action, 'entry-not-submittable')
              }
              const current = yield* entryRevisionOf(tenantId, entry.currentRevisionId)
              // Two versions of the question, two different jobs (§32.62).
              // What was written is read as an answer to the form it was
              // written under; what happens to it now - which form it has to
              // satisfy, whose route it walks - is the question as it stands
              // today. Nothing has begun yet, so there is nothing to
              // grandfather: a draft that has been sitting since before the
              // form gained a required field is a draft that is not finished.
              const written = yield* revisionOf(tenantId, current!.itemRevisionId)
              const live =
                item.currentRevisionId === null
                  ? null
                  : yield* revisionOf(tenantId, item.currentRevisionId)
              if (written === null || live === null) {
                return yield* refuse(action, 'item-not-configured')
              }
              const batch = yield* oneBatch(tenantId, entry.batchId)
              const driver = driverOf(item)
              if (driver === undefined) return yield* refuse(action, 'item-type-not-installed')
              const carried =
                driver.projectPayload === undefined
                  ? current!.payload
                  : driver.projectPayload(written.formConfig, live.formConfig, current!.payload)
              const readable = yield* Effect.result(
                driver.decodePayload(live.formConfig, carried, {
                  materialRange: deps.parseRange(String(batch!.materialRange)),
                }),
              )
              if (Result.isFailure(readable)) {
                // not "you cannot submit": the form asks for something this
                // draft does not have yet, and the way on is to go and fill
                // it in
                return yield* refuse(action, 'entry-needs-revision')
              }

              // Both routes, resolved once against this person's frozen
              // lineage and snapshotted. The escalation route is resolved here
              // too, though most rounds never reach it: escalating must
              // not re-resolve an organization that has moved since (§14).
              const policy = yield* resolvePolicy({
                tenantId,
                batchId: entry.batchId,
                policy: readPolicy(live.reviewPolicy),
                lineage: participant.anchorLineage,
              })
              const first = enterableFrom(policy, 'normal', 0)
              // every stage named a level this person sits under none of:
              // there is nowhere to anchor a round, and no later grant can
              // supply it - the configuration itself is wrong here
              if (first === null) return yield* refuse(action, 'review-level-missing')
              const nodePath = yield* nodePathOf(tenantId, first.nodeId!)
              if (nodePath === null) return yield* refuse(action, 'review-level-missing')
              const holders = yield* holdersOf({
                tenantId,
                batchId: entry.batchId,
                stage: first,
                subjectUserId: participant.userId,
                actorId: current!.actorId,
              })
              // Nobody holds the stage's roles there today - which is the
              // round's problem, not this person's. The round is written
              // down as blocked so the patrol and the alert panel own it,
              // and it heals the moment somebody is appointed (§14).
              const arrived = holders.length > 0 ? 'active' : 'blocked'

              const roundNo = yield* nextRoundNo(tenantId, entryId)
              const instanceId = yield* insertReviewInstance({
                tenantId,
                entryId,
                revisionId: entry.currentRevisionId,
                roundNo,
                policyRevisionId: live.id,
                effectivePolicy: policy,
                // an ordinary submission: it walks the ordinary route, and
                // whoever it reaches may end it (§32.63)
                rejectPolicy: 'any-stage',
                route: 'normal',
                stageId: first.id,
                roleIds: first.roleIds,
                nodeId: first.nodeId!,
                nodePath,
                state: arrived,
              })
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: instanceId,
                kind: 'submitted',
                actorId: as.userId,
                route: 'normal',
                stageId: first.id,
              })
              if (arrived === 'blocked') {
                yield* insertReviewEvent({
                  tenantId,
                  reviewInstanceId: instanceId,
                  kind: 'assignee-not-found',
                  actorId: null,
                  route: 'normal',
                  stageId: first.id,
                })
              }
              const moved = yield* setEntryState({
                tenantId,
                entryId,
                from: ['draft'],
                to: 'in_review',
                currentReviewInstanceId: instanceId,
              })
              // unreachable while the batch lock is held over a fresh read;
              // checked so a future reordering fails loudly instead of
              // leaving a review round attached to nothing
              if (!moved) return yield* refuse(action, 'entry-not-submittable')
            } else {
              if (entry.status !== 'in_review' || entry.currentReviewInstanceId === null) {
                return yield* refuse(action, 'entry-not-withdrawable')
              }
              const cancelled = yield* cancelReviewInstance({
                tenantId,
                instanceId: entry.currentReviewInstanceId,
                outcome: 'cancelled',
              })
              if (!cancelled) return yield* refuse(action, 'entry-not-withdrawable')
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: entry.currentReviewInstanceId,
                kind: 'cancelled-by-submitter',
                actorId: as.userId,
              })
              const moved = yield* setEntryState({
                tenantId,
                entryId,
                from: ['in_review'],
                to: 'draft',
                currentReviewInstanceId: null,
              })
              if (!moved) return yield* refuse(action, 'entry-not-withdrawable')
            }
            const written = (yield* entryOf(tenantId, entryId))!
            return view(
              written,
              yield* revisionView(tenantId, written.currentRevisionId),
              as,
              participant,
            )
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const listMyEntries: EntryMethods['listMyEntries'] = Effect.fn('Assessment.listMyEntries')(
    function* (tenantId, batchId, page, as) {
      const fingerprint = `my-entries:${batchId}:${as.userId}`
      const key = readQueryCursor(page.cursor, fingerprint, ['text', 'uuid'])
      if (key === null) return yield* cursorUnusable()
      const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
      return yield* withDb(
        Effect.gen(function* () {
          const batch = yield* oneBatch(tenantId, batchId)
          if (!batch) return yield* new BatchNotFound()
          // one's own filings only, behind the same door as every other
          // read of the round; the membership row is historical standing
          yield* deps.requireBatchVisible(tenantId, batchId, as)
          const membership = yield* participantRowByUser(tenantId, batchId, as.userId)
          if (membership === null) return yield* new ParticipantNotFound()
          const participant = (yield* participantOf(tenantId, batchId, membership.id))!
          const rows = yield* entriesOfParticipantPage({
            tenantId,
            batchId,
            participantId: membership.id,
            after: key === undefined ? undefined : [key[0]!, key[1]!],
            limit: limit + 1,
          })
          const pageRows = rows.slice(0, limit)
          const entries: EntryView[] = []
          for (const entry of pageRows) {
            entries.push(
              view(entry, yield* revisionView(tenantId, entry.currentRevisionId), as, participant),
            )
          }
          const last = pageRows[pageRows.length - 1]
          const lastIso =
            rows.length > limit && last !== undefined
              ? yield* entryCreatedIso(tenantId, last.id)
              : null
          return {
            participantId: membership.id,
            entries,
            nextCursor:
              lastIso !== null && last !== undefined
                ? encodeQueryCursor(fingerprint, [lastIso, last.id])
                : null,
          }
        }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const getEntryHistory: EntryMethods['getEntryHistory'] = Effect.fn('Assessment.getEntryHistory')(
    function* (tenantId, entryId, as) {
      return yield* withDb(
        Effect.gen(function* () {
          const loaded = yield* loadEntry(tenantId, entryId)
          if (loaded === null) return yield* new EntryNotFound()
          const { entry, participant } = loaded
          // the same read rule as the entry itself (§32.56): the subject,
          // or administrative reach - and nothing, not even existence,
          // for anyone else
          if (participant.userId !== as.userId) {
            const reach = yield* Effect.result(deps.requireRosterReach(as, tenantId, entry.batchId))
            if (Result.isFailure(reach)) return yield* new EntryNotFound()
          }
          const revisions = yield* entryRevisionsOf(tenantId, entryId)
          const forms = new Map<string, unknown>()
          for (const itemRevisionId of new Set(revisions.map((r) => r.itemRevisionId))) {
            const cited = yield* revisionOf(tenantId, itemRevisionId)
            forms.set(itemRevisionId, cited?.formConfig ?? null)
          }
          const attachments = yield* attachmentsOfRevisions(
            tenantId,
            revisions.map((revision) => revision.id),
          )
          const rounds = yield* roundsOfEntry(tenantId, entryId)
          const events = yield* eventsOfRounds(
            tenantId,
            rounds.map((round) => round.id),
          )
          const ownEvents = yield* entryEventsOf(tenantId, entryId)
          return {
            entry: view(
              entry,
              yield* revisionView(tenantId, entry.currentRevisionId),
              as,
              participant,
            ),
            revisions: revisions.map((revision) => ({
              id: revision.id,
              revisionNo: revision.revisionNo,
              itemRevisionId: revision.itemRevisionId,
              payload: revision.payload,
              note: revision.note,
              source: revision.source,
              actorId: revision.actorId,
              subjectId: revision.subjectId,
              attachments: attachments.get(revision.id) ?? [],
              createdAt: revision.createdAt,
              formConfig: forms.get(revision.itemRevisionId) ?? null,
            })),
            rounds: rounds.map((round): EntryRoundView => ({
              id: round.id,
              roundNo: round.roundNo,
              state: round.state,
              outcome: round.outcome,
              revisionId: round.revisionId,
              submittedAt: round.createdAt,
              completedAt: round.completedAt,
              events: (events.get(round.id) ?? []).map((event) => ({
                kind: event.kind,
                actorId: event.actorId,
                actorName: event.actorName,
                comment: event.comment,
                suggestedPayload: event.suggestedPayload,
                at: event.createdAt,
              })),
            })),
            events: ownEvents.map((event) => ({
              kind: event.kind,
              actorId: event.actorId,
              actorName: event.actorName,
              reason: event.reason,
              at: event.createdAt,
            })),
          }
        }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  /**
   * The round's arrangements changed under a claim, and somebody who may
   * change them says so.
   *
   * Deliberately not `decideReview`: that one asks whether the caller really
   * holds the level the round is standing at, and it should keep asking. An
   * administrator whose level has nobody in it does not become that level's
   * reviewer by having the power to fix the question - they end the round and
   * hand the claim back, in those words.
   *
   * The review phase gate is not consulted either. This is how a claim
   * stranded on an empty level gets out, and a gate that has since closed is
   * exactly the situation it has to work in.
   */
  const interveneOnEntry: EntryMethods['interveneOnEntry'] = Effect.fn(
    'Assessment.interveneOnEntry',
  )(function* (tenantId, entryId, input, as) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const located = yield* entryOf(tenantId, entryId)
          if (located === null) return yield* new EntryNotFound()
          const locked = yield* lockBatch(tenantId, located.batchId)
          if (locked!.status === 'archived') return yield* new BatchReadOnly()
          // re-asked on the locked connection, like every other write here
          yield* deps.requireRosterReach(as, tenantId, located.batchId)
          const reason = input.reason.trim()
          if (reason === '') return yield* refuse('return', 'reason-required')
          const loaded = yield* loadEntry(tenantId, entryId)
          if (loaded === null) return yield* new EntryNotFound()
          const { entry, participant } = loaded
          if (entry.status !== 'in_review' && entry.status !== 'approved') {
            return yield* refuse('return', 'entry-not-returnable')
          }
          // a recorded fact is not its subject's to rewrite, so handing it
          // back would leave it somewhere nobody can act: those are corrected
          // by voiding and recording again
          if (entry.source === 'record' || entry.source === 'import') {
            return yield* refuse('return', 'entry-not-returnable')
          }
          if (entry.currentReviewInstanceId !== null) {
            const ended = yield* cancelReviewInstance({
              tenantId,
              instanceId: entry.currentReviewInstanceId,
              outcome: 'superseded',
            })
            if (ended) {
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: entry.currentReviewInstanceId,
                kind: 'returned-for-revision',
                actorId: as.userId,
                comment: reason,
              })
            }
          }
          const moved = yield* setEntryState({
            tenantId,
            entryId,
            from: ['in_review', 'approved'],
            to: 'needs_revision',
            currentReviewInstanceId: null,
          })
          if (!moved) return yield* refuse('return', 'entry-not-returnable')
          // an approved claim sent back has no open round to record this in,
          // and it is not a rejection: it gets its own line in the entry's
          // own log
          yield* insertEntryEvent({
            tenantId,
            entryId,
            kind: 'revision-required',
            actorId: as.userId,
            reason,
          })
          const written = (yield* entryOf(tenantId, entryId))!
          return view(
            written,
            yield* revisionView(tenantId, written.currentRevisionId),
            as,
            participant,
          )
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

  return {
    listMyEntries,
    getEntryHistory,
    createEntry,
    getEntry,
    appendEntryRevision,
    setEntryStatus,
    interveneOnEntry,
  }
}
