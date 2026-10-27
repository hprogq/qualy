import { randomUUID } from 'node:crypto'
import { Cause, Effect, Exit, Metric } from 'effect'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { BackendUnavailable } from '../src/errors.ts'
import { Storage } from '../src/server/service.ts'
import { memoryBackend, ok, run } from './support/harness.ts'

// What the failure counter counts at the service's own doors, and what each
// caller is still told. A file that is not there and a caller's refusal are
// answers, not failures; a backend, a database or a defect is a failure,
// wherever it comes from - the caller's authorizer included.

/** what a caller sees of an exit: success, its typed error's tag, or a defect */
const seen = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return 'ok'
  const failure = exit.cause.reasons.find(Cause.isFailReason)
  if (failure !== undefined) return (failure.error as { _tag?: string })._tag ?? 'untagged'
  return exit.cause.reasons.some(Cause.isDieReason) ? 'defect' : 'interrupted'
}

describe.runIf(postgresAvailable)('storage failure metrics at the service boundary', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  beforeAll(async () => {
    db = await createTestContext('storage-operation-metrics')
  })
  afterAll(async () => {
    await db?.dispose()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('counts backend, database and defects, wherever they arise, and leaves every answer as it was', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const backend = memoryBackend()
    const refused = { _tag: 'CallerRefused' as const }
    const result = ok(
      await run(
        db.url,
        backend,
        Effect.gen(function* () {
          const storage = yield* Storage
          const ticket = yield* storage.prepareUpload({
            tenantId,
            ownerUserId,
            filename: 'test.png',
            declaredMime: 'image/png',
            size: 4n,
          })
          backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.from('test'))
          yield* storage.completeUpload({
            tenantId,
            ownerUserId,
            reservationId: ticket.reservationId,
          })
          const input = { tenantId, attachmentId: ticket.attachmentId }
          const exits = {
            // answers: not counted
            absent: yield* Effect.exit(
              storage.open({ tenantId, attachmentId: randomUUID() }, () => Effect.void),
            ),
            denied: yield* Effect.exit(storage.open(input, () => Effect.fail(refused))),
            deniedRead: yield* Effect.exit(
              Effect.scoped(storage.read(input, () => Effect.fail(refused))),
            ),
            // failures inside the authorizer: counted, and told as before
            authorizerDatabase: yield* Effect.exit(
              storage.open(input, () => Effect.fail({ _tag: 'QueryFailed' as const })),
            ),
            authorizerBackend: yield* Effect.exit(
              Effect.scoped(storage.read(input, () => Effect.fail(new BackendUnavailable('read')))),
            ),
            authorizerDefect: yield* Effect.exit(
              storage.open(input, () => Effect.die(new Error('authorizer crashed'))),
            ),
          }
          vi.spyOn(backend, 'open').mockImplementation(() =>
            Effect.fail(new BackendUnavailable('open')),
          )
          const broken = yield* Effect.exit(storage.open(input, () => Effect.void))
          return { exits: { ...exits, broken }, metrics: yield* Metric.snapshot }
        }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
      ),
    )

    expect(Object.fromEntries(Object.entries(result.exits).map(([k, v]) => [k, seen(v)]))).toEqual({
      absent: 'STORAGE_ATTACHMENT_NOT_FOUND',
      denied: 'CallerRefused',
      deniedRead: 'CallerRefused',
      authorizerDatabase: 'defect',
      authorizerBackend: 'STORAGE_BACKEND_UNAVAILABLE',
      authorizerDefect: 'defect',
      broken: 'STORAGE_BACKEND_UNAVAILABLE',
    })
    // the caller's own refusal comes back as the very value it failed with
    const denied = result.exits.denied
    if (Exit.isFailure(denied)) expect(denied.cause.reasons[0]).toMatchObject({ error: refused })

    const counted = Object.fromEntries(
      result.metrics
        .filter((state) => state.id === 'qualy.storage.operation.failure')
        .map((state) => [
          state.attributes?.['operation'],
          (state.state as { count: number }).count,
        ]),
    )
    expect(counted).toEqual({ open: 3, read: 1 })
  })
})
