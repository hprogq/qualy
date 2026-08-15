import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { ChevronRightIcon } from 'lucide-react'
import { assessmentMessages as m } from '../i18n.ts'
import { Basis } from './Basis.tsx'
import { amountOf, trimAmount, unitsOf, type EntryDto } from './model.ts'
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
  entriesByItem,
  standing,
  onOpen,
}: {
  row: StructureRow
  rows: readonly StructureRow[]
  /** this person's claims, so the section can say what of theirs is still moving */
  entriesByItem: ReadonlyMap<string, readonly EntryDto[]>
  standing: Standing | null
  onOpen: (id: string) => void
}) {
  const { format } = useI18n()
  const score = standing?.groups.find((one) => one.groupId === row.id) ?? null
  const inside = rows.filter((one) => one.parentId === row.id)
  const held = subtree(rows, row.id).flatMap((one) =>
    one.kind === 'item' ? [...(entriesByItem.get(one.id) ?? [])] : [],
  )
  const pending = held.filter((one) => one.status === 'in_review').length
  const drafts = held.filter((one) => one.status === 'draft').length

  const finalUnits = score === null ? 0 : unitsOf(score.final)
  const capUnits =
    score?.cap === null || score?.cap === undefined ? null : Math.max(0, unitsOf(score.cap))
  const reached =
    capUnits === null || capUnits === 0
      ? null
      : Math.min(100, Math.max(0, (finalUnits / capUnits) * 100))

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

        {reached !== null && capUnits !== null && (
          <div className="flex flex-col gap-1.5">
            {/* the mark rides the end of the fill: a bar without one reads as
                a rough proportion, and this one is somebody's marks */}
            <div className="relative h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-foreground transition-[width] duration-500 ease-out"
                style={{ width: `${reached}%` }}
              />
              <span
                aria-hidden
                className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground transition-[left] duration-500 ease-out"
                style={{ left: `${reached}%` }}
              />
            </div>
            <div className="flex justify-between gap-3 text-xs tabular-nums text-muted-foreground">
              <span>0</span>
              <span>
                {format(m.myEntriesHeadroom, {
                  value: amountOf(Math.max(0, capUnits - finalUnits)),
                })}
              </span>
              <span>{amountOf(capUnits)}</span>
            </div>
          </div>
        )}
      </div>

      <Basis />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 border-b pb-2">
            <h3 className="text-sm font-semibold">{format(m.myEntriesHolds)}</h3>
            <p className="text-xs text-muted-foreground">
              {format(m.myEntriesHoldsCount, { count: inside.length })}
            </p>
          </div>
          {inside.length === 0 && (
            <p className="py-3 text-sm text-muted-foreground">{format(m.myEntriesHoldsEmpty)}</p>
          )}
          {inside.map((one) => (
            <button
              key={one.id}
              type="button"
              onClick={() => onOpen(one.id)}
              className="group flex items-center gap-3 border-b px-1 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/40"
            >
              <Badge variant="outline" className="shrink-0 font-normal">
                {format(one.kind === 'group' ? m.myEntriesGroupBadge : m.myEntriesItemBadge)}
              </Badge>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm">{one.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {one.kind === 'group'
                    ? format(m.myEntriesHoldsCount, {
                        count: rows.filter((child) => child.parentId === one.id).length,
                      })
                    : one.tag === null
                      ? ''
                      : format(ROW_TAG[one.tag])}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums">
                {one.right === '' ? '—' : one.right}
              </span>
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
              />
            </button>
          ))}
        </div>

        {score !== null && (
          <div className="flex flex-col gap-2 rounded-xl border p-4">
            <p className="text-sm font-semibold">{format(m.myEntriesMakeup)}</p>
            <Line label={format(m.myEntriesFromItems)} value={trimAmount(score.itemsTotal)} />
            <Line label={format(m.myEntriesFromChildren)} value={trimAmount(score.childrenTotal)} />
            {pending > 0 && (
              <Line
                label={format(m.entryStatusInReview)}
                value={format(m.myEntriesRows, { count: pending })}
              />
            )}
            {drafts > 0 && (
              <Line
                label={format(m.entryStatusDraft)}
                value={format(m.myEntriesRows, { count: drafts })}
              />
            )}
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
    </div>
  )
}

/** every row under a group, however deep, for counting what is outstanding */
const subtree = (rows: readonly StructureRow[], groupId: string): readonly StructureRow[] => {
  const held: StructureRow[] = []
  const walk = (parentId: string) => {
    for (const row of rows) {
      if (row.parentId !== parentId) continue
      held.push(row)
      if (row.kind === 'group') walk(row.id)
    }
  }
  walk(groupId)
  return held
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
