import { formatDateTime, useLocale } from '@qualy/web-i18n'
import { useMemo } from 'react'
import { DeadlineDock, deadlineWords, useDeadlineNow } from '../batch/DeadlineDock.tsx'
import { useBatchZone, yearOf } from '../batch/zone.ts'
import { submissionWindowOf, type SubmissionStage } from './submission-window.ts'
import * as m from '#messages'

export function SubmissionDock({
  stages,
  itemIds,
  itemTitle,
}: {
  stages: readonly SubmissionStage[]
  itemIds: readonly string[]
  itemTitle: string | undefined
}) {
  const window = useMemo(() => submissionWindowOf(stages, itemIds), [stages, itemIds])
  const now = useDeadlineNow(window?.at ?? null)
  const locale = useLocale()
  const zone = useBatchZone()
  if (window === null || window.at <= now) return null
  const when = formatDateTime(
    new Date(window.at),
    locale,
    yearOf(window.at, zone) === yearOf(now, zone) ? 'month-day-clock' : 'year-month-day-clock',
    zone,
  )
  return (
    <DeadlineDock
      id="submission-dock"
      workbench
      title={itemTitle ?? window.stage}
      detail={m.deadline_filingCloses({ when })}
      countdown={{
        text: deadlineWords(window.at, now),
        remaining: window.at - now,
        progress:
          window.since !== null && window.since < window.at
            ? Math.min(1, Math.max(0, (now - window.since) / (window.at - window.since)))
            : null,
      }}
    />
  )
}
