import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { CaptchaPrompt } from '../contract.ts'
import { captchaProviderFor, type CaptchaRecovery } from './registry.ts'

// A challenge, from the moment a request is answered with one to the proof
// that lets the request be sent again.
//
// The caller keeps what is its own: the prompt it was answered with, where
// an interactive challenge may appear, and what to do with the proof - send
// the same request again, usually. This keeps what every caller would
// otherwise get subtly wrong: bringing the provider up in the container,
// taking it down, and making sure a challenge that was abandoned - the
// address it was bound to changed, the form went away - can never deliver
// its proof late and resubmit something nobody asked for.

export type CaptchaState =
  | 'idle'
  /** the provider's own code is still arriving */
  | 'loading-provider'
  /** under way, with nothing for the person to do */
  | 'working'
  /** the person has to act in the challenge */
  | 'interaction'
  | 'failed'

/** where an interactive challenge is shown: in the form, or over the page */
export type CaptchaPlacement = 'inline' | 'modal'

export interface CaptchaGate {
  readonly state: CaptchaState
  /** when the state is `failed`: whether the same challenge can be tried again */
  readonly recovery: CaptchaRecovery | undefined
  readonly placement: CaptchaPlacement
  /** the element the provider works in, which `CaptchaChallenge` renders */
  readonly containerRef: RefObject<HTMLDivElement | null>
  /** abandons the current challenge; nothing it was doing will reach the caller */
  readonly cancel: () => void
  /** starts the same challenge over, after it failed */
  readonly retry: () => void
  /**
   * Tries again the way the failure calls for: the same challenge once more,
   * or - when the challenge itself is spent - the caller's own request again,
   * which is the only thing that can bring a new one.
   */
  readonly recover: () => void
}

export interface CaptchaSolution {
  readonly provider: string
  readonly response: string
}

export function useCaptchaGate(input: {
  /** the challenge to meet, or nothing while there is none */
  readonly prompt: CaptchaPrompt | null
  readonly placement?: CaptchaPlacement
  /**
   * Called once per challenge, with the proof to send the request again with.
   * The caller should drop the prompt before sending: a proof is spent the
   * moment it is handed over, whatever the request then answers.
   */
  readonly onSolved: (solution: CaptchaSolution) => void
  /**
   * The challenge can no longer be met: send the original request again,
   * without a proof, for the server to issue a new one. Never done here -
   * this capability does not know the caller's request, and must not.
   */
  readonly onRefresh: () => void
}): CaptchaGate {
  const { prompt, placement = 'inline' } = input
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<CaptchaState>('idle')
  const [recovery, setRecovery] = useState<CaptchaRecovery | undefined>(undefined)
  // bumped to start over; the prompt a cancel set aside stays set aside
  const [round, setRound] = useState(0)
  const [abandoned, setAbandoned] = useState<CaptchaPrompt | null>(null)
  // every start takes a number; a report under an older number is ignored
  const generation = useRef(0)
  const solved = useRef(input.onSolved)
  const refresh = useRef(input.onRefresh)
  useEffect(() => {
    solved.current = input.onSolved
    refresh.current = input.onRefresh
  })
  const fail = (how: CaptchaRecovery) => {
    setRecovery(how)
    setState('failed')
  }

  useEffect(() => {
    const mine = ++generation.current
    const current = () => mine === generation.current
    setRecovery(undefined)
    if (prompt === null || prompt === abandoned) {
      setState('idle')
      return
    }
    const provider = captchaProviderFor(prompt.provider)
    const container = containerRef.current
    if (provider === undefined || container === null) {
      // a challenge this build cannot meet: the deployment chose a provider
      // whose browser half is not here, and no amount of waiting fixes that
      fail('restart')
      return
    }
    setState('loading-provider')
    let dispose: (() => void) | undefined
    let finished = false
    provider
      .start({
        container,
        challenge: prompt.challenge,
        onStateChange: (next) => {
          if (!current() || finished) return
          switch (next.kind) {
            case 'working':
              setState('working')
              return
            case 'interaction-required':
              setState('interaction')
              return
            case 'failed':
              fail(next.recovery)
              return
            case 'solved':
              finished = true
              setState('idle')
              solved.current({ provider: prompt.provider, response: next.response })
          }
        },
      })
      .then(
        (handle) => {
          // taken down before it was up: take it down now
          if (current()) dispose = handle.dispose
          else handle.dispose()
        },
        () => {
          // its code did not arrive; the challenge itself is untouched
          if (current() && !finished) fail('restart')
        },
      )
    return () => {
      // the number moves on first, so nothing the provider says while it is
      // being taken down reaches the caller
      generation.current += 1
      dispose?.()
    }
  }, [prompt, abandoned, round])

  const cancel = useCallback(() => {
    generation.current += 1
    setAbandoned(prompt)
  }, [prompt])
  const retry = useCallback(() => setRound((was) => was + 1), [])
  const recover = useCallback(() => {
    if (recovery === 'refresh') refresh.current()
    else retry()
  }, [recovery, retry])

  return { state, recovery, placement, containerRef, cancel, retry, recover }
}
