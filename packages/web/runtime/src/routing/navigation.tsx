import { useEffect, useState } from 'react'
import { matchPath, useLocation, useNavigation, useResolvedPath } from 'react-router'

/** how long a navigation may take before its destination says so */
export const PENDING_INDICATOR_AFTER = 150

export interface PendingNavigation {
  /** While moving, selection follows this destination instead of the old location. */
  readonly selected: (current: boolean) => boolean
  /** the router is loading this destination, not another state of the open page */
  readonly pending: boolean
  /** pending for longer than a beat: time to show it */
  readonly indicating: boolean
}

// The router owns the whole move, including the RSC request and a blocked
// move's eventual continuation. A click-local React transition can finish
// before the server answers, or outlive a navigation that was superseded.
// Leave click handling to Link/NavLink and observe the router's destination.
export function usePendingNavigation(to: string, end = true): PendingNavigation {
  const navigation = useNavigation()
  const location = useLocation()
  const target = useResolvedPath(to)
  const destination =
    navigation.state !== 'idle' && navigation.location.pathname !== location.pathname
      ? navigation.location.pathname
      : undefined
  const matches = (pathname: string) =>
    matchPath({ path: target.pathname, end: end || target.pathname === '/' }, pathname) !== null
  const next = destination !== undefined && matches(destination)
  const pending = next && !matches(location.pathname)
  const [indicating, setIndicating] = useState(false)

  useEffect(() => {
    if (!pending) {
      setIndicating(false)
      return
    }
    const timer = setTimeout(() => setIndicating(true), PENDING_INDICATOR_AFTER)
    return () => clearTimeout(timer)
  }, [pending])

  return {
    selected: (current) => (destination === undefined ? current : next),
    pending,
    indicating: pending && indicating,
  }
}
