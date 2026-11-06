import { afterEach, describe, expect, it } from 'vitest'
import { Effect, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { ANONYMOUS_IDENTITY, QUALY_IDENTITY_HEADER } from '@qualy/api-kit'
import { clientFor } from '../src/api.ts'
import { browserRuntime } from '../src/api-query.ts'
import { adoptDocumentIdentity, identityOfManifest } from '../src/document-identity.ts'
import { installSessionRecovery } from '../src/session-recovery.ts'

// Whose the page is, on every request it makes (docs/adr/0013-document-identity.md):
// the identity it took from its manifest, fixed as each call starts, so a call
// held for a recovery and made again goes out as the page it was made for.

/** the refusal the session middlewares give a page that is somebody else's */
class IdentityChanged extends Schema.TaggedError<IdentityChanged>()(
  'IDENTITY_CHANGED',
  {},
  { httpApiStatus: 409, identifier: 'IdentityChanged' },
) {}

/** the refusal for a session that lapsed, which a recovery waits out */
class SessionExpired extends Schema.TaggedError<SessionExpired>()(
  'SESSION_EXPIRED',
  {},
  { httpApiStatus: 401, identifier: 'SessionExpired' },
) {}

const api = HttpApi.make('identity-under-test').add(
  HttpApiGroup.make('ping').add(
    HttpApiEndpoint.post('send', '/ping/send', {
      success: Schema.Struct({ ok: Schema.Boolean }),
      error: [IdentityChanged, SessionExpired],
    }),
  ),
)

const answers = {
  ok: () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  lost: () =>
    new Response(JSON.stringify({ _tag: 'SESSION_EXPIRED' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  changed: () =>
    new Response(JSON.stringify({ _tag: 'IDENTITY_CHANGED' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }),
}

/** a fetch that writes down whose each request said it was, answering in turn */
const recording =
  (said: (string | null)[], replies: (() => Response)[]): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    said.push(headers.get(QUALY_IDENTITY_HEADER))
    return (replies.shift() ?? answers.ok)()
  }

const send = (fetch: typeof globalThis.fetch) =>
  Effect.gen(function* () {
    const client = yield* clientFor(api, 'http://qualy.test')
    return yield* client.ping.send()
  }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch))

afterEach(() => {
  adoptDocumentIdentity(ANONYMOUS_IDENTITY)
})

describe("a page's identity on its requests", () => {
  it('names the person of the manifest the page took, or nobody', () => {
    expect(identityOfManifest({ viewer: 'authenticated', identity: 'ada' })).toBe('ada')
    expect(identityOfManifest({ viewer: 'anonymous' })).toBe(ANONYMOUS_IDENTITY)
  })

  it('says it on every request', async () => {
    adoptDocumentIdentity('ada')
    const said: (string | null)[] = []
    await browserRuntime.runPromise(send(recording(said, [])))
    expect(said).toEqual(['ada'])
  })

  it('goes out as the page it was started for, whatever the page became meanwhile', async () => {
    adoptDocumentIdentity('ada')
    const said: (string | null)[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const call = browserRuntime.runPromise(
      Effect.promise(() => held).pipe(Effect.andThen(send(recording(said, [])))),
    )
    // the page changes hands while the call waits to go out
    adoptDocumentIdentity('bob')
    release()
    await call
    expect(said).toEqual(['ada'])
  })

  it('is made again after a recovery as the same page, never as whoever the page is now', async () => {
    adoptDocumentIdentity('ada')
    const said: (string | null)[] = []
    const uninstall = installSessionRecovery({
      wait: async () => {
        // somebody else's manifest arrived while the reader was away
        adoptDocumentIdentity('bob')
        return true
      },
      lost: () => false,
      frozen: () => false,
      changed: () => {},
    })
    try {
      await browserRuntime.runPromise(send(recording(said, [answers.lost, answers.ok])))
    } finally {
      uninstall()
    }
    expect(said).toEqual(['ada', 'ada'])
  })

  it("locks the page when the session is somebody else's, and never makes the call again", async () => {
    adoptDocumentIdentity('ada')
    const said: (string | null)[] = []
    let waited = 0
    let locked = 0
    const uninstall = installSessionRecovery({
      wait: async () => {
        waited += 1
        return true
      },
      lost: () => false,
      frozen: () => false,
      changed: () => {
        locked += 1
      },
    })
    try {
      await expect(
        browserRuntime.runPromise(send(recording(said, [answers.changed, answers.ok]))),
      ).rejects.toMatchObject({ _tag: 'IDENTITY_CHANGED' })
    } finally {
      uninstall()
    }
    expect(said).toEqual(['ada'])
    expect(locked).toBe(1)
    expect(waited).toBe(0)
  })
})
