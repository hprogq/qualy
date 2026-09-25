import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
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
// what that answer did not reach - the page ran out of time, the scoring
// service is down, the answer did not come at all - becomes a button that
// asks about this one person alone. A total that cannot be given says why
// in a word, rather than showing a number it does not have.

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

const styles = stylex.create({
  seat: {
    display: 'inline-flex',
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'flex-end',
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
  waiting,
}: {
  batchId: string
  participantId: string
  name: string
  /** what the page's own question said about this person, if it said anything */
  answer: RosterScoreAnswer | undefined
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
  const said = asked ? alone.data?.scores[0] : answer
  const pending = asked ? alone.isPending : waiting
  const state = pending ? 'pending' : (said?.state ?? 'deferred')

  const hooks = {
    'data-testid': 'participant-score',
    'data-score-state': state,
    'data-score': said?.state === 'scored' ? (said.total ?? '') : '',
    'data-score-reason': said?.state === 'unavailable' ? (said.reason ?? '') : '',
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
        onClick={(event) => {
          event.stopPropagation()
          if (asked) void alone.refetch()
          else setAsked(true)
        }}
      >
        {format(m.rosterScoreCompute)}
      </Button>
    </span>
  )
}
