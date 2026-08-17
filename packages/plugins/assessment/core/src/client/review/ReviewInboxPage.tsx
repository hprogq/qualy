import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CornerDownLeftIcon, FileTextIcon, SearchIcon, ShieldIcon } from 'lucide-react'
import { useApiQuery, usePageNavigate, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Skeleton } from '@qualy/ui/skeleton'
import { DoneMark, Stagger } from '@qualy/ui/reveal'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AwaitingSection } from './AwaitingSection.tsx'
import {
  groupByDay,
  groupByItem,
  groupByPerson,
  matchesSearch,
  rowSummary,
  timeLabel,
  clockLabel,
  writeRunScope,
  type InboxItemDto,
} from './model.ts'

// The queue, laid out three ways: by question so one standard is applied in
// a row, by submitted time to clear a backlog oldest first, by participant
// so one person's duplicates sit next to each other. Every row opens the
// same workbench; the layout only decides which rows it walks in a run.

type View = 'item' | 'time' | 'person'

export default function ReviewInboxPage() {
  const { format } = useI18n()
  const [view, setView] = usePageQueryState('view', 'item')
  return (
    <BatchScreen title={format(m.reviewTab)} description={format(m.reviewHint)} size="wide">
      {(batch) =>
        batch.capabilities.review ? (
          <Queue batchId={batch.id} view={(view as View) || 'item'} onView={setView} />
        ) : (
          // said as what it is: no standing here, not an empty queue -
          // pretending otherwise makes permission problems look like quiet
          // days
          <EmptyScreen
            icon={<ShieldIcon aria-hidden className="size-5" />}
            title={format(m.reviewNoRoleTitle)}
            body={format(m.reviewNoStandingHint)}
          />
        )
      }
    </BatchScreen>
  )
}

