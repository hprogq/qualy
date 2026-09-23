import { useState } from 'react'
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
  Spacer,
  Status,
  TableSkeleton,
} from '@qualy/ui/screen'
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
  // the record's own controls: which ones, and which days
  tools: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  period: { width: { default: 260, '@media (max-width: 767.98px)': '100%' } },
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

/** a page of the reader's own records */
const PAGE_SIZE = 20

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

/** the days to read within, shared by both records */
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

/** the strip a record ends on: how many, and the pages */
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
    <CardFoot inset>
      <Pager
        testId="records-pager"
        label={format(m.pagerLabel)}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        disabled={busy}
        summary={format(m.pageSummary, {
          from: (page - 1) * PAGE_SIZE + 1,
          to: (page - 1) * PAGE_SIZE + shown,
          total,
        })}
        onPage={onPage}
      />
    </CardFoot>
  )
}

/**
 * Every attempt to come in as the reader, newest first, a numbered page at
 * a time: all of them, or only those that went one way, within the days
 * asked for. Each is when first - the record is read by time - then what it
 * came from and through which door.
 */
export function SignInRecords() {
  const query = useApiQuery(authApi)
  const { format, formatError, locale } = useI18n()
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
    <>
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
      <Card data-testid="sign-ins-card">
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
            items.map((attempt) => (
              <div
                key={attempt.id}
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
            ))
          )}
          <Pages
            page={signIns.data?.page ?? page}
            total={signIns.data?.total ?? 0}
            shown={items.length}
            busy={signIns.isFetching}
            onPage={setPage}
          />
        </AsyncSection>
      </Card>
    </>
  )
}

/**
 * What was done to the reader's account - their password, their address,
 * their ways in, their sessions - newest first, in the words given for them,
 * and whether they did it or somebody else did.
 */
export function AccountChanges() {
  const query = useApiQuery(authApi)
  const { format, formatError, formatText, locale } = useI18n()
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
    <>
      <div {...stylex.props(styles.tools)}>
        <Period
          range={range}
          onChange={(next) => {
            setRange(next)
            setPage(1)
          }}
        />
      </div>
      <Card data-testid="account-changes">
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
            items.map((change) => (
              <div
                key={change.id}
                data-testid="account-change"
                data-actor={change.actor}
                {...stylex.props(styles.row)}
              >
                <span {...stylex.props(styles.words)}>
                  <span {...stylex.props(styles.line, styles.when)}>
                    {instantWords(locale, change.occurredAt)}
                  </span>
                  <span {...stylex.props(styles.meta)}>
                    <span>{formatText(change.name)}</span>
                    <span>
                      {format(change.actor === 'self' ? m.changeBySelf : m.changeByOther)}
                    </span>
                  </span>
                </span>
              </div>
            ))
          )}
          <Pages
            page={changes.data?.page ?? page}
            total={changes.data?.total ?? 0}
            shown={items.length}
            busy={changes.isFetching}
            onPage={setPage}
          />
        </AsyncSection>
      </Card>
    </>
  )
}
