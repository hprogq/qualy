import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { entities as storageEntities } from '@qualy/plugin-storage/db'
import { DEFAULT_LIMITS, StorageConfig, Storage } from '@qualy/plugin-storage/server'
import type { Orm } from '@qualy/plugin-database/server'
import { serviceLayer } from '@qualy/plugin-storage/server/service'
import { registryLayer } from '@qualy/plugin-storage/server/registry'
import { backendLayer } from '@qualy/plugin-storage/testkit'
import { localBackend } from '../src/server/backend.ts'

// The whole way in through the disk's door, at the service seam the http
// route stands on: a ticket is prepared, its bytes are received under the
// reservation's own ceiling, and completing it turns the staged file into
// an attachment. The refusals are the door's worth: an unknown ticket, a
// spent one, and more bytes than were reserved.

let root: string

const stream = async function* (bytes: Uint8Array, chunk = 8) {
  for (let index = 0; index < bytes.byteLength; index += chunk) {
    yield bytes.subarray(index, index + chunk)
  }
}

describe.runIf(postgresAvailable)('the upload door', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'qualy-upload-door-'))
    db = await createTestContext('storage-local-upload-door')
  })

  afterAll(async () => {
    await db?.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const stack = () =>
    serviceLayer.pipe(
      Layer.provideMerge(backendLayer(localBackend(root))),
      Layer.provideMerge(registryLayer),
      Layer.provideMerge(
        Layer.succeed(StorageConfig, { defaultBackend: 'local', limits: DEFAULT_LIMITS }),
      ),
      Layer.provideMerge(databaseFor(db.url, { entities: storageEntities })),
    )

  const run = <A, E>(effect: Effect.Effect<A, E, Storage | Orm>) =>
    Effect.runPromiseExit(Effect.provide(effect, stack()))

  const tenant = (slug: string) =>
    Effect.map(
      runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
      (result) => String((result as { rows: { id: string }[] }).rows[0]!.id),
    )

  it('takes exactly what was reserved, and what it took can be completed', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const storage = yield* Storage
        const t = yield* tenant('door-ok')
        const owner = randomUUID()
        const bytes = new TextEncoder().encode('a small honest certificate')
        const ticket = yield* storage.prepareUpload({
          tenantId: t,
          ownerUserId: owner,
          filename: 'proof.pdf',
          declaredMime: 'application/pdf',
          size: BigInt(bytes.byteLength),
        })
        yield* storage.receiveUpload({ reservationId: ticket.reservationId, body: stream(bytes) })
        const meta = yield* storage.completeUpload({
          tenantId: t,
          ownerUserId: owner,
          reservationId: ticket.reservationId,
        })
        const missing = yield* Effect.exit(
          storage.receiveUpload({ reservationId: randomUUID(), body: stream(bytes) }),
        )
        return { meta, ticket, missing }
      }),
    )
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
    expect(exit.value.meta.status).toBe('staged')
    expect(exit.value.meta.size).toBe(26n)
    // the grant names the exact door these bytes went through
    expect(exit.value.ticket.grant.driver).toBe('local')
    expect(
      (exit.value.ticket.grant.payload as { url: string }).url.endsWith(
        exit.value.ticket.reservationId,
      ),
    ).toBe(true)
    const missing = exit.value.missing
    expect(Exit.isFailure(missing)).toBe(true)
  })

  it('refuses more bytes than the ticket reserved, and leaves nothing staged', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const storage = yield* Storage
        const t = yield* tenant('door-over')
        const owner = randomUUID()
        const bytes = new TextEncoder().encode('rather more than was promised')
        const ticket = yield* storage.prepareUpload({
          tenantId: t,
          ownerUserId: owner,
          filename: 'proof.pdf',
          declaredMime: 'application/pdf',
          size: 4n,
        })
        const over = yield* Effect.exit(
          storage.receiveUpload({ reservationId: ticket.reservationId, body: stream(bytes) }),
        )
        const completed = yield* Effect.exit(
          storage.completeUpload({
            tenantId: t,
            ownerUserId: owner,
            reservationId: ticket.reservationId,
          }),
        )
        return { over, completed }
      }),
    )
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
    const over = exit.value.over
    expect(Exit.isFailure(over) && String(over.cause).includes('oversized')).toBe(true)
    // nothing arrived, so the ticket cannot be turned into an attachment
    expect(Exit.isFailure(exit.value.completed)).toBe(true)
  })
})
