import { pageNumber } from '@qualy/api-kit/schema'

// Which audit events are showing, as the address says it: the action, the
// actor, the outcome and the page. Read by the page as it is open and by the
// server drawing it, which must ask the same question.

/** the narrowing the address names, without the page */
export const eventsFilterOf = (get: (key: string) => string) => {
  const action = get('action')
  const actor = get('actor')
  const outcome = get('outcome')
  const outcomeFilter: 'success' | 'denied' | 'failure' | undefined =
    outcome === 'success' || outcome === 'denied' || outcome === 'failure' ? outcome : undefined
  return {
    ...(action ? { actionCode: action } : {}),
    ...(actor ? { actorUserId: actor } : {}),
    ...(outcomeFilter !== undefined ? { outcome: outcomeFilter } : {}),
  }
}

/** the question the events endpoint is asked, for the address */
export const eventsQueryOf = (get: (key: string) => string) => ({
  ...eventsFilterOf(get),
  page: String(pageNumber(get('page'))),
})
