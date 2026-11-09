import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { formatDateTime, useLocale } from '@qualy/web-i18n'
import { assessmentApi } from '../api.ts'
import { useBatchZone, yearOf } from '../batch/zone.ts'
import { DeadlineDock, deadlineWords, useDeadlineNow } from '../batch/DeadlineDock.tsx'
import { distanceOf, reviewWindowOf, turnOf, type ReviewWindow } from './review-window.ts'
import * as m from '#messages'

export function ReviewDock({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const timeline = useQuery({
    ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  // a round with no stages has no clock; the bar above the rail says so
  const window: ReviewWindow | null =
    timeline.data === undefined || timeline.data.timeline.length === 0
      ? null
      : reviewWindowOf(timeline.data.timeline)
  return window === null ? null : <ReviewDockNotice key={batchId} window={window} />
}

function ReviewDockNotice({ window }: { window: ReviewWindow }) {
  const now = useDeadlineNow(turnOf(window))
  const locale = useLocale()
  const zone = useBatchZone()

  const when = (at: number) =>
    formatDateTime(
      new Date(at),
      locale,
      yearOf(at, zone) === yearOf(now, zone) ? 'month-day-clock' : 'year-month-day-clock',
      zone,
    )
  const open =
    window.kind === 'closes' || window.kind === 'closes-with' || window.kind === 'stays-open'
  const distance =
    window.kind === 'closes' || window.kind === 'opens' ? distanceOf(window.at, now) : null
  const left =
    distance === null
      ? null
      : window.kind === 'closes'
        ? deadlineWords(window.at, now)
        : distance.unit === 'day'
          ? m.review_untilDays({ count: distance.count })
          : distance.unit === 'hour'
            ? m.review_untilHours({ count: distance.count })
            : m.review_untilSoon()
  const progress =
    window.kind === 'closes' && window.since !== null && window.at > window.since
      ? Math.min(1, Math.max(0, (now - window.since) / (window.at - window.since)))
      : null

  const stage = open ? window.stage : m.review_windowShut()
  const said =
    window.kind === 'closes'
      ? m.review_windowCloses({ when: when(window.at) })
      : window.kind === 'closes-with'
        ? m.review_windowClosesWith({ phase: window.endStage })
        : window.kind === 'stays-open'
          ? m.review_windowStaysOpen()
          : window.kind === 'opens'
            ? m.review_windowOpens({ when: when(window.at) })
            : window.kind === 'opens-with'
              ? m.review_windowOpensWith({ phase: window.opener })
              : window.kind === 'ended'
                ? m.review_windowEnded()
                : m.review_windowNone()

  const single = window.kind === 'ended' || window.kind === 'none'
  return (
    <DeadlineDock
      id="review-dock"
      closed={!open}
      title={single ? said : stage}
      detail={single ? undefined : said}
      countdown={
        left === null
          ? undefined
          : {
              text: left,
              remaining: window.kind === 'closes' ? window.at - now : 0,
              progress,
            }
      }
      facts={{
        'data-window': window.kind,
        'data-left':
          distance === null
            ? undefined
            : distance.unit === 'soon'
              ? 'soon'
              : `${distance.unit}:${String(distance.count)}`,
      }}
      aside={
        window.kind === 'closes' && window.reopens !== null
          ? m.review_windowReopens({ when: when(window.reopens) })
          : undefined
      }
    />
  )
}
