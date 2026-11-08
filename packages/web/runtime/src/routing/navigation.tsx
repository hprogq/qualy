import { useEffect, useState } from 'react'
import { useLocation, useNavigation, useResolvedPath } from 'react-router'

/** how long a navigation may take before its destination says so */
export const PENDING_INDICATOR_AFTER = 150

export interface PendingNavigation {
  /** the router is loading this destination, not another state of the open page */
  readonly pending: boolean
  /** pending for longer than a beat: time to show it */
  readonly indicating: boolean
}

// The router owns the whole move, including the RSC request and a blocked
// move's eventual continuation. A click-local React transition can finish
// before the server answers, or outlive a navigation that was superseded.
// Leave click handling to Link/NavLink and observe the router's destination.
export function usePendingNavigation(to: string): PendingNavigation {
  const navigation = useNavigation()
  const location = useLocation()
  const target = useResolvedPath(to)
  const pending =
    navigation.state !== 'idle' &&
    navigation.location.pathname === target.pathname &&
    navigation.location.pathname !== location.pathname
  const [indicating, setIndicating] = useState(false)

  useEffect(() => {
    if (!pending) {
      setIndicating(false)
      return
    }
    const timer = setTimeout(() => setIndicating(true), PENDING_INDICATOR_AFTER)
    return () => clearTimeout(timer)
  }, [pending])

  return { pending, indicating: pending && indicating }
}
