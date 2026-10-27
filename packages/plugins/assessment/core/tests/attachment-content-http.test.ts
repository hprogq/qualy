import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { assembledLayer } from '@qualy/api-kit/assembled'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { Authenticated, AuthRequired, CurrentUser } from '@qualy/auth-contract/session'
import { assessmentApiGroup } from '../src/api.ts'
import { assessmentApiHandlers } from '../src/server/index.ts'
import { AssessmentLive } from '../src/live/service.ts'
import { catalogLayers } from './support/catalogs.ts'
import { backend, ok, run, seed, staged, stack } from './support/round.ts'

describe.runIf(postgresAvailable)('attachment content HTTP delivery', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  let web: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
  let fixture: { tenantId: string; owner: string; other: string; id: string }

  beforeAll(async () => {
    db = await createTestContext('attachment-content-http')
    fixture = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('attachment-http')
          const id = yield* staged(f.t, f.s1, 16)
          return { tenantId: f.t, owner: f.s1, other: f.s2, id }
        }),
      ),
    )
    const session = Layer.succeed(
      Authenticated,
      Authenticated.of((httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const userId = request.headers['x-test-user']
          if (userId === undefined) return yield* Effect.fail(new AuthRequired({}))
          return yield* Effect.provideService(httpEffect, CurrentUser, {
            tenantId: fixture.tenantId,
            userId,
            sessionId: 'test',
          })
        }),
      ),
    )
    web = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(Api.local(assessmentApiGroup)).pipe(
        Layer.provide(assessmentApiHandlers),
        Layer.provideMerge(
          Layer.mergeAll(
            AssessmentLive.layer.pipe(Layer.provide(assembledLayer)),
            session,
            catalogLayers,
            HttpServer.layerServices,
          ),
        ),
        Layer.provideMerge(stack(db.url)),
      ),
      { disableLogger: true },
    )
  }, 120_000)

  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    await web?.dispose()
    await db?.dispose()
  })

  const ask = (user?: string) =>
    web.handler(
      new Request(
        `http://qualy.test${QUALY_API_PREFIX}/assessment/attachments/${fixture.id}/content`,
        { headers: user === undefined ? {} : { 'x-test-user': user } },
      ),
    )

  it('checks access before issuing a fresh, uncacheable redirect on each click', async () => {
    let issued = 0
    const open = vi.spyOn(backend, 'open').mockImplementation(() =>
      Effect.sync(() => ({
        kind: 'redirect',
        url: `https://files.example.test/v1/signed-${++issued}`,
        expiresInSeconds: 60,
      })),
    )
    expect((await ask()).status).toBe(401)
    // Attachments outside the reader's reach deliberately look absent.
    expect((await ask(fixture.other)).status).toBe(404)
    expect(open).not.toHaveBeenCalled()
    for (const expected of [1, 2]) {
      const response = await ask(fixture.owner)
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(
        `https://files.example.test/v1/signed-${expected}`,
      )
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).toBe('')
    }
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('preserves direct stream delivery with its filename and exact bytes', async () => {
    const response = await ask(fixture.owner)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('proof.pdf')
    expect(response.headers.get('content-length')).toBe('16')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(16))
  })

  it('describes an authorized rendition without changing the content download target', async () => {
    const delivery = {
      kind: 'redirect' as const,
      url: 'https://files.example.test/v1/original',
      expiresInSeconds: 60,
      thumbnail: { url: 'https://files.example.test/v1/thumbnail', expiresInSeconds: 60 },
    }
    const open = vi.spyOn(backend, 'open').mockImplementation(() => Effect.succeed(delivery))
    const describe = (user: string) =>
      web.handler(
        new Request(`http://qualy.test${QUALY_API_PREFIX}/assessment/attachments/${fixture.id}`, {
          headers: { 'x-test-user': user },
        }),
      )
    expect((await describe(fixture.other)).status).toBe(404)
    expect(open).not.toHaveBeenCalled()
    const response = await describe(fixture.owner)
    expect(response.status).toBe(200)
    expect((await response.json()).delivery).toEqual(delivery)
    expect(open.mock.calls[0]![1].size).toBe(16n)
    expect((await ask(fixture.owner)).headers.get('location')).toBe(delivery.url)
  })
})
