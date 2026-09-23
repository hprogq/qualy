// A button held back for a while after it was pressed.
//
// A refused attempt holds the button for a moment, so a press repeated in a
// hurry is not a burst of requests - and a refusal for too many attempts
// holds it until the wait it named has passed, counting down, so the reader
// is not left to press again and be refused again.

import { useCallback, useEffect, useState } from 'react'

/** after an ordinary refusal: long enough to be a pause, short enough to go unnoticed */
export const PAUSE_MS = 1000

export function useHold() {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const tick = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at >= until) window.clearInterval(tick)
    }, 250)
    return () => window.clearInterval(tick)
  }, [until])
  const hold = useCallback((ms: number) => {
    const at = Date.now()
    setNow(at)
    setUntil(at + ms)
  }, [])
  return { held: until > now, secondsLeft: Math.max(0, Math.ceil((until - now) / 1000)), hold }
}

/** a wait as a clock reads it: 4:05, 0:09 */
export const clock = (seconds: number): string =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
