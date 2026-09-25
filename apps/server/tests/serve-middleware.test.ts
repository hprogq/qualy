import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
  QUALY_CLIENT_UNSUPPORTED_HEADER,
} from '@qualy/release-contract'
import { apiRouteFallback } from '@qualy/api-kit/route-fallback'
import { clientAssemblyLayer, ClientAssembly } from '@qualy/api-kit/client-assembly'
import {
  CLIENT_ASSEMBLY_UNSUPPORTED,
  CLIENT_PROTOCOL_UNSUPPORTED,
  CLIENT_RELEASE_UNSUPPORTED,
} from '../src/client-compatibility.ts'
import { serveMiddleware } from '../src/serve-middleware.ts'

// The chain in front of the router, served in front of a router of two
// routes: what an unsafe request from another origin gets back, on the
// wire, with the real status and the body the browser will read.

const port = 3210
const base = `http://127.0.0.1:${port}`
/** a second chain, serving a wider protocol window: the expand step of a breaking change */
const widerPort = 3217
const wider = `http://127.0.0.1:${widerPort}`
/** a third, with something that can judge which assembly a release was built from */
const judgedPort = 3218
const judged = `http://127.0.0.1:${judgedPort}`

/** the release ids this suite's judgement knows about */
const SAME_ASSEMBLY = 'r_sameAssembly'
const OTHER_ASSEMBLY = 'r_otherAssembly'

// Stands in for the web plugin, which is the only thing that can answer this
// for real: it owns the store where each installed release records the
// assembly it was built from. The host asks through the registry and names
// no plugin, which is the property being served here as much as the answers.
const judging = Layer.effectDiscard(
  Effect.gen(function* () {
    const assembly = yield* ClientAssembly
    yield* assembly.register((releaseId) =>
      releaseId === SAME_ASSEMBLY
        ? 'compatible'
        : releaseId === OTHER_ASSEMBLY
          ? 'other-assembly'
          : 'unknown',
    )
  }),
).pipe(Layer.provideMerge(clientAssemblyLayer))

let scope: Scope.Closeable

