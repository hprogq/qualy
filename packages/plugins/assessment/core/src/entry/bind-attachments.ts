import { Effect, Result } from 'effect'
import type { AttachmentMeta } from '@qualy/plugin-storage/server'
import type { AttachmentRef } from '../plugin.ts'
import { EntryPayloadInvalid } from '../errors.ts'
import { entryAttachmentHistory, lockAttachments } from './db.ts'

// Crossing a cited file into storage, for every door that writes a revision.
//
// This lives on its own because forgetting it is silent and expensive: a
// revision may cite an attachment that storage still calls staged, and the
// staged sweep then deletes the bytes and fails on the row that still points
// at them. Sharing one implementation is what keeps a new writing door from
// discovering that the hard way.

/** the two storage doors this walks through, typed to what it uses */
export interface CitedAttachmentStorage {
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

/**
 * The attachments a payload cites, held to storage's own facts and bound in
 * the caller's transaction.
 *
 * Trust runs one way: the driver names what the payload claims, storage says
 * what actually exists - who uploaded it, how large it really is, what state
 * it is in. A staged file must be the actor's own; a bound one may only be
 * cited again by the entry that already cites it; nothing retired is ever
 * cited anew.
 *
 * `entryId` is the entry whose own history may cite a bound file again, or
 * null when the revision being written is the entry's first.
 */
export const bindCitedAttachments = (
  storage: CitedAttachmentStorage,
  input: {
    tenantId: string
    entryId: string | null
    actorId: string
    refs: readonly AttachmentRef[]
  },
) =>
  Effect.gen(function* () {
    if (input.refs.length === 0) return

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
    if (issues.length > 0) return yield* new EntryPayloadInvalid({ issues })

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
      // included: a limit tightened after the first upload is a limit, not a
      // suggestion grandfathered away
      if (ref.maxFileBytes !== undefined && attachment.size > BigInt(ref.maxFileBytes)) {
        issues.push({ field: ref.field, reason: 'attachment-too-large' })
        continue
      }
      if (ref.accept !== undefined && !acceptable(ref.accept, attachment.declaredMime, attachment.filename)) {
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
    if (issues.length > 0) return yield* new EntryPayloadInvalid({ issues })
    for (const target of toBind) {
      const bound = yield* Effect.result(
        storage.bind({
          tenantId: input.tenantId,
          attachmentId: target.attachmentId,
          ownerUserId: target.ownerUserId,
        }),
      )
      if (Result.isFailure(bound)) {
        return yield* new EntryPayloadInvalid({
          issues: [{ field: '', reason: 'attachment-unavailable' }],
        })
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
