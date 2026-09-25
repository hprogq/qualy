import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '../src/index.ts'
import { schemaRefusals } from '../src/schema-refusal.ts'
import { storableTextGuard } from '../src/storable-text.ts'

// Text PostgreSQL cannot keep - a NUL, half of a surrogate pair - passed
// every schema not built from the kit's primitives: a login email, a search
// box, a path parameter, a free-form payload headed for a jsonb column. The
// database refused it instead, and the defect answered 500 to anybody who
// typed `%00`. The endpoints below take any string at all, which is exactly
// what those fields do, so what they are refused by is the guard.

const port = 3288
const base = `http://127.0.0.1:${port}${QUALY_API_PREFIX}`

/** what a handler received, so a request that should pass is seen to arrive intact */
const echo = Schema.Struct({ seen: Schema.Unknown })

const group = HttpApiGroup.make('probe')
  .add(
    HttpApiEndpoint.post('keep', '/probe/keep', {
      payload: Schema.Struct({
        text: Schema.optional(Schema.String),
        any: Schema.optional(Schema.Unknown),
      }),
      success: echo,
    }),
  )
  .add(
    HttpApiEndpoint.get('find', '/probe/:code/find', {
      params: Schema.Struct({ code: Schema.String }),
      query: Schema.Struct({ search: Schema.optional(Schema.String) }),
      success: echo,
    }),
  )
const api = HttpApi.make('probe').add(group).prefix(QUALY_API_PREFIX)
const handlers = HttpApiBuilder.group(api, 'probe', (h) =>
  h
    .handle('keep', ({ payload }) => Effect.succeed({ seen: payload }))
    .handle('find', ({ params, query }) => Effect.succeed({ seen: { ...params, ...query } })),
)

/** a raw route taking bytes, the way a file upload arrives */
const bytes = HttpRouter.add(
  'PUT',
  `${QUALY_API_PREFIX}/probe/bytes`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = new Uint8Array(yield* request.arrayBuffer)
    return HttpServerResponse.jsonUnsafe({ length: body.byteLength, nul: body.includes(0) })
  }),
)

let scope: Scope.Closeable

beforeAll(async () => {
  const layer = HttpRouter.serve(
    Layer.mergeAll(HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)), bytes, schemaRefusals),
    { disableLogger: true, middleware: storableTextGuard },
  ).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })))
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(layer as never, scope) as never)
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

/** a JSON body written by hand, so escapes reach the server exactly as spelled */
const keep = (json: string) =>
  fetch(`${base}/probe/keep`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: json,
  })

const refusedAsBadRequest = async (response: Response) => ({
  status: response.status,
  tag: ((await response.json()) as { _tag?: string })._tag,
})

describe('text postgres cannot keep', () => {
  it('is refused in a JSON body, however deep, as a bad request', async () => {
    for (const json of [
      '{"text":"a\\u0000b"}',
      '{"text":"\\ud800"}',
      '{"text":"\\udc00x"}',
      '{"any":{"deep":[1,"fine",{"deeper":"\\u0000"}]}}',
      // a key is stored as much as a value is, in a jsonb column
      '{"any":{"\\u0000":true}}',
    ]) {
      expect(await refusedAsBadRequest(await keep(json)), json).toEqual({
        status: 400,
        tag: 'BAD_REQUEST',
      })
    }
  })

  it('is refused in a body sent with no content type, which the endpoint reads as JSON', async () => {
    // a Blob with no type, so fetch adds no content type of its own
    const bare = await fetch(`${base}/probe/keep`, {
      method: 'POST',
      body: new Blob(['{"text":"a\\u0000b"}']),
    })
    expect(await refusedAsBadRequest(bare)).toEqual({ status: 400, tag: 'BAD_REQUEST' })
    // and the same body, clean, still arrives: the endpoint does read it
    const clean = await fetch(`${base}/probe/keep`, {
      method: 'POST',
      body: new Blob(['{"text":"ab"}']),
    })
    expect(clean.status).toBe(200)
    expect(await clean.json()).toEqual({ seen: { text: 'ab' } })
  })

  it('is refused in an address, path and query alike', async () => {
    for (const path of ['/probe/a%00b/find', '/probe/code/find?search=%00']) {
      expect(await refusedAsBadRequest(await fetch(`${base}${path}`)), path).toEqual({
        status: 400,
        tag: 'BAD_REQUEST',
      })
    }
  })

  it('is not mistaken for text that merely looks like it', async () => {
    // a backslash and "u0000", written out; a surrogate pair that is whole;
    // an escaped percent sign followed by zeros
    const spelled = await keep('{"text":"\\\\u0000 \\ud83d\\ude00 😀"}')
    expect(spelled.status).toBe(200)
    expect(await spelled.json()).toEqual({ seen: { text: '\\u0000 😀 😀' } })
    const percent = await fetch(`${base}/probe/code/find?search=%2500`)
    expect(percent.status).toBe(200)
    expect(await percent.json()).toEqual({ seen: { code: 'code', search: '%00' } })
  })

  it('leaves a body that is not JSON to the route that reads it', async () => {
    // an upload is bytes, NUL bytes included, and is streamed rather than read here
    const response = await fetch(`${base}/probe/bytes`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1, 0, 2, 0, 3]),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ length: 5, nul: true })
  })

  it('walks a body nested deeper than a recursive walk could', async () => {
    const depth = 20_000
    const json = `${'['.repeat(depth)}"\\u0000"${']'.repeat(depth)}`
    const response = await keep(`{"any":${json}}`)
    expect(response.status).toBe(400)
  })
})
