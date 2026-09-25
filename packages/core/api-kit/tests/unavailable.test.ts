import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '../src/index.ts'
import { unavailable, unavailableDependencies } from '../src/unavailable.ts'

// A request that died because a dependency was unavailable, told so in the
// one error shape, and every other failure left exactly as it was.
//
// The kit knows no dependency. What it reads is the mark a failure's owner
// set - the database plugin sets it on its own query failures - so the
// failures below are marked by hand, the way that owner marks them.

class Refused extends Schema.TaggedError<Refused>()(
  'PROBE_REFUSED',
  {},
  { httpApiStatus: 409, identifier: 'ProbeRefused' },
) {}

/** a failure its owner says means the dependency is unavailable */
const marked = () =>
  Object.assign(new Error('no connection in time'), { [unavailable]: 'database' })

const group = HttpApiGroup.make('probe')
  .add(HttpApiEndpoint.get('down', '/probe/down', { success: Schema.Struct({}) }))
  .add(HttpApiEndpoint.get('wrapped', '/probe/wrapped', { success: Schema.Struct({}) }))
  .add(HttpApiEndpoint.get('broken', '/probe/broken', { success: Schema.Struct({}) }))
  .add(
    HttpApiEndpoint.get('refused', '/probe/refused', {
      success: Schema.Struct({}),
      error: [Refused],
    }),
  )
const api = HttpApi.make('probe').add(group).prefix(QUALY_API_PREFIX)
const handlers = HttpApiBuilder.group(api, 'probe', (h) =>
  h
    .handle('down', () => Effect.die(marked()))
    // a service that re-raised the failure inside one of its own
    .handle('wrapped', () => Effect.die(new Error('could not save', { cause: marked() })))
    .handle('broken', () => Effect.die(new Error('a bug')))
    .handle('refused', () => Effect.fail(new Refused())),
)

/** the api with the kit's answer mounted beside it, the way the host mounts it */
const app = Layer.mergeAll(
  HttpApiBuilder.layer(api).pipe(
    Layer.provide(handlers),
    Layer.provide(NodeHttpServer.layerHttpServices),
  ),
  unavailableDependencies,
)

const answers = async (paths: readonly string[]) => {
  const { handler, dispose } = HttpRouter.toWebHandler(app, { disableLogger: true })
  try {
    const seen: Record<string, { status: number; tag: string | undefined }> = {}
    for (const path of paths) {
      const response = await handler(new Request(`http://qualy.test${QUALY_API_PREFIX}${path}`))
      const text = await response.text()
      seen[path] = {
        status: response.status,
        tag: text === '' ? undefined : (JSON.parse(text) as { _tag?: string })._tag,
      }
    }
    return seen
  } finally {
    await dispose()
  }
}

describe('a request whose dependency is unavailable', () => {
  it('answers 503 in the one shape, and leaves every other failure alone', async () => {
    expect(
      await answers(['/probe/down', '/probe/wrapped', '/probe/broken', '/probe/refused']),
    ).toEqual({
      '/probe/down': { status: 503, tag: 'SERVICE_UNAVAILABLE' },
      '/probe/wrapped': { status: 503, tag: 'SERVICE_UNAVAILABLE' },
      '/probe/broken': { status: 500, tag: undefined },
      '/probe/refused': { status: 409, tag: 'PROBE_REFUSED' },
    })
  })

  it('names no dependency to the caller', async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(app, { disableLogger: true })
    try {
      const response = await handler(new Request(`http://qualy.test${QUALY_API_PREFIX}/probe/down`))
      const body = await response.text()
      for (const leak of ['database', 'connection']) expect(body).not.toContain(leak)
    } finally {
      await dispose()
    }
  })
})
