import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { RefreshCwIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

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
// What was asked about one person alone stands until the page reads its
// totals again: a later page answer is newer than it, and a live change that
// made the page read again made the lone answer old too.

export type RosterScoreAnswer = ApiResult<
  typeof assessmentApi,
  'assessment',
  'listParticipantScores'
>['scores'][number]

const REASONS = {
  'scoring-unavailable': m.rosterScoreUnavailable,
  'account-too-large': m.rosterScoreTooLarge,
  'timed-out': m.rosterScoreTimedOut,
} as const

/** the reasons asking again may answer; a reading past its ceiling will not change */
const PASSING: ReadonlySet<string> = new Set(['scoring-unavailable', 'timed-out'])

const styles = stylex.create({
  seat: {
    display: 'inline-flex',
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    fontVariantNumeric: 'tabular-nums',
  },
  total: { fontSize: 14, fontWeight: 600, color: tokens.foreground },
  reason: { fontSize: 12, color: tokens.mutedForeground, whiteSpace: 'nowrap' },
  bone: { width: '3.5rem', height: 14, borderRadius: 4 },
})

export function RosterScore({
  batchId,
  participantId,
  name,
  answer,
  answeredAt,
  waiting,
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
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const [asked, setAsked] = useState(false)
  const alone = useQuery({
    ...query.assessment.listParticipantScores.queryOptions({
      params: { batchId },
      query: { participantIds: [participantId] },
    }),
    enabled: asked,
  })
  // the lone answer while it is the newer one
  const own =
    asked && alone.data !== undefined && alone.dataUpdatedAt >= answeredAt
      ? alone.data.scores[0]
      : undefined
  const said = own ?? answer
  const pending = asked && alone.isFetching ? true : own === undefined && waiting
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
    if (asked) void alone.refetch()
    else setAsked(true)
  }

  if (pending) {
    return (
      <span {...hooks} {...stylex.props(styles.seat)} aria-label={format(m.rosterScoreWorking)}>
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
      <span {...hooks} {...stylex.props(styles.seat, styles.reason)}>
        {format(REASONS[said.reason])}
        {PASSING.has(said.reason) && (
          <Button
            size="icon-xs"
            variant="ghost"
            data-testid="participant-score-again"
            aria-label={format(m.rosterScoreAgainOne, { name })}
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
        aria-label={format(m.rosterScoreComputeOne, { name })}
        onClick={ask}
      >
        {format(m.rosterScoreCompute)}
      </Button>
    </span>
  )
}
