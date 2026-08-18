import { useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@qualy/ui/breadcrumb'
import { Button } from '@qualy/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '@qualy/ui/empty'
import { cn } from '@qualy/ui/cn'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { CheckIcon, ChevronRightIcon, FileTextIcon, PlusIcon } from 'lucide-react'
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

// One question, and what this person has put into it.
//
// The question's terms read as one sentence under its name; what the round
// has granted from it stands at the right with the places used. The claims
// are cards that say just enough to be told apart - the designated list
// fields and one line for everything else - because the whole claim, its
// account and its acts live in the drawer one press away. A card that tried
// to say everything ended up a page per claim, and comparing two claims
// meant reading two pages.

export function ItemDetail({
  row,
  crumbs,
  onCrumb,
  entries,
  standing,
  busy,
  onFile,
  onDeclare,
  onDetail,
}: {
  row: StructureRow
  /** the groups above this question, with the ids that open them */
  crumbs: readonly { id: string; name: string }[]
  onCrumb: (id: string) => void
  entries: readonly EntryDto[]
  standing: Standing | null
  busy: boolean
  onFile: (entry: EntryDto | null) => void
  /** a declaration's one press: file and hand on, no dialog */
  onDeclare: () => void
  /** the drawer that holds the whole claim */
  onDetail: (entry: EntryDto) => void
}) {
  const { format } = useI18n()
  const [showing, setShowing] = useState<'all' | 'todo' | 'done'>('all')
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
  const done = live.filter((entry) => entry.status === 'approved')
  const todo = live.filter((entry) => entry.status !== 'approved')
  const counted = itemScore(standing, item.id)
  const recorded = item.currentRevision?.entrySource === 'administrative'
  const granted = item.itemType === 'constant'
  const declared = item.itemType === 'declaration'
  // the group this question scores into, for the rail that says where
  const group = standing?.groups.find((one) => one.groupId === row.parentId) ?? null

  // the question's terms as one readable line, not a row of chips: what one
  // claim is worth, how many fit, who has to agree
  const headParts = [
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

  const listed = showing === 'all' ? live : showing === 'done' ? done : todo

  return (
    <div className="flex flex-col gap-4 lg:flex-1">
      {/* the title bar: where this stands in the paper, what it is, and the
          two numbers that say how much of it is already spent */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2.5">
          {crumbs.length > 0 && (
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap text-xs sm:gap-1.5">
                {crumbs.map((crumb, index) => (
                  <BreadcrumbItem key={crumb.id} className="min-w-0">
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbLink asChild>
                      <button
                        type="button"
                        className="min-w-0 cursor-pointer truncate"
                        onClick={() => onCrumb(crumb.id)}
                      >
                        {crumb.name}
                      </button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          )}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="min-w-0 text-2xl font-semibold tracking-tight">{item.title}</h2>
            {headParts.length > 0 && (
              <p className="min-w-0 truncate text-sm text-muted-foreground">
                {headParts.join('，')}
              </p>
            )}
          </div>
        </div>
        <span className="flex-1" />
        <div className="flex shrink-0 items-center gap-5">
          {!granted && !recorded && item.maxEntries !== null && (
            <span className="flex flex-col items-end gap-1">
              <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-xs text-muted-foreground">{format(m.myEntriesQuota)}</span>
                <span className="text-sm tabular-nums">
                  {filed.length} / {item.maxEntries}
                </span>
              </span>
              <span className="block h-0.75 w-16 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-foreground"
                  style={{
                    width: `${Math.min(100, Math.round((filed.length / item.maxEntries) * 100))}%`,
                  }}
                />
              </span>
            </span>
          )}
          <span className="flex flex-col items-end gap-0.5">
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {format(m.myEntriesCountedHere)}
            </span>
            <span className="text-lg leading-none font-semibold tabular-nums">
              {two(counted ?? '0')}
            </span>
          </span>
        </div>
      </div>

      {item.status === 'voided' && (
        <p className="rounded-lg bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
          {format(m.itemVoided)}
        </p>
      )}

      {/* claims on the left, the question's own terms on the right: the
          reference column keeps out of the reading column's way */}
      <div className="flex flex-col gap-5 lg:grid lg:flex-1 lg:grid-cols-[minmax(0,1fr)_15.5rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5 border-b pb-2">
            {(!granted || live.length > 0) && (
              <div className="flex items-center rounded-lg bg-muted p-0.5 text-sm">
                {(
                  [
                    ['all', m.myEntriesClaimsAll, live.length],
                    ['todo', m.myEntriesClaimsTodo, todo.length],
                    ['done', m.myEntriesClaimsDone, done.length],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setShowing(key)}
                    className={cn(
                      'inline-flex h-7 items-center gap-1 rounded-md px-2.5 whitespace-nowrap',
                      showing === key
                        ? 'bg-background font-medium shadow-sm'
                        : 'text-muted-foreground',
                    )}
                  >
                    {format(label)}
                    <span className="tabular-nums">{count}</span>
                  </button>
                ))}
              </div>
            )}
            <span className="flex-1" />
            <p className="text-xs whitespace-nowrap text-muted-foreground">
              {format(m.myEntriesClaimsNote, { todo: todo.length, done: done.length })}
            </p>
            <FileButton
              item={item}
              entries={entries}
              granted={granted}
              declared={declared}
              busy={busy}
              hasDraft={live.some((entry) => entry.status === 'draft')}
              onFile={() => onFile(null)}
              onDeclare={onDeclare}
            />
          </div>

          {live.length === 0 && (
            <Empty className="min-h-64 flex-1 rounded-xl border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileTextIcon aria-hidden />
                </EmptyMedia>
                <EmptyDescription>
                  {format(recorded ? m.myEntriesRecordedNone : m.myEntriesNoneYet)}
                </EmptyDescription>
              </EmptyHeader>
              {/* the way in stands under the sentence that explains it */}
              <EmptyContent>
                {/* quieter than the toolbar's own: the bar keeps the one
                    primary way in, and this one is the same door offered
                    where the eye already is */}
                <FileButton
                  item={item}
                  entries={entries}
                  granted={granted}
                  declared={declared}
                  busy={busy}
                  hasDraft={false}
                  variant="outline"
                  onFile={() => onFile(null)}
                  onDeclare={onDeclare}
                />
              </EmptyContent>
            </Empty>
          )}
          {live.length > 0 && listed.length === 0 && (
            <p className="text-sm text-muted-foreground">{format(m.myEntriesFilterNone)}</p>
          )}

          {/* Columns follow the count: cards keep their block proportions
              at ~340px instead of one claim stretching into a ribbon, and
              the dashed card at the end holds the next place - or says the
              places are gone - so capacity is read where claims are read. */}
          {listed.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] items-stretch gap-3">
              {listed.map((entry) => (
                <ClaimCard
                  key={entry.id}
                  entry={entry}
                  item={item}
                  score={entryScore(standing, entry.id) ?? (each === undefined ? null : each)}
                  onOpen={() => onDetail(entry)}
                />
              ))}
              {showing === 'all' && (
                <AddCard
                  item={item}
                  entries={entries}
                  declared={declared}
                  granted={granted}
                  recorded={recorded}
                  busy={busy}
                  hasDraft={live.some((entry) => entry.status === 'draft')}
                  onFile={() => onFile(null)}
                  onDeclare={onDeclare}
                />
              )}
            </div>
          )}
        </div>

        {/* what the question is and how it scores, kept beside the claims:
            reading a claim against the rule should not cost a journey */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <div className="flex flex-col gap-2 rounded-xl bg-muted/60 px-3.5 py-3">
            <p className="text-sm font-semibold">{format(m.itemDescTitle)}</p>
            {description !== '' && (
              <p className="text-sm leading-relaxed text-pretty">{description}</p>
            )}
            <p
              className={cn(
                'text-xs leading-relaxed text-pretty text-muted-foreground',
                description !== '' && 'border-t pt-2',
              )}
            >
              {format(m.myEntriesBasisSoon)}
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-sm font-semibold">{format(m.itemScoringTitle)}</p>
            {each !== undefined && <ScoreRow label={format(m.itemScoreEach)} value={two(each)} />}
            {each !== undefined && item.maxEntries !== null && (
              <ScoreRow
                label={format(m.itemScoreMaxHere)}
                value={two(String(Number(each) * item.maxEntries))}
              />
            )}
            {group !== null && (
              <ScoreRow
                label={format(m.itemGroupSubtotal, { group: group.name })}
                value={two(group.final)}
              />
            )}
            {group?.cap != null && (
              <ScoreRow
                label={format(m.itemGroupCapNamed, { group: group.name })}
                value={two(group.cap)}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

/** one scoring fact, ruled across to its number */
function ScoreRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span aria-hidden className="h-px min-w-0 flex-1 bg-border" />
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

/** amounts on this screen speak with two decimals, the way the ledger does */
const two = (value: string): string => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value
}

/**
 * One claim, as just enough to be told apart: its standing, when, why it
 * came back, what it is worth, the designated list fields, and one row that
 * is the way into everything else.
 */
function ClaimCard({
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
  const tone = toneOf(entry)
  const revisionNo = entry.currentRevision?.revisionNo
  // the designated list fields; until the question names them, its first
  // three stand in - the drawer always has the rest
  const shown = fields.slice(0, 3)
  const more = fields.length - shown.length

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2.5 rounded-xl border p-3.5',
        tone === 'draft' ? 'border-dashed bg-muted/30' : 'bg-card',
        tone === 'attention' && 'border-destructive/35',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <EntryStanding
          status={entry.status}
          revised={entry.currentReviewInstanceId !== null}
          asked={entry.supplement !== null}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {entry.status === 'draft' || revisionNo === undefined
            ? format(m.entryDraftSavedFoot, { at: when(entry) })
            : `${format(m.entryVersionNo, { no: revisionNo })}　${when(entry)}`}
        </span>
        {entry.refusal?.reason != null && (
          <span className="shrink-0 rounded-md bg-destructive/8 px-1.5 py-px text-xs whitespace-nowrap text-destructive">
            {entry.refusal.reason}
          </span>
        )}
        {score !== null && (
          <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-xs text-muted-foreground">
              {format(
                tone === 'ok'
                  ? m.entryScoreCounted
                  : tone === 'wait'
                    ? m.entryScorePending
                    : m.entryScoreIfApproved,
              )}
            </span>
            <span
              className={cn(
                'text-[15px] tabular-nums',
                tone === 'ok' ? 'font-semibold' : 'font-medium text-muted-foreground',
              )}
            >
              {trimAmount(score)}
            </span>
          </span>
        )}
      </div>

      <dl className="flex flex-col gap-1.5">
        {shown.map((field) => {
          const value = payload[field.key]
          return (
            <div key={field.key} className="flex min-w-0 items-baseline gap-2.5">
              <dt className="w-20 shrink-0 truncate text-sm text-muted-foreground">
                {field.label}
              </dt>
              <dd className="min-w-0 flex-1 truncate text-sm">
                {field.type === 'attachment' ? (
                  Array.isArray(value) && value.length > 0 ? (
                    format(m.reviewFilesCount, { count: value.length })
                  ) : (
                    <span className="text-muted-foreground">{format(m.myEntriesFilesNone)}</span>
                  )
                ) : typeof value === 'string' && value !== '' ? (
                  value
                ) : (
                  <span className="text-muted-foreground">{format(m.entryFieldCleared)}</span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      {/* the whole row is the way in: what the card has no room for is one
          press away, never a maze of buttons on the card itself */}
      <button
        type="button"
        onClick={onOpen}
        className="mt-auto flex w-full cursor-pointer items-center gap-2.5 border-t pt-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {more > 0
            ? format(m.myEntriesMoreFields, { count: more })
            : format(m.myEntriesNoMoreFields)}
        </span>
        <span className="shrink-0 text-xs font-medium whitespace-nowrap">
          {format(m.myEntriesViewDetail)}
        </span>
        <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </div>
  )
}

/**
 * The place after the last claim: dashed, because it is not a claim yet.
 * With room it is the way to the next one and says how many are left; full,
 * it stays and says so - a place that vanished would leave the reader
 * counting cards against a number somewhere else on screen.
 */
function AddCard({
  item,
  entries,
  declared,
  granted,
  recorded,
  busy,
  hasDraft,
  onFile,
  onDeclare,
}: {
  item: ItemDto
  entries: readonly EntryDto[]
  declared: boolean
  granted: boolean
  recorded: boolean
  busy: boolean
  hasDraft: boolean
  onFile: () => void
  onDeclare: () => void
}) {
  const { format } = useI18n()
  if (granted || recorded) return null
  if (item.status !== 'active' || item.currentRevision?.entrySource !== 'student') return null
  const room = roomLeft(item, entries)
  const open = mayFile(item, entries) && !(declared && hasDraft)
  const full = room !== null && room <= 0
  if (!open && !full) return null
  const inner = (
    <>
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full bg-muted',
          open ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {open ? (
          <PlusIcon aria-hidden className="size-3.5" />
        ) : (
          <CheckIcon aria-hidden className="size-3.5" />
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-px text-left">
        <span className={cn('text-sm font-medium', !open && 'text-muted-foreground')}>
          {format(open ? m.myEntriesAddMore : m.myEntriesAddFull)}
        </span>
        <span className="text-xs text-muted-foreground">
          {open
            ? room !== null
              ? format(m.myEntriesAddRoom, { count: room })
              : format(m.itemsPreviewNoMax)
            : format(m.myEntriesAddFullHint, { count: item.maxEntries ?? 0 })}
        </span>
      </span>
    </>
  )
  if (!open) {
    return (
      <div className="flex min-w-0 items-center justify-center gap-2.5 rounded-xl border border-dashed p-3.5">
        {inner}
      </div>
    )
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={declared ? onDeclare : onFile}
      className="flex min-w-0 cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-dashed p-3.5 transition-colors hover:bg-accent/50"
    >
      {inner}
    </button>
  )
}

/** one way in, whatever is already filed; full places keep the button with
    the reason on hover - a control that vanishes reads as a page that lost
    something */
function FileButton({
  item,
  entries,
  granted,
  declared,
  busy,
  hasDraft,
  variant = 'default',
  onFile,
  onDeclare,
}: {
  item: ItemDto
  entries: readonly EntryDto[]
  granted: boolean
  declared: boolean
  busy: boolean
  hasDraft: boolean
  variant?: 'default' | 'outline'
  onFile: () => void
  onDeclare: () => void
}) {
  const { format } = useI18n()
  if (granted) return null
  if (declared) {
    return mayFile(item, entries) && !hasDraft ? (
      <Button size="sm" variant={variant} className="shrink-0" disabled={busy} onClick={onDeclare}>
        <PlusIcon aria-hidden />
        {format(m.entryDeclare)}
      </Button>
    ) : null
  }
  if (mayFile(item, entries)) {
    return (
      <Button size="sm" variant={variant} className="shrink-0" onClick={onFile}>
        <PlusIcon aria-hidden />
        {format(m.entryNew)}
      </Button>
    )
  }
  if (
    item.status === 'active' &&
    item.currentRevision?.entrySource === 'student' &&
    item.maxEntries !== null
  ) {
    return (
      <TooltipProvider>
        <Tooltip>
          {/* a disabled button swallows pointer events, so the span around
              it is what the tooltip listens to */}
          <TooltipTrigger asChild>
            <span tabIndex={0} className="shrink-0">
              <Button size="sm" disabled className="pointer-events-none">
                <PlusIcon aria-hidden />
                {format(m.entryNew)}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{format(m.refuseMaxEntries)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return null
}

/**
 * What a claim's card looks like it is: granted, waiting on somebody else,
 * waiting on the reader, or not handed on yet.
 */
type CardTone = 'ok' | 'wait' | 'draft' | 'attention'

const toneOf = (entry: EntryDto): CardTone =>
  entry.status === 'approved'
    ? 'ok'
    : entry.supplement !== null || entry.status === 'rejected' || entry.status === 'needs_revision'
      ? 'attention'
      : entry.status === 'in_review'
        ? 'wait'
        : 'draft'

const when = (entry: EntryDto): string =>
  new Date(entry.currentRevision?.createdAt ?? entry.createdAt).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
