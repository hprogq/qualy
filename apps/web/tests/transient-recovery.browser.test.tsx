import { expect, it } from 'vitest'
import { Effect } from 'effect'
import { page } from 'vitest/browser'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
import '../src/app.css'

// A failed document read offers a router retry. There is no manifest Query
// observer keeping a separate SPA tree alive behind these screen fixtures.

/** the shape the http client hands over for a server between processes */
const betweenProcesses = () =>
  Object.assign(new Error('service unavailable'), {
    _tag: 'HttpClientError',
    response: { status: 503, headers: { 'x-qualy-state': 'starting' } },
  })

it('can retry a failed document read once the backend comes back', async () => {
  let ready = false
  let asked = 0
  await renderScreen({
    client: fakeClient({
      app: {
        getManifest: () => {
          asked++
          return ready ? Effect.succeed(emptyManifest()) : Effect.fail(betweenProcesses())
        },
      },
    }),
    children: <p>the application</p>,
  })
  await expect.element(page.getByRole('button', { name: /重试|Retry/ })).toBeVisible()
  ready = true
  await page.getByRole('button', { name: /重试|Retry/ }).click()
  await expect.element(page.getByText('the application')).toBeVisible()
  expect(asked).toBe(2)
}, 30_000)

it('says so when the server means it', async () => {
  await renderScreen({
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
