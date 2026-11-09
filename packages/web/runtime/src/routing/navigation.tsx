import { matchPath, useLocation, useNavigation, useResolvedPath } from 'react-router'

export interface PendingNavigation {
  readonly selected: (current: boolean) => boolean
  readonly pending: boolean
}

// Follow the router rather than individual clicks: a new destination
// supersedes the last one, including while an RSC response is outstanding.
export function usePendingNavigation(
  to: string,
  end = true,
  sections?: readonly string[],
): PendingNavigation {
  const navigation = useNavigation()
  const location = useLocation()
  const target = useResolvedPath(to)
  const pathname = navigation.location?.pathname
  const destination =
    pathname !== undefined &&
    pathname !== location.pathname &&
    (sections === undefined ||
      sections.some((path) =>
        matchPath(
          { path, end: path === '/' || sections.some((other) => other.startsWith(`${path}/`)) },
          pathname,
        ),
      ))
      ? pathname
      : undefined
  const matches = (path: string) =>
    matchPath({ path: target.pathname, end: end || target.pathname === '/' }, path) !== null
  const next = destination !== undefined && matches(destination)
  return {
    // A destination outside this set does not change the outgoing rail.
    selected: (current) => (destination === undefined ? current : next),
    pending: next && !matches(location.pathname),
  }
}
