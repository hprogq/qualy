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
      browserRuntime
        .runPromise(
          Effect.flatMap(making(), (stream) =>
            Stream.runForEach(stream, (event) =>
              Effect.sync(() => {
                // the first delivered event is what proves the channel open,
                // and proves the way back is worth taking at full speed again
                setLive(true)
                backoff = REDIAL_MS
                handler.current(event)
              }),
            ),
          ),
          { signal: controller.signal },
        )
        .then(() => {
          // a clean end is the server closing a connection it will accept
          // again: dial straight back
          backoff = REDIAL_MS
          return undefined
        })
        .catch((error: unknown) => {
          if (isAuthenticationError(error)) return 'stop' as const
          backoff = Math.min(backoff * 2, REDIAL_MOST_MS)
          return undefined
        })
        .then((verdict) => {
          setLive(false)
          if (verdict === 'stop' || controller.signal.aborted) return
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
