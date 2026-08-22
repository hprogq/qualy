import { useEffect, useRef, useState } from 'react'
import { Effect, Stream } from 'effect'
import { isAuthenticationError } from '@qualy/web-i18n'
import { browserRuntime } from './api-query.ts'

// A server-sent stream as a React resource, with the same division of labour
// as the query side: the page composes the Effect, this hook is the one place
// it runs. The stream's life is the component's - unmount interrupts the
// fiber, which cancels the fetch, which closes the server's scope.
//
// The stream is a wake-up channel, not a data channel, so its failure mode is
// simply "asleep": an end waits out a pause and dials again, and `live` tells
// the caller to lean on polling in the meantime. Nothing is replayed - the
// server opens every connection with its own catch-up signal.
//
// Two endings are not "asleep". A session that is gone will refuse every dial
// the same way, so re-dialling it is a request loop for as long as the tab is
// open; that one stops and waits for the identity to change, which remounts
// the hook. Anything else that fails backs away instead of knocking at a
// fixed rate - a server that is down should not be dialled twenty times a
// minute by every open tab.

const REDIAL_MS = 3_000
const REDIAL_MOST_MS = 60_000
// What returns the wait to its floor is a connection that lasted, not one
// that started. A server opens every stream with a catch-up signal, so an
// arriving event proves only that the request was accepted; a backend that
// accepts and immediately drops, or a proxy that closes the body at once,
// answers that way on every dial and would pin the cycle at three seconds
// forever. Fifteen seconds is far past accept-and-drop and far short of the
// minute at which a middlebox recycles a stream that is working.
const STEADY_MS = 15_000

/** how long to wait before the next dial, given how long the last one lived */
export function nextRedialMs(previous: number, aliveMs: number): number {
  if (aliveMs >= STEADY_MS) return REDIAL_MS
  return Math.min(previous * 2, REDIAL_MOST_MS)
}

export function useApiStream<A>(
  /** undefined when the endpoint is not there to call (a stubbed harness) */
  open: (() => Effect.Effect<Stream.Stream<A, unknown>, unknown>) | undefined,
  onEvent: (event: A) => void,
  options: {
    /** re-dial identity: change it when the stream should be replaced */
    readonly key: string
    readonly enabled?: boolean
  },
): { live: boolean } {
  const enabled = options.enabled ?? true
  const [live, setLive] = useState(false)
  // the freshest closures, without making them re-dial dependencies
  const handler = useRef(onEvent)
  handler.current = onEvent
  const opener = useRef(open)
  opener.current = open

  const absent = open === undefined
  useEffect(() => {
    if (!enabled || absent) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let backoff = REDIAL_MS
    const dial = () => {
      const making = opener.current
      if (controller.signal.aborted || making === undefined) return
      const openedAt = Date.now()
      browserRuntime
        .runPromise(
          Effect.flatMap(making(), (stream) =>
            Stream.runForEach(stream, (event) =>
              Effect.sync(() => {
                // an arriving event is what proves the channel open to the
                // caller; whether it is worth dialling back at full speed is
                // settled at the end, by how long the connection lived
                setLive(true)
                handler.current(event)
              }),
            ),
          ),
          { signal: controller.signal },
        )
        .then(() => undefined)
        .catch((error: unknown) => (isAuthenticationError(error) ? ('stop' as const) : undefined))
        .then((verdict) => {
          setLive(false)
          if (verdict === 'stop' || controller.signal.aborted) return
          // a clean end and a failed one are the same question here: a
          // connection the server closes at once is not one it will serve
          // any better on the next try
          backoff = nextRedialMs(backoff, Date.now() - openedAt)
          timer = setTimeout(dial, backoff)
        })
    }
    dial()
    return () => {
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
      setLive(false)
    }
  }, [enabled, absent, options.key])

  return { live }
}
