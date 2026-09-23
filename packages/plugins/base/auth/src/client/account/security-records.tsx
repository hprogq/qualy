import { Fragment, useState, type ReactNode } from 'react'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { cursorPages, PageLink, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  Card,
  CardEmpty,
  CardFoot,
  CardHead,
  DetailSheet,
  Spacer,
  Status,
  TableSkeleton,
} from '@qualy/ui/screen'
import type { ApiResult } from '@qualy/web-runtime/api'
import { toast } from '@qualy/ui/toast'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { DateRangePicker, type DateRange } from '@qualy/ui/date-range-picker'
import { Pager } from '@qualy/ui/pager'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { instantWords } from '../when.ts'
import { deviceWords } from './device.ts'

// What is signed in as the reader now, for the security page, and the record
// of every time somebody came in, for its own page. A session is named by the
// browser and the system it runs in - words a person knows as theirs - with
// the door it came through, the address it came from, and when. Two sessions
// in the same browser are two rows: they are sessions, not devices.

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingInline: 16,
    paddingBlock: 10,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  words: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 3 },
  line: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8, fontSize: 14 },
  device: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 2,
    fontSize: 12.5,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  end: { flexShrink: 0 },
  when: { fontVariantNumeric: 'tabular-nums' },
  whole: { display: 'flex', flexDirection: 'column', gap: 12 },
  // the record's own controls: which ones, and which days
  tools: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  // the days at the row's far end, apart from what narrows the rows; the
  // whole row on a phone
  // As wide as the days it says, on one line: where that does not fit beside
  // the toggles the whole field goes to the next line, rather than folding
  // its dates in two. A phone gives it the whole row.
  period: {
    width: { default: 'max-content', '@media (max-width: 767.98px)': '100%' },
    minWidth: 170,
    flexShrink: 0,
    flexBasis: { default: 'auto', '@media (max-width: 767.98px)': '100%' },
    whiteSpace: 'nowrap',
    marginInlineStart: { default: 'auto', '@media (max-width: 767.98px)': 0 },
  },
  // a way on beside the card's title, in the size of what stands there
  all: {
    fontSize: 13,
    fontWeight: 500,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    textDecoration: 'none',
  },
})

/** the door, the address and the time of one row, whichever are known */
function Meta({ parts }: { parts: readonly (string | null)[] }) {
  return (
    <span {...stylex.props(styles.meta)}>
      {parts
        .filter((part): part is string => part !== null && part !== '')
        .map((part) => (
          <span key={part}>{part}</span>
        ))}
    </span>
  )
}

/**
 * The reader's sessions still open, with a way to end any but the one in
 * hand, or all of those at once.
 */
