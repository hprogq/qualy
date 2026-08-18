import { useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { CheckIcon, ChevronDownIcon, FileTextIcon, PlusIcon } from 'lucide-react'
import { assessmentMessages as m } from '../i18n.ts'
import { EntryStanding } from './EntryStanding.tsx'
import { fieldsOf, trimAmount, type EntryDto, type ItemDto } from './model.ts'
import {
  chainLength,
  eachWorth,
  entryScore,
  itemScore,
  mayFile,
  roomLeft,
  type Standing,
  type StructureRow,
} from './standing.ts'

// The whole paper, top to bottom: a band per group, a row per question, and
// the question's own claims as table rows whose count decides the row's
// height. Nothing is chosen to be seen - which questions stand empty and
// which are full is one scan - and any claim row opens the drawer where the
// whole claim lives. The rail beside it follows the scroll; this file only
// reports which row is under the reader through `data-paper-row`.

export function Paper({
  rows,
  entriesByItem,
  standing,
  showTodoOnly,
  busy,
  onFile,
  onDeclare,
  onDetail,
}: {
  rows: readonly StructureRow[]
  entriesByItem: ReadonlyMap<string, readonly EntryDto[]>
  standing: Standing | null
  /** the toolbar's own filter: only questions still waiting on the reader */
  showTodoOnly: boolean
  busy: boolean
  onFile: (item: ItemDto, entry: EntryDto | null) => void
  onDeclare: (item: ItemDto) => void
  onDetail: (entry: EntryDto) => void
}) {
  // the root group is the summary card's business; the paper starts at its
  // children, numbered 01.. as bands
  const root =
    rows.length > 0 &&
    rows[0]!.kind === 'group' &&
    rows.filter((row) => row.depth === 0).length === 1
      ? rows[0]!
      : null
  const body = root === null ? rows : rows.slice(1).map((row) => ({ ...row, depth: row.depth - 1 }))
  const listed = showTodoOnly ? body.filter((row) => row.kind === 'group' || row.todo) : body
  // a band with nothing left under it says nothing in the todo view
  const kept = listed.filter((row, index) => {
    if (row.kind !== 'group') return true
    const next = listed.slice(index + 1).find((one) => one.depth <= row.depth)
    const nextIndex = next === undefined ? listed.length : listed.indexOf(next)
    return listed.slice(index + 1, nextIndex).some((one) => one.kind === 'item')
  })
  // the caps of the top bands, for each band's share of the whole
  const capSum = body
    .filter((row) => row.kind === 'group' && row.depth === 0)
    .reduce((sum, row) => sum + (row.cap == null || row.cap === '' ? 0 : Number(row.cap)), 0)

  let bandNo = 0
  let subNo = 0
  let questionNo = 0

  return (
    <div className="flex flex-col pb-10">
      {kept.map((row) => {
        if (row.kind === 'group' && row.depth === 0) {
          bandNo += 1
          subNo = 0
          questionNo = 0
          return (
            <Band
              key={row.id}
              row={row}
              no={String(bandNo).padStart(2, '0')}
              share={capSum > 0 && row.cap != null ? Number(row.cap) / capSum : null}
            />
          )
        }
        if (row.kind === 'group') {
          subNo += 1
          return (
            <SubBand key={row.id} row={row} no={`${String(bandNo).padStart(2, '0')}.${subNo}`} />
          )
        }
        questionNo += 1
        return (
          <Question
            key={row.id}
            row={row}
            no={`${bandNo}.${questionNo}`}
            entries={entriesByItem.get(row.id) ?? []}
            standing={standing}
            busy={busy}
            onFile={onFile}
            onDeclare={onDeclare}
            onDetail={onDetail}
          />
        )
      })}
    </div>
  )
}

/** amounts on the paper speak with two decimals, the way the ledger does */
const two = (value: string | number): string => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : String(value)
}

