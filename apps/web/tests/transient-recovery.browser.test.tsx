import { expect, it } from 'vitest'
import { Effect } from 'effect'
import { page } from 'vitest/browser'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
import '../src/app.css'

// What the shell does while the backend is being replaced.
//
// In development the api goes away for a second or two on every save. The
// whole application is behind one query - the manifest - so the difference
// between waiting that out and not is the difference between a page that
// carries on and a page that drops the reader onto a retry button they have
// to find and press each time somebody edits a file.
//
// It is bounded, though, and the other case is asserted with it: a refusal
// the server means is answered at once rather than waited on.

/** the shape the http client hands over for a server between processes */
const betweenProcesses = () =>
  Object.assign(new Error('service unavailable'), {
    _tag: 'HttpClientError',
    response: { status: 503, headers: { 'x-qualy-state': 'starting' } },
  })

const manifestThat = (fail: () => number) => {
  let asked = 0
  return fakeClient({
    app: {
      getManifest: () => {
        asked += 1
        return asked <= fail() ? Effect.fail(betweenProcesses()) : Effect.succeed(emptyManifest())
      },
    },
  })
}

it('carries on once the backend comes back', async () => {
  renderScreen({
    client: manifestThat(() => 2),
    children: <p>the application</p>,
  })
  // it never says the manifest failed; it simply arrives late
  await expect.element(page.getByText('the application')).toBeVisible()
}, 30_000)

it('says so when the server means it', async () => {
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.fail(Object.assign(new Error('nope'), { _tag: 'INTERNAL_SERVER_ERROR' })),
      },
    }),
    children: <p>the application</p>,
  })
  // a refusal is not waited out: the reader is told, with a way to try again
  await expect.element(page.getByRole('button', { name: /重试|Retry/ })).toBeVisible()
}, 30_000)
