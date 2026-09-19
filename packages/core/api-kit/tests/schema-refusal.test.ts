import { describe, expect, it } from 'vitest'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { NodeHttpServer } from '@effect/platform-node'
import { createServer } from 'node:http'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { QUALY_API_PREFIX } from '../src/index.ts'
import { schemaRefusals } from '../src/schema-refusal.ts'

// A request the endpoint's schema would not read is still an api error, and
// there is one shape for those. Measured before this existed: status 400,
// no content type, empty body - the only answer under /api with no `_tag`
// for a browser to translate.

const port = 3287
const base = `http://127.0.0.1:${port}${QUALY_API_PREFIX}`

class Refused extends Schema.TaggedError<Refused>()(
  'PROBE_REFUSED',
  { why: Schema.String },
  { httpApiStatus: 422, identifier: 'ProbeRefused' },
) {}

const group = HttpApiGroup.make('probe')
  .add(
    HttpApiEndpoint.post('take', '/probe/take', {
      payload: Schema.Struct({ n: Schema.Number }),
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  )
  .add(
    HttpApiEndpoint.get('refuse', '/probe/refuse', {
      success: Schema.Struct({ ok: Schema.Boolean }),
      error: [Refused],
    }),
  )
const api = HttpApi.make('probe').add(group).prefix(QUALY_API_PREFIX)
const handlers = HttpApiBuilder.group(api, 'probe', (h) =>
  h
    .handle('take', () => Effect.succeed({ ok: true }))
    .handle('refuse', () => Effect.fail(new Refused({ why: 'as asked' }))),
)

const serving = <A>(use: () => Promise<A>) =>
  Effect.runPromise(Scope.make()).then(async (scope) => {
    const layer = HttpRouter.serve(
      Layer.mergeAll(HttpApiBuilder.layer(api).pipe(Layer.provide(handlers)), schemaRefusals),
    ).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })))
    await Effect.runPromise(Layer.buildWithScope(layer as never, scope) as never)
    try {
      return await use()
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

describe('a request its own schema will not read', () => {
  it('answers in the one shape, and leaves every other refusal alone', async () => {
    const seen = await serving(async () => {
      const bad = await fetch(`${base}/probe/take`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ n: 'not a number' }),
      })
      const refused = await fetch(`${base}/probe/refuse`)
      const good = await fetch(`${base}/probe/take`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ n: 1 }),
      })
      return {
        bad: { status: bad.status, body: (await bad.json()) as Record<string, unknown> },
        refused: {
          status: refused.status,
          body: (await refused.json()) as Record<string, unknown>,
        },
        good: { status: good.status, body: (await good.json()) as Record<string, unknown> },
      }
    })

    expect(seen.bad.status).toBe(400)
    expect(seen.bad.body['_tag']).toBe('BAD_REQUEST')
    // it names the part that would not read, and nothing about the value
    expect(String(seen.bad.body['message'])).toContain('payload')
    expect(JSON.stringify(seen.bad.body)).not.toContain('not a number')

    // a domain refusal is not a bad request, and must come back as itself
    expect(seen.refused.status).toBe(422)
    expect(seen.refused.body).toEqual({ _tag: 'PROBE_REFUSED', why: 'as asked' })

    expect(seen.good.status).toBe(200)
  }, 30_000)
})
