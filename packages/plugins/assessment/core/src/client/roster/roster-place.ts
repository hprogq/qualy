// Where the reader is in the roster, as the address says it, and what the
// roster is asked for there (roster-view.ts). Free of React, so a server
// reading the roster's first page on the page's behalf reads the address the
// way the page does, and asks with the same inputs under the same keys.

/** people per page: each row on it is a whole account whose total is then asked for */
export const ROSTER_PAGE_SIZE = 20

export const ROSTER_WAITING = [
  'inReview',
  'toSupplement',
  'reconsidering',
  'toRevise',
  'blocked',
] as const
export type RosterWaiting = (typeof ROSTER_WAITING)[number]

export const ROSTER_SORTS = ['unit', 'name', 'business-no'] as const
export type RosterSort = (typeof ROSTER_SORTS)[number]

export interface RosterView {
  readonly page: number
  readonly q: string
  /** one unit, pointed at; empty for the whole roster */
  readonly unit: string
  readonly scope: 'self' | 'subtree'
  readonly status: '' | 'active' | 'excluded'
  /** one kind of waiting, or `any` for anybody with something waiting at all */
  readonly waiting: '' | 'any' | RosterWaiting
  readonly sort: RosterSort
}

export const ROSTER_KEYS = {
  page: 'list-page',
  q: 'list-q',
  unit: 'list-unit',
  scope: 'list-scope',
  status: 'list-status',
  waiting: 'list-waiting',
  sort: 'list-sort',
} as const satisfies Record<keyof RosterView, string>

const oneOf = <T extends string>(allowed: readonly T[], value: string, fallback: T): T =>
  (allowed as readonly string[]).includes(value) ? (value as T) : fallback

/** the roster as an address has it, every parameter it leaves out at its default */
export const rosterViewOf = (read: (key: string) => string): RosterView => ({
  page: Math.max(1, Number.parseInt(read(ROSTER_KEYS.page), 10) || 1),
  q: read(ROSTER_KEYS.q),
  unit: read(ROSTER_KEYS.unit),
  scope: read(ROSTER_KEYS.scope) === 'self' ? 'self' : 'subtree',
  status: oneOf(['', 'active', 'excluded'], read(ROSTER_KEYS.status), ''),
  waiting: oneOf(['', 'any', ...ROSTER_WAITING], read(ROSTER_KEYS.waiting), ''),
  sort: oneOf(ROSTER_SORTS, read(ROSTER_KEYS.sort), 'unit'),
})

/**
 * The address change that puts the list on this page, for a write that moves
 * other keys in the same press (opening the next person moves the list too).
 */
export const rosterPageAddress = (page: number): Record<string, string> => ({
  [ROSTER_KEYS.page]: page === 1 ? '' : String(page),
})

/** the question the roster endpoint is asked, for this view */
export const rosterQueryOf = (view: RosterView) => ({
  page: String(view.page),
  limit: String(ROSTER_PAGE_SIZE),
  sort: view.sort,
  ...(view.q.trim() !== '' ? { q: view.q.trim() } : {}),
  ...(view.unit !== '' ? { orgNodeIds: [view.unit], orgScope: view.scope } : {}),
  ...(view.status !== '' ? { status: view.status } : {}),
  ...(view.waiting !== '' ? { attention: view.waiting } : {}),
})

/** whether the view narrows the roster by anything other than a search */
export const rosterFiltered = (view: RosterView): boolean =>
  view.unit !== '' || view.status !== '' || view.waiting !== ''

/** the filters a search leaves alone, cleared in one move */
export const ROSTER_UNFILTERED: Partial<RosterView> = { unit: '', status: '', waiting: '' }