function Queue({
  batchId,
  view,
  onView,
}: {
  batchId: string
  view: View
  onView: (next: string) => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const [itemFilter, setItemFilter] = usePageQueryState('item')
  const [unitFilter, setUnitFilter] = usePageQueryState('unit')
  const [search, setSearch] = usePageQueryState('q')
  const inbox = useQuery({
    ...query.assessment.listReviewInbox.queryOptions({ query: { batchId } }),
    refetchInterval: 30_000,
  })
  // the same read the section below makes; one request either way, and the
  // header can say how much is out with somebody else without owning the list
  const asked = useQuery({
    ...query.assessment.listAwaitingSupplements.queryOptions({ query: { batchId } }),
    refetchInterval: 30_000,
  })
  const awaiting = asked.data?.items.length ?? 0
  const all = useMemo(
    () => (inbox.data?.items ?? []).filter((item) => item.batchId === batchId),
    [inbox.data, batchId],
  )
  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          (itemFilter === '' || row.itemId === itemFilter) &&
          (unitFilter === '' || row.unitId === unitFilter) &&
          matchesSearch(row, search.trim()),
      ),
    [all, itemFilter, unitFilter, search],
  )
  const itemOptions = useMemo(
    () =>
      [...new Map(all.map((row) => [row.itemId, row.itemTitle])).entries()]
        .map(([id, title]) => [id, title] as const)
        .sort(([, a], [, b]) => a.localeCompare(b)),
    [all],
  )
  const unitOptions = useMemo(
    () =>
      [
        ...new Map(
          all.flatMap((row) => (row.unitId === null ? [] : [[row.unitId, row.unitName ?? '']])),
        ).entries(),
      ]
        .map(([id, name]) => [id, String(name)] as const)
        .sort(([, a], [, b]) => a.localeCompare(b)),
    [all],
  )

  return (
    <AsyncSection
      pending={inbox.isPending}
      error={inbox.error ? formatError(inbox.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void inbox.refetch()}
      skeleton={<Skeleton className="h-32 w-full" />}
      className="flex flex-1 flex-col"
    >
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={onView}>
            <TabsList>
              <TabsTrigger value="item">{format(m.reviewTabByItem)}</TabsTrigger>
              <TabsTrigger value="time">{format(m.reviewTabByTime)}</TabsTrigger>
              <TabsTrigger value="person">{format(m.reviewTabByPerson)}</TabsTrigger>
            </TabsList>
          </Tabs>
          {/* every control on this row is the same height as the tabs beside
              it: a row of filters that do not line up reads as two rows */}
          {view !== 'person' && (
            <Filter
              label={format(m.reviewFilterAllItems)}
              value={itemFilter}
              options={itemOptions}
              onChange={setItemFilter}
            />
          )}
          {view !== 'time' && unitOptions.length > 0 && (
            <Filter
              label={format(m.reviewFilterAllUnits)}
              value={unitFilter}
              options={unitOptions}
              onChange={setUnitFilter}
            />
          )}
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="h-9 w-60 pl-8.5"
              value={search}
              placeholder={format(m.reviewSearchPlaceholder)}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <span className="flex-1" />
          <Stats
            pending={all.length}
            handledToday={inbox.data?.handledToday ?? 0}
            awaiting={awaiting}
          />
        </div>

        {/* An empty queue is only half the story: work this step asked
            somebody else for is still work, and a full-screen "all done"
            over the top of it would hide the very filings that are waiting
            on a reply. So the empty screen shrinks to a line whenever there
            is anything outstanding underneath. */}
        {all.length === 0 ? (
          // two different quiet days: everything handled, or nothing has
          // arrived yet. The counter is what tells them apart
          awaiting > 0 ? (
            <p className="rounded-xl border px-5 py-4 text-sm text-muted-foreground">
              {format(
                (inbox.data?.handledToday ?? 0) > 0 ? m.reviewAllDoneTitle : m.reviewNothingTitle,
              )}
            </p>
          ) : (inbox.data?.handledToday ?? 0) > 0 ? (
            <EmptyScreen
              mark={<DoneMark />}
              title={format(m.reviewAllDoneTitle)}
              body={format(m.reviewAllDoneBody, { count: inbox.data?.handledToday ?? 0 })}
            />
          ) : (
            <EmptyScreen
              icon={<FileTextIcon aria-hidden className="size-5" />}
              title={format(m.reviewNothingTitle)}
              body={format(m.reviewNothingBody)}
            />
          )
        ) : rows.length === 0 ? (
          <p className="rounded-xl border px-5 py-4 text-sm text-muted-foreground">
            {format(m.reviewMatchesNone)}
          </p>
        ) : view === 'item' ? (
          <ByItem batchId={batchId} rows={rows} />
        ) : view === 'time' ? (
          <ByTime batchId={batchId} rows={rows} />
        ) : (
          <ByPerson batchId={batchId} rows={rows} />
        )}

        {/* below the queue, never inside it, and never filtered with it: the
            question/unit filters are about what can be decided now */}
        <AwaitingSection batchId={batchId} />
      </div>
    </AsyncSection>
  )
}

/** how much is waiting and how much moved, beside the filters they describe */
function Stats({
  pending,
  handledToday,
  awaiting,
}: {
  pending: number
  handledToday: number
  /** out with somebody else; shown only when there is any, never as a zero */
  awaiting: number
}) {
  const { format } = useI18n()
  return (
    <div className="flex items-end gap-5">
      <Stat label={format(m.reviewStatPending)} value={pending} />
      {awaiting > 0 && <Stat label={format(m.reviewAwaitingTitle)} value={awaiting} />}
      <Stat label={format(m.reviewStatToday)} value={handledToday} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="text-xs whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="text-base leading-none font-semibold tabular-nums">{value}</span>
    </span>
  )
}

/** where the round stands, as one small chip on the row */
function StateChip({ row }: { row: InboxItemDto }) {
  const { format } = useI18n()
  if (row.route === 'escalation') {
    return <Badge variant="outline">{format(m.reviewStateEscalated)}</Badge>
  }
  if (row.roundNo > 1) {
    return <Badge variant="outline">{format(m.reviewStateRound, { round: row.roundNo })}</Badge>
  }
  return <Badge variant="secondary">{format(m.reviewStateWaiting)}</Badge>
}

