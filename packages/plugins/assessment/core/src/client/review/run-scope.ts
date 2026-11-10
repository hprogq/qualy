// Which slice of the queue a run walks, carried in the address so the
// server's first read and the workbench's later reads ask the same question.

export type RunFilters = {
  search?: string
  unitId?: string
  mark?: 'escalated' | 'resubmitted' | 'supplemented'
}

export type RunScope = (
  | { kind: 'all' }
  | { kind: 'item'; itemId: string }
  | { kind: 'person'; participantId: string }
) & { filters?: RunFilters }

export const readRunScope = (raw: string): RunScope => {
  const at = raw.indexOf('?')
  const head = at < 0 ? raw : raw.slice(0, at)
  const params = new URLSearchParams(at < 0 ? '' : raw.slice(at + 1))
  const search = params.get('q')?.trim()
  const unitId = params.get('unit')
  const mark = params.get('mark')
  const filters: RunFilters = {
    ...(search ? { search } : {}),
    ...(unitId ? { unitId } : {}),
    ...(mark === 'escalated' || mark === 'resubmitted' || mark === 'supplemented' ? { mark } : {}),
  }
  const extra = Object.keys(filters).length > 0 ? { filters } : {}
  if (head.startsWith('item:')) return { kind: 'item', itemId: head.slice(5), ...extra }
  if (head.startsWith('person:')) return { kind: 'person', participantId: head.slice(7), ...extra }
  return { kind: 'all', ...extra }
}

export const writeRunScope = (scope: RunScope): string => {
  const head =
    scope.kind === 'item'
      ? `item:${scope.itemId}`
      : scope.kind === 'person'
        ? `person:${scope.participantId}`
        : ''
  const params = new URLSearchParams()
  if (scope.filters?.search) params.set('q', scope.filters.search)
  if (scope.filters?.unitId) params.set('unit', scope.filters.unitId)
  if (scope.filters?.mark) params.set('mark', scope.filters.mark)
  const query = params.toString()
  return query ? `${head}?${query}` : head
}

/** The same queue slice is read for the server's first frame and the live rail. */
export const runQueryOf = (scope: RunScope) => ({
  ...scope.filters,
  ...(scope.kind === 'item' ? { itemId: scope.itemId } : {}),
  ...(scope.kind === 'person' ? { person: scope.participantId } : {}),
})
