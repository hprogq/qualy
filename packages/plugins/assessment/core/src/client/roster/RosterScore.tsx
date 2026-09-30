import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { RefreshCwIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import * as m from '#messages'

// One person's current total on the roster.
//
// The page asks for its people's totals once, after the rows are up, and
// what that answer did not reach - the page ran out of time, the answer did
// not come at all - becomes a button that asks about this one person alone.
// A total that cannot be given says why in a word, rather than showing a
// number it does not have; where asking again could help - the scoring
// service was down, the reading ran out of time - a way to ask again stands
// beside the word.
//
// What was asked about one person alone stands until the page says
// something newer about them. A page answer that defers them says nothing:
// a person the page could not reach before is usually one it cannot reach
// now, and dropping their total back to a button on every re-read had the
// reader pressing it again and again. So after a change that may have moved
// totals, the page's answer is waited for, and only where it defers this
// person again is this person asked about alone once more.

export type RosterScoreAnswer = ApiResult<
  typeof assessmentApi,
  'assessment',
  'listParticipantScores'
>['scores'][number]

const REASONS = {
  'scoring-unavailable': m.roster_scoreUnavailable,
  'account-too-large': m.roster_scoreTooLarge,
  'timed-out': m.roster_scoreTimedOut,
} as const

/** the reasons asking again may answer; a reading past its ceiling will not change */
const PASSING: ReadonlySet<string> = new Set(['scoring-unavailable', 'timed-out'])

const styles = stylex.create({
  // never wider than its cell: the way to ask again is what the cell is
  // for when there is no total, and a cell clips whatever runs past it
  seat: {
    display: 'inline-flex',
    maxWidth: '100%',
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    verticalAlign: 'middle',
    fontVariantNumeric: 'tabular-nums',
  },
  total: { fontSize: 14, fontWeight: 600, color: tokens.foreground },
  // a reason longer than the column takes a second line rather than
  // pushing the button out of the cell
  reason: {
    minWidth: 0,
    fontSize: 12,
    lineHeight: '1rem',
    color: tokens.mutedForeground,
    textAlign: 'end',
    whiteSpace: 'normal',
  },
  bone: { width: '3.5rem', height: 14, borderRadius: 4 },
})

export function RosterScore({
  batchId,
  participantId,
  name,
  answer,
  answeredAt,
  waiting,
  movedAt,
}: {
  batchId: string
  participantId: string
  name: string
  /** what the page's own question said about this person, if it said anything */
  answer: RosterScoreAnswer | undefined
  /** when the page's question was last answered, to tell which answer is newer */
  answeredAt: number
  /** the page's question is still out */
  waiting: boolean
  /** when the page last heard of a change that may have moved totals; 0 for never */
  movedAt: number
}) {
  const query = useApiQuery(assessmentApi)

  const [asked, setAsked] = useState(false)
  // when the reader last pressed, so a re-read they did not ask for keeps
  // the total up rather than blanking it while it runs
  const [pressedAt, setPressedAt] = useState(0)
  const alone = useQuery({
    ...query.assessment.listParticipantScores.queryOptions({
      params: { batchId },
      query: { participantIds: [participantId] },
    }),
    enabled: asked,
    // asked again after a change that may move it (below), not whenever
    // the window takes focus: each asking is one whole account
    refetchOnWindowFocus: false,
  })
  const pageSays = answer !== undefined && answer.state !== 'deferred'

  // After a change that may have moved totals, and once the page has
  // answered since: where it deferred this person again, and nobody has
  // asked about them alone since, ask. Once per change, whatever the asking
  // comes to - a failing reading is not asked again and again.
  const tried = useRef(0)
  const again = alone.refetch
  const fetching = alone.isFetching
  const aloneAt = alone.dataUpdatedAt
  const held = alone.data !== undefined
  useEffect(() => {
    if (!asked || !held || fetching) return
    if (movedAt <= Math.max(aloneAt, tried.current) || answeredAt < movedAt) return
    tried.current = movedAt
    if (!pageSays) void again()
  }, [asked, held, fetching, aloneAt, movedAt, answeredAt, pageSays, again])

  const own = asked ? alone.data?.scores[0] : undefined
  const said = own !== undefined && !(pageSays && answeredAt > alone.dataUpdatedAt) ? own : answer
  const pending =
    asked && alone.isFetching && (alone.data === undefined || pressedAt >= alone.dataUpdatedAt)
      ? true
      : own === undefined && waiting
  const state = pending ? 'pending' : (said?.state ?? 'deferred')

  const hooks = {
    'data-testid': 'participant-score',
    'data-score-state': state,
    'data-score': said?.state === 'scored' ? (said.total ?? '') : '',
    'data-score-reason': said?.state === 'unavailable' ? (said.reason ?? '') : '',
  }
  const ask = (event: { stopPropagation: () => void }) => {
    // pressing a total is not opening the person
    event.stopPropagation()
    setPressedAt(Date.now())
    if (asked) void alone.refetch()
    else setAsked(true)
  }

  if (pending) {
    return (
      <span {...hooks} {...stylex.props(styles.seat)} aria-label={m.roster_scoreWorking()}>
        <Skeleton className={stylex.props(styles.bone).className} />
      </span>
    )
  }
  if (said?.state === 'scored' && said.total !== null) {
    return (
      <span {...hooks} {...stylex.props(styles.seat, styles.total)}>
        {said.total}
      </span>
    )
  }
  if (said?.state === 'unavailable' && said.reason !== null) {
    return (
      <span {...hooks} {...stylex.props(styles.seat)}>
        <span {...stylex.props(styles.reason)}>{REASONS[said.reason]()}</span>
        {PASSING.has(said.reason) && (
          <Button
            size="icon-xs"
            variant="ghost"
            data-testid="participant-score-again"
            aria-label={m.roster_scoreAgainOne({ name })}
            onClick={ask}
          >
            <RefreshCwIcon aria-hidden />
          </Button>
        )}
      </span>
    )
  }
  // not reached by the page, or the page's question failed as a whole
  return (
    <span {...hooks} {...stylex.props(styles.seat)}>
      <Button
        size="xs"
        variant="ghost"
        aria-label={m.roster_scoreComputeOne({ name })}
        onClick={ask}
      >
        {m.roster_scoreCompute()}
      </Button>
    </span>
  )
}
