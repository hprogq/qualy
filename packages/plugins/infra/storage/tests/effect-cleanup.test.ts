import { randomUUID } from 'node:crypto'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { databaseFor, createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import type { TestContext } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../src/db/entities.ts'
import { DEFAULT_LIMITS, StorageConfig, type StorageLimits } from '../src/server/config.ts'
import { registryLayer, StorageBackends } from '../src/server/registry.ts'
import { Storage, serviceLayer } from '../src/server/service.ts'
import { cleanupLayer, StorageCleanup } from '../src/server/cleanup.ts'
import { backendLayer, memoryBackend, type MemoryBackend } from '../src/testkit/index.ts'
import { ok, reasonIn } from './support/harness.ts'

// What happens to what nobody came back for.
//
// On a clock the suite moves, because every rule here is about a deadline: an
// abandoned upload is deleted only after its credential has expired and a
// grace period has passed, and an attachment nobody saved is deleted only
// after its time to live. Both are exactly the kind of thing that looks
// correct in code and is off by a factor of sixty in practice.

const stack = (url: string, backend: MemoryBackend, limits: Partial<StorageLimits> = {}) => {
  const config = Layer.succeed(StorageConfig, {
    defaultBackend: backend.code,
    limits: { ...DEFAULT_LIMITS, ...limits },
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
  limits: Partial<StorageLimits> = {},
) => Effect.runPromiseExit(Effect.scoped(Effect.provide(effect, stack(url, backend, limits))))

const prepare = (input: { tenantId: string; ownerUserId: string; size?: bigint }) =>
  Effect.flatMap(Storage, (storage) =>
    storage.prepareUpload({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      filename: 'evidence.pdf',
      declaredMime: 'application/pdf',
      size: input.size ?? 1024n,
    }),
  )

/** a completed upload: ticket, object in the store, staged attachment */
const uploaded = (backend: MemoryBackend, input: { tenantId: string; ownerUserId: string }) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const ticket = yield* prepare(input)
    backend.put(`attachments/${input.tenantId}/${ticket.attachmentId}`, Buffer.from('kept for now'))
    const meta = yield* storage.completeUpload({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      reservationId: ticket.reservationId,
    })
    return { ticket, meta }
  })

describe.skipIf(!postgresAvailable)('storage cleanup', () => {
  let context: TestContext
  beforeAll(async () => {
    context = await createTestContext('storage-cleanup')
  })
  afterAll(async () => {
    await context?.dispose()
  })
  // a sweep is deliberately not scoped to one tenant, so rows another test
  // left behind would be swept by this one and counted in its report. Cascade
  // because business plugins hold foreign keys into attachments; their tables
  // are empty here, and naming them would couple this suite to whoever they
  // are this month.
  beforeEach(async () => {
    await context.query('truncate storage_upload_reservations, storage_attachments cascade')
  })

  it('leaves an abandoned upload alone until the grace period is over', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const report = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          const ticket = yield* prepare({ tenantId, ownerUserId })
          // the object landed late, which is the whole reason for the grace
          backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.from('slow'))
          // past the credential, not yet past the grace
          yield* TestClock.adjust(`${15 + 20} minutes`)
          return yield* cleanup.sweepAbandonedUploads
        }),
      ),
    )

    expect(report.claimed).toBe(0)
    expect(backend.keys()).toHaveLength(1)
    const row = await context.row<{ status: string }>(
      'select status from storage_upload_reservations where tenant_id = $1',
      [tenantId],
    )
    expect(row.status).toBe('issued')
  })

  it('deletes the object and releases the quota once the grace period has passed', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const report = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          const ticket = yield* prepare({ tenantId, ownerUserId })
          backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.from('too late'))
          yield* TestClock.adjust('50 minutes')
          return yield* cleanup.sweepAbandonedUploads
        }),
      ),
    )

    expect(report).toEqual({ claimed: 1, removed: 1 })
    expect(backend.keys()).toEqual([])
    const row = await context.row<{ status: string }>(
      'select status from storage_upload_reservations where tenant_id = $1',
      [tenantId],
    )
    expect(row.status).toBe('expired')
  })

  it('keeps the reservation claimed and the quota held when the delete fails', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const report = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          yield* prepare({ tenantId, ownerUserId })
          yield* TestClock.adjust('50 minutes')
          backend.failNext('delete')
          return yield* cleanup.sweepAbandonedUploads
        }),
      ),
    )

    // claimed but not finished: the next sweep tries again
    expect(report).toEqual({ claimed: 1, removed: 0 })
    const row = await context.row<{ status: string }>(
      'select status from storage_upload_reservations where tenant_id = $1',
      [tenantId],
    )
    expect(row.status).toBe('issued')
  })

  it('refuses to complete an upload a sweeper is holding', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const cleanup = yield* StorageCleanup
        const ticket = yield* prepare({ tenantId, ownerUserId })
        yield* TestClock.adjust('50 minutes')
        backend.failNext('delete')
        yield* cleanup.sweepAbandonedUploads
        // the object arrives after the sweeper has taken the ticket
        backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.from('very late'))
        return yield* storage.completeUpload({
          tenantId,
          ownerUserId,
          reservationId: ticket.reservationId,
        })
      }),
    )

    expect(reasonIn(exit)).toBe('being-cleaned-up')
  })

  it('deletes a staged attachment nobody saved, and the row with it', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const report = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const cleanup = yield* StorageCleanup
          yield* uploaded(backend, { tenantId, ownerUserId })
          yield* TestClock.adjust('25 hours')
          return yield* cleanup.sweepStagedAttachments
        }),
      ),
    )

    expect(report).toEqual({ claimed: 1, removed: 1 })
    expect(backend.keys()).toEqual([])
    const rows = await context.query('select id from storage_attachments where tenant_id = $1', [
      tenantId,
    ])
    expect(rows.rows).toHaveLength(0)
  })

  it('never sweeps an attachment that was bound, however old it is', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const report = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const storage = yield* Storage
          const cleanup = yield* StorageCleanup
          const { meta } = yield* uploaded(backend, { tenantId, ownerUserId })
          yield* storage.bind({ tenantId, attachmentId: meta.id, ownerUserId })
          yield* TestClock.adjust(`${24 * 30} hours`)
          return yield* cleanup.sweepStagedAttachments
        }),
      ),
    )

    expect(report).toEqual({ claimed: 0, removed: 0 })
    expect(backend.keys()).toHaveLength(1)
    const row = await context.row<{ status: string }>(
      'select status from storage_attachments where tenant_id = $1',
      [tenantId],
    )
    expect(row.status).toBe('bound')
  })

  it('still refuses to bind an attachment whose sweeper lease has run out', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const cleanup = yield* StorageCleanup
        const { meta } = yield* uploaded(backend, { tenantId, ownerUserId })
        yield* TestClock.adjust('25 hours')
        backend.failNext('delete')
        yield* cleanup.sweepStagedAttachments
        // long past the lease: another sweeper may take the work over, but
        // the first one's delete may still be in flight, and binding on top
        // of an object that is about to vanish is how history loses a file
        yield* TestClock.adjust('1 hour')
        return yield* storage.bind({ tenantId, attachmentId: meta.id, ownerUserId })
      }),
    )

    expect(reasonIn(exit)).toBe('being-cleaned-up')
  })

  it('still refuses to complete an upload whose sweeper lease has run out', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const cleanup = yield* StorageCleanup
        const ticket = yield* prepare({ tenantId, ownerUserId })
        yield* TestClock.adjust('50 minutes')
        backend.failNext('delete')
        yield* cleanup.sweepAbandonedUploads
        yield* TestClock.adjust('1 hour')
        backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.from('very late'))
        return yield* storage.completeUpload({
          tenantId,
          ownerUserId,
          reservationId: ticket.reservationId,
        })
      }),
    )

    expect(reasonIn(exit)).toBe('being-cleaned-up')
  })

  it('refuses to bind an attachment a sweeper is holding', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const cleanup = yield* StorageCleanup
        const { meta } = yield* uploaded(backend, { tenantId, ownerUserId })
        yield* TestClock.adjust('25 hours')
        backend.failNext('delete')
        yield* cleanup.sweepStagedAttachments
        return yield* storage.bind({ tenantId, attachmentId: meta.id, ownerUserId })
      }),
    )

    expect(reasonIn(exit)).toBe('being-cleaned-up')
  })

  it('does not let one person bind another person’s upload', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const { meta } = yield* uploaded(backend, { tenantId, ownerUserId })
        return yield* storage.bind({
          tenantId,
          attachmentId: meta.id,
          ownerUserId: randomUUID(),
        })
      }),
    )

    expect(reasonIn(exit)).toBe('not-owner')
  })

  it('does not let one person bind an attachment that is already bound to another', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const { meta } = yield* uploaded(backend, { tenantId, ownerUserId })
        yield* storage.bind({ tenantId, attachmentId: meta.id, ownerUserId })
        // idempotence is for the owner retrying, not for everybody else: a
        // caller that reads a successful bind as "this file was mine to use"
        // must not get one here
        return yield* storage.bind({
          tenantId,
          attachmentId: meta.id,
          ownerUserId: randomUUID(),
        })
      }),
    )

    expect(reasonIn(exit)).toBe('not-owner')
  })

  it('refuses to retire an attachment nothing ever referred to', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const { meta } = yield* uploaded(backend, { tenantId, ownerUserId })
        // retiring is a statement about history, and a staged attachment has
        // none; keeping it forever to record that nobody used it is the
        // opposite of what the staged sweep is for
        return yield* storage.retire({ tenantId, attachmentId: meta.id })
      }),
    )

    expect(reasonIn(exit)).toBe('not-bound')
    const row = await context.row<{ status: string; bound_at: string | null }>(
      'select status, bound_at from storage_attachments where tenant_id = $1',
      [tenantId],
    )
    expect(row).toEqual({ status: 'staged', bound_at: null })
  })

  it('keeps a retired attachment’s bytes and refuses to bind it again', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const { meta } = yield* uploaded(backend, { tenantId, ownerUserId })
        yield* storage.bind({ tenantId, attachmentId: meta.id, ownerUserId })
        yield* storage.retire({ tenantId, attachmentId: meta.id })
        return yield* storage.bind({ tenantId, attachmentId: meta.id, ownerUserId })
      }),
    )

    expect(reasonIn(exit)).toBe('retired')
    // retiring deletes nothing: history that referred to it still can
    expect(backend.keys()).toHaveLength(1)
  })
})
