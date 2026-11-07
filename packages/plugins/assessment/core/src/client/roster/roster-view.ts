import { useCallback, useEffect, useRef, useState } from 'react'
import { usePageQueryState, usePageQueryUpdate } from '@qualy/web-runtime'
import { ROSTER_KEYS as KEYS, rosterViewOf, type RosterView } from './roster-place.ts'

export {
  ROSTER_PAGE_SIZE,
  ROSTER_SORTS,
  ROSTER_UNFILTERED,
  ROSTER_WAITING,
  rosterFiltered,
  rosterPageAddress,
  rosterQueryOf,
  type RosterSort,
  type RosterView,
  type RosterWaiting,
} from './roster-place.ts'

// Where the reader is in the roster: which page, which people, in what
// order. It lives in the address, beside the person who is open, so opening
// somebody and coming back lands on the row that was pressed, a reload keeps
// the question, and moving to the next person walks the same list the reader
// was walking.
//
// The keys carry a prefix of their own: the account opened over the list
// has filters of its own, and the two must never read each other's.

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
  // read the way a server reading the roster for the page reads it
  const said: Record<string, string> = {
    [KEYS.page]: page,
    [KEYS.q]: q,
    [KEYS.unit]: unit,
    [KEYS.scope]: scope,
    [KEYS.status]: status,
    [KEYS.waiting]: waiting,
    [KEYS.sort]: sort,
  }
  const view = rosterViewOf((key) => said[key] ?? '')
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
