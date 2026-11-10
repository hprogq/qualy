import { randomUUID } from 'node:crypto'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Api } from '@qualy/api-kit/local'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Authenticated, AuthRequired, CurrentUser } from '@qualy/auth-contract/session'
import { defineReadContext } from '../src/content.ts'
import { storageContentApiGroup } from '../src/api.ts'
import { storageContentApiHandlers } from '../src/server/content-api.ts'
import { identityKeyOf } from '@qualy/auth-contract/identity-key'
import {
  compileReadContexts,
  ReadContextCatalog,
  readContext,
} from '../src/server/read-contexts.ts'
import { Storage } from '../src/server/service.ts'
import { presentAttachmentMetadata } from '../src/server/metadata.ts'
import { memoryBackend, ok, run, stack } from './support/harness.ts'

const Entry = defineReadContext('test/entry', Schema.Struct({ entryId: Schema.String }))
// This contract is shared with the independent type tests.
declare module '@qualy/plugin-storage/content' {
  interface ReadContextTypes {
    readonly 'test/entry': { readonly entryId: string }
  }
}

describe.runIf(postgresAvailable)('document-bound storage HTTP delivery', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  let web: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
  const actor = { tenantId: randomUUID(), userId: randomUUID(), sessionId: randomUUID() }
  const backend = memoryBackend()
  let id: string
  let permitted = true
  let decisions = 0
  let reads = 0
  let redirect = false
  const sourceOpen = backend.open
  const fetch = (url: string, identity = actor, method = 'GET') =>
    web.handler(
      new Request(new URL(url, 'https://app.invalid'), {
        method,
        headers: {
          'x-test-user': identity.userId,
          'x-test-session': identity.sessionId,
          'x-test-tenant': identity.tenantId,
        },
      }),
    )

  beforeAll(async () => {
    db = await createTestContext('content-delivery')
    id = ok(
      await run(
        db.url,
        backend,
        Effect.gen(function* () {
          const storage = yield* Storage
          const ticket = yield* storage.prepareUpload({
            tenantId: actor.tenantId,
            ownerUserId: actor.userId,
            filename: '证明.png',
            declaredMime: 'image/png',
            size: 4n,
          })
          backend.put(`attachments/${actor.tenantId}/${ticket.attachmentId}`, Buffer.from('test'))
          yield* storage.completeUpload({
            tenantId: actor.tenantId,
            ownerUserId: actor.userId,
            reservationId: ticket.reservationId,
          })
          return ticket.attachmentId
        }),
      ),
    )
    vi.spyOn(backend, 'open').mockImplementation((...args) => {
      reads++
      return redirect
        ? Effect.succeed({
            kind: 'redirect' as const,
            url: `https://files.invalid/v1/read-${reads}`,
            expiresInSeconds: 60,
            thumbnail: { url: `https://files.invalid/v1/thumb-${reads}`, expiresInSeconds: 60 },
          })
        : sourceOpen(...args)
    })
    const feature = readContext(
      Entry,
      Effect.succeed({
        authorize: ({ context, attachmentIds }) => {
          decisions++
          return Effect.succeed(
            permitted && context.entryId === 'entry'
              ? attachmentIds.filter((value) => value === id)
              : [],
          )
        },
      }),
    )
    if (feature._tag !== 'Contribute') throw new Error('expected read contribution')
    const catalog = await Effect.runPromise(
      compileReadContexts([
        {
          pluginId: 'test',
          value: feature.value as Parameters<typeof compileReadContexts<never>>[0][number]['value'],
        },
      ]),
    )
    const session = Layer.succeed(
      Authenticated,
      Authenticated.of((http) =>
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          if (!req.headers['x-test-user']) return yield* new AuthRequired()
          return yield* Effect.provideService(http, CurrentUser, {
            tenantId: req.headers['x-test-tenant']!,
            userId: req.headers['x-test-user']!,
            sessionId: req.headers['x-test-session']!,
          })
        }),
      ),
    )
    const services = stack(db.url, backend)
    web = HttpRouter.toWebHandler(
      HttpApiBuilder.layer(Api.local(storageContentApiGroup)).pipe(
        Layer.provide(storageContentApiHandlers),
        Layer.provideMerge(
          Layer.mergeAll(
            session,
            HttpServer.layerServices,
            Layer.succeed(ReadContextCatalog, catalog),
          ),
        ),
        Layer.provideMerge(services),
      ),
      { disableLogger: true },
    )
  }, 120_000)
  afterAll(async () => {
    await web?.dispose()
    vi.restoreAllMocks()
    await db?.dispose()
  })

  it('projects repeated citations with one metadata batch and no file delivery', async () => {
    const before = reads
    let batches = 0
    const files = await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* Storage
        return yield* presentAttachmentMetadata(actor.tenantId, Array(100).fill(id)).pipe(
          Effect.provideService(Storage, {
            ...storage,
            metadataMany: (input) => {
              batches++
              expect(input.attachmentIds).toEqual([id])
              return storage.metadataMany(input)
            },
          }),
        )
      }).pipe(Effect.provide(stack(db.url, backend))),
    )
    expect(batches).toBe(1)
    expect(files).toEqual([expect.objectContaining({ id, filename: '证明.png' })])
    expect(reads).toBe(before)
    expect(JSON.stringify(files)).not.toMatch(/storageKey|storageVersion|contentUrl|https:/)
  })

  it('returns local bytes and safe headers, checking authorization on every request', async () => {
    const url = Entry.at({ entryId: 'entry' }).contentUrl(id, identityKeyOf(actor))
    const before = decisions
    for (let i = 0; i < 2; i++) {
      const response = await fetch(url)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
      expect(await response.text()).toBe('test')
    }
    expect(decisions - before).toBe(2)
  })
  it('refuses another document identity before business authorization or opening the backend', async () => {
    const url = Entry.at({ entryId: 'entry' }).contentUrl(id, identityKeyOf(actor))
    const before = [decisions, reads]
    for (const identity of [
      { ...actor, userId: randomUUID() },
      { ...actor, tenantId: randomUUID() },
    ])
      expect((await fetch(url, identity)).status).toBe(409)
    expect([decisions, reads]).toEqual(before)
    // Reauthentication as the same person preserves the document, as for API/RSC.
    expect((await fetch(url, { ...actor, sessionId: randomUUID() })).status).toBe(200)
    expect((await web.handler(new Request(new URL(url, 'https://app.invalid')))).status).toBe(401)
  })
  it('observes revoked access and refuses unknown or unrelated contexts without alternate paths', async () => {
    permitted = false
    const before = reads
    expect(
      (await fetch(Entry.at({ entryId: 'entry' }).contentUrl(id, identityKeyOf(actor)))).status,
    ).toBe(404)
    permitted = true
    expect(
      (await fetch(Entry.at({ entryId: 'other' }).contentUrl(id, identityKeyOf(actor)))).status,
    ).toBe(404)
    for (const [key, value] of [
      ['context', 'test/missing'],
      ['params', '{invalid'],
      ['params', '{}'],
    ] as const) {
      const altered = new URL(
        Entry.at({ entryId: 'entry' }).contentUrl(id, identityKeyOf(actor)),
        'https://app.invalid',
      )
      altered.searchParams.set(key, value)
      expect((await fetch(altered.href)).status).toBe(404)
    }
    expect(reads).toBe(before)
  })
  it('mints a fresh 302 only on actual reads and selects the fixed thumbnail purpose', async () => {
    redirect = true
    const url = Entry.at({ entryId: 'entry' }).contentUrl(id, identityKeyOf(actor))
    const before = reads
    const a = await fetch(url)
    const b = await fetch(url)
    expect(a.status).toBe(302)
    expect(b.status).toBe(302)
    expect(a.headers.get('location')).not.toBe(b.headers.get('location'))
    expect(a.headers.get('cache-control')).toBe('private, no-store')
    const thumbnail = await fetch(
      Entry.at({ entryId: 'entry' }).contentUrl(id, identityKeyOf(actor), 'thumbnail'),
    )
    expect(thumbnail.headers.get('location')).toContain('/thumb-')
    expect(reads - before).toBe(3)
    redirect = false
  })
})
