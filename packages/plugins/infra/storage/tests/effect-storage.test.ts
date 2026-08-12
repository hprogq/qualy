import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  postgresAvailable,
  type TestContext,
} from '@qualy/plugin-database/testkit'
import { Storage } from '../src/server/service.ts'
import { memoryBackend, ok, reasonIn, run, tagOf } from './support/harness.ts'

// The upload story, told against a real database.
//
// Every one of these is about a claim the design makes and a way it could
// quietly stop being true: that the browser's word is never evidence, that a
// ticket costs something before any byte is written, that completing twice
// yields one attachment, and that the key an upload is authorized for is the
// key it keeps.

const owner = () => ({ tenantId: randomUUID(), ownerUserId: randomUUID() })

const prepare = (input: {
  tenantId: string
  ownerUserId: string
  size?: bigint
  filename?: string
}) =>
  Effect.flatMap(Storage, (storage) =>
    storage.prepareUpload({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      filename: input.filename ?? 'evidence.pdf',
      declaredMime: 'application/pdf',
      size: input.size ?? 1024n,
    }),
  )

describe.skipIf(!postgresAvailable)('storage', () => {
  let context: TestContext
  beforeAll(async () => {
    context = await createTestContext('storage')
  })
  afterAll(async () => {
    await context?.dispose()
  })

  it('reserves a key before a single byte is written', async () => {
    const { tenantId, ownerUserId } = owner()
    const backend = memoryBackend()
    const ticket = ok(await run(context.url, backend, prepare({ tenantId, ownerUserId })))

    expect(ticket.grant.driver).toBe('memory')
    // the key is the attachment's final resting place, decided now
    const row = await context.row<{ storage_key: string; status: string; reserved_bytes: string }>(
      'select storage_key, status, reserved_bytes from storage_upload_reservations where id = $1',
      [ticket.reservationId],
    )
    expect(row.storage_key).toBe(`attachments/${tenantId}/${ticket.attachmentId}`)
    expect(row.status).toBe('issued')
    expect(row.reserved_bytes).toBe('1024')
    // and nothing has been written yet
    expect(backend.keys()).toEqual([])
  })

  it('refuses to complete an upload the backend cannot see', async () => {
    const { tenantId, ownerUserId } = owner()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const ticket = yield* prepare({ tenantId, ownerUserId })
        return yield* storage.completeUpload({
          tenantId,
          ownerUserId,
          reservationId: ticket.reservationId,
        })
      }),
    )

    expect(tagOf(exit)).toBe('STORAGE_RESERVATION_INVALID')
    expect(reasonIn(exit)).toBe('not-uploaded')
    // the ticket survives, because uploading again is the answer
    const row = await context.row<{ status: string }>(
      'select status from storage_upload_reservations order by created_at desc limit 1',
    )
    expect(row.status).toBe('issued')
  })

  it('records the size and fingerprint the backend reports, not the declared ones', async () => {
    const { tenantId, ownerUserId } = owner()
    const backend = memoryBackend()
    const meta = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const storage = yield* Storage
          const ticket = yield* prepare({ tenantId, ownerUserId, size: 4096n })
          // the client said 4096 and wrote 11
          backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.from('hello world'))
          return yield* storage.completeUpload({
            tenantId,
            ownerUserId,
            reservationId: ticket.reservationId,
          })
        }),
      ),
    )

    expect(meta.size).toBe(11n)
    expect(meta.status).toBe('staged')
    expect(meta.integrityAlgorithm).toBe('sha256')
    expect(meta.integrityValue).toHaveLength(64)
  })

  it('answers a repeated complete with the attachment it already made', async () => {
    const { tenantId, ownerUserId } = owner()
    const backend = memoryBackend()
    const [first, second] = ok(
      await run(
        context.url,
        backend,
        Effect.gen(function* () {
          const storage = yield* Storage
          const ticket = yield* prepare({ tenantId, ownerUserId })
          backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.from('once'))
          const complete = () =>
            storage.completeUpload({ tenantId, ownerUserId, reservationId: ticket.reservationId })
          const one = yield* complete()
          const two = yield* complete()
          return [one, two] as const
        }),
      ),
    )

    expect(second.id).toBe(first.id)
    const rows = await context.query('select id from storage_attachments where tenant_id = $1', [
      tenantId,
    ])
    expect(rows.rows).toHaveLength(1)
  })

  it('fails the ticket and deletes the object when more arrived than was reserved', async () => {
    const { tenantId, ownerUserId } = owner()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const ticket = yield* prepare({ tenantId, ownerUserId, size: 8n })
        backend.put(
          `attachments/${tenantId}/${ticket.attachmentId}`,
          Buffer.from('far more than eight bytes'),
        )
        return yield* storage.completeUpload({
          tenantId,
          ownerUserId,
          reservationId: ticket.reservationId,
        })
      }),
    )

    expect(reasonIn(exit)).toBe('oversized')
    expect(backend.keys()).toEqual([])
    const row = await context.row<{ status: string }>(
      'select status from storage_upload_reservations order by created_at desc limit 1',
    )
    expect(row.status).toBe('failed')
  })

  it('refuses to complete somebody else’s ticket', async () => {
    const { tenantId, ownerUserId } = owner()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const ticket = yield* prepare({ tenantId, ownerUserId })
        backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.from('mine'))
        return yield* storage.completeUpload({
          tenantId,
          ownerUserId: randomUUID(),
          reservationId: ticket.reservationId,
        })
      }),
    )

    expect(tagOf(exit)).toBe('STORAGE_RESERVATION_NOT_FOUND')
  })

  it('does not let one tenant read another tenant’s attachment', async () => {
    const { tenantId, ownerUserId } = owner()
    const backend = memoryBackend()
    const exit = await run(
      context.url,
      backend,
      Effect.gen(function* () {
        const storage = yield* Storage
        const ticket = yield* prepare({ tenantId, ownerUserId })
        backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.from('private'))
        yield* storage.completeUpload({
          tenantId,
          ownerUserId,
          reservationId: ticket.reservationId,
        })
        return yield* storage.metadata({
          tenantId: randomUUID(),
          attachmentId: ticket.attachmentId,
        })
      }),
    )

    expect(tagOf(exit)).toBe('STORAGE_ATTACHMENT_NOT_FOUND')
  })
})
