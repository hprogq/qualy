import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

// What the rail shells share below the components: how an entry is ordered,
// when an entry's path counts as "here", how a parameterised path is filled
// from the route, and how the phone drawer keeps its open state.

export const byOrder = (a: { order?: number }, b: { order?: number }) =>
  (a.order ?? 0) - (b.order ?? 0)

/** whether some other entry of the rail lives under this one's path */
export const hasEntriesBelow = (path: string, all: readonly string[]) =>
  all.some((other) => other !== path && other.startsWith(`${path}/`))

/**
 * Whether an entry's path is the one being read - the same rule NavLink
 * applies, stated here for the bar that has to know before it draws.
 *
 * A bar that keeps only some of its entries has to decide whether what is
 * open is among them, and there is nothing to ask: the entries it dropped
 * were never rendered.
 */
export const isHere = (pathname: string, path: string, exact: boolean) =>
  exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)

/** the entry's path with this route's parameters in it, or nothing if one is missing */
export const fill = (path: string, params: Readonly<Record<string, string | undefined>>) => {
  if (!path.includes(':')) return path
  const segments = path.split('/')
  const filled: string[] = []
  for (const segment of segments) {
    if (!segment.startsWith(':')) {
      filled.push(segment)
      continue
    }
    const value = params[segment.slice(1)]
    // an entry that cannot be addressed from here is not shown here: better
    // absent than pointing at a literal ":batchId"
    if (value === undefined) return undefined
    filled.push(encodeURIComponent(value))
  }
  return filled.join('/')
}

/**
 * Whether the navigation drawer is open, kept on the history entry rather
 * than in component state.
 *
 * On a phone the drawer is somewhere the reader went, and the back key is
 * how anybody leaves such a place: opening pushes an entry, the system back
 * gesture pops it, and a page reached through the drawer keeps the drawer
 * underneath it on the way back. Component state would make back leave the
 * page instead, which on a phone reads as the app closing on them.
 */
const NAV_STATE = 'workspaceNav'
export function useNavDrawer() {
  const location = useLocation()
  const navigate = useNavigate()
  const open = (location.state as Record<string, unknown> | null)?.[NAV_STATE] === true
  const show = () => {
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { state: { [NAV_STATE]: true } },
    )
  }
  const hide = () => {
    // consume the entry the drawer stands on, so closing and the back key
    // are the same move and history never fills with spent drawers
    if (open) void navigate(-1)
  }
  return { open, show, hide }
}

/**
 * The width one cell of the bar at the foot needs: a mark over a word of two
 * or three characters, with air either side. Below it the words start to be
 * cut, which costs more than the cell was worth.
 */
const CELL = 76

const cellsAcross = (width: number, most: number) =>
  Math.max(3, Math.min(most, Math.floor(width / CELL)))

/**
 * How many cells this window has room for, watched rather than read once: a
 * rotation turns four into six and back.
 *
 * Before the window has been asked - a render with no window, a harness -
 * it answers with the most, which is what a wide window would have answered
 * anyway.
 */
export function useCellsAcross(most: number): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  useEffect(() => {
    const measure = () => setWidth(window.innerWidth)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return width === 0 ? most : cellsAcross(width, most)
}
