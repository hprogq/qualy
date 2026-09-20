import { useLocation, useNavigate } from 'react-router'

// What the rail shells share below the components: how an entry is ordered,
// when an entry's path counts as "here", how a parameterised path is filled
// from the route, and how the phone drawer keeps its open state.

export const byOrder = (a: { order?: number }, b: { order?: number }) =>
  (a.order ?? 0) - (b.order ?? 0)

/** whether some other entry of the rail lives under this one's path */
export const hasEntriesBelow = (path: string, all: readonly string[]) =>
  all.some((other) => other !== path && other.startsWith(`${path}/`))

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
