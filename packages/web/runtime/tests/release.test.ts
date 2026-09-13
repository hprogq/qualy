import { describe, expect, it, vi } from 'vitest'
import { QUALY_RELEASE_ENDPOINT, type ReleaseProbe } from '@qualy/release-contract'
import { createReleaseCoordinator, type ChannelLike } from '../src/release.ts'

// The coordinator's state machine with every browser thing injected: what
// a page concludes from what the host answers, and when it asks.

const current = {
  schema: 1 as const,
  releaseId: 'A',
  mode: 'production' as const,
  clientProtocol: 1,
}
const probeFor = (releaseId: string): ReleaseProbe => ({
  schema: 1,
  releaseId,
  mode: 'production',
  clientProtocol: 1,
  serverProtocol: { min: 1, max: 1 },
})

/** a host answering the probe with a fixed release, or failing */
const host = (answer: () => ReleaseProbe | Error) => {
  const calls: string[] = []
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    calls.push(input)
    expect(init.cache).toBe('no-store')
    const result = answer()
    if (result instanceof Error) throw result
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { fetch, calls }
}

class FakeDocument extends EventTarget {
  visibilityState = 'visible'
}

class FakeChannel implements ChannelLike {
  readonly posted: unknown[] = []
  onmessage: ChannelLike['onmessage'] = null
  closed = false
  postMessage(message: unknown) {
    this.posted.push(message)
  }
  close() {
    this.closed = true
  }
  /** what another tab said */
  hear(data: unknown) {
    this.onmessage?.({ data })
  }
}

