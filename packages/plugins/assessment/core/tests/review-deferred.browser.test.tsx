import { Effect } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { adoptDocumentIdentity, ExpectedIdentity } from '@qualy/web-runtime/document-identity'
import { CURRENT_CLIENT_PROTOCOL } from '@qualy/release-contract'
import { emptyManifest, fakeClient, renderScreen } from '@qualy/testkit/browser'
import {
  useDeferredDecision,
  type StagedDecision,
} from '../src/client/review/useDeferredDecision.ts'

const decision: StagedDecision = {
  kind: 'decision',
  instanceId: '11111111-1111-4111-8111-111111111111',
  decision: 'approve',
  payload: { decision: 'approve', expectedStage: { route: 'normal', stageId: 'class' } },
  participantName: 'Example',
}
const client = fakeClient({
  app: { getManifest: () => Effect.succeed(emptyManifest()) },
  assessment: { decideReview: () => Effect.void, requestSupplement: () => Effect.void },
})
afterEach(() => {
  vi.restoreAllMocks()
})
it('leaving declares the identity that staged the decision even after the cookie changes', async () => {
  const rejected = vi.fn()
  const committed = vi.fn()
  const requests: RequestInit[] = []
  vi.spyOn(window, 'fetch').mockImplementation(async (_url, init) => {
    requests.push(init ?? {})
    const header = new Headers(init?.headers).get('x-qualy-identity')
    return new Response(null, { status: header === 'actor-b' ? 204 : 409 })
  })
  function Screen() {
    const deferred = useDeferredDecision({
      onCommitted: committed,
      onFailed: vi.fn(),
      onRejected: rejected,
    })
    return <button onClick={() => deferred.stage(decision)}>Stage</button>
  }
  await renderScreen({ client, children: <Screen /> })
  await expect.element(page.getByRole('button', { name: 'Stage' })).toBeVisible()
  adoptDocumentIdentity('actor-a')
  await page.getByRole('button', { name: 'Stage' }).click()
  const before = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(before)
  expect(before.defaultPrevented).toBe(true)
  adoptDocumentIdentity('actor-b')
  window.dispatchEvent(new Event('pagehide'))
  await expect.poll(() => rejected.mock.calls.length).toBe(1)
  expect(committed).not.toHaveBeenCalled()
  expect(requests).toHaveLength(1)
  expect(requests[0]?.keepalive).toBe(true)
  expect(new Headers(requests[0]?.headers).get('x-qualy-identity')).toBe('actor-a')
  expect(new Headers(requests[0]?.headers).get('x-qualy-client-protocol')).toBe(
    String(CURRENT_CLIENT_PROTOCOL),
  )
  expect(JSON.parse(String(requests[0]?.body))).toEqual(decision.payload)
})

it('acknowledges a leave request that succeeds while the page remains alive', async () => {
  const committed = vi.fn()
  const rejected = vi.fn()
  vi.spyOn(window, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  function Screen() {
    const deferred = useDeferredDecision({
      onCommitted: committed,
      onFailed: vi.fn(),
      onRejected: rejected,
    })
    return <button onClick={() => deferred.stage(decision)}>Stage</button>
  }
  await renderScreen({ client, children: <Screen /> })
  adoptDocumentIdentity('actor-a')
  await page.getByRole('button', { name: 'Stage' }).click()
  window.dispatchEvent(new Event('pagehide'))
  await expect.poll(() => committed.mock.calls.length).toBe(1)
  expect(rejected).not.toHaveBeenCalled()
})

it('returns an unconfirmed leave decision when the server refuses its old stage', async () => {
  const committed = vi.fn()
  const rejected = vi.fn()
  const sent = vi.spyOn(window, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ _tag: 'ASSESSMENT_ENTRY_ACTION_REFUSED', reason: 'review-stage-changed' }),
      {
        status: 403,
        headers: { 'content-type': 'application/json' },
      },
    ),
  )
  function Screen() {
    const deferred = useDeferredDecision({
      onCommitted: committed,
      onFailed: vi.fn(),
      onRejected: rejected,
    })
    return <button onClick={() => deferred.stage(decision)}>Stage</button>
  }
  await renderScreen({ client, children: <Screen /> })
  adoptDocumentIdentity('actor-a')
  await page.getByRole('button', { name: 'Stage' }).click()
  window.dispatchEvent(new Event('pagehide'))
  await expect.poll(() => rejected.mock.calls.length).toBe(1)
  expect(rejected).toHaveBeenCalledWith(decision)
  expect(committed).not.toHaveBeenCalled()
  const request = sent.mock.calls[0]![1]!
  expect(new Headers(request.headers).get('x-qualy-identity')).toBe('actor-a')
  expect(JSON.parse(String(request.body))).toEqual(decision.payload)
})

it('carries the original identity and supplement payload on leaving', async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = []
  vi.spyOn(window, 'fetch').mockImplementation(async (url, init) => {
    requests.push({ url: String(url), init })
    return new Response(null, { status: 204 })
  })
  const supplement: StagedDecision = {
    kind: 'supplement',
    instanceId: decision.instanceId,
    participantName: 'Example',
    payload: {
      instructions: 'Add a document',
      requirements: [],
      expectedStage: { route: 'escalation', stageId: 'panel' },
    },
  }
  const committed = vi.fn()
  function Screen() {
    const deferred = useDeferredDecision({
      onCommitted: committed,
      onFailed: vi.fn(),
      onRejected: vi.fn(),
    })
    return <button onClick={() => deferred.stage(supplement)}>Stage</button>
  }
  await renderScreen({ client, children: <Screen /> })
  adoptDocumentIdentity('actor-a')
  await page.getByRole('button', { name: 'Stage' }).click()
  adoptDocumentIdentity('actor-b')
  window.dispatchEvent(new Event('pagehide'))
  await expect.poll(() => committed.mock.calls.length).toBe(1)
  expect(requests).toHaveLength(1)
  expect(new Headers(requests[0]?.init?.headers).get('x-qualy-identity')).toBe('actor-a')
  expect(new Headers(requests[0]?.init?.headers).get('x-qualy-client-protocol')).toBe(
    String(CURRENT_CLIENT_PROTOCOL),
  )
  expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(supplement.payload)
})

it('uses the staged identity when the timer is flushed by the next decision', async () => {
  const seen: (string | undefined)[] = []
  const payloads: unknown[] = []
  const fake = fakeClient({
    app: { getManifest: () => Effect.succeed(emptyManifest()) },
    assessment: {
      decideReview: (request: { payload: unknown }) =>
        Effect.gen(function* () {
          seen.push(yield* ExpectedIdentity)
          payloads.push(request.payload)
        }),
      requestSupplement: () => Effect.void,
    },
  })
  function Screen() {
    const deferred = useDeferredDecision({
      onCommitted: vi.fn(),
      onFailed: vi.fn(),
      onRejected: vi.fn(),
    })
    return (
      <>
        <button onClick={() => deferred.stage(decision)}>Stage</button>
        <button onClick={() => deferred.undo()}>Undo</button>
      </>
    )
  }
  await renderScreen({ client: fake, children: <Screen /> })
  adoptDocumentIdentity('actor-a')
  await page.getByRole('button', { name: 'Stage' }).click()
  adoptDocumentIdentity('actor-b')
  await page.getByRole('button', { name: 'Stage' }).click()
  await expect.poll(() => seen.length).toBe(1)
  expect(seen).toEqual(['actor-a'])
  expect(payloads).toEqual([decision.payload])
  await page.getByRole('button', { name: 'Undo' }).click()
})
