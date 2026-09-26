import { useCallback, useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { assessmentApi } from '../api.ts'
import { rosterFiltered, rosterQueryOf, type RosterView } from './roster-view.ts'

// The roster an open account walks: the list the reader came from, read a
// page at a time around whoever is open, so the column beside the account
// can show them among the people either side and the keys over it can step
// to the next one - both from the same rows, in the same order.
//
// The pages are the list page's own, under the same keys, so going back to
// the list reads nothing again. The open person's page is the one the
// address names; when they are not on it - opened from a link, a search
// typed since, somebody taken off the round moving everybody up a place -
// the server is asked where they stand, and the address follows. Somebody
// the list does not hold at all is said to be off it, never guessed at.

/** how near either end of what has been read the open person may stand before the page beyond is read */
const EDGE = 10

/**
 * How long a page read here stays good without asking again. The list page
 * reads the same keys, and every change that moves a page wakes the screen
 * holding it, which asks again whatever it says here.
 */
const FRESH = 10_000

type Answer = ApiResult<typeof assessmentApi, 'assessment', 'listParticipantAccounts'>

/**
 * One person on the walk, as the list has them - everything opening them
 * reads about who they are, and what their claims wait on - and where the
 * list stands them.
 */
export type WalkRow = Answer['items'][number] & {
  /** the list page they stand on */
  readonly page: number
  /** where they stand on the whole list, from one */
  readonly position: number
}

export interface RosterWalk {
  /** whether anybody is open to walk from */
  readonly active: boolean
  /** the question the list asks, without its page: a new one starts the walk again */
  readonly question: string
  /** reading the first page of this question */
  readonly state: 'loading' | 'failed' | 'ready'
  readonly error: unknown
  /** the rows on screen answer the question asked before this one */
  readonly stale: boolean
  /** every row read so far, in the list's order and with no gap */
  readonly rows: readonly WalkRow[]
  /** how many the question holds; null until it is answered */
  readonly total: number | null
  /** the open person, where the rows hold them */
  readonly here: WalkRow | null
  /** the list does not hold the open person: filtered out, or taken off it */
  readonly off: boolean
  readonly previous: WalkRow | null
  readonly next: WalkRow | null
  /** the list is narrowed by a search or a filter */
  readonly narrowed: boolean
  /** there are people before the first row read, and after the last */
  readonly earlier: boolean
  readonly later: boolean
  readonly loadEarlier: () => void
  readonly loadLater: () => void
  readonly retry: () => void
}

const rowsOf = (answer: Answer): WalkRow[] =>
  answer.items.map((row, index) => ({
    ...row,
    page: answer.page,
    position: (answer.page - 1) * answer.pageSize + index + 1,
  }))

export function useRosterWalk({
  batchId,
  participantId,
  view,
  onPage,
}: {
  batchId: string
  /** who is open; empty while nobody is, and nothing is read */
  participantId: string
  view: RosterView
  /** put the list on this page, without a step in the history */
  onPage: (page: number) => void
}): RosterWalk {
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const active = participantId !== ''
  const optionsOf = (page: number, around?: string) =>
    query.assessment.listParticipantAccounts.queryOptions({
      params: { batchId },
      query: { ...rosterQueryOf({ ...view, page }), ...(around === undefined ? {} : { around }) },
    })
  const question = JSON.stringify([batchId, rosterQueryOf({ ...view, page: 1 })])

  // The pages asked for so far: the one the address names, and those read
  // on either side of it since. A new question, or a page outside them, is
  // a walk begun again.
  const [asked, setAsked] = useState({ question, from: view.page, to: view.page })
  let span = asked
  if (asked.question !== question || view.page < asked.from || view.page > asked.to) {
    span = { question, from: view.page, to: view.page }
    setAsked(span)
  }

  // The address's page, kept on screen while a new question is answered, so
  // a search being typed does not blank the list under the hand typing it.
  const anchor = useQuery({
    ...optionsOf(view.page),
    enabled: active,
    staleTime: FRESH,
    placeholderData: keepPreviousData,
  })
  const beside: number[] = []
  for (let page = span.from; page <= span.to; page += 1) if (page !== view.page) beside.push(page)
  const others = useQueries({
    queries: beside.map((page) => ({ ...optionsOf(page), enabled: active, staleTime: FRESH })),
  })

  const answered = anchor.data
  const stale = anchor.isPlaceholderData
  const byPage = new Map<number, Answer>()
  if (!stale) {
    for (const other of others) {
      if (other.data !== undefined) byPage.set(other.data.page, other.data)
    }
  }
  if (answered !== undefined) byPage.set(answered.page, answered)

  // only what joins up with the address's page: a page further out that
  // arrived first waits for the one between
  let first = answered?.page ?? view.page
  let last = first
  const rows: WalkRow[] = []
  if (answered !== undefined) {
    if (stale) rows.push(...rowsOf(answered))
    else {
      while (byPage.has(first - 1)) first -= 1
      while (byPage.has(last + 1)) last += 1
      for (let page = first; page <= last; page += 1) rows.push(...rowsOf(byPage.get(page)!))
    }
  }
  const total = answered === undefined || stale ? null : answered.total
  const pages =
    answered === undefined ? 1 : Math.max(1, Math.ceil(answered.total / answered.pageSize))
  const at = stale ? -1 : rows.findIndex((row) => row.id === participantId)
  const here = at < 0 ? null : rows[at]!

  // Reading on around them: enough either side to stand them in the middle
  // of the column, and the page beyond whichever end they are near, so the
  // key to the next one works across a page's edge.
  const earlier = !stale && answered !== undefined && first > 1
  const later = !stale && answered !== undefined && last < pages
  const widen = useCallback(
    (side: 'from' | 'to', page: number) =>
      setAsked((now) =>
        now.question !== question
          ? now
          : side === 'from'
            ? { ...now, from: Math.min(now.from, page) }
            : { ...now, to: Math.max(now.to, page) },
      ),
    [question],
  )
  const towardEarlier = earlier && span.from >= first
  const towardLater = later && span.to <= last
  useEffect(() => {
    if (at < 0) return
    if (towardEarlier && at < EDGE) widen('from', first - 1)
    if (towardLater && rows.length - 1 - at < EDGE) widen('to', last + 1)
  }, [at, rows.length, first, last, towardEarlier, towardLater, widen])

  // Where they are not on the rows read, the server says which page holds
  // them in this very question, and the address moves there. Asked once per
  // answer of the address's page, so a list that moves under a live round
  // is followed without asking on every render.
  const latest = useRef({ optionsOf, onPage, page: view.page })
  latest.current = { optionsOf, onPage, page: view.page }
  const [missing, setMissing] = useState<string | null>(null)
  const person = `${question}|${participantId}`
  const locate =
    active && answered !== undefined && !stale && !anchor.isFetching && here === null
      ? `${person}|${String(anchor.dataUpdatedAt)}`
      : null
  useEffect(() => {
    if (locate === null) return
    let gone = false
    const { optionsOf: ask, page } = latest.current
    queryClient.fetchQuery({ ...ask(page, participantId), staleTime: 0 }).then(
      (answer) => {
        if (gone) return
        if (!answer.items.some((row) => row.id === participantId)) {
          setMissing(locate)
          return
        }
        // the page they stand on, as its own number would ask for it
        queryClient.setQueryData(ask(answer.page).queryKey, answer)
        if (answer.page !== page) latest.current.onPage(answer.page)
      },
      // not knowing where they stand is not their being off the list: the
      // keys stay put and the next answer asks again
      () => {},
    )
    return () => {
      gone = true
    }
    // one ask per answer: the key says everything the ask depends on
  }, [locate, participantId, queryClient])

  // held on a page other than the one the address names - the list moved
  // under a live round - the address follows, so going back lands on them
  const herePage = here?.page
  useEffect(() => {
    if (herePage !== undefined && herePage !== latest.current.page) latest.current.onPage(herePage)
  }, [herePage])

  const off = here === null && missing !== null && missing.startsWith(`${person}|`)

  /** a page asked for beside the address's that did not come back, asked again */
  const again = (page: number) => {
    const read = others[beside.indexOf(page)]
    if (read?.isError === true) void read.refetch()
  }
  return {
    active,
    question,
    state:
      answered !== undefined ? 'ready' : anchor.isError ? 'failed' : active ? 'loading' : 'ready',
    error: anchor.error,
    stale,
    rows,
    total,
    here,
    off,
    previous: at > 0 ? rows[at - 1]! : null,
    next: at >= 0 && at < rows.length - 1 ? rows[at + 1]! : null,
    narrowed: view.q.trim() !== '' || rosterFiltered(view),
    earlier,
    later,
    loadEarlier: () => {
      if (!earlier) return
      if (span.from < first) again(first - 1)
      else widen('from', first - 1)
    },
    loadLater: () => {
      if (!later) return
      if (span.to > last) again(last + 1)
      else widen('to', last + 1)
    },
    retry: () => void anchor.refetch(),
  }
}
