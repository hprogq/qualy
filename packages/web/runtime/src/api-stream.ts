import { useEffect, useRef, useState } from 'react'
import { Effect, Stream } from 'effect'
import { browserRuntime } from './api-query.ts'

// A server-sent stream as a React resource, with the same division of labour
// as the query side: the page composes the Effect, this hook is the one place
// it runs. The stream's life is the component's - unmount interrupts the
// fiber, which cancels the fetch, which closes the server's scope.
//
// The stream is a wake-up channel, not a data channel, so its failure mode is
// simply "asleep": any error or end waits out a pause and dials again, and
// `live` tells the caller to lean on polling in the meantime. Nothing is
// replayed - the server opens every connection with its own catch-up signal.

const REDIAL_MS = 3_000

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
    const dial = () => {
      const making = opener.current
      if (controller.signal.aborted || making === undefined) return
      browserRuntime
        .runPromise(
          Effect.flatMap(making(), (stream) =>
            Stream.runForEach(stream, (event) =>
              Effect.sync(() => {
                // the first delivered event is what proves the channel open
                setLive(true)
                handler.current(event)
              }),
            ),
          ),
          { signal: controller.signal },
        )
        .catch(() => undefined)
        .finally(() => {
          setLive(false)
          if (!controller.signal.aborted) timer = setTimeout(dial, REDIAL_MS)
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
