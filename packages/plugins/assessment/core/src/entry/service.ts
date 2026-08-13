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
} from '../server/errors.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import { itemOf, revisionOf, type ItemRevisionRow, type ItemRow } from '../item/db.ts'
import {
  cancelReviewInstance,
  entryAttachmentHistory,
  entryCountOf,
  entryOf,
  entryRevisionOf,
  insertEntry,
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
  stageHolders,
  staffReachesParticipant,
  type EntryRow,
  type ParticipantAnchor,
} from './db.ts'

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

export interface EntryMethods {
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
      const seen = new Set<string>()
      const toBind: { attachmentId: string; ownerUserId: string }[] = []
      const history =
        input.entryId === null
          ? new Set<string>()
          : yield* entryAttachmentHistory(input.tenantId, input.entryId)

      for (const ref of input.refs) {
        if (seen.has(ref.attachmentId)) continue
        seen.add(ref.attachmentId)
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
        canEdit: active && (entry.status === 'draft' || entry.status === 'rejected'),
        canSubmit: active && entry.status === 'draft',
        canWithdraw: active && entry.status === 'in_review',
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
      const participant = yield* participantOf(tenantId, entry.participantId)
      return { entry, item: item!, participant: participant! }
    })

  const createEntry: EntryMethods['createEntry'] = Effect.fn('Assessment.createEntry')(
    function* (tenantId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const item = yield* itemOf(tenantId, input.itemId)
            if (item === null) return yield* new ItemNotFound()
            const locked = yield* lockBatch(tenantId, item.batchId)
            if (!locked) return yield* new BatchNotFound()
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            const participant = yield* participantOf(tenantId, input.participantId)
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
          const loaded = yield* loadEntry(tenantId, entryId)
          if (loaded === null) return yield* new EntryNotFound()
          const { entry, item, participant } = loaded
          const locked = yield* lockBatch(tenantId, entry.batchId)
          if (locked!.status === 'archived') return yield* new BatchReadOnly()
          // editing is the subject's own act, always: proxies file once and
          // hold nothing afterwards, staff records are corrected by voiding
          if (participant.userId !== as.userId) return yield* refuse('edit', 'not-your-entry')
          if (participant.status !== 'active')
            return yield* refuse('edit', 'participant-not-active')
          if (entry.source === 'record' || entry.source === 'import') {
            return yield* refuse('edit', 'entry-not-editable')
          }
          if (entry.status !== 'draft' && entry.status !== 'rejected') {
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
          // a rejected entry re-enters work through its next revision
          yield* setEntryState({
            tenantId,
            entryId,
            from: ['draft', 'rejected'],
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
            const loaded = yield* loadEntry(tenantId, entryId)
            if (loaded === null) return yield* new EntryNotFound()
            const { entry, item, participant } = loaded
            const locked = yield* lockBatch(tenantId, entry.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
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
              const itemRevision =
                item.currentRevisionId === null
                  ? null
                  : yield* revisionOf(tenantId, item.currentRevisionId)
              if (itemRevision === null) return yield* refuse(action, 'item-not-configured')
              // the current content must still read under the configuration
              // it will be judged by
              const batch = yield* oneBatch(tenantId, entry.batchId)
              const driver = driverOf(item)
              if (driver === undefined) return yield* refuse(action, 'item-type-not-installed')
              const current = yield* entryRevisionOf(tenantId, entry.currentRevisionId)
              const readable = yield* Effect.result(
                driver.decodePayload(itemRevision.formConfig, current!.payload, {
                  materialRange: deps.parseRange(String(batch!.materialRange)),
                }),
              )
              if (Result.isFailure(readable)) {
                return yield* refuse(action, 'entry-not-submittable')
              }

              // the one stage, resolved from the frozen lineage: the nearest
              // ancestor of the stage's node type, the roles anchored exactly
              // there, minus whoever would be judging their own filing
              const policy = itemRevision.reviewPolicy as {
                stages: readonly {
                  selector: { nodeTypeId: string; roleIds: readonly string[] }
                  quorum: unknown
                }[]
                normalTerminal: number
              }
              const stage = policy.stages[0]!
              const step = participant.anchorLineage.find(
                (candidate) => candidate.nodeTypeId === stage.selector.nodeTypeId,
              )
              if (step === undefined) return yield* refuse(action, 'reviewer-not-found')
              const nodePath = yield* nodePathOf(tenantId, step.nodeId)
              if (nodePath === null) return yield* refuse(action, 'reviewer-not-found')
              const holders = yield* stageHolders({
                tenantId,
                nodeId: step.nodeId,
                roleIds: stage.selector.roleIds,
              })
              const conflicted = new Set([participant.userId, current!.actorId])
              if (holders.filter((holder) => !conflicted.has(holder)).length === 0) {
                return yield* refuse(action, 'reviewer-not-found')
              }

              const roundNo = yield* nextRoundNo(tenantId, entryId)
              const instanceId = yield* insertReviewInstance({
                tenantId,
                entryId,
                revisionId: entry.currentRevisionId,
                roundNo,
                effectiveChain: {
                  stages: [
                    {
                      selector: stage.selector,
                      nodeId: step.nodeId,
                      quorum: stage.quorum,
                    },
                  ],
                  normalTerminal: policy.normalTerminal,
                },
                roleIds: stage.selector.roleIds,
                nodeId: step.nodeId,
                nodePath,
              })
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: instanceId,
                kind: 'submitted',
                actorId: as.userId,
              })
              yield* setEntryState({
                tenantId,
                entryId,
                from: ['draft'],
                to: 'in_review',
                currentReviewInstanceId: instanceId,
              })
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
              yield* setEntryState({
                tenantId,
                entryId,
                from: ['in_review'],
                to: 'draft',
                currentReviewInstanceId: null,
              })
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

  return { createEntry, getEntry, appendEntryRevision, setEntryStatus }
}