/** a top group's band: number, name, progress, and its ledger line */
function Band({
  row,
  no,
  share,
}: {
  row: StructureRow
  no: string
  /** this band's part of the whole paper, when every top cap is known */
  share: number | null
}) {
  const { format } = useI18n()
  const cap = row.cap == null || row.cap === '' ? null : Number(row.cap)
  const got = row.right === '' ? 0 : Number(row.right)
  const pct = cap === null || cap === 0 ? 0 : Math.min(100, Math.round((got / cap) * 100))
  return (
    <div data-paper-row={row.id} className="scroll-mt-16 px-6 pt-7 pb-4 first:pt-5">
      <div className="flex items-center gap-4 overflow-hidden rounded-xl border bg-linear-to-r from-muted/70 to-background to-65% px-4.5 py-3.5">
        <span
          aria-hidden
          className="shrink-0 text-xl leading-none font-semibold text-muted-foreground"
        >
          {no}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="min-w-0 truncate text-lg leading-tight font-semibold">{row.name}</h2>
          <div className="flex items-center gap-2.5">
            {cap !== null && (
              <span className="block h-0.75 w-24 shrink-0 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full bg-foreground"
                  style={{ width: `${pct}%` }}
                />
              </span>
            )}
            {share !== null && (
              <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                {format(m.paperBandShare, { pct: Math.round(share * 100) })}
              </span>
            )}
          </div>
        </div>
        <span className="flex-1" />
        <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-xl leading-none font-semibold tabular-nums">
            {two(row.right === '' ? 0 : row.right)}
          </span>
          {cap !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {format(m.paperCap, { value: trimAmount(String(cap)) })}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

/** a nested group's smaller band */
function SubBand({ row, no }: { row: StructureRow; no: string }) {
  const { format } = useI18n()
  const cap = row.cap == null || row.cap === '' ? null : Number(row.cap)
  return (
    <div data-paper-row={row.id} className="scroll-mt-16 px-6 pt-2 pb-3">
      <div className="flex h-10 items-center gap-3 overflow-hidden rounded-lg border bg-linear-to-r from-muted/60 to-background to-55% px-4">
        <span aria-hidden className="shrink-0 text-sm font-semibold text-muted-foreground">
          {no}
        </span>
        <h3 className="min-w-0 truncate text-sm font-semibold">{row.name}</h3>
        <span className="flex-1" />
        <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-base font-semibold tabular-nums">
            {two(row.right === '' ? 0 : row.right)}
          </span>
          {cap !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {format(m.paperCap, { value: trimAmount(String(cap)) })}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

/** the claims table's columns, shared by its header and rows */
const CLAIM_COLS = 'grid grid-cols-[minmax(0,1fr)_8.5rem_6rem_5.5rem] items-center gap-3 px-4'

/**
 * One question: its terms on the left at a fixed width, its claims on the
 * right deciding how tall the row is. Empty questions carry their own tray
 * saying why - not yet filed, or never this person's to file.
 */
function Question({
  row,
  no,
  entries,
  standing,
  busy,
  onFile,
  onDeclare,
  onDetail,
}: {
  row: StructureRow
  no: string
  entries: readonly EntryDto[]
  standing: Standing | null
  busy: boolean
  onFile: (item: ItemDto, entry: EntryDto | null) => void
  onDeclare: (item: ItemDto) => void
  onDetail: (entry: EntryDto) => void
}) {
  const { format } = useI18n()
  const [unfolded, setUnfolded] = useState(false)
  const item = row.item
  if (item === undefined) return null
  const description = String(
    (item.currentRevision?.displayConfig as { description?: unknown } | undefined)?.description ??
      '',
  ).trim()
  const each = eachWorth(item)
  const steps = chainLength(item)
  const live = entries.filter((entry) => entry.status !== 'voided')
  const filed = live.filter(
    (entry) => entry.status !== 'draft' && entry.status !== 'needs_revision',
  )
  const counted = itemScore(standing, item.id)
  const recorded = item.currentRevision?.entrySource === 'administrative'
  const granted = item.itemType === 'constant'
  const declared = item.itemType === 'declaration'
  const room = roomLeft(item, entries)
  const full = !granted && !recorded && room !== null && room <= 0

  const terms = [
    each !== undefined ? format(m.myEntriesHeadEach, { value: trimAmount(each) }) : null,
    granted
      ? format(m.myEntriesGranted)
      : item.maxEntries !== null
        ? format(m.myEntriesHeadMost, { count: item.maxEntries })
        : null,
    recorded
      ? format(m.myEntriesRecorded)
      : steps > 0
        ? format(m.myEntriesHeadSteps, { count: steps })
        : null,
  ].filter((part): part is string => part !== null)

  const shown = unfolded ? live : live.slice(0, 6)

  return (
    <div data-paper-row={row.id} className="scroll-mt-16 px-6 pb-3.5">
      <div className="grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[23.5rem_minmax(0,1fr)]">
        {/* the question itself: what it asks, what it pays, the way in */}
        <div className="flex min-w-0 flex-col gap-2 border-b p-4 lg:border-r lg:border-b-0">
          <div className="flex items-baseline gap-2.5">
            <span aria-hidden className="shrink-0 text-xs font-semibold text-muted-foreground">
              {no}
            </span>
            <h3 className="min-w-0 flex-1 text-base leading-snug font-semibold">{item.title}</h3>
            {counted !== null && Number(counted) > 0 && (
              <span className="shrink-0 text-base font-semibold whitespace-nowrap tabular-nums">
                {two(counted)}
              </span>
            )}
          </div>
          {description !== '' && (
            <p className="text-sm leading-relaxed text-pretty">{description}</p>
          )}
          {terms.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">{terms.join('，')}</p>
          )}
          {/* the clause this question scores under; reserved until the data
              carries one */}
          <p className="flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
            <span className="shrink-0 text-muted-foreground">{format(m.myEntriesBasis)}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {format(m.myEntriesBasisSoon)}
            </span>
          </p>
          <span className="min-h-2 flex-1" />
          <div className="flex items-center gap-3">
            {!granted && !recorded && item.maxEntries !== null && (
              <span className="flex shrink-0 items-baseline gap-1.5 text-xs whitespace-nowrap">
                <span className="text-muted-foreground">{format(m.myEntriesQuota)}</span>
                <span className="tabular-nums">
                  {live.length} / {item.maxEntries}
                </span>
              </span>
            )}
            <span className="flex-1" />
            {full ? (
              <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                {format(m.myEntriesAddFull)}
              </span>
            ) : declared ? (
              mayFile(item, entries) && !live.some((entry) => entry.status === 'draft') ? (
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => onDeclare(item)}
                >
                  <PlusIcon aria-hidden />
                  {format(m.entryDeclare)}
                </Button>
              ) : null
            ) : (
              mayFile(item, entries) && (
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => onFile(item, null)}
                >
                  <PlusIcon aria-hidden />
                  {format(m.entryNew)}
                </Button>
              )
            )}
          </div>
        </div>

        {/* the claims, a row each; the row is the way into the drawer */}
        <div className="flex min-w-0 flex-col">
          {live.length > 0 ? (
            <>
              <div
                className={cn(CLAIM_COLS, 'h-8 border-b bg-muted/30 text-xs text-muted-foreground')}
              >
                <span>{format(m.paperColContent)}</span>
                <span>{format(m.paperColVersion)}</span>
                <span>{format(m.paperColStatus)}</span>
                <span className="text-right">{format(m.paperColScore)}</span>
              </div>
              {shown.map((entry) => (
                <ClaimRow
                  key={entry.id}
                  entry={entry}
                  item={item}
                  score={entryScore(standing, entry.id) ?? (each === undefined ? null : each)}
                  onOpen={() => onDetail(entry)}
                />
              ))}
              {live.length > 6 && (
                <button
                  type="button"
                  onClick={() => setUnfolded((now) => !now)}
                  className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {unfolded
                    ? format(m.paperFoldLess)
                    : format(m.paperFoldMore, { count: live.length - 6 })}
                  <ChevronDownIcon
                    aria-hidden
                    className={cn('size-3.5', unfolded && 'rotate-180')}
                  />
                </button>
              )}
            </>
          ) : (
            // why this side is empty: never filed, or never theirs to file
            <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2.5 p-4">
              <span className="flex size-8.5 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {granted || recorded ? (
                  <CheckIcon aria-hidden className="size-4" />
                ) : (
                  <FileTextIcon aria-hidden className="size-4" />
                )}
              </span>
              <span className="flex flex-col items-center gap-1 text-center">
                <span className="text-sm font-medium">
                  {format(
                    granted
                      ? m.paperEmptyGranted
                      : recorded
                        ? m.paperEmptyRecorded
                        : m.paperEmptyTitle,
                  )}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {format(
                    granted
                      ? m.paperEmptyGrantedHint
                      : recorded
                        ? m.paperEmptyRecordedHint
                        : m.paperEmptyHint,
                  )}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** one claim as one table row: enough to be told apart, and the way in */
function ClaimRow({
  entry,
  item,
  score,
  onOpen,
}: {
  entry: EntryDto
  item: ItemDto
  score: string | null
  onOpen: () => void
}) {
  const { format } = useI18n()
  const fields = fieldsOf(item.currentRevision?.formConfig)
  const payload = (entry.currentRevision?.payload ?? {}) as Record<string, unknown>
  const revisionNo = entry.currentRevision?.revisionNo
  const said = (field: (typeof fields)[number] | undefined): string => {
    if (field === undefined) return ''
    const value = payload[field.key]
    if (field.type === 'attachment') {
      return Array.isArray(value) && value.length > 0
        ? format(m.reviewFilesCount, { count: value.length })
        : format(m.myEntriesFilesNone)
    }
    return typeof value === 'string' ? value : ''
  }
  const lead = said(fields[0])
  const sub = said(fields[1])
  const ok = entry.status === 'approved'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_8.5rem_6rem_5.5rem] items-center gap-3 border-b px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/50"
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="max-w-44 shrink-0 truncate text-sm font-medium">
          {lead === '' ? item.title : lead}
        </span>
        {sub !== '' && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{sub}</span>
        )}
      </span>
      <span className="flex min-w-0 items-baseline gap-2 text-xs whitespace-nowrap text-muted-foreground">
        <span className="shrink-0">
          {entry.status === 'draft' || revisionNo === undefined
            ? format(m.paperUnsubmitted)
            : format(m.entryVersionNo, { no: revisionNo })}
        </span>
        <span className="min-w-0 truncate tabular-nums">{when(entry)}</span>
      </span>
      <span className="min-w-0">
        <EntryStanding
          status={entry.status}
          revised={entry.currentReviewInstanceId !== null}
          asked={entry.supplement !== null}
        />
      </span>
      {score !== null ? (
        <span className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
          <span className="text-xs text-muted-foreground">
            {format(
              ok
                ? m.entryScoreCounted
                : entry.status === 'in_review'
                  ? m.entryScorePending
                  : m.entryScoreIfApproved,
            )}
          </span>
          <span
            className={cn(
              'text-sm tabular-nums',
              ok ? 'font-semibold' : 'font-medium text-muted-foreground',
            )}
          >
            {trimAmount(score)}
          </span>
        </span>
      ) : (
        <span />
      )}
    </button>
  )
}

const when = (entry: EntryDto): string =>
  new Date(entry.currentRevision?.createdAt ?? entry.createdAt).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