beforeAll(async () => {
  const echo = Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true }))
  // a route that actually reads the body, which is the only way to observe
  // the ceiling: the echo routes above answer without ever touching it
  const swallow = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* request.text
    return HttpServerResponse.jsonUnsafe({ read: body.length })
  })
  const routes = Layer.mergeAll(
    HttpRouter.add('GET', '/echo', echo),
    HttpRouter.add('POST', '/echo', echo),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/echo`, echo),
    HttpRouter.add('POST', `${QUALY_API_PREFIX}/echo`, echo),
    HttpRouter.add('POST', `${QUALY_API_PREFIX}/swallow`, swallow),
    // the mount's own not-found, as the host serves it
    apiRouteFallback,
  )
  const serve = (
    at: number,
    clientProtocol?: { min: number; max: number },
    assembly?: Layer.Layer<never>,
  ) =>
    HttpRouter.serve(routes, {
      disableLogger: true,
      middleware: serveMiddleware({
        trustedProxies: [],
        access: { mode: 'off', level: 'Debug', exclude: [] },
        ...(clientProtocol === undefined ? {} : { clientProtocol }),
      }),
    }).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: at })), (layer) =>
      assembly === undefined ? layer : Layer.provide(layer, assembly),
    )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(
    Layer.buildWithScope(
      Layer.mergeAll(
        serve(port),
        serve(widerPort, { min: 1, max: 2 }),
        serve(judgedPort, undefined, judging),
      ),
      scope,
    ),
  )
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

describe('what counts as being inside the api', () => {
  it('decides on the same spelling the router matches on', async () => {
    // The prefix test reads the raw url while the router matches the path it
    // has already decoded. If those disagree, a request can reach an api
    // handler while every wrapper that keys off the prefix - the client
    // compatibility check, the access log's api mode - believes it is
    // somewhere else entirely.
    const probe = async (path: string) => {
      const response = await fetch(`${base}${path}`)
      return `${path} -> ${response.status} ${response.headers.get('x-qualy-request-id') === null ? 'no-id' : 'id'}`
    }
    const seen = [
      await probe(`${QUALY_API_PREFIX}/echo`),
      await probe('/%61pi/echo'),
      await probe('/API/echo'),
      await probe('//api/echo'),
      await probe('/api//echo'),
    ]
    // every spelling the router accepts is one the prefix test must accept
    expect(seen).toEqual([
      '/api/echo -> 200 id',
      '/%61pi/echo -> 200 id',
      '/API/echo -> 200 id',
      '//api/echo -> 200 id',
      '/api//echo -> 200 id',
    ])
  })
})

describe('how heavy a request body may be', () => {
  const post = (bytes: number) =>
    fetch(`${base}${QUALY_API_PREFIX}/swallow`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: base },
      body: 'x'.repeat(bytes),
    })

  it('reads a body the product can legitimately send', async () => {
    // an administrative act naming five thousand people, and excluding five
    // thousand more, is around 380 KB of identifiers
    const ordinary = await post(400_000)
    expect(ordinary.status).toBe(200)
    expect(await ordinary.json()).toEqual({ read: 400_000 })
  })

  it('refuses to buffer one past the ceiling', async () => {
    // Without a ceiling this answered 200 with three megabytes held in
    // memory, and nothing bounded how many of those could be in flight.
    // Reaching the limit destroys the request stream, so what the caller
    // sees is the connection going away rather than a status - either way
    // the body was never read to the end.
    const outcome = await post(3 * 1024 * 1024).then(
      (response) => `status:${response.status}`,
      () => 'dropped',
    )
    expect(outcome).not.toBe('status:200')
  })
})

describe('text the database could not keep', () => {
  it('is refused before a route reads it, in the address or a JSON body', async () => {
    // a NUL, or half a surrogate pair, passed any schema not built from the
    // kit's primitives and was refused by postgres instead: a 500 for anybody
    const body = await fetch(`${base}${QUALY_API_PREFIX}/swallow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: '{"email":"a\\u0000@example.edu"}',
    })
    expect(body.status).toBe(400)
    expect(await body.json()).toMatchObject({ _tag: 'BAD_REQUEST' })
    const address = await fetch(`${base}${QUALY_API_PREFIX}/echo?search=%00`)
    expect(address.status).toBe(400)
    // and what can be kept goes through, read by the route as it was sent
    const ordinary = await fetch(`${base}${QUALY_API_PREFIX}/swallow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: '{"email":"a@example.edu"}',
    })
    expect(ordinary.status).toBe(200)
    expect(await ordinary.json()).toEqual({ read: 25 })
  })

  it('is refused in a body sent with no content type, before a route reads it', async () => {
    // an anonymous script need send neither an origin nor a content type, and
    // the platform reads a typeless body as JSON while a raw route streams
    // it; a Blob with no type keeps fetch from adding one
    const bare = await fetch(`${base}${QUALY_API_PREFIX}/swallow`, {
      method: 'POST',
      body: new Blob(['{"email":"a\\u0000@example.edu"}']),
    })
    expect(bare.status).toBe(415)
    expect(await bare.json()).toMatchObject({ _tag: 'BAD_REQUEST' })
  })
})

describe('what every api answer carries', () => {
  it('names the request it answered, on the api and the probes, never elsewhere', async () => {
    const api = await fetch(`${base}${QUALY_API_PREFIX}/echo`)
    const id = api.headers.get('x-qualy-request-id')
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    // one id per request: the next answer names another
    const again = await fetch(`${base}${QUALY_API_PREFIX}/echo`)
    expect(again.headers.get('x-qualy-request-id')).not.toBe(id)
    // a refusal is an answer too
    const refused = await fetch(`${base}${QUALY_API_PREFIX}/echo`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(refused.status).toBe(403)
    expect(refused.headers.get('x-qualy-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    // outside the mount and the probes, nothing is named
    const page = await fetch(`${base}/echo`)
    expect(page.headers.get('x-qualy-request-id')).toBeNull()
  })

  it('answers an unmatched route inside the mount with the tagged 404', async () => {
    const response = await fetch(`${base}${QUALY_API_PREFIX}/nope`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-qualy-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(await response.json()).toEqual({
      _tag: 'API_ROUTE_NOT_FOUND',
      message: expect.any(String),
    })
    // outside the mount the router's own answer stands
    const elsewhere = await fetch(`${base}/nope`)
    expect(elsewhere.status).toBe(404)
    expect(await elsewhere.text()).toBe('')
  })
})

describe('the web client protocol', () => {
  const api = (headers: Record<string, string>, origin = base) =>
    fetch(`${origin}${QUALY_API_PREFIX}/echo`, { headers })

  it('serves a request that names no protocol: the api is not the web page alone', async () => {
    expect((await api({})).status).toBe(200)
  })

  it('serves the generation it speaks', async () => {
    expect((await api({ [QUALY_CLIENT_PROTOCOL_HEADER]: '2' })).status).toBe(200)
  })

  it('refuses a generation outside the window, at once, with the signal the page reads', async () => {
    for (const declared of ['0', '1', '3', 'one', '-1', '2.0']) {
      const response = await api({ [QUALY_CLIENT_PROTOCOL_HEADER]: declared })
      expect(response.status, declared).toBe(409)
      // the header names which of the three refusals it was; the body is the
      // tag alone. What the page sent and what this server serves are in the
      // log, not in an answer every caller can read.
      expect(response.headers.get(QUALY_CLIENT_UNSUPPORTED_HEADER)).toBe('protocol')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(await response.json()).toEqual({ _tag: CLIENT_PROTOCOL_UNSUPPORTED })
    }
  })

  it('lets an older page of the same assembly go on talking', async () => {
    // The rollout property this whole mechanism exists to keep: a deployment
    // that only changed code leaves every open tab working. The release
    // differs, the assembly does not, and nothing is refused.
    const response = await fetch(`${judged}${QUALY_API_PREFIX}/echo`, {
      headers: { [QUALY_CLIENT_RELEASE_HEADER]: SAME_ASSEMBLY },
    })
    expect(response.status).toBe(200)
  })

  it('refuses a page built from a different plugin selection', async () => {
    // Possible only since a build carries the active assembly alone: the
    // page has screens whose api may not be here, and asks a manifest for
    // surfaces its own bundle does not have. The protocol cannot see it -
    // nothing about the api's shape changed.
    const response = await fetch(`${judged}${QUALY_API_PREFIX}/echo`, {
      headers: { [QUALY_CLIENT_RELEASE_HEADER]: OTHER_ASSEMBLY },
    })
    expect(response.status).toBe(409)
    expect(response.headers.get(QUALY_CLIENT_UNSUPPORTED_HEADER)).toBe('assembly')
    expect(await response.json()).toEqual({ _tag: CLIENT_ASSEMBLY_UNSUPPORTED })
  })

  it('refuses a page naming a release it cannot identify', async () => {
    // a tab open longer than the store keeps releases, and a header that is
    // not a release id at all: neither can be judged, so neither is served
    for (const named of ['r_collectedLongAgo', 'not a release id']) {
      const response = await fetch(`${judged}${QUALY_API_PREFIX}/echo`, {
        headers: { [QUALY_CLIENT_RELEASE_HEADER]: named },
      })
      expect(response.status, named).toBe(409)
      expect(response.headers.get(QUALY_CLIENT_UNSUPPORTED_HEADER)).toBe('release')
      expect(await response.json()).toEqual({ _tag: CLIENT_RELEASE_UNSUPPORTED })
    }
  })

  it('judges no release where nothing serves releases', async () => {
    // a headless deployment has no store and no pages; a release header then
    // names a build this process has no opinion about, and having no opinion
    // is not grounds for refusing the cli or an integration
    const response = await fetch(`${base}${QUALY_API_PREFIX}/echo`, {
      headers: { [QUALY_CLIENT_RELEASE_HEADER]: OTHER_ASSEMBLY },
    })
    expect(response.status).toBe(200)
  })

  it('asks about the release only after the protocol, and only for web callers', async () => {
    // one refusal per request, and the older question first: a page that is
    // both out of window and out of assembly is told the simpler thing
    const both = await fetch(`${judged}${QUALY_API_PREFIX}/echo`, {
      headers: {
        [QUALY_CLIENT_PROTOCOL_HEADER]: '1',
        [QUALY_CLIENT_RELEASE_HEADER]: OTHER_ASSEMBLY,
      },
    })
    expect(both.headers.get(QUALY_CLIENT_UNSUPPORTED_HEADER)).toBe('protocol')
    // and a caller that names no release is never judged on one
    expect((await fetch(`${judged}${QUALY_API_PREFIX}/echo`)).status).toBe(200)
  })

  it('judges only the api mount: the shell, probes and the release endpoint answer anyone', async () => {
    const response = await fetch(`${base}/echo`, {
      headers: { [QUALY_CLIENT_PROTOCOL_HEADER]: '0' },
    })
    expect(response.status).toBe(200)
  })

  it('speaks two generations while a breaking change rolls out', async () => {
    for (const declared of ['1', '2']) {
      expect((await api({ [QUALY_CLIENT_PROTOCOL_HEADER]: declared }, wider)).status).toBe(200)
    }
    expect((await api({ [QUALY_CLIENT_PROTOCOL_HEADER]: '3' }, wider)).status).toBe(409)
  })

  it('sits inside the origin guard: a request from elsewhere learns nothing about the window', async () => {
    const response = await fetch(`${base}${QUALY_API_PREFIX}/echo`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', [QUALY_CLIENT_PROTOCOL_HEADER]: '0' },
    })
    expect(response.status).toBe(403)
    expect(response.headers.get(QUALY_CLIENT_UNSUPPORTED_HEADER)).toBeNull()
    // and a same-origin request outside the window is refused before any handler
    const refused = await fetch(`${base}${QUALY_API_PREFIX}/echo`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', [QUALY_CLIENT_PROTOCOL_HEADER]: '0' },
    })
    expect(refused.status).toBe(409)
  })
})

const post = (headers: Record<string, string>) => fetch(`${base}/echo`, { method: 'POST', headers })

describe('unsafe requests from elsewhere', () => {
  it('refuses a cross-site request with the api error shape', async () => {
    const response = await post({ 'sec-fetch-site': 'cross-site' })
    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({
      _tag: 'REQUEST_ORIGIN_REFUSED',
      message: expect.any(String),
    })
  })

  it('refuses a same-site request: a sibling subdomain is not this application', async () => {
    expect((await post({ 'sec-fetch-site': 'same-site' })).status).toBe(403)
  })

  it('serves a same-origin request', async () => {
    expect((await post({ 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  })

  it('judges an origin against the host when no fetch metadata came', async () => {
    expect((await post({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await post({ origin: `http://127.0.0.1:${port}` })).status).toBe(200)
  })

  it('serves a request that says nothing about where it came from', async () => {
    expect((await post({})).status).toBe(200)
  })

  it('serves a safe request from anywhere', async () => {
    const response = await fetch(`${base}/echo`, { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(response.status).toBe(200)
  })
})