const setUp = (
  answer: () => ReleaseProbe | Error,
  options: { readonly channel?: ChannelLike | null } = {},
) => {
  let clock = 1_000_000
  const window = new EventTarget()
  const document = new FakeDocument()
  const reload = vi.fn()
  const { fetch, calls } = host(answer)
  const coordinator = createReleaseCoordinator({
    current,
    fetch,
    now: () => clock,
    window,
    document,
    reload,
    channel: options.channel ?? null,
  })
  const states: string[] = []
  coordinator.subscribe(() => states.push(coordinator.getSnapshot().kind))
  return {
    coordinator,
    calls,
    window,
    document,
    reload,
    states,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('what a probe means', () => {
  it('stays current when the host serves the same release', async () => {
    const { coordinator, states } = setUp(() => probeFor('A'))
    expect(await coordinator.check({ force: true })).toEqual(probeFor('A'))
    expect(coordinator.getSnapshot()).toEqual({ kind: 'current' })
    expect(states).toEqual([])
  })

  it('finds an update when the host serves another, and says so once', async () => {
    const { coordinator, states } = setUp(() => probeFor('B'))
    await coordinator.check({ force: true })
    expect(coordinator.getSnapshot()).toEqual({ kind: 'update-available', latest: probeFor('B') })
    await coordinator.check({ force: true })
    expect(states).toEqual(['update-available'])
  })

  it('reads nothing into a failed background probe', async () => {
    const { coordinator, states } = setUp(() => new Error('offline'))
    expect(await coordinator.check({ force: true })).toBeUndefined()
    expect(coordinator.getSnapshot()).toEqual({ kind: 'current' })
    expect(states).toEqual([])
  })

  it('reads nothing into an answer that is not a probe', async () => {
    const fetch = vi.fn(async () => new Response('<!doctype html>', { status: 200 }))
    const coordinator = createReleaseCoordinator({
      current,
      fetch,
      window: new EventTarget(),
      document: new FakeDocument(),
      channel: null,
    })
    expect(await coordinator.check({ force: true })).toBeUndefined()
    expect(coordinator.getSnapshot()).toEqual({ kind: 'current' })
  })

  it('shares one probe between concurrent checks', async () => {
    const { coordinator, calls } = setUp(() => probeFor('A'))
    const [one, two] = await Promise.all([
      coordinator.check({ force: true }),
      coordinator.check({ force: true }),
    ])
    expect(one).toEqual(two)
    expect(calls).toEqual([QUALY_RELEASE_ENDPOINT])
  })
})

describe('when a page asks', () => {
  it('does not ask again within the throttle on coming into view, and asks after it', async () => {
    const { coordinator, calls, document, advance } = setUp(() => probeFor('A'))
    coordinator.start()
    advance(4 * 60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await settled()
    expect(calls).toHaveLength(0)
    advance(2 * 60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await settled()
    expect(calls).toHaveLength(1)
    // hidden: nothing to ask for
    document.visibilityState = 'hidden'
    advance(10 * 60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await settled()
    expect(calls).toHaveLength(1)
  })

  it('asks at once when restored from the back-forward cache', async () => {
    const { coordinator, calls, window } = setUp(() => probeFor('B'))
    coordinator.start()
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    await settled()
    expect(calls).toHaveLength(0)
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    await settled()
    expect(calls).toHaveLength(1)
    expect(coordinator.getSnapshot().kind).toBe('update-available')
  })

  it('stops listening when stopped', async () => {
    const { coordinator, calls, window } = setUp(() => probeFor('B'))
    coordinator.start()
    coordinator.stop()
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    await settled()
    expect(calls).toHaveLength(0)
  })
})

describe('when a chunk fails to load', () => {
  const preloadError = (window: EventTarget) => {
    const event = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(event)
    return event
  }

  it('is a release skew when the host serves another release', async () => {
    const { coordinator, window } = setUp(() => probeFor('B'))
    coordinator.start()
    const event = preloadError(window)
    expect(event.defaultPrevented).toBe(true)
    await settled()
    expect(coordinator.getSnapshot()).toEqual({
      kind: 'reload-required',
      reason: 'release-skew',
      latest: probeFor('B'),
    })
  })

  it('is a loading failure when the host serves the same release', async () => {
    const { coordinator, window } = setUp(() => probeFor('A'))
    coordinator.start()
    preloadError(window)
    await settled()
    expect(coordinator.getSnapshot()).toEqual({
      kind: 'reload-required',
      reason: 'asset-load-failed',
    })
  })

  it('is a loading failure, not an update, when the host cannot be asked', async () => {
    const { coordinator, window } = setUp(() => new Error('offline'))
    coordinator.start()
    preloadError(window)
    await settled()
    expect(coordinator.getSnapshot()).toEqual({
      kind: 'reload-required',
      reason: 'asset-load-failed',
    })
  })

  it('learns it was a skew after all when the network comes back', async () => {
    let answer: ReleaseProbe | Error = new Error('offline')
    const { coordinator, window } = setUp(() => answer)
    coordinator.start()
    preloadError(window)
    await settled()
    expect(coordinator.getSnapshot().kind).toBe('reload-required')
    answer = probeFor('B')
    window.dispatchEvent(new Event('online'))
    await settled()
    expect(coordinator.getSnapshot()).toEqual({
      kind: 'reload-required',
      reason: 'release-skew',
      latest: probeFor('B'),
    })
  })
})

describe('the reader and the block', () => {
  it('does not say the same release twice once dismissed, and says a later one', async () => {
    let answer = probeFor('B')
    const { coordinator, states } = setUp(() => answer)
    await coordinator.check({ force: true })
    coordinator.dismissAvailable()
    expect(coordinator.getSnapshot()).toEqual({ kind: 'current' })
    await coordinator.check({ force: true })
    expect(coordinator.getSnapshot()).toEqual({ kind: 'current' })
    answer = probeFor('C')
    await coordinator.check({ force: true })
    expect(coordinator.getSnapshot()).toEqual({ kind: 'update-available', latest: probeFor('C') })
    expect(states).toEqual(['update-available', 'current', 'update-available'])
  })

  it('blocks on the api refusing this protocol', () => {
    const { coordinator } = setUp(() => probeFor('A'))
    coordinator.notifyClientUnsupported()
    expect(coordinator.getSnapshot()).toEqual({
      kind: 'reload-required',
      reason: 'client-protocol',
    })
  })

  it('never softens a block on a later probe, and never reloads on its own', async () => {
    const { coordinator, reload } = setUp(() => probeFor('A'))
    coordinator.requireReload('client-protocol')
    await coordinator.check({ force: true })
    expect(coordinator.getSnapshot()).toEqual({
      kind: 'reload-required',
      reason: 'client-protocol',
    })
    coordinator.requireReload('asset-load-failed')
    expect(
      coordinator.getSnapshot().kind === 'reload-required' && coordinator.getSnapshot(),
    ).toMatchObject({
      reason: 'client-protocol',
    })
    coordinator.dismissAvailable()
    expect(coordinator.getSnapshot().kind).toBe('reload-required')
    expect(reload).not.toHaveBeenCalled()
    coordinator.reload()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('between tabs', () => {
  it('tells the other tabs about a release it saw, and hears theirs', async () => {
    const channel = new FakeChannel()
    const { coordinator } = setUp(() => probeFor('B'), { channel })
    coordinator.start()
    await coordinator.check({ force: true })
    expect(channel.posted).toEqual([{ type: 'release-observed', probe: probeFor('B') }])
    const other = new FakeChannel()
    const listener = setUp(() => probeFor('A'), { channel: other })
    listener.coordinator.start()
    other.hear({ type: 'release-observed', probe: probeFor('C') })
    expect(listener.coordinator.getSnapshot()).toEqual({
      kind: 'update-available',
      latest: probeFor('C'),
    })
    // a word that is not a probe is not heard; a block stays this tab's own
    other.hear({ type: 'release-observed', probe: { releaseId: 'D' } })
    other.hear('reload now')
    expect(listener.coordinator.getSnapshot()).toEqual({
      kind: 'update-available',
      latest: probeFor('C'),
    })
    listener.coordinator.stop()
    expect(other.closed).toBe(true)
  })
})
