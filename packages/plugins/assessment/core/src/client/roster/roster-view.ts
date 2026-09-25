import { useCallback } from 'react'
import { usePageQueryState, usePageQueryUpdate } from '@qualy/web-runtime'

// Where the reader is in the roster: which page, which people, in what
// order. It lives in the address, beside the person who is open, so opening
// somebody and coming back lands on the row that was pressed, a reload keeps
// the question, and moving to the next person walks the same list the reader
// was walking.
//
// The keys carry a prefix of their own: the account opened over the list
// has filters of its own, and the two must never read each other's.

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

const KEYS = {
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

/** the roster as the address has it, and a way to move it */
export function useRosterView(): readonly [RosterView, (changes: Partial<RosterView>) => void] {
  const [page] = usePageQueryState(KEYS.page)
  const [q] = usePageQueryState(KEYS.q)
  const [unit] = usePageQueryState(KEYS.unit)
  const [scope] = usePageQueryState(KEYS.scope)
  const [status] = usePageQueryState(KEYS.status)
  const [waiting] = usePageQueryState(KEYS.waiting)
  const [sort] = usePageQueryState(KEYS.sort)
  const write = usePageQueryUpdate()
  const view: RosterView = {
    page: Math.max(1, Number.parseInt(page, 10) || 1),
    q,
    unit,
    scope: scope === 'self' ? 'self' : 'subtree',
    status: oneOf(['', 'active', 'excluded'], status, ''),
    waiting: oneOf(['', 'any', ...ROSTER_WAITING], waiting, ''),
    sort: oneOf(ROSTER_SORTS, sort, 'unit'),
  }
  // Every key in one write: two address writes from one press race, and the
  // second drops the first. A different question starts at its first page.
  const move = useCallback(
    (changes: Partial<RosterView>) => {
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(changes) as [keyof RosterView, unknown][]) {
        const text = String(value ?? '')
        const quiet =
          (key === 'page' && text === '1') ||
          (key === 'scope' && text === 'subtree') ||
          (key === 'sort' && text === 'unit')
        next[KEYS[key]] = quiet ? '' : text
      }
      if (changes.page === undefined) next[KEYS.page] = ''
      write(next)
    },
    [write],
  )
  return [view, move] as const
}

/**
 * The address change that puts the list on this page, for a write that moves
 * other keys in the same press (opening the next person moves the list too).
 */
export const rosterPageAddress = (page: number): Record<string, string> => ({
  [KEYS.page]: page === 1 ? '' : String(page),
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
