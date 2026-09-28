import { randomUUID } from 'node:crypto'
import { Clock, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { databaseFor, createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import type { TestContext } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../src/db/entities.ts'
import { DEFAULT_LIMITS, StorageConfig } from '../src/server/config.ts'
import { registryLayer, StorageBackends } from '../src/server/registry.ts'
import { Storage, serviceLayer } from '../src/server/service.ts'
import {
  cleanupLayer,
  revisionVerdict,
  StorageCleanup,
  UNKNOWN_KEY_GRACE_MS,
} from '../src/server/cleanup.ts'
import type { RevisionEntry } from '../src/server/backend.ts'
import { backendLayer, memoryBackend, type MemoryBackend } from '../src/testkit/index.ts'
import { backendContract } from '../src/testkit/contract.ts'
import { ok } from './support/harness.ts'

// A store that keeps every write as a revision of its own.
//
// There a second write to an attachment's key is not refused: the upload
// credential is good until it expires, and whatever is written with it in the
// meantime becomes the newest revision. What keeps an attachment the bytes
// that were checked is that it names the revision it completed with - and
// what keeps the bucket from filling with bytes nobody reads is that
// everything else under the key is removed once nothing can write to it.
//
// The clock is the suite's: a revision is written at the instant the clock
// says, because every rule here is a comparison with a deadline.

const MINUTE = 60 * 1000

const stack = (url: string, backend: MemoryBackend) => {
  const config = Layer.succeed(StorageConfig, {
    defaultBackend: backend.code,
    limits: DEFAULT_LIMITS,
  })
  const registered = backendLayer(backend).pipe(
    Layer.provideMerge(registryLayer),
    Layer.provideMerge(config),
  )
  return Layer.mergeAll(serviceLayer, cleanupLayer).pipe(
    Layer.provideMerge(registered),
    Layer.provideMerge(databaseFor(url, { entities: [...entities] })),
    Layer.provideMerge(TestClock.layer()),
  )
}

const run = <A, E>(
  url: string,
  backend: MemoryBackend,
  effect: Effect.Effect<A, E, Storage | StorageCleanup | StorageBackends | Orm>,
) => Effect.runPromiseExit(Effect.scoped(Effect.provide(effect, stack(url, backend))))

/** a write to the key at the instant the suite's clock says */
const write = (backend: MemoryBackend, key: string, text: string) =>
  Effect.map(Clock.currentTimeMillis, (modifiedAt) =>
    backend.put(key, Buffer.from(text), { modifiedAt }),
  )

/** a completed upload, and the key its bytes live at */
const completed = (backend: MemoryBackend, input: { tenantId: string; ownerUserId: string }) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const ticket = yield* storage.prepareUpload({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      filename: 'evidence.pdf',
      declaredMime: 'application/pdf',
      size: 1024n,
    })
    const key = `attachments/${input.tenantId}/${ticket.attachmentId}`
    yield* write(backend, key, 'checked')
    yield* storage.completeUpload({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      reservationId: ticket.reservationId,
    })
    return { ticket, key }
  })

/** what a read of the attachment hands over, as text */
const readBack = (input: { tenantId: string; attachmentId: string }) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const opened = yield* storage.open(input, () => Effect.void)
    if (opened.target.kind !== 'stream') throw new Error('the memory backend streams')
    const body = opened.target.body
    return yield* Effect.promise(async () => {
      const chunks: Uint8Array[] = []
      for await (const chunk of body) chunks.push(chunk)
      return Buffer.concat(chunks).toString()
    })
  })

