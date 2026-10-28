import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useManifest, type Manifest } from './runtime-context.tsx'
import type { LiveChannels, LiveChannelState } from './live-channel.ts'

// The tab's live channels as a React resource, with the same division of
// labour as the query side: a screen says which channel and what to do with
// a word, and the runtime keeps the connection.

/** the runtime's channels; absent outside a runtime, where a screen simply polls */
export const LiveChannelsContext = createContext<LiveChannels | undefined>(undefined)

const QUIET: LiveChannelState = { live: false, lost: false, heard: false, waiting: false }

/**
 * Who a channel is held for: the signed-in identity the manifest names, or
 * nobody. A page held by nobody is refused at once and stops dialling; it is
 * still told apart, so nothing it held is lent to whoever signs in next.
 */
export const liveIdentityOf = (manifest: Manifest): string =>
  manifest.viewer === 'authenticated' ? `user:${manifest.identity ?? ''}` : 'anonymous'

export function useLiveChannel(
  /** the api path of the channel; undefined where the screen has none to hold */
  path: string | undefined,
  onMessage: (kind: string) => void,
): LiveChannelState {
  const channels = useContext(LiveChannelsContext)
  const identity = liveIdentityOf(useManifest())
  const [state, setState] = useState(QUIET)
  // the freshest closure, without making it a reason to hold again
  const handler = useRef(onMessage)
  handler.current = onMessage

  useEffect(() => {
    if (channels === undefined || path === undefined) return
    const release = channels.hold(identity, path, {
      onMessage: (kind) => handler.current(kind),
      onState: setState,
    })
    return () => {
      release()
      setState(QUIET)
    }
  }, [channels, identity, path])

  return state
}
