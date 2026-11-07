// Which slice of the queue a run of reviews walks, as the address carries it
// (`run`): pure, so the page's server entry reads it the way the page does.

/**
 * The slice of the queue a run walks: everything, one question's rows, or
 * one participant's. Carried in the address as `run`, so a reload and the
 * queue rail agree about which walk this is.
 */
export type RunScope =
  | { kind: 'all' }
  | { kind: 'item'; itemId: string }
  | { kind: 'person'; participantId: string }

export const readRunScope = (raw: string): RunScope => {
  if (raw.startsWith('item:')) return { kind: 'item', itemId: raw.slice('item:'.length) }
  if (raw.startsWith('person:'))
    return { kind: 'person', participantId: raw.slice('person:'.length) }
  return { kind: 'all' }
}

export const writeRunScope = (scope: RunScope): string =>
  scope.kind === 'item'
    ? `item:${scope.itemId}`
    : scope.kind === 'person'
      ? `person:${scope.participantId}`
      : ''
