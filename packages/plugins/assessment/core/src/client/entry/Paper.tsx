import { useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Appear } from '@qualy/ui/reveal'
import { cn } from '@qualy/ui/cn'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleSlashIcon,
  ClockIcon,
  FileTextIcon,
  PlusIcon,
} from 'lucide-react'
import { projectEntrySummary } from '../../entry/summary.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { EntryStanding } from './EntryStanding.tsx'
import { fieldsOf, trimAmount, type EntryDto, type ItemDto } from './model.ts'
import {
  chainNamesOf,
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
//
// One paper, three widths. Under 768 the question is a single column and a
// claim is two lines of one row; to 1024 the terms stand beside a
// three-column table with the version folded into the content cell; wider,
// the four-column table. The same rows, the same drawer behind them - only
// the columns give way, never the content.
//
// Rules run edge to edge while the writing stays inside one measure: the
// paper reads as sheets divided by lines, not as a stack of floating cards.
const MEASURE = 'mx-auto w-full max-w-6xl px-4 lg:px-6'

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

  // Numbered over the whole paper, never over what is on screen: sections
  // carry a dotted number (01, 01.2) and questions carry a running one, so
  // the two can never be mistaken for each other, and question 17 is
  // question 17 whether or not the questions before it are being shown.
  const numbers = new Map<string, string>()
  let bandNo = 0
  let subNo = 0
  let questionNo = 0
  for (const row of body) {
    if (row.kind === 'group' && row.depth === 0) {
      bandNo += 1
      subNo = 0
      numbers.set(row.id, String(bandNo).padStart(2, '0'))
    } else if (row.kind === 'group') {
      subNo += 1
      numbers.set(row.id, `${String(bandNo).padStart(2, '0')}.${subNo}`)
    } else {
      questionNo += 1
      numbers.set(row.id, String(questionNo))
    }
  }

  return (
    // room at the foot for the shell's floating capsule where it floats
    <div className="flex flex-col pb-16 max-lg:pb-28">
      {kept.map((row) => {
        if (row.kind === 'group' && row.depth === 0) {
          return (
            <Band
              key={row.id}
              row={row}
              no={numbers.get(row.id) ?? ''}
              share={capSum > 0 && row.cap != null ? Number(row.cap) / capSum : null}
            />
          )
        }
        if (row.kind === 'group') {
          return <SubBand key={row.id} row={row} no={numbers.get(row.id) ?? ''} />
        }
        return (
          <Question
            key={row.id}
            row={row}
            no={numbers.get(row.id) ?? ''}
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

/**
 * Amounts on the paper speak with two decimals, the way the ledger does.
 * Nothing counted yet is still 0.00 and not a dash - a dash in Chinese copy
 * reads as the numeral one; what keeps a zero from shouting is its weight,
 * not a substitute for it.
 */
const two = (value: string | number): string => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : String(value)
}

/**
 * A top group's band: number, name, progress, and its ledger line.
 *
 * Three arrangements of the same facts: a phone gives the name a line and
 * the progress the next one, a tablet holds everything on one 42px line,
 * and a laptop affords the display card. Which one shows is the width's
 * business alone.
 */
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
  const ledger = (gotSize: string, capSize: string) => (
    <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
      <span
        className={cn(
          gotSize,
          'leading-none font-semibold tabular-nums',
          got === 0 && 'text-muted-foreground',
        )}
      >
        {two(got)}
      </span>
      {cap !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {format(m.paperCap, { value: trimAmount(String(cap)) })}
        </span>
      )}
    </span>
  )
  const bar = (className: string) =>
    cap !== null && (
      <span className={cn('block overflow-hidden rounded-full bg-border', className)}>
        <span className="block h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
      </span>
    )
  return (
    <div
      data-paper-row={row.id}
      data-paper-band={row.id}
      className="scroll-mt-30 border-b bg-linear-to-r from-muted/70 to-background to-65% lg:scroll-mt-16"
    >
      {/* phone: the name gets a line, the progress gets the next */}
      <div className={cn(MEASURE, 'flex flex-col gap-2 py-3 md:hidden')}>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="shrink-0 text-lg leading-none font-semibold tracking-tight text-muted-foreground/60 tabular-nums"
          >
            {no}
          </span>
          <h2 className="min-w-0 flex-1 truncate text-base leading-tight font-semibold">
            {row.name}
          </h2>
          {ledger('text-lg', 'text-[11px]')}
        </div>
        <div className="flex items-center gap-2.5">
          {bar('h-1 min-w-0 flex-1')}
          {share !== null && (
            <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">
              {format(m.paperBandShare, { pct: Math.round(share * 100) })}
            </span>
          )}
        </div>
      </div>
      {/* tablet: one line, worth its 42px and no more */}
      <div className={cn(MEASURE, 'hidden h-10.5 items-center gap-3.5 md:flex lg:hidden')}>
        <span
          aria-hidden
          className="shrink-0 text-[15px] leading-none font-semibold tracking-tight text-muted-foreground/60 tabular-nums"
        >
          {no}
        </span>
        <h2 className="min-w-0 truncate text-sm leading-tight font-semibold">{row.name}</h2>
        {share !== null && (
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
            {format(m.paperBandShare, { pct: Math.round(share * 100) })}
          </span>
        )}
        <span className="flex-1" />
        {ledger('text-base', 'text-xs')}
      </div>
      {/* laptop and wider: the display card the section deserves */}
      <div className={cn(MEASURE, 'hidden items-center gap-6 py-4 lg:flex')}>
        <span
          aria-hidden
          className="shrink-0 text-3xl leading-none font-semibold tracking-tight text-muted-foreground/50"
        >
          {no}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="min-w-0 truncate text-lg leading-tight font-semibold">{row.name}</h2>
          <div className="flex items-center gap-2.5">
            {bar('h-0.75 w-24 shrink-0')}
            {share !== null && (
              <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                {format(m.paperBandShare, { pct: Math.round(share * 100) })}
              </span>
            )}
          </div>
        </div>
        <span className="flex-1" />
        {ledger('text-xl', 'text-xs')}
      </div>
    </div>
  )
}

/** a nested group's smaller band */
function SubBand({ row, no }: { row: StructureRow; no: string }) {
  const { format } = useI18n()
  const cap = row.cap == null || row.cap === '' ? null : Number(row.cap)
  return (
    <div
      data-paper-row={row.id}
      className="scroll-mt-34 border-b bg-linear-to-r from-muted/45 to-background to-55% lg:scroll-mt-24"
    >
      <div className={cn(MEASURE, 'flex h-9 items-center gap-3 lg:h-11 lg:gap-4')}>
        <span
          aria-hidden
          className="shrink-0 text-xs font-semibold text-muted-foreground/70 lg:text-sm"
        >
          {no}
        </span>
        <h3 className="min-w-0 truncate text-[13px] font-semibold lg:text-sm">{row.name}</h3>
        <span className="flex-1" />
        <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
          <span
            className={cn(
              'text-sm font-semibold tabular-nums lg:text-base',
              (row.right === '' || Number(row.right) === 0) && 'text-muted-foreground',
            )}
          >
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

/**
 * The claims table's columns, shared by its header and rows: three of them
 * on a tablet with the version folded into the content cell, four on a
 * laptop. The header only exists where there are columns to head.
 */
const CLAIM_COLS =
  'grid grid-cols-[minmax(0,1fr)_6rem_5.5rem] items-center gap-3 px-4 lg:grid-cols-[minmax(0,1fr)_8.5rem_6rem_5.5rem]'

/**
 * One question: its terms on the left at a fixed measure, its claims on the
 * right in a table of their own deciding how tall the row is. Empty
 * questions carry their own tray saying why - not yet filed, or never this
 * person's to file.
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
  // a withdrawn question arrives folded: it is history, not work
  const [opened, setOpened] = useState(false)
  const item = row.item
  if (item === undefined) return null
  const description = String(
    (item.currentRevision?.displayConfig as { description?: unknown } | undefined)?.description ??
      '',
  ).trim()
  const each = eachWorth(item)
  const chain = chainNamesOf(item)
  const live = entries.filter((entry) => entry.status !== 'voided')
  const counted = itemScore(standing, item.id)
  const recorded = item.currentRevision?.entrySource === 'administrative'
  const voided = item.status === 'voided'
  const granted = item.itemType === 'constant'
  const declared = item.itemType === 'declaration'
  const room = roomLeft(item, entries)
  const full = !granted && !recorded && room !== null && room <= 0
  const declaredAlready = declared && live.some((entry) => entry.status === 'draft')
  const mayAdd = !full && mayFile(item, entries) && !declaredAlready
  const add = () => (declared ? onDeclare(item) : onFile(item, null))

  // A question granted to everybody is administrative in the data, because
  // nobody fills it in - but nobody records it either, so it must not say so.
  // Its terms are the amount and the fact that it lands by itself, and that
  // is all there is to say about it.
  const terms = [
    each !== undefined
      ? format(granted ? m.paperGrantedEach : m.myEntriesHeadEach, { value: trimAmount(each) })
      : null,
    granted
      ? format(m.myEntriesGranted)
      : item.maxEntries !== null
        ? format(m.myEntriesHeadMost, { count: item.maxEntries })
        : null,
    granted ? null : recorded ? format(m.myEntriesRecorded) : null,
  ].filter((part): part is string => part !== null)
  // The routes by their step names and nothing else: who a step lands on -
  // levels, roles, people - is the round's business, not this reader's.
  const stepName = (label: string | null, index: number) =>
    label ?? format(m.entryFlowStep, { n: index + 1 })
  const routes =
    granted || recorded
      ? []
      : [
          chain.normal.length > 0
            ? { name: format(m.reviewRouteNormal), steps: chain.normal.map(stepName) }
            : null,
          chain.escalation.length > 0
            ? { name: format(m.reviewRouteEscalation), steps: chain.escalation.map(stepName) }
            : null,
        ].filter((route): route is { name: string; steps: string[] } => route !== null)

  const shown = unfolded ? live : live.slice(0, 6)

  const body = (
    <div
      className={cn(
        MEASURE,
        'grid gap-4 py-5 md:grid-cols-[17rem_minmax(0,1fr)] md:gap-6 md:py-6 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-8 lg:py-7 xl:grid-cols-[21rem_minmax(0,1fr)] xl:gap-10',
        voided && 'pt-2 opacity-75',
      )}
    >
      {/* the question itself: what it asks, what it pays, the way in */}
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex items-baseline gap-2.5">
          <span
            aria-hidden
            className="shrink-0 text-xs font-semibold text-muted-foreground/70 tabular-nums"
          >
            {no}.
          </span>
          <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold md:text-base">
            {item.title}
          </h3>
          {counted !== null && Number(counted) > 0 && (
            <span className="shrink-0 text-[15px] font-semibold whitespace-nowrap tabular-nums md:text-base">
              {two(counted)}
            </span>
          )}
        </div>
        {description !== '' && <p className="text-sm leading-relaxed text-pretty">{description}</p>}
        {/* what the question pays and asks for - one line on a phone, a term
            to a line where there is height to spend - closing with the
            clause it scores under; the association feature takes that seat
            next */}
        <div className="flex flex-col rounded-lg border bg-muted/30 text-xs">
          {terms.length > 0 && (
            <>
              <p className="px-3 py-2 leading-relaxed text-muted-foreground md:hidden">
                {terms.join('，')}
              </p>
              <ul className="hidden flex-col gap-1.5 px-3 py-2.5 text-muted-foreground md:flex">
                {terms.map((term) => (
                  <li key={term}>{term}</li>
                ))}
              </ul>
            </>
          )}
          {routes.length > 0 && (
            <div
              data-testid="question-chain"
              className={cn(
                'flex flex-col gap-1 px-3 py-2 text-muted-foreground',
                terms.length > 0 && 'border-t',
              )}
            >
              {routes.map((route) => (
                <p key={route.name} className="flex items-baseline gap-2">
                  <span className="shrink-0">{route.name}</span>
                  <span className="min-w-0 leading-relaxed">{route.steps.join(' → ')}</span>
                </p>
              ))}
            </div>
          )}
          <p
            className={cn(
              'flex items-baseline gap-2 px-3 py-2 text-muted-foreground',
              (terms.length > 0 || routes.length > 0) && 'border-t',
            )}
          >
            <span className="shrink-0">{format(m.myEntriesBasis)}</span>
            <span className="min-w-0 truncate">{format(m.myEntriesBasisSoon)}</span>
          </p>
        </div>
        <span className="hidden min-h-2 flex-1 md:block" />
        {/* the way in and the quota live in the claims list on a phone,
            where the thumb already is */}
        <div className="hidden items-center gap-3 md:flex">
          {!granted && !recorded && item.maxEntries !== null && (
            <span className="flex shrink-0 items-baseline gap-1.5 text-xs whitespace-nowrap">
              <span className="text-muted-foreground">{format(m.myEntriesQuota)}</span>
              <span className="tabular-nums">
                {live.length} / {item.maxEntries}
              </span>
            </span>
          )}
          <span className="flex-1" />
          {/* Where there is nothing to press, a badge says why in a word
              rather than a control that exists only to be refused. Three
              reasons, one shape: the quota is used up, somebody else fills
              this one in, or it lands by itself. */}
          {full ? (
            <Badge variant="secondary" className="shrink-0">
              <CircleSlashIcon aria-hidden />
              {format(m.myEntriesAddFull)}
            </Badge>
          ) : granted ? (
            <Badge variant="secondary" className="shrink-0">
              <CheckIcon aria-hidden />
              {format(m.paperEmptyGranted)}
            </Badge>
          ) : recorded ? (
            <Badge variant="secondary" className="shrink-0">
              <ClockIcon aria-hidden />
              {format(m.myEntriesRecorded)}
            </Badge>
          ) : (
            mayAdd && (
              <Button
                data-testid="file-claim"
                size="sm"
                className="shrink-0"
                disabled={busy}
                onClick={add}
              >
                <PlusIcon aria-hidden />
                {format(declared ? m.entryDeclare : m.entryNew)}
              </Button>
            )
          )}
        </div>
      </div>

      {/* The claims, a row each, in their own sheet; the row is the way into
            the drawer. The sheet keeps its head whether or not there is
            anything under it - a question with nothing filed yet is the same
            table, empty, not a different thing on the page. The exception is
            a question granted to everybody: it has no claims to table, ever,
            so it says so inside a tray instead of under column headings that
            will never have anything under them. */}
      <div className="flex min-w-0 flex-col">
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col md:overflow-hidden md:rounded-xl md:border',
            granted
              ? 'overflow-hidden rounded-xl border border-dashed bg-muted/20'
              : cn('md:bg-card', live.length > 0 && 'max-md:border-t'),
          )}
        >
          {!granted && (
            <div
              className={cn(
                CLAIM_COLS,
                'h-8 border-b bg-muted/40 text-xs text-muted-foreground max-md:hidden',
              )}
            >
              <span>
                <span className="lg:hidden">{format(m.paperColContentVersion)}</span>
                <span className="max-lg:hidden">{format(m.paperColContent)}</span>
              </span>
              <span className="max-lg:hidden">{format(m.paperColVersion)}</span>
              <span>{format(m.paperColStatus)}</span>
              <span className="text-right">{format(m.paperColScore)}</span>
            </div>
          )}
          {live.length > 0 ? (
            <>
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
                  className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 border-b text-xs text-muted-foreground transition-colors last:border-b-0 hover:text-foreground md:border-b-0"
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
              {/* the next claim's own seat: it takes whatever room the
                    filed ones leave, so a question with one claim still
                    stands as tall as the terms beside it */}
              {mayAdd && (
                <button
                  type="button"
                  data-testid="file-claim"
                  disabled={busy}
                  onClick={add}
                  className="flex min-h-11 w-full flex-1 cursor-pointer items-center justify-center gap-1.5 text-[13px] font-medium text-foreground transition-colors max-md:border-b md:bg-muted/20 md:text-xs md:font-normal md:text-muted-foreground md:hover:bg-accent/40 md:hover:text-foreground"
                >
                  <PlusIcon aria-hidden className="size-3.5" />
                  {format(declared ? m.entryDeclare : m.paperEmptyFile)}
                </button>
              )}
              {/* the quota, spoken where the next claim would have gone */}
              {full && (
                <span className="flex h-10 items-center justify-center gap-1.5 text-xs text-muted-foreground max-md:border-b md:hidden">
                  {format(m.myEntriesAddFull)}
                  {item.maxEntries !== null && (
                    <span className="tabular-nums">
                      {live.length} / {item.maxEntries}
                    </span>
                  )}
                </span>
              )}
            </>
          ) : (
            // why the table stands empty: never filed, or never this
            // person's to file. Staff record theirs, so the notice here
            // goes the moment the first one lands.
            // tinted, not white: an empty table body that matches the
            // page reads as a table that failed to draw its rows
            <div
              className={cn(
                'flex min-h-28 flex-1 flex-col items-center justify-center gap-2.5 p-4',
                !granted && 'bg-muted/25 max-md:rounded-xl max-md:border',
              )}
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {granted ? (
                  <CheckIcon aria-hidden className="size-4" />
                ) : recorded ? (
                  // waiting on somebody else, which is not the same as done
                  <ClockIcon aria-hidden className="size-4" />
                ) : (
                  <FileTextIcon aria-hidden className="size-4" />
                )}
              </span>
              <span className="text-sm font-medium">
                {format(
                  granted
                    ? m.paperEmptyGranted
                    : recorded
                      ? m.paperEmptyRecorded
                      : m.paperEmptyTitle,
                )}
              </span>
              {mayAdd ? (
                <Button
                  data-testid="file-claim"
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={add}
                >
                  <PlusIcon aria-hidden />
                  {format(declared ? m.entryDeclare : m.paperEmptyFile)}
                </Button>
              ) : (
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {format(
                    voided
                      ? m.itemVoided
                      : granted
                        ? m.paperEmptyGrantedHint
                        : recorded
                          ? m.paperEmptyRecordedHint
                          : m.paperEmptyHint,
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div
      data-paper-row={row.id}
      className={cn('scroll-mt-34 border-b lg:scroll-mt-24', voided && 'bg-muted/15')}
    >
      {voided ? (
        <>
          {/* A withdrawn question stays on the paper - what was filed under
              it is still the reader's, and still theirs to argue about - but
              it is folded away and greyed, and it says on its face why it
              was withdrawn. */}
          <button
            type="button"
            onClick={() => setOpened((now) => !now)}
            className={cn(MEASURE, 'flex cursor-pointer items-center gap-3 py-3 text-left')}
          >
            <span
              aria-hidden
              className="shrink-0 text-xs font-semibold text-muted-foreground/60 tabular-nums"
            >
              {no}.
            </span>
            <h3 className="max-w-64 shrink-0 truncate text-sm font-medium text-muted-foreground line-through decoration-muted-foreground/40">
              {item.title}
            </h3>
            <span className="shrink-0 rounded-md border bg-background px-1.5 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground">
              {format(m.itemsStatusVoided)}
            </span>
            {item.voidReason !== null && item.voidReason.trim() !== '' && (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground max-md:hidden">
                {format(m.paperVoidedWhy, { reason: item.voidReason })}
              </span>
            )}
            <span className="flex-1" />
            <ChevronDownIcon
              aria-hidden
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                opened && 'rotate-180',
              )}
            />
          </button>
          <Appear show={opened} collapse>
            {body}
          </Appear>
        </>
      ) : (
        body
      )}
    </div>
  )
}

/**
 * One claim as one table row: enough to be told apart, and the way in.
 *
 * The cells come and go with the width - a phone folds the status and the
 * time under the content and stacks the amount over its word, a tablet
 * folds only the time - but it is one row of one list at every width, and
 * it opens the same drawer.
 */
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
  // the shared identity line (§32.74): the item's elected fields, or the
  // first ones that identify anything - never "whatever came first"
  const parts = projectEntrySummary({
    formConfig: item.currentRevision?.formConfig,
    displayConfig: item.currentRevision?.displayConfig,
    payload,
  }).filter((part) => part.value !== '')
  const lead = parts[0]?.value ?? ''
  const sub = parts
    .slice(1)
    .map((part) => part.value)
    .join(' ')
  const ok = entry.status === 'approved'
  // how many files this claim cites, as a number rather than as the phrase
  // counting them: the drawer is where the files themselves are
  const files = fields
    .filter((field) => field.type === 'attachment')
    .reduce(
      (count, field) =>
        count + (Array.isArray(payload[field.key]) ? (payload[field.key] as unknown[]).length : 0),
      0,
    )
  const verWhen = (
    <>
      <span className="shrink-0">
        {entry.status === 'draft' || revisionNo === undefined
          ? format(m.paperUnsubmitted)
          : format(m.entryVersionNo, { no: revisionNo })}
      </span>
      <span className="min-w-0 truncate tabular-nums">{when(entry)}</span>
    </>
  )
  return (
    <button
      type="button"
      data-testid="claim-row"
      data-files={String(files)}
      onClick={onOpen}
      className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b py-2.5 text-left transition-colors last:border-b-0 md:grid-cols-[minmax(0,1fr)_6rem_5.5rem] md:px-4 md:py-3.5 lg:grid-cols-[minmax(0,1fr)_8.5rem_6rem_5.5rem] hover:bg-accent/50"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="max-w-44 shrink-0 truncate text-sm font-medium">
            {lead === '' ? item.title : lead}
          </span>
          {/* the rest of the identity stays on a phone too: without it a
              claim named by its second and third fields reads as nothing */}
          {sub !== '' && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{sub}</span>
          )}
        </span>
        {/* the folded cells, under the content where the width folds them */}
        <span className="flex min-w-0 items-center gap-2.5 md:hidden">
          <EntryStanding
            status={entry.status}
            revised={entry.currentReviewInstanceId !== null}
            asked={entry.supplement !== null}
          />
          <span className="flex min-w-0 items-baseline gap-2 text-[11px] whitespace-nowrap text-muted-foreground">
            {verWhen}
          </span>
        </span>
        <span className="hidden min-w-0 items-baseline gap-2 text-[11px] whitespace-nowrap text-muted-foreground md:flex lg:hidden">
          {verWhen}
        </span>
      </span>
      <span className="hidden min-w-0 items-baseline gap-2 text-xs whitespace-nowrap text-muted-foreground lg:flex">
        {verWhen}
      </span>
      <span className="min-w-0 max-md:hidden">
        <EntryStanding
          status={entry.status}
          revised={entry.currentReviewInstanceId !== null}
          asked={entry.supplement !== null}
        />
      </span>
      {score !== null ? (
        <span className="flex flex-col items-end gap-0.5 whitespace-nowrap md:flex-row md:items-baseline md:justify-end md:gap-1.5">
          <span className="text-[10.5px] text-muted-foreground md:text-xs">
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
      <ChevronRightIcon aria-hidden className="size-3.5 text-muted-foreground/60 md:hidden" />
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
