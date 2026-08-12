import { randomUUID } from 'node:crypto'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  postgresAvailable,
  type TestContext,
} from '@qualy/plugin-database/testkit'
import { Storage } from '../src/server/service.ts'
import { lockKey } from '../src/server/db.ts'
import { memoryBackend, ok, reasonIn, run } from './support/harness.ts'

// What an account may take, and what happens when two of its requests arrive
// at the same moment.
//
// The concurrent case is the only reason the advisory locks exist. Read usage,
// decide, insert - done twice at once without a lock - lets both requests see
// the same "there is room" and both take it, and the tenant ends up over its
// limit with nothing in the log to say when. So the interesting assertion is
// not that a quota is enforced; it is that it is enforced when ten requests
// race.

const owner = () => ({ tenantId: randomUUID(), ownerUserId: randomUUID() })

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

describe.skipIf(!postgresAvailable)('storage quota', () => {
  let context: TestContext
  beforeAll(async () => {
    context = await createTestContext('storage-quota')
  })
  afterAll(async () => {
    await context?.dispose()
  })

  it('refuses a file larger than the deployment allows', async () => {
    const { tenantId, ownerUserId } = owner()
    const exit = await run(
      context.url,
      memoryBackend(),
      prepare({ tenantId, ownerUserId, size: 2048n }),
      { maxFileBytes: 1024n },
    )
    expect(reasonIn(exit)).toBe('file-too-large')
  })

  it('refuses a file larger than the caller’s own stricter rule', async () => {
    const { tenantId, ownerUserId } = owner()
    const exit = await run(
      context.url,
      memoryBackend(),
      Effect.flatMap(Storage, (storage) =>
        storage.prepareUpload({
          tenantId,
          ownerUserId,
          filename: 'photo.png',
          declaredMime: 'image/png',
          size: 900n,
          maxFileBytes: 500n,
        }),
      ),
    )
    expect(reasonIn(exit)).toBe('file-too-large')
  })

  it('counts tickets nobody used against the person who asked for them', async () => {
    const { tenantId, ownerUserId } = owner()
    const exit = await run(
      context.url,
      memoryBackend(),
      Effect.gen(function* () {
        // two allowed, and not one byte uploaded
        yield* prepare({ tenantId, ownerUserId })
        yield* prepare({ tenantId, ownerUserId })
        return yield* prepare({ tenantId, ownerUserId })
      }),
      { maxActiveReservationsPerOwner: 2 },
    )
    expect(reasonIn(exit)).toBe('too-many-reservations')
  })

  it('counts reserved bytes, not stored ones', async () => {
    const { tenantId, ownerUserId } = owner()
    const exit = await run(
      context.url,
      memoryBackend(),
      Effect.gen(function* () {
        yield* prepare({ tenantId, ownerUserId, size: 700n })
        return yield* prepare({ tenantId, ownerUserId, size: 700n })
      }),
      { maxReservedBytesPerOwner: 1000n },
    )
    expect(reasonIn(exit)).toBe('owner-quota-exceeded')
  })

  it('stops one tenant filling the deployment', async () => {
    const tenantId = randomUUID()
    const exit = await run(
      context.url,
      memoryBackend(),
      Effect.gen(function* () {
        // two different people, one tenant
        yield* prepare({ tenantId, ownerUserId: randomUUID(), size: 600n })
        return yield* prepare({ tenantId, ownerUserId: randomUUID(), size: 600n })
      }),
      { tenantHardBytes: 1000n },
    )
    expect(reasonIn(exit)).toBe('tenant-quota-exceeded')
  })

  it('refuses somebody asking for keys faster than the rate window allows', async () => {
    const { tenantId, ownerUserId } = owner()
    const exit = await run(
      context.url,
      memoryBackend(),
      Effect.gen(function* () {
        yield* prepare({ tenantId, ownerUserId })
        yield* prepare({ tenantId, ownerUserId })
        return yield* prepare({ tenantId, ownerUserId })
      }),
      // the rate window counts every ticket ever asked for, used or not, so a
      // limit of two refuses the third even with room to spare
      { prepareRatePerHour: 2, maxActiveReservationsPerOwner: 100 },
    )
    expect(reasonIn(exit)).toBe('rate-limited')
  })

  it('lets exactly as many concurrent requests through as there was room for', async () => {
    const { tenantId, ownerUserId } = owner()
    const exits = ok(
      await run(
        context.url,
        memoryBackend(),
        // ten at once against room for three: the lock is the only thing
        // standing between this and thirteen hundred reserved bytes
        Effect.all(
          Array.from({ length: 10 }, () =>
            Effect.exit(prepare({ tenantId, ownerUserId, size: 100n })),
          ),
          { concurrency: 'unbounded' },
        ),
        {
          maxReservedBytesPerOwner: 300n,
          maxActiveReservationsPerOwner: 100,
          prepareRatePerHour: 100,
        },
      ),
    )

    const granted = exits.filter(Exit.isSuccess).length
    expect(granted).toBe(3)
    const row = await context.row<{ total: string }>(
      `select coalesce(sum(reserved_bytes), 0)::text as total from storage_upload_reservations
       where tenant_id = $1 and status = 'issued'`,
      [tenantId],
    )
    expect(row.total).toBe('300')
    for (const exit of exits.filter(Exit.isFailure)) {
      expect(reasonIn(exit)).toBe('owner-quota-exceeded')
    }
  })

  it('serializes a tenant’s uploads on a key every process derives alike', () => {
    // the lock is a number, and two nodes computing it differently would each
    // hold a lock nobody else respects
    expect(lockKey('tenant', 'a')).toBe(lockKey('tenant', 'a'))
    expect(lockKey('tenant', 'a')).not.toBe(lockKey('tenant', 'b'))
    expect(lockKey('tenant', 'a')).not.toBe(lockKey('owner', 'a'))
    // and it has to fit in the bigint postgres takes
    const key = lockKey('tenant', randomUUID())
    expect(key).toBeGreaterThanOrEqual(-(2n ** 63n))
    expect(key).toBeLessThan(2n ** 63n)
  })
})
