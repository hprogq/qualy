import { useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { formatDateTime, useLocale } from '@qualy/web-i18n'
import { assessmentApi } from '../api.ts'
import { DeadlineDock, deadlineWords, useDeadlineNow } from '../batch/DeadlineDock.tsx'
import { stageWindowOf, turnOf, type StageWindow } from '../batch/stage-window.ts'
import { useBatchZone, yearOf } from '../batch/zone.ts'
import * as m from '#messages'

export function RecordDock({ batchId }: { batchId: string }) {
  const api = useApi(assessmentApi)
  if (typeof api.assessment.getTimeline !== 'function') return null
  return <RecordSchedule key={batchId} batchId={batchId} />
}

function RecordSchedule({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const timeline = useQuery({
    ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  }).data?.timeline
  // An older server may omit the recording profile. An unknown schedule is
  // not a closed one; wait for data instead of saying no stage opens it.
  if (!timeline?.some((stage) => stage.recording !== undefined)) return null
  const window = stageWindowOf(timeline, (stage) => stage.recording === true)
  return <RecordNotice window={window} />
}

function RecordNotice({ window }: { window: StageWindow }) {
  const at = turnOf(window)
  const now = useDeadlineNow(at)
  const zone = useBatchZone()
  const locale = useLocale()
  const when = (time: number) =>
    formatDateTime(
      new Date(time),
      locale,
      yearOf(time, zone) === yearOf(now, zone) ? 'month-day-clock' : 'year-month-day-clock',
      zone,
    )

  const detail =
    window.kind === 'closes'
      ? m.record_windowCloses({ when: when(window.at) })
      : window.kind === 'closes-with'
        ? m.record_windowClosesWith({ phase: window.endStage })
        : window.kind === 'stays-open'
          ? m.record_windowStaysOpen()
          : window.kind === 'opens'
            ? m.record_windowOpens({ when: when(window.at) })
            : window.kind === 'opens-with'
              ? m.record_windowOpensWith({ phase: window.opener })
              : window.kind === 'ended'
                ? m.record_windowEnded()
                : m.record_windowNone()

  const progress =
    window.kind === 'closes' && window.since !== null && window.at > window.since
      ? Math.min(1, Math.max(0, (now - window.since) / (window.at - window.since)))
      : null
  return (
    <DeadlineDock
      id="record-dock"
      title={'stage' in window ? window.stage : m.record_tab()}
      detail={detail}
      closed={!('stage' in window)}
      countdown={
        at !== null && at > now
          ? { text: deadlineWords(at, now), remaining: at - now, progress }
          : undefined
      }
      facts={{ 'data-window': window.kind }}
    />
  )
}
