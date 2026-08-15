import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { assessmentMessages as m } from '../i18n.ts'
import { trimAmount } from './model.ts'
import { ROW_TAG, type Standing, type StructureRow } from './standing.ts'

// A group, from the inside: what it has granted this person so far, how much
// of it is still open to them, and what it holds.
//
// The bar is the point of the pane. A group is the only place in the round
// where "how am I doing" has an answer that is not a single row, and the
// limits are what make that answer mean anything.

export function GroupDetail({
  row,
  rows,
  standing,
  onOpen,
}: {
  row: StructureRow
  rows: readonly StructureRow[]
  standing: Standing | null
  onOpen: (id: string) => void
}) {
  const { format } = useI18n()
  const score = standing?.groups.find((one) => one.groupId === row.id) ?? null
  const inside = rows.filter((one) => one.parentId === row.id)

  const final = score === null ? 0 : Number(score.final)
  const cap = score?.cap === null || score?.cap === undefined ? null : Number(score.cap)
  const reached = cap === null || cap <= 0 ? null : Math.min(100, Math.max(0, (final / cap) * 100))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            {row.trail.length > 0 && (
              <p className="truncate text-xs text-muted-foreground">{row.trail.join(` ${'›'} `)}</p>
            )}
            <div className="flex items-center gap-2.5">
              <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight">{row.name}</h2>
              <Badge variant="secondary">{format(m.myEntriesGroupBadge)}</Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-end gap-6">
            <Figure
              label={format(m.myEntriesInGroup)}
              value={score === null ? '—' : trimAmount(score.final)}
              lead
            />
            <Figure
              label={format(m.itemsGroupCap)}
              value={
                score?.cap === null || score?.cap === undefined
                  ? format(m.structureUncapped)
                  : trimAmount(score.cap)
              }
            />
            <Figure
              label={format(m.itemsGroupFloor)}
              value={
                score?.floor === null || score?.floor === undefined
                  ? format(m.paperFloorNone)
                  : trimAmount(score.floor)
              }
            />
          </div>
        </div>

        {reached !== null && (
          <div className="flex flex-col gap-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-foreground" style={{ width: `${reached}%` }} />
            </div>
            <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
              <span>0</span>
              <span>{trimAmount(String(cap!))}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3 border-b pb-2">
          <h3 className="text-sm font-semibold">{format(m.myEntriesHolds)}</h3>
          <p className="text-xs text-muted-foreground">
            {format(m.myEntriesHoldsCount, { count: inside.length })}
          </p>
        </div>
        {inside.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">{format(m.myEntriesHoldsEmpty)}</p>
        )}
        {inside.map((one) => (
          <button
            key={one.id}
            type="button"
            onClick={() => onOpen(one.id)}
            className="flex items-center gap-3 rounded-lg border-b px-1 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/40"
          >
            <Badge variant="outline" className="shrink-0 font-normal">
              {format(one.kind === 'group' ? m.myEntriesGroupBadge : m.myEntriesItemBadge)}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-sm">{one.name}</span>
            {one.tag !== null && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {format(ROW_TAG[one.tag])}
              </span>
            )}
            <span className="shrink-0 text-sm tabular-nums">
              {one.right === '' ? '—' : one.right}
            </span>
          </button>
        ))}
      </div>

      {score !== null && (
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <p className="text-sm font-semibold">{format(m.myEntriesMakeup)}</p>
          <Line label={format(m.myEntriesFromItems)} value={trimAmount(score.itemsTotal)} />
          <Line label={format(m.myEntriesFromChildren)} value={trimAmount(score.childrenTotal)} />
          <div className="mt-1 flex justify-between gap-3 border-t pt-2.5 text-sm font-semibold">
            <span>{format(m.myEntriesGroupTotal)}</span>
            <span className="tabular-nums">{trimAmount(score.final)}</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {format(m.myEntriesMakeupNote)}
          </p>
        </div>
      )}
    </div>
  )
}

function Figure({ label, value, lead }: { label: string; value: string; lead?: boolean }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs whitespace-nowrap text-muted-foreground">{label}</span>
      <span
        className={
          lead
            ? 'text-2xl font-semibold tracking-tight tabular-nums'
            : 'text-sm font-medium tabular-nums'
        }
      >
        {value}
      </span>
    </span>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
