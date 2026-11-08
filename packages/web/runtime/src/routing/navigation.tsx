import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router'

// What a link in the shell knows about the navigation it started.
//
// The router moves in a transition: the page that is open stays up until
// the next one's code has arrived, rather than the whole area collapsing to
// a spinner for the length of a chunk download. Right, and useless on its
// own: the address does not change until the transition commits, so
// nothing the address drives - the lit entry, the title - moves either,
// and on a slow network a press looks like a press that missed. The
// transition is therefore started here, where the press happened, so the
// element that was pressed can say it heard: lit at once, marked busy
// after a beat, both for exactly as long as the transition takes.
//
// A plain left click only. A modified click, a middle click and a link
// with a target are the browser's - a new tab has no transition to show.

/** how long a navigation may take before the element that started it says so */
export const PENDING_INDICATOR_AFTER = 150

export interface PendingNavigation {
  /** the navigation this element started has not committed yet */
  readonly pending: boolean
  /** pending for longer than a beat: time to show it */
  readonly indicating: boolean
  /** the click handler, for an anchor that already carries the href */
  readonly onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void
}

const plainLeftClick = (event: ReactMouseEvent<HTMLAnchorElement>): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  (event.currentTarget.target === '' || event.currentTarget.target === '_self')

export function usePendingNavigation(to: string): PendingNavigation {
  const navigate = useNavigate()
  const location = useLocation()
  const [pending, startTransition] = useTransition()
  const [indicating, setIndicating] = useState(false)

  useEffect(() => {
    if (!pending) {
      setIndicating(false)
      return
    }
    const timer = setTimeout(() => setIndicating(true), PENDING_INDICATOR_AFTER)
    return () => clearTimeout(timer)
  }, [pending])

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || !plainLeftClick(event)) return
      event.preventDefault()
      // one press is one navigation: a second press while the first is on
      // its way would only queue the same move again
      if (pending) return
      // pressing the entry that is already open replaces rather than pushes,
      // as the router's own link does, so back still leaves the page
      const here = `${location.pathname}${location.search}${location.hash}`
      startTransition(() => {
        void navigate(to, { replace: here === to })
      })
    },
    [pending, location, navigate, to, startTransition],
  )

  return { pending, indicating, onClick }
}
