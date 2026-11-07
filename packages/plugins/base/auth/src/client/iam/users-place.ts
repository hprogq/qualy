// Which people the roster is showing, as the address says it: the unit it
// is open at - the first the reader may see until another is picked - how
// far below it, the standing, the words searched for, the kind and the
// page. Read by the page as it is open and by the server drawing it, which
// must ask the same question.

/** people per page */
export const USERS_PAGE_SIZE = 50

/** the question the roster endpoint is asked, from the address and the units on offer */
export const usersFilterOf = (
  get: (key: string) => string,
  nodes: readonly { readonly orgNodeId: string }[],
) => {
  const anchor = get('anchor')
  const active = nodes.find((entry) => entry.orgNodeId === anchor) ?? nodes[0]
  const standingParam = get('standing')
  const standing: 'active' | 'disabled' | 'any' =
    standingParam === 'any' || standingParam === 'disabled' ? standingParam : 'active'
  const search = get('q')
  const typeFilter = get('type')
  const page = Math.max(1, Number.parseInt(get('page'), 10) || 1)
  return {
    active,
    standing,
    page,
    filter: {
      orgNodeId: active?.orgNodeId ?? '',
      scope: get('scope') === 'self' ? ('self' as const) : ('subtree' as const),
      // either state: the list asks for neither
      ...(standing === 'any' ? {} : { status: standing }),
      ...(search ? { search } : {}),
      ...(typeFilter ? { userTypeId: typeFilter } : {}),
      page: String(page),
      limit: String(USERS_PAGE_SIZE),
    },
  }
}
