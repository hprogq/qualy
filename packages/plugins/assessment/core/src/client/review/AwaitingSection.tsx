import { useQuery } from '@tanstack/react-query'
import { ClockIcon } from 'lucide-react'
import { useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { timeLabel, useHowLongAgo, type AwaitingDto } from './model.ts'

// What this reviewer's step is waiting on somebody else for.
//
// Its own section under the queue rather than rows inside it: the queue is
// what can be decided now, and a round paused for material cannot be. But it
// has to be somewhere - an ask nobody can see is an ask nobody follows up,
// and the filing behind it looks to its owner like a review that stopped.
//
// Two kinds of row, one fact at two moments: still with the person who filed,
// or answered and back here. The second kind is also in the queue above; it
// appears here as well because arriving there it would look like any other
// filing and give no sign that it is the answer to a question this step asked.

export function AwaitingSection({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const navigate = usePageNavigate()
  const howLongAgo = useHowLongAgo()
  const asked = useQuery({
    ...query.assessment.listAwaitingSupplements.queryOptions({ query: { batchId } }),
    refetchInterval: 30_000,
  })
  const rows = asked.data?.items ?? []
  // nothing outstanding is not an empty state worth drawing: the section
  // simply is not there
  if (rows.length === 0) return null
  const answered = rows.filter((row) => row.status === 'answered').length

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border">
      <header className="flex flex-wrap items-center gap-2.5 border-b bg-muted/60 px-4 py-2.5">
        <p className="text-sm font-semibold">{format(m.reviewAwaitingTitle)}</p>
        <Badge variant="outline" className="bg-background tabular-nums">
          {format(m.reviewAwaitingCount, { count: rows.length })}
        </Badge>
        {answered > 0 && (
          <p className="text-xs text-muted-foreground">
            {format(m.reviewAwaitingBack, { count: answered })}
          </p>
        )}
        <span className="flex-1" />
        <p className="text-xs text-muted-foreground">{format(m.reviewAwaitingNote)}</p>
      </header>

      {/* the same column names the queue uses, so the two read as one table
          even though they are two lists */}
      <div className="hidden grid-cols-[10rem_minmax(0,1fr)_9rem_9rem_7rem_6rem] gap-3 border-b px-4 py-2 text-xs text-muted-foreground lg:grid">
        <span>{format(m.reviewColumnWho)}</span>
        <span>{format(m.reviewAwaitingColAsk)}</span>
        <span>{format(m.reviewAwaitingColWaited)}</span>
        <span>{format(m.reviewColumnStatus)}</span>
        <span>{format(m.reviewAwaitingColAskedAt)}</span>
        <span />
      </div>

      <ul className="flex flex-col">
        {rows.map((row) => (
          <AwaitingRow
            key={row.requestId}
            row={row}
            howLongAgo={howLongAgo}
            onOpen={() =>
              navigate('assessment/review-instance', {
                params: { batchId, instanceId: row.instanceId },
              })
            }
          />
        ))}
      </ul>

      <p className="border-t bg-muted/40 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
        {format(m.reviewAwaitingFoot)}
      </p>
    </section>
  )
}

function AwaitingRow({
  row,
  howLongAgo,
  onOpen,
}: {
  row: AwaitingDto
  howLongAgo: (iso: string) => string
  onOpen: () => void
}) {
  const { format } = useI18n()
  const answered = row.status === 'answered'
  return (
    <li
      className={cn(
        'grid gap-x-3 gap-y-1 border-b border-l-2 px-4 py-3 last:border-b-0 lg:grid-cols-[10rem_minmax(0,1fr)_9rem_9rem_7rem_6rem] lg:items-center lg:py-2.5',
        answered ? 'border-l-foreground' : 'border-l-transparent',
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{row.participantName}</span>
        {row.businessNo !== null && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {row.businessNo}
          </span>
        )}
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm">{row.itemTitle}</span>
        {row.asks.length > 0 && (
          <span className="truncate text-xs text-muted-foreground">
            {format(m.reviewAwaitingWant, { what: row.asks.join('、') })}
          </span>
        )}
      </span>

      {/* how long it has been out, which is the thing worth knowing here; the
          instant it was asked is in its own column beside it */}
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ClockIcon aria-hidden className="size-3.5 shrink-0" />
        {howLongAgo(row.requestedAt)}
      </span>

      <span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap',
            answered ? 'border-foreground/30' : 'text-muted-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              answered ? 'bg-foreground' : 'border border-muted-foreground/50',
            )}
          />
          {format(answered ? m.reviewAwaitingAnswered : m.supplementStatusOpen)}
        </span>
      </span>

      <span className="text-xs text-muted-foreground tabular-nums">
        {timeLabel(row.requestedAt)}
      </span>

      <span className="flex justify-start lg:justify-end">
        {/* one way in either way: the round is where both the answer and the
            way to take the ask back are read */}
        <Button variant={answered ? 'outline' : 'ghost'} size="sm" onClick={onOpen}>
          {format(answered ? m.reviewAwaitingGo : m.reviewOpen)}
        </Button>
      </span>
    </li>
  )
}
