import { StrictMode, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Effect, Stream } from 'effect'
import { useApiStream } from '@qualy/web-runtime'

// The re-dial loop of a live stream, observed through the waits it asks for.
//
// A backend that accepts the connection, sends its opening catch-up event and
// then drops it answers every dial the same way, so the wait has to keep
// growing; resetting it on the arriving event pinned the loop at its floor and
// the tab knocked ten times a minute for as long as it stayed open. Waiting
// those seconds out here would make the test a minute long, so the re-dial
// timers are recorded and fired at once while every other timer, Effect's
// scheduler and the five seconds a dial has to be answered in included,
// keeps its own timing.
const ANSWER_MS = 5_000
const recordRedials = () => {
  const asked: number[] = []
  const real = globalThis.setTimeout.bind(globalThis)
  vi.stubGlobal('setTimeout', (handler: TimerHandler, ms?: number, ...rest: unknown[]): number => {
    if (typeof ms === 'number' && ms >= 3_000 && ms !== ANSWER_MS) {
      asked.push(ms)
      return real(handler, 0)
    }
    return real(handler, ms, ...rest)
  })
  return asked
}

function DyingStream({ onDial }: { onDial: () => void }) {
  useApiStream<string>(
    () => {
      onDial()
      return Effect.succeed(
        Stream.concat(Stream.succeed('sync'), Stream.fail(new Error('connection dropped'))),
      )
    },
    () => {},
    { key: 'probe' },
  )
  return null
}

describe('a stream that dies as soon as it opens', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('waits longer before each dial instead of knocking at a fixed rate', async () => {
    const waits = recordRedials()
    let dials = 0
    await render(<DyingStream onDial={() => (dials += 1)} />)

    await vi.waitFor(() => expect(waits.length).toBeGreaterThanOrEqual(3), { timeout: 5_000 })
    expect(waits.slice(0, 3)).toEqual([6_000, 12_000, 24_000])
    expect(dials).toBeGreaterThanOrEqual(4)
  })
})

/** a stream that answers at once and then stays open, and what the hook says of it */
function OpenStream() {
  const { live } = useApiStream<string>(
    () => Effect.succeed(Stream.concat(Stream.succeed('sync'), Stream.never)),
    () => {},
    { key: 'probe' },
  )
  return <p data-testid="probe" data-live={String(live)} />
}

describe('a connection that was replaced', () => {
  it('does not take the live mark from the connection that replaced it', async () => {
    // a development mount runs every effect twice: the first connection is
    // let go of at once, and it settles after the second has already heard
    await render(
      <StrictMode>
        <OpenStream />
      </StrictMode>,
    )
    const probe = page.getByTestId('probe')
    await expect.element(probe).toHaveAttribute('data-live', 'true')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(probe.element().getAttribute('data-live')).toBe('true')
  })
})

/**
 * A stream whose connections are scripted one by one, and what the hook says
 * of the channel.
 */
function Scripted({ connections }: { connections: (() => Stream.Stream<string, Error>)[] }) {
  const dials = useRef(0)
  const { live, lost, heard } = useApiStream<string>(
    () => {
      const next = connections[Math.min(dials.current, connections.length - 1)]!
      dials.current += 1
      return Effect.succeed(next())
    },
    () => {},
    { key: 'probe' },
  )
  return (
    <p
      data-testid="probe"
      data-live={String(live)}
      data-lost={String(lost)}
      data-heard={String(heard)}
    />
  )
}

/** every value an attribute takes from here on, the one it has now first */
const watchAttribute = (element: Element, name: string): string[] => {
  const seen = [element.getAttribute(name) ?? '']
  new MutationObserver(() => {
    const now = element.getAttribute(name) ?? ''
    if (seen.at(-1) !== now) seen.push(now)
  }).observe(element, { attributes: true, attributeFilter: [name] })
  return seen
}

describe('telling a planned re-dial from a lost channel', () => {
  // how long a connection lived is read off the clock, so a test moves the
  // clock rather than wait out a quarter of a minute
  let skew = 0
  const realNow = Date.now.bind(Date)
  afterEach(() => {
    vi.restoreAllMocks()
    skew = 0
  })
  const skewClock = () => vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew)

  /** a connection that answers and stays open until `end` is called, then ends cleanly */
  const lasting = () => {
    let end = () => {}
    const ended = new Promise<void>((resolve) => {
      end = resolve
    })
    const stream = () =>
      Stream.concat(Stream.succeed('sync'), Stream.fromEffectDrain(Effect.promise(() => ended)))
    return { stream, end: () => end() }
  }
  const answering = () => Stream.concat(Stream.succeed('sync'), Stream.never)

  it('does not count the end of a steady connection as lost when the re-dial answers', async () => {
    skewClock()
    const first = lasting()
    await render(<Scripted connections={[first.stream, answering]} />)
    const probe = page.getByTestId('probe')
    await expect.element(probe).toHaveAttribute('data-live', 'true')
    const lost = watchAttribute(probe.element(), 'data-lost')
    const live = watchAttribute(probe.element(), 'data-live')
    // the server ends a connection that has served for a while
    skew = 16_000
    first.end()
    await expect.poll(() => live.length, { timeout: 6_000 }).toBeGreaterThanOrEqual(3)
    expect(live).toEqual(['true', 'false', 'true'])
    expect(lost).toEqual(['false'])
  })

  it('counts a connection that ends before it proved steady as lost', async () => {
    await render(
      <Scripted
        connections={[
          () => Stream.concat(Stream.succeed('sync'), Stream.fail(new Error('dropped'))),
          () => Stream.never,
        ]}
      />,
    )
    const probe = page.getByTestId('probe')
    await expect.element(probe).toHaveAttribute('data-lost', 'true')
    // it said hello before it dropped, which a screen may never have drawn:
    // the channel is one that was heard and lost, not one never opened
    expect(probe.element().getAttribute('data-live')).toBe('false')
    expect(probe.element().getAttribute('data-heard')).toBe('true')
  })

  it('does not count a channel that never answered as heard', async () => {
    await render(<Scripted connections={[() => Stream.never]} />)
    const probe = page.getByTestId('probe')
    // the dial's allowance runs out: lost, but never heard
    await expect.element(probe, { timeout: 7_000 }).toHaveAttribute('data-lost', 'true')
    expect(probe.element().getAttribute('data-heard')).toBe('false')
  })

  it('counts a planned re-dial that fails as lost', async () => {
    skewClock()
    const first = lasting()
    await render(<Scripted connections={[first.stream, () => Stream.fail(new Error('refused'))]} />)
    const probe = page.getByTestId('probe')
    await expect.element(probe).toHaveAttribute('data-live', 'true')
    skew = 16_000
    first.end()
    // nothing is said while the re-dial is still to come
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(probe.element().getAttribute('data-lost')).toBe('false')
    await expect.element(probe, { timeout: 6_000 }).toHaveAttribute('data-lost', 'true')
  })
})