export function SessionsCard() {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()
  const [confirming, setConfirming] = useState(false)
  const sessions = useInfiniteQuery({
    queryKey: [...query.self.listSelfSessions.key({ query: {} }), 'infinite'],
    queryFn: ({ pageParam }) =>
      run(
        api.self.listSelfSessions({ query: pageParam === undefined ? {} : { cursor: pageParam } }),
      ),
    ...cursorPages,
  })
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? []
  const others = items.filter((session) => !session.current).length
  const refresh = () => queryClient.invalidateQueries({ queryKey: query.self.key() })
  const endOne = useMutation({
    mutationFn: (sessionId: string) => run(api.self.deleteSelfSession({ params: { sessionId } })),
    onSuccess: async () => {
      toast.success(format(m.sessionEnded))
      await refresh()
    },
    onError: (error: unknown) => toast.error(formatError(error)),
  })
  const endOthers = useMutation({
    mutationFn: () => run(api.self.deleteSelfSessions({})),
    onSuccess: async ({ ended }) => {
      toast.success(format(m.sessionsEnded, { count: ended }))
      await refresh()
    },
    onError: (error: unknown) => toast.error(formatError(error)),
  })

  return (
    <Card data-testid="sessions-card">
      <CardHead title={format(m.sessionsTitle)}>
        {/* the history of how they came in is its own page; this card is
            what is signed in now */}
        <PageLink
          page="auth/account-activity"
          unavailable={null}
          className={stylex.props(styles.all).className}
        >
          {format(m.sessionsActivity)}
        </PageLink>
      </CardHead>
      <AsyncSection
        pending={sessions.isPending}
        error={sessions.isError ? formatError(sessions.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void sessions.refetch()}
        skeleton={<TableSkeleton rows={2} />}
      >
        {items.map((session) => (
          <div
            key={session.id}
            data-testid="session-row"
            data-current={session.current}
            {...stylex.props(styles.row)}
          >
            <span {...stylex.props(styles.words)}>
              <span {...stylex.props(styles.line)}>
                <span {...stylex.props(styles.device)}>
                  {deviceWords(session.userAgent) ?? format(m.unknownDevice)}
                </span>
                {session.current && <Status tone="ok">{format(m.sessionCurrent)}</Status>}
              </span>
              <Meta
                parts={[
                  session.entrance?.name ?? format(m.entranceGone),
                  session.clientIp,
                  format(m.sessionActive, {
                    when: instantWords(locale, session.lastUsedAt ?? session.createdAt),
                  }),
                ]}
              />
            </span>
            {!session.current && (
              <Button
                size="xs"
                variant="ghost"
                disabled={endOne.isPending}
                onClick={() => endOne.mutate(session.id)}
                className={stylex.props(styles.end).className}
              >
                {format(m.sessionEnd)}
              </Button>
            )}
          </div>
        ))}
        {(sessions.hasNextPage || others > 0) && (
          <CardFoot inset>
            {sessions.hasNextPage && (
              <Button
                size="xs"
                variant="ghost"
                disabled={sessions.isFetchingNextPage}
                onClick={() => void sessions.fetchNextPage()}
              >
                {format(m.showMore)}
              </Button>
            )}
            <Spacer />
            {others > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={endOthers.isPending}
                onClick={() => setConfirming(true)}
              >
                {format(m.sessionsEndOthers)}
              </Button>
            )}
          </CardFoot>
        )}
      </AsyncSection>
      <ConfirmDialog
        open={confirming}
        tone="destructive"
        title={format(m.sessionsEndOthersTitle)}
        description={format(m.sessionsEndOthersBody)}
        confirmLabel={format(m.sessionsEndOthers)}
        cancelLabel={format(m.cancel)}
        pending={endOthers.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          endOthers.mutate()
        }}
      />
    </Card>
  )
}

/** a page of the reader's own records, in the sheet that holds all of them */
const PAGE_SIZE = 20
/** how many of each record the page shows before the way to the rest */
const RECENT = 5

/**
 * The days a reader picked, as the instants the server reads: from the first
 * moment of the first day to the first moment after the last, in the
 * reader's own time.
 */
