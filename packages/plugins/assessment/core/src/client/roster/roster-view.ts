import { useCallback, useEffect, useRef, useState } from 'react'
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

/** whether the view narrows the roster by anything other than a search */
export const rosterFiltered = (view: RosterView): boolean =>
  view.unit !== '' || view.status !== '' || view.waiting !== ''

/** the filters a search leaves alone, cleared in one move */
export const ROSTER_UNFILTERED: Partial<RosterView> = { unit: '', status: '', waiting: '' }

/**
 * The words in a roster's search box, and what they have asked the address.
 *
 * Typing does not fire a request per keystroke: the words go to the address
 * once they have been still for a moment. What the box last asked for is
 * remembered, so an address that moves by itself - the back button, a link,
 * the same search typed on the other side of the page - moves the box, rather
 * than the box writing its old words back over it. `flush` asks at once.
 */
export function useRosterSearch(
  q: string,
  onView: (changes: Partial<RosterView>) => void,
): { draft: string; setDraft: (next: string) => void; flush: (next?: string) => void } {
  const [draft, setDraft] = useState(q)
  const asked = useRef(q)
  useEffect(() => {
    if (q === asked.current) return
    asked.current = q
    setDraft(q)
  }, [q])
  useEffect(() => {
    if (draft === asked.current) return
    const timer = setTimeout(() => {
      asked.current = draft
      onView({ q: draft })
    }, 300)
    return () => clearTimeout(timer)
  }, [draft, onView])
  const flush = useCallback(
    (next?: string) => {
      const words = next ?? draft
      setDraft(words)
      if (words === asked.current) return
      asked.current = words
      onView({ q: words })
    },
    [draft, onView],
  )
  return { draft, setDraft, flush }
}
