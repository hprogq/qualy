import { formatDateTime, useLocale } from '@qualy/web-i18n'
import { useMemo } from 'react'
import { DeadlineDock, deadlineWords, useDeadlineNow } from '../batch/DeadlineDock.tsx'
import { useBatchZone, yearOf } from '../batch/zone.ts'
import { submissionWindowOf, type SubmissionStage } from './submission-window.ts'
import * as m from '#messages'

export function SubmissionDock({
  batchId,
  stages,
  itemIds,
  itemTitle,
}: {
  batchId: string
  stages: readonly SubmissionStage[]
  itemIds: readonly string[]
  itemTitle: string | undefined
}) {
  const window = useMemo(() => submissionWindowOf(stages, itemIds), [stages, itemIds])
  const now = useDeadlineNow(window?.at ?? null)
  const locale = useLocale()
  const zone = useBatchZone()
  const stage = stages.find((entry) => entry.status === 'current')
  if (window === null || window.at <= now) {
    const detail =
      window !== null
        ? m.deadline_filingEnded()
        : itemIds.length === 0
          ? stage?.submitting === false
            ? m.deadline_filingShut()
            : m.deadline_filingUnavailable()
          : m.deadline_filingNoDate()
    return (
      <DeadlineDock
        batchId={batchId}
        id="submission-dock"
        workbench
        closed={window !== null || itemIds.length === 0}
        title={itemTitle ?? stage?.displayName ?? m.entry_tab()}
        detail={detail}
        facts={{
          'data-window': window !== null ? 'ended' : itemIds.length === 0 ? 'shut' : 'unscheduled',
        }}
      />
    )
  }
  const when = formatDateTime(
    new Date(window.at),
    locale,
    yearOf(window.at, zone) === yearOf(now, zone) ? 'month-day-clock' : 'year-month-day-clock',
    zone,
  )
  return (
    <DeadlineDock
      batchId={batchId}
      id="submission-dock"
      workbench
      facts={{ 'data-window': 'closes' }}
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
