import { useCallback, useState } from 'react'
import type { Viewer } from './model.ts'

// What a reader has chosen to put away on the entries workspace, kept by
// this browser alone: a convenience of the reader's, never a fact anybody
// else reads. The owner's head and a staff reader's hold different figures,
// so each is kept apart. A browser that cannot remember - a private window,
// blocked site data - shows everything, as a first visit does.

const statsKey = (viewer: Viewer) => `qualy:assessment-entries-stats:${viewer}`

/** whether the figures under the head's total are out, as this browser last left them */
export const statsShownFor = (viewer: Viewer): boolean => {
  try {
    return window.localStorage.getItem(statsKey(viewer)) !== '0'
  } catch {
    return true
  }
}

/** the head's figures out or put away, remembered for the next visit */
export function useStatsShown(viewer: Viewer): readonly [boolean, (shown: boolean) => void] {
  const [shown, setShown] = useState(() => statsShownFor(viewer))
  const show = useCallback(
    (next: boolean) => {
      setShown(next)
      try {
        window.localStorage.setItem(statsKey(viewer), next ? '1' : '0')
      } catch {
        // kept for this visit only
      }
    },
    [viewer],
  )
  return [shown, show] as const
}
