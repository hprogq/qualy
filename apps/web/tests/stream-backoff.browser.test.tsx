import { afterEach, describe, expect, it, vi } from 'vitest'
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
// scheduler included, keeps its own timing.
const recordRedials = () => {
  const asked: number[] = []
  const real = globalThis.setTimeout.bind(globalThis)
  vi.stubGlobal('setTimeout', (handler: TimerHandler, ms?: number, ...rest: unknown[]): number => {
    if (typeof ms === 'number' && ms >= 3_000) {
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
    render(<DyingStream onDial={() => (dials += 1)} />)

    await vi.waitFor(() => expect(waits.length).toBeGreaterThanOrEqual(3), { timeout: 5_000 })
    expect(waits.slice(0, 3)).toEqual([6_000, 12_000, 24_000])
    expect(dials).toBeGreaterThanOrEqual(4)
  })
})