describe.skipIf(!postgresAvailable)('storage over a store that keeps revisions', () => {
  let context: TestContext
  beforeAll(async () => {
    context = await createTestContext('storage-revisions')
  })
  afterAll(async () => {
    await context?.dispose()
  })
  // reconciliation walks the whole prefix of every store, so rows another
  // test left would be judged by this one
  beforeEach(async () => {
    await context.query('truncate storage_upload_reservations, storage_attachments cascade')
  })

  const versionOf = async (attachmentId: string) =>
    (
      await context.row<{ storage_version: string | null }>(
        'select storage_version from storage_attachments where id = $1',
        [attachmentId],
      )
    ).storage_version

  it('keeps the revision it checked and reads that one back after a later write', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend('memory', { versioned: true })
    const { attachmentId, text } = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const { ticket, key } = yield* completed(backend, { tenantId, ownerUserId })
          // the credential has not expired, and the store takes the write
          yield* write(backend, key, 'swapped afterwards')
          const text = yield* readBack({ tenantId, attachmentId: ticket.attachmentId })
          return { attachmentId: ticket.attachmentId, text }
        }),
      ),
    )

    expect(text).toBe('checked')
    const version = await versionOf(attachmentId)
    expect(version).toBe('r1')
    expect(backend.openedRevision()).toBe(version)
  })

  it('names no revision where the store keeps only one object a key', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const attachmentId = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const { ticket } = yield* completed(backend, { tenantId, ownerUserId })
          yield* readBack({ tenantId, attachmentId: ticket.attachmentId })
          return ticket.attachmentId
        }),
      ),
    )

    expect(await versionOf(attachmentId)).toBeNull()
    expect(backend.openedRevision()).toBeNull()
  })

  it('leaves a later write alone while the credential could still be used, and removes it after', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend('memory', { versioned: true })
    const outcome = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          const { ticket, key } = yield* completed(backend, { tenantId, ownerUserId })
          yield* write(backend, key, 'swapped afterwards')
          // past the credential, not yet past the grace: an upload that began
          // just before the credential expired may still be arriving
          yield* TestClock.adjust('20 minutes')
          const early = yield* cleanup.reconcileRevisions
          const kept = backend.revisionsOf(key).length
          yield* TestClock.adjust('30 minutes')
          const late = yield* cleanup.reconcileRevisions
          const text = yield* readBack({ tenantId, attachmentId: ticket.attachmentId })
          return { early, kept, late, key, text }
        }),
      ),
    )

    expect(outcome.early.removed).toBe(0)
    expect(outcome.kept).toBe(2)
    expect(outcome.late.removed).toBe(1)
    expect(backend.revisionsOf(outcome.key).map((entry) => entry.revision)).toEqual(['r1'])
    expect(outcome.text).toBe('checked')
  })

  it('removes a marker laid over an attachment, which then still reads', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend('memory', { versioned: true })
    const outcome = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          const { ticket, key } = yield* completed(backend, { tenantId, ownerUserId })
          backend.mark(key, { modifiedAt: yield* Clock.currentTimeMillis })
          yield* TestClock.adjust('50 minutes')
          const report = yield* cleanup.reconcileRevisions
          const text = yield* readBack({ tenantId, attachmentId: ticket.attachmentId })
          return { report, key, text }
        }),
      ),
    )

    expect(outcome.report.removed).toBe(1)
    expect(backend.revisionsOf(outcome.key)).toEqual([
      expect.objectContaining({ revision: 'r1', bytes: expect.anything() }),
    ])
    expect(outcome.text).toBe('checked')
  })

  it('touches nothing at a key where the revision an attachment reads is missing', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend('memory', { versioned: true })
    const outcome = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          const { key } = yield* completed(backend, { tenantId, ownerUserId })
          yield* write(backend, key, 'swapped afterwards')
          // gone from the store by some hand other than this one
          yield* backend.revisions!.remove(key, 'r1')
          yield* TestClock.adjust('50 minutes')
          return { report: yield* cleanup.reconcileRevisions, key }
        }),
      ),
    )

    expect(outcome.report.removed).toBe(0)
    expect(backend.revisionsOf(outcome.key).map((entry) => entry.revision)).toEqual(['r2'])
  })

  // A thousand writes to one key inside a credential's lifetime put the
  // revision the attachment reads on a later page than most of the rest.
  // Judged page by page, the pages without it kept everything, every pass.
  it('removes the later writes to a key in one pass, however many pages they span', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend('memory', { versioned: true, listPage: 3 })
    const outcome = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          const { ticket, key } = yield* completed(backend, { tenantId, ownerUserId })
          for (let round = 0; round < 7; round += 1) {
            yield* write(backend, key, `swapped ${String(round)}`)
          }
          yield* TestClock.adjust('50 minutes')
          const report = yield* cleanup.reconcileRevisions
          const text = yield* readBack({ tenantId, attachmentId: ticket.attachmentId })
          return { report, key, text }
        }),
      ),
    )

    expect(outcome.report.removed).toBe(7)
    expect(backend.revisionsOf(outcome.key).map((entry) => entry.revision)).toEqual(['r1'])
    expect(outcome.text).toBe('checked')
  })

  it('removes what sits at a key no ticket named, once it is a day old', async () => {
    const tenantId = randomUUID()
    const backend = memoryBackend('memory', { versioned: true })
    const key = `attachments/${tenantId}/${randomUUID()}`
    const outcome = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          yield* write(backend, key, 'left behind')
          yield* TestClock.adjust('2 hours')
          const early = yield* cleanup.reconcileRevisions
          yield* TestClock.adjust('1 day')
          const late = yield* cleanup.reconcileRevisions
          return { early, late }
        }),
      ),
    )

    expect(outcome.early.removed).toBe(0)
    expect(outcome.late.removed).toBe(1)
    expect(backend.revisionsOf(key)).toEqual([])
  })

  it('removes every revision of an abandoned upload, not only the newest', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend('memory', { versioned: true })
    const outcome = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const storage = yield* Storage
          const cleanup = yield* StorageCleanup
          const ticket = yield* storage.prepareUpload({
            tenantId,
            ownerUserId,
            filename: 'evidence.pdf',
            declaredMime: 'application/pdf',
            size: 1024n,
          })
          const key = `attachments/${tenantId}/${ticket.attachmentId}`
          yield* write(backend, key, 'first try')
          yield* write(backend, key, 'second try')
          yield* TestClock.adjust('50 minutes')
          return { report: yield* cleanup.sweepAbandonedUploads, key }
        }),
      ),
    )

    expect(outcome.report).toEqual({ claimed: 1, removed: 1 })
    expect(backend.revisionsOf(outcome.key)).toEqual([])
  })

  it('does not list a store that keeps one object a key', async () => {
    const backend = memoryBackend()
    const report = ok(
      await run(
        context.url,
        backend,
        Effect.flatMap(StorageCleanup, (cleanup) => cleanup.reconcileRevisions),
      ),
    )

    expect(report).toEqual({ claimed: 0, removed: 0 })
  })

  it('stops a pass the store cannot finish without failing it', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend('memory', { versioned: true })
    const outcome = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          const { key } = yield* completed(backend, { tenantId, ownerUserId })
          yield* write(backend, key, 'swapped afterwards')
          yield* TestClock.adjust('50 minutes')
          backend.failNext('remove')
          const refused = yield* cleanup.reconcileRevisions
          const retried = yield* cleanup.reconcileRevisions
          return { refused, retried, key }
        }),
      ),
    )

    expect(outcome.refused.removed).toBe(0)
    expect(outcome.retried.removed).toBe(1)
    expect(backend.revisionsOf(outcome.key).map((entry) => entry.revision)).toEqual(['r1'])
  })
})