function useOpenRow(batchId: string) {
  const navigate = usePageNavigate()
  return (row: InboxItemDto, run: string) =>
    navigate('assessment/review-instance', {
      params: { batchId, instanceId: row.instanceId },
      search: run === '' ? {} : { run },
    })
}

/** a whole row is one press; the chevron affordance is the row's hover */
const ROW =
  'grid w-full cursor-pointer items-center gap-3 border-b px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/50'

function ByItem({ batchId, rows }: { batchId: string; rows: readonly InboxItemDto[] }) {
  const { format } = useI18n()
  const open = useOpenRow(batchId)
  const groups = groupByItem(rows)
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const run = writeRunScope({ kind: 'item', itemId: group.itemId })
        return (
          <section key={group.itemId} className="overflow-hidden rounded-xl border">
            <header className="flex flex-wrap items-center gap-3 border-b bg-muted/50 px-4 py-2.5">
              <h3 className="min-w-0 truncate text-sm font-semibold">{group.itemTitle}</h3>
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {format(m.reviewGroupCount, { count: group.rows.length })}
              </span>
              <span className="flex-1" />
              <Button size="sm" variant="outline" onClick={() => open(group.rows[0]!, run)}>
                {format(m.reviewRunStart)}
                <Badge variant="secondary" className="tabular-nums">
                  {group.rows.length}
                </Badge>
                <CornerDownLeftIcon aria-hidden />
              </Button>
            </header>
            <div
              className="grid items-center gap-3 border-b px-4 py-1.5 text-xs text-muted-foreground"
              style={{ gridTemplateColumns: GRID_ITEM }}
            >
              <span>{format(m.reviewColumnParticipant)}</span>
              <span className="flex min-w-0 gap-3">
                {group.columns.map((column, index) => (
                  <span key={index} className="min-w-0 flex-1 truncate">
                    {column}
                  </span>
                ))}
              </span>
              <span>{format(m.reviewColumnFiles)}</span>
              <span>{format(m.reviewColumnWhen)}</span>
              <span />
            </div>
            <ul>
              {group.rows.map((row) => (
                <li key={row.instanceId}>
                  <button
                    type="button"
                    className={ROW}
                    style={{ gridTemplateColumns: GRID_ITEM }}
                    onClick={() => open(row, run)}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 truncate font-medium">{row.participantName}</span>
                      {row.businessNo !== null && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {row.businessNo}
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 gap-3">
                      {row.values.map((pair, index) => (
                        <span key={index} className="min-w-0 flex-1 truncate">
                          {pair.value}
                        </span>
                      ))}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      {format(m.reviewFilesCount, { count: row.attachmentCount })}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {timeLabel(row.submittedAt)}
                    </span>
                    <span className="flex justify-end">
                      <StateChip row={row} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

const GRID_ITEM = '11rem minmax(0,1fr) 4rem 7rem 6rem'
const GRID_TIME = '4rem 11rem 12rem minmax(0,1fr) 6rem'
const GRID_PERSON = '12rem minmax(0,1fr) 4rem 7rem 6rem'

function ByTime({ batchId, rows }: { batchId: string; rows: readonly InboxItemDto[] }) {
  const { format } = useI18n()
  const open = useOpenRow(batchId)
  const days = groupByDay(rows)
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => (
        <section key={day.day} className="overflow-hidden rounded-xl border">
          <header className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2.5">
            <h3 className="text-sm font-semibold tabular-nums">{day.day}</h3>
            <span className="text-xs text-muted-foreground">
              {format(m.reviewGroupCount, { count: day.rows.length })}
            </span>
          </header>
          <div
            className="grid items-center gap-3 border-b px-4 py-1.5 text-xs text-muted-foreground"
            style={{ gridTemplateColumns: GRID_TIME }}
          >
            <span>{format(m.reviewColumnTime)}</span>
            <span>{format(m.reviewColumnParticipant)}</span>
            <span>{format(m.reviewColumnItem)}</span>
            <span>{format(m.reviewColumnSummary)}</span>
            <span />
          </div>
          <ul>
            {day.rows.map((row) => (
              <li key={row.instanceId}>
                <button
                  type="button"
                  className={ROW}
                  style={{ gridTemplateColumns: GRID_TIME }}
                  onClick={() => open(row, '')}
                >
                  <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {clockLabel(row.submittedAt)}
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 truncate font-medium">{row.participantName}</span>
                    {row.businessNo !== null && (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {row.businessNo}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 truncate">{row.itemTitle}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{rowSummary(row)}</span>
                  <span className="flex justify-end">
                    <StateChip row={row} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ByPerson({ batchId, rows }: { batchId: string; rows: readonly InboxItemDto[] }) {
  const { format } = useI18n()
  const open = useOpenRow(batchId)
  const people = groupByPerson(rows)
  return (
    <div className="flex flex-col gap-4">
      {people.map((person) => {
        const run = writeRunScope({ kind: 'person', businessNo: person.key })
        return (
          <section key={person.key} className="overflow-hidden rounded-xl border">
            <header className="flex flex-wrap items-center gap-3 border-b bg-muted/50 px-4 py-2">
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">{person.name.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <h3 className="text-sm font-semibold">{person.name}</h3>
              {person.businessNo !== null && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {person.businessNo}
                </span>
              )}
              {person.unitName !== null && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {person.unitName}
                </span>
              )}
              <span className="flex-1" />
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {format(m.reviewGroupCount, { count: person.rows.length })}
              </span>
              <Button size="sm" variant="outline" onClick={() => open(person.rows[0]!, run)}>
                {format(m.reviewRunStart)}
                <Badge variant="secondary" className="tabular-nums">
                  {person.rows.length}
                </Badge>
                <CornerDownLeftIcon aria-hidden />
              </Button>
            </header>
            <div
              className="grid items-center gap-3 border-b px-4 py-1.5 text-xs text-muted-foreground"
              style={{ gridTemplateColumns: GRID_PERSON }}
            >
              <span>{format(m.reviewColumnItem)}</span>
              <span>{format(m.reviewColumnSummary)}</span>
              <span>{format(m.reviewColumnFiles)}</span>
              <span>{format(m.reviewColumnWhen)}</span>
              <span />
            </div>
            <ul>
              {person.rows.map((row) => (
                <li key={row.instanceId}>
                  <button
                    type="button"
                    className={ROW}
                    style={{ gridTemplateColumns: GRID_PERSON }}
                    onClick={() => open(row, run)}
                  >
                    <span className="min-w-0 truncate font-medium">{row.itemTitle}</span>
                    <span className="min-w-0 truncate text-muted-foreground">
                      {rowSummary(row)}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      {format(m.reviewFilesCount, { count: row.attachmentCount })}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {timeLabel(row.submittedAt)}
                    </span>
                    <span className="flex justify-end">
                      <StateChip row={row} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/**
 * A quiet day, said in full: the screen a reviewer lands on when there is
 * nothing to do is the screen they see most often, so it gets the room.
 */
function EmptyScreen({
  icon,
  mark,
  title,
  body,
}: {
  icon?: ReactNode
  /** a drawn mark instead of a still icon, where the emptiness was earned */
  mark?: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Stagger className="flex max-w-md flex-col items-center gap-5 text-center" step={0.08}>
        {mark ?? (
          <span className="flex size-13 items-center justify-center rounded-full border text-muted-foreground">
            {icon}
          </span>
        )}
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{body}</p>
        </div>
      </Stagger>
    </div>
  )
}

/**
 * One narrowing of the queue: everything, or one of something.
 *
 * The empty value is the whole list rather than a blank, so the control
 * always says what the reader is looking at instead of what they are not.
 */
function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  onChange: (next: string) => void
}) {
  return (
    <Select
      value={value === '' ? ALL : value}
      onValueChange={(next) => onChange(next === ALL ? '' : next)}
    >
      <SelectTrigger aria-label={label} className="max-w-52">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {options.map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** radix refuses an empty option value, so "no filter" needs a name of its own */
const ALL = 'all'