const periodOf = (range: DateRange) => ({
  ...(range.start === '' ? {} : { from: new Date(`${range.start}T00:00:00`).toISOString() }),
  ...(range.end === ''
    ? {}
    : {
        to: new Date(
          new Date(`${range.end}T00:00:00`).getTime() + 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
})

type SignIn = ApiResult<typeof authApi, 'self', 'listSelfSignIns'>['items'][number]
type Change = ApiResult<typeof authApi, 'self', 'listSelfAccountChanges'>['items'][number]

/** the days to read within */
function Period({ range, onChange }: { range: DateRange; onChange: (next: DateRange) => void }) {
  const { format, locale } = useI18n()
  return (
    <DateRangePicker
      value={range}
      onChange={onChange}
      placeholder={format(m.activityPeriod)}
      localeTag={locale}
      monthLabel={format(commonMessages.calendarMonth)}
      yearLabel={format(commonMessages.calendarYear)}
      xstyle={styles.period}
    />
  )
}

/** the strip a full record ends on: which of how many, and the pages */
function Pages({
  page,
  total,
  shown,
  busy,
  onPage,
}: {
  page: number
  total: number
  shown: number
  busy: boolean
  onPage: (page: number) => void
}) {
  const { format } = useI18n()
  if (total <= PAGE_SIZE) return null
  return (
    <Pager
      testId="records-pager"
      label={format(m.pagerLabel)}
      page={page}
      pageSize={PAGE_SIZE}
      total={total}
      disabled={busy}
      summary={format(m.recordsSummary, {
        from: (page - 1) * PAGE_SIZE + 1,
        to: (page - 1) * PAGE_SIZE + shown,
        total,
      })}
      onPage={onPage}
    />
  )
}

/** one attempt: when first - a record is read by time - then from what, through which door */
function SignInRow({ attempt }: { attempt: SignIn }) {
  const { format, locale } = useI18n()
  return (
    <div
      data-testid="sign-in-row"
      data-outcome={attempt.outcome}
      data-current={attempt.current}
      {...stylex.props(styles.row)}
    >
      <span {...stylex.props(styles.words)}>
        <span {...stylex.props(styles.line)}>
          <span {...stylex.props(styles.device, styles.when)}>
            {instantWords(locale, attempt.occurredAt)}
          </span>
          {attempt.current && <Status tone="plain">{format(m.signInThisSession)}</Status>}
        </span>
        <Meta
          parts={[
            deviceWords(attempt.userAgent) ?? format(m.unknownDevice),
            attempt.entrance?.name ?? format(m.entranceGone),
            attempt.clientIp,
          ]}
        />
      </span>
      <Status tone={attempt.outcome === 'success' ? 'ok' : 'bad'}>
        {format(attempt.outcome === 'success' ? m.signInSucceeded : m.signInRefused)}
      </Status>
    </div>
  )
}

/** one change: when, what, and whether the reader did it */
function ChangeRow({ change }: { change: Change }) {
  const { format, formatText, locale } = useI18n()
  return (
    <div data-testid="account-change" data-actor={change.actor} {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.words)}>
        <span {...stylex.props(styles.line, styles.when)}>
          {instantWords(locale, change.occurredAt)}
        </span>
        <span {...stylex.props(styles.meta)}>
          <span>{formatText(change.name)}</span>
          <span>{format(change.actor === 'self' ? m.changeBySelf : m.changeByOther)}</span>
        </span>
      </span>
    </div>
  )
}

/**
 * One record on the page: its latest few, and the way to all of it - which
 * opens beside the page, or from the foot on a phone, with its own filters
 * and pages, so the page itself stays short.
 */
function RecordCard<Item extends { readonly id: string }>({
  testId,
  title,
  empty,
  recent,
  row,
  whole,
}: {
  testId: string
  title: string
  empty: string
  recent: {
    readonly isPending: boolean
    readonly isError: boolean
    readonly error: unknown
    readonly data?: { readonly items: readonly Item[]; readonly total: number } | undefined
    readonly refetch: () => unknown
  }
  row: (item: Item) => ReactNode
  /** the whole record, for the sheet */
  whole: ReactNode
}) {
  const { format, formatError } = useI18n()
  const [open, setOpen] = useState(false)
  const items = recent.data?.items ?? []
  return (
    <Card data-testid={testId}>
      {/* always there: the sheet is where the record is searched by day and
          outcome, not only where the rest of it is */}
      <CardHead title={title}>
        {recent.data !== undefined && (
          <Button
            size="xs"
            variant="ghost"
            data-testid={`${testId}-all`}
            onClick={() => setOpen(true)}
          >
            {format(m.recordsAll)}
          </Button>
        )}
      </CardHead>
      <AsyncSection
        pending={recent.isPending}
        error={recent.isError ? formatError(recent.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void recent.refetch()}
        skeleton={<TableSkeleton rows={3} />}
      >
        {items.length === 0 ? (
          <CardEmpty>{empty}</CardEmpty>
        ) : (
          items.map((item) => <Fragment key={item.id}>{row(item)}</Fragment>)
        )}
      </AsyncSection>
      <DetailSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        // a record's rows are a line or two of short words; a wide panel
        // left half of it empty
        width="regular"
        // a height of its own: filled from a request, and filtered after, it
        // would otherwise grow under the reader as the rows arrive
        fill
        closeLabel={format(commonMessages.close)}
        testId={`${testId}-sheet`}
      >
        {open && whole}
      </DetailSheet>
    </Card>
  )
}

/** the reader's sign-ins: the latest few here, all of them in the sheet */
export function SignInRecords() {
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  const recent = useQuery(
    query.self.listSelfSignIns.queryOptions({
      query: { page: '1', limit: String(RECENT) },
    }),
  )
  return (
    <RecordCard
      testId="sign-ins-card"
      title={format(m.activitySignIns)}
      empty={format(m.signInsEmpty)}
      recent={recent}
      row={(attempt: SignIn) => <SignInRow attempt={attempt} />}
      whole={<AllSignIns />}
    />
  )
}

/** what was done to the reader's account: the latest few here, all of it in the sheet */
export function AccountChanges() {
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  const recent = useQuery(
    query.self.listSelfAccountChanges.queryOptions({
      query: { page: '1', limit: String(RECENT) },
    }),
  )
  return (
    <RecordCard
      testId="account-changes"
      title={format(m.activityChanges)}
      empty={format(m.changesEmpty)}
      recent={recent}
      row={(change: Change) => <ChangeRow change={change} />}
      whole={<AllChanges />}
    />
  )
}

/** every sign-in, a numbered page at a time, within the days and outcome asked for */
function AllSignIns() {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const [outcome, setOutcome] = useState<'all' | 'success' | 'failure'>('all')
  const [range, setRange] = useState<DateRange>({ start: '', end: '' })
  const [page, setPage] = useState(1)
  const signIns = useQuery({
    ...query.self.listSelfSignIns.queryOptions({
      query: {
        ...(outcome === 'all' ? {} : { outcome }),
        ...periodOf(range),
        page: String(page),
        limit: String(PAGE_SIZE),
      },
    }),
    placeholderData: keepPreviousData,
  })
  const items = signIns.data?.items ?? []
  return (
    <div {...stylex.props(styles.whole)}>
      <div {...stylex.props(styles.tools)}>
        <ToggleGroup
          value={outcome}
          aria-label={format(m.signInsFilter)}
          onValueChange={(next) => {
            if (next === '') return
            setOutcome(next as typeof outcome)
            setPage(1)
          }}
        >
          <ToggleGroupItem value="all">{format(m.signInsFilterAll)}</ToggleGroupItem>
          <ToggleGroupItem value="success">{format(m.signInsFilterSucceeded)}</ToggleGroupItem>
          <ToggleGroupItem value="failure">{format(m.signInsFilterRefused)}</ToggleGroupItem>
        </ToggleGroup>
        <Period
          range={range}
          onChange={(next) => {
            setRange(next)
            setPage(1)
          }}
        />
      </div>
      <Card data-testid="sign-ins-all">
        <AsyncSection
          pending={signIns.isPending}
          error={signIns.isError ? formatError(signIns.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void signIns.refetch()}
          skeleton={<TableSkeleton rows={6} />}
        >
          {items.length === 0 ? (
            <CardEmpty>{format(m.signInsEmpty)}</CardEmpty>
          ) : (
            items.map((attempt) => <SignInRow key={attempt.id} attempt={attempt} />)
          )}
        </AsyncSection>
      </Card>
      <Pages
        page={signIns.data?.page ?? page}
        total={signIns.data?.total ?? 0}
        shown={items.length}
        busy={signIns.isFetching}
        onPage={setPage}
      />
    </div>
  )
}

/** every change, a numbered page at a time, within the days asked for */
function AllChanges() {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const [range, setRange] = useState<DateRange>({ start: '', end: '' })
  const [page, setPage] = useState(1)
  const changes = useQuery({
    ...query.self.listSelfAccountChanges.queryOptions({
      query: { ...periodOf(range), page: String(page), limit: String(PAGE_SIZE) },
    }),
    placeholderData: keepPreviousData,
  })
  const items = changes.data?.items ?? []
  return (
    <div {...stylex.props(styles.whole)}>
      <div {...stylex.props(styles.tools)}>
        <Period
          range={range}
          onChange={(next) => {
            setRange(next)
            setPage(1)
          }}
        />
      </div>
      <Card data-testid="account-changes-all">
        <AsyncSection
          pending={changes.isPending}
          error={changes.isError ? formatError(changes.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void changes.refetch()}
          skeleton={<TableSkeleton rows={6} />}
        >
          {items.length === 0 ? (
            <CardEmpty>{format(m.changesEmpty)}</CardEmpty>
          ) : (
            items.map((change) => <ChangeRow key={change.id} change={change} />)
          )}
        </AsyncSection>
      </Card>
      <Pages
        page={changes.data?.page ?? page}
        total={changes.data?.total ?? 0}
        shown={items.length}
        busy={changes.isFetching}
        onPage={setPage}
      />
    </div>
  )
}