// the stand-in the suite above relies on, held to what every real store is
describe('a memory store that keeps revisions keeps the storage contract', () => {
  const backend = memoryBackend('memory', { versioned: true })
  const write = async (key: string, bytes: Uint8Array) => backend.put(key, bytes)
  for (const check of backendContract(() => ({ backend, write }))) {
    it(check.name, check.run)
  }
})

describe('which revisions stay', () => {
  const now = 100 * 24 * 60 * MINUTE
  const entry = (revision: string | undefined, extra: Partial<RevisionEntry> = {}) => ({
    key: 'attachments/t/a',
    revision,
    deleteMarker: false,
    modifiedAt: now - 60 * MINUTE,
    ...extra,
  })
  const settled = { status: 'completed' as const, cleanupAfter: now - MINUTE }
  const writable = { status: 'completed' as const, cleanupAfter: now + MINUTE }

  it('keeps everything at a key that can still be written to', () => {
    expect(
      revisionVerdict({
        entry: entry('r2'),
        facts: { attachment: { storageVersion: 'r1' }, reservation: writable },
        frozenSeen: true,
        now,
      }),
    ).toBe('keep')
  })

  it('keeps the revision an attachment reads and removes the rest', () => {
    const facts = { attachment: { storageVersion: 'r1' }, reservation: settled }
    expect(revisionVerdict({ entry: entry('r1'), facts, frozenSeen: true, now })).toBe('keep')
    expect(revisionVerdict({ entry: entry('r2'), facts, frozenSeen: true, now })).toBe('remove')
    expect(
      revisionVerdict({
        entry: entry('r3', { deleteMarker: true }),
        facts,
        frozenSeen: true,
        now,
      }),
    ).toBe('remove')
  })

  it('reads an attachment written before the store kept revisions as the one without a name', () => {
    const facts = { attachment: { storageVersion: null }, reservation: settled }
    expect(revisionVerdict({ entry: entry(undefined), facts, frozenSeen: true, now })).toBe('keep')
    expect(revisionVerdict({ entry: entry('r2'), facts, frozenSeen: true, now })).toBe('remove')
  })

  it('keeps everything when the revision an attachment reads was not in the listing', () => {
    const facts = { attachment: { storageVersion: 'r1' }, reservation: settled }
    expect(revisionVerdict({ entry: entry('r2'), facts, frozenSeen: false, now })).toBe('keep')
  })

  it('waits a day before tidying an attachment that has no ticket', () => {
    const facts = { attachment: { storageVersion: 'r1' }, reservation: undefined }
    expect(revisionVerdict({ entry: entry('r2'), facts, frozenSeen: true, now })).toBe('keep')
    expect(
      revisionVerdict({
        entry: entry('r2', { modifiedAt: now - UNKNOWN_KEY_GRACE_MS }),
        facts,
        frozenSeen: true,
        now,
      }),
    ).toBe('remove')
  })

  it('removes what an abandoned ticket left once its grace is over', () => {
    const facts = {
      attachment: undefined,
      reservation: { status: 'expired' as const, cleanupAfter: now - MINUTE },
    }
    expect(revisionVerdict({ entry: entry('r1'), facts, frozenSeen: false, now })).toBe('remove')
  })
})
