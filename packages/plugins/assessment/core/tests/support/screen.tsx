import { Effect, Exit, Fiber, Stream } from 'effect'
import {
  fakeLiveServer,
  renderScreen as render,
  withDocumentContext,
  type FakeLiveServer,
} from '@qualy/testkit/browser'
// the host's stylesheet, because a screen asserted unstyled is a screen
// nobody sees; it is the product's one stylesheet wherever a screen renders
import '../../../../../../apps/web/src/app.css'

// This package's own use of the testkit.
//
// What is said by code - api failures by code - is
// named here rather than taken from the generated aggregate: these tests
// render this plugin's screens, and what they meet is this plugin's own -
// plus, where one of its screens renders a neighbour's contribution, that
// neighbour's. Reaching for
// `virtual:qualy/plugins` instead would make every one of these a
// whole-composition test, and a plugin outside this repository could not
// write one at all.

export {
  addressNow,
  apiError,
  emptyManifest,
  fakeClient,
  type FakeClient,
  type FakeManifest,
} from '@qualy/testkit/browser'

/** who these screens are read by, unless a test says otherwise */
export const READER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const signedIn = {
  user: {
    id: READER_ID,
    displayName: '李老师',
    businessNo: null,
    userType: { id: 'type-staff', code: 'staff', name: '教职工' },
    primaryOrgNode: {
      id: 'node-root',
      name: '示例大学',
      orgType: { id: 'org-school', name: '学校' },
      lineage: [],
    },
    tenant: { id: 'tenant-demo', slug: 'demo', name: '示例大学' },
  },
}

/** the tenant's words settings gives every page, as a tenant that never renamed them has them */
const termsIn = (locale: 'zh-CN' | 'en-US') => ({
  'settings/terms': {
    'auth/business-number': locale === 'en-US' ? 'Student/staff ID' : '学工号',
  },
})

/**
 * A batch's live channel, played from a `watchBatch` stub.
 *
 * The cases here script the server's half the way they always have: a stub
 * answering with a stream of wake-ups. Each socket the page opens is one
 * call of the stub, every element one frame, and a stream that ends or
 * fails is a connection dropped without a close (1006). A case about the
 * socket itself - a close code, a refusal - brings its own server instead.
 */
const playedLive = (watch: unknown): FakeLiveServer | undefined => {
  if (typeof watch !== 'function') return undefined
  return fakeLiveServer((socket) => {
    const batchId = /\/batches\/([^/]+)\/events$/.exec(socket.url.pathname)?.[1] ?? ''
    socket.accept()
    const fiber = Effect.runFork(
      Effect.flatMap(
        (watch as (input: unknown) => Effect.Effect<Stream.Stream<{ kind: string }>>)({
          params: { batchId },
        }),
        (stream) =>
          Stream.runForEach(stream, (event) => Effect.sync(() => socket.send(event.kind))),
      ),
    )
    socket.onClosed(() => void Effect.runFork(Fiber.interrupt(fiber)))
    fiber.addObserver((exit) => {
      if (!Exit.hasInterrupts(exit)) socket.close(1006)
    })
  })
}

export const renderScreen = (options: Parameters<typeof render>[0]) =>
  render({
    ...options,
    ...(options.live === undefined
      ? (() => {
          const live = playedLive(options.client['assessment']?.['watchBatch'])
          return live === undefined ? {} : { live }
        })()
      : {}),
    // the shell's own read of who is signed in, which a few screens share
    client: withDocumentContext(
      {
        ...options.client,
        auth: { getSession: () => Effect.succeed(signedIn), ...options.client['auth'] },
      },
      termsIn(options.locale ?? 'zh-CN'),
    ),
  })
