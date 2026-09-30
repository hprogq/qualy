import { Fragment, useState, type ReactNode } from 'react'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import {
  cursorPages,
  PageLink,
  useApi,
  useApiQuery,
  useLoadFailure,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'

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

import { authApi } from '../api.ts'
import { instantWords } from '../when.ts'
import { deviceWords } from './device.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
 * Whose record this is, when it is not the reader's own: somebody the reader
 * administers, read and acted on through the directory rather than the
 * reader's own account.
 */
export interface RecordPerson {
  readonly userId: string
  readonly name: string
}

/**
 * The sessions still open, with a way to end any but the one in hand, or all
 * of those at once: the reader's own, or those of somebody whose account the
 * reader administers.
 */
export function SessionsCard({ person }: { person?: RecordPerson }) {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { formatError, locale } = useI18n()
  const describe = useLoadFailure()
  const [confirming, setConfirming] = useState(false)
  // somebody else's session, asked about before it is ended: a stray press
  // signs out a student in the middle of filling something in
  const [ending, setEnding] = useState<{ id: string; device: string } | null>(null)
  const sessions = useInfiniteQuery({
    queryKey:
      person === undefined
        ? [...query.self.listSelfSessions.key({ query: {} }), 'infinite']
        : [
            ...query.identity.listUserSessions.key({
              params: { userId: person.userId },
              query: {},
            }),
            'infinite',
          ],
    queryFn: ({ pageParam }) => {
      const page = pageParam === undefined ? {} : { cursor: pageParam }
      return person === undefined
        ? run(api.self.listSelfSessions({ query: page }))
        : run(api.identity.listUserSessions({ params: { userId: person.userId }, query: page }))
    },
    ...cursorPages,
  })
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? []
  const others = items.filter((session) => !session.current).length
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: person === undefined ? query.self.key() : query.identity.key(),
    })
  const endOne = useMutation({
    mutationFn: (sessionId: string) =>
      person === undefined
        ? run(api.self.deleteSelfSession({ params: { sessionId } }))
        : run(api.identity.deleteUserSession({ params: { userId: person.userId, sessionId } })),
    onSuccess: async () => {
      toast.success(m.sessions_endDone())
      await refresh()
    },
    onError: (error: unknown) => toast.error(formatError(error)),
  })
  const endOthers = useMutation({
    mutationFn: () =>
      person === undefined
        ? run(api.self.deleteSelfSessions({}))
        : run(api.identity.deleteUserSessions({ params: { userId: person.userId } })),
    onSuccess: async ({ ended }) => {
      toast.success(m.sessions_ended({ count: ended }))
      await refresh()
    },
    onError: (error: unknown) => toast.error(formatError(error)),
  })

  return (
    <Card data-testid="sessions-card" data-count={items.length}>
      <CardHead title={m.sessions_title()}>
        {/* the history of how they came in is its own page; this card is
            what is signed in now. Somebody else's history is on the page
            this card stands on. */}
        {person === undefined && (
          <PageLink
            page="auth/account-activity"
            unavailable={null}
            className={stylex.props(styles.all).className}
          >
            {m.sessions_activity()}
          </PageLink>
        )}
      </CardHead>
      <AsyncSection
        pending={sessions.isPending}
        error={sessions.isError ? describe.of(sessions.error) : null}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => void sessions.refetch()}
        skeleton={<TableSkeleton rows={2} />}
      >
        {/* the reader's own list always has the session in hand; somebody
            else's may have none at all */}
        {items.length === 0 && <CardEmpty>{m.person_sessionsNone()}</CardEmpty>}
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
                  {deviceWords(session.userAgent) ?? m.sessions_unknownDevice()}
                </span>
                {session.current && <Status tone="ok">{m.sessions_current()}</Status>}
              </span>
              <Meta
                parts={[
                  session.entrance?.name ?? m.sessions_entranceGone(),
                  session.clientIp,
                  m.sessions_active({
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
                onClick={() =>
                  person === undefined
                    ? endOne.mutate(session.id)
                    : setEnding({
                        id: session.id,
                        // said inside a sentence, so the words that stand
                        // alone as a row's heading are not the ones used
                        device: deviceWords(session.userAgent) ?? m.sessions_unknownDeviceInline(),
                      })
                }
                className={stylex.props(styles.end).className}
              >
                {(person === undefined ? m.sessions_end : m.person_sessionEnd)()}
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
                {m.sessions_more()}
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
                {(person === undefined ? m.sessions_endOthers : m.person_sessionsEndAll)()}
              </Button>
            )}
          </CardFoot>
        )}
      </AsyncSection>
      <ConfirmDialog
        open={confirming}
        tone="destructive"
        title={
          person === undefined
            ? m.sessions_endOthersTitle()
            : m.person_sessionsEndAllTitle({ name: person.name })
        }
        description={(person === undefined
          ? m.sessions_endOthersBody
          : m.person_sessionsEndAllBody)()}
        confirmLabel={(person === undefined ? m.sessions_endOthers : m.person_sessionsEndAll)()}
        cancelLabel={m.action_cancel()}
        pending={endOthers.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          endOthers.mutate()
        }}
      />
      {person !== undefined && (
        <ConfirmDialog
          open={ending !== null}
          tone="destructive"
          title={m.person_sessionEndTitle({ device: ending?.device ?? '' })}
          description={m.person_sessionEndBody({ name: person.name })}
          confirmLabel={m.person_sessionEnd()}
          cancelLabel={m.action_cancel()}
          pending={endOne.isPending}
          onCancel={() => setEnding(null)}
          onConfirm={() => {
            const id = ending?.id
            setEnding(null)
            if (id !== undefined) endOne.mutate(id)
          }}
        />
      )}
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
  const { locale } = useI18n()
  return (
    <DateRangePicker
      value={range}
      onChange={onChange}
      placeholder={m.activity_period()}
      localeTag={locale}
      monthLabel={commonMessages.calendar_month()}
      yearLabel={commonMessages.calendar_year()}
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
  if (total <= PAGE_SIZE) return null
  return (
    <Pager
      testId="records-pager"
      label={m.users_pager()}
      page={page}
      pageSize={PAGE_SIZE}
      total={total}
      disabled={busy}
      summary={m.activity_summary({
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
  const { locale } = useI18n()
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
          {attempt.current && <Status tone="plain">{m.signIns_thisSession()}</Status>}
        </span>
        <Meta
          parts={[
            deviceWords(attempt.userAgent) ?? m.sessions_unknownDevice(),
            attempt.entrance?.name ?? m.sessions_entranceGone(),
            attempt.clientIp,
          ]}
        />
      </span>
      <Status tone={attempt.outcome === 'success' ? 'ok' : 'bad'}>
        {(attempt.outcome === 'success' ? m.signIns_succeeded : m.signIns_refused)()}
      </Status>
    </div>
  )
}

/** one change: when, what, and whether the reader did it */
function ChangeRow({ change }: { change: Change }) {
  const { locale } = useI18n()
  return (
    <div data-testid="account-change" data-actor={change.actor} {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.words)}>
        <span {...stylex.props(styles.line, styles.when)}>
          {instantWords(locale, change.occurredAt)}
        </span>
        <span {...stylex.props(styles.meta)}>
          <span>{change.name}</span>
          <span>{(change.actor === 'self' ? m.activity_bySelf : m.activity_byOther)()}</span>
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
  const describe = useLoadFailure()
  const [open, setOpen] = useState(false)
  const items = recent.data?.items ?? []
  return (
    <Card data-testid={testId}>
      {/* there whenever there is a record: the sheet is where it is searched
          by day and outcome, not only where the rest of it is; an empty one
          has nothing to search */}
      <CardHead title={title}>
        {recent.data !== undefined && recent.data.total > 0 && (
          <Button
            size="xs"
            variant="ghost"
            data-testid={`${testId}-all`}
            onClick={() => setOpen(true)}
          >
            {m.activity_all()}
          </Button>
        )}
      </CardHead>
      <AsyncSection
        pending={recent.isPending}
        error={recent.isError ? describe.of(recent.error) : null}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
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
        closeLabel={commonMessages.action_close()}
        testId={`${testId}-sheet`}
      >
        {open && whole}
      </DetailSheet>
    </Card>
  )
}

/** one page of sign-ins, the reader's own or somebody's they administer */
const useSignIns = (
  person: RecordPerson | undefined,
  asked: {
    outcome?: 'success' | 'failure'
    from?: string
    to?: string
    page: string
    limit: string
  },
  keepPrevious = false,
) => {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  // one query, whichever record it is: the other one is not asked for at all
  return useQuery({
    queryKey:
      person === undefined
        ? query.self.listSelfSignIns.key({ query: asked })
        : query.identity.listUserSignIns.key({ params: { userId: person.userId }, query: asked }),
    queryFn: () =>
      person === undefined
        ? run(api.self.listSelfSignIns({ query: asked }))
        : run(api.identity.listUserSignIns({ params: { userId: person.userId }, query: asked })),
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
  })
}

/** the sign-ins: the latest few here, all of them in the sheet */
export function SignInRecords({ person }: { person?: RecordPerson }) {
  const recent = useSignIns(person, { page: '1', limit: String(RECENT) })
  return (
    <RecordCard
      testId="sign-ins-card"
      title={m.activity_signIns()}
      empty={m.signIns_empty()}
      recent={recent}
      row={(attempt: SignIn) => <SignInRow attempt={attempt} />}
      whole={<AllSignIns person={person} />}
    />
  )
}

/** what was done to the reader's account: the latest few here, all of it in the sheet */
export function AccountChanges() {
  const query = useApiQuery(authApi)

  const recent = useQuery(
    query.self.listSelfAccountChanges.queryOptions({
      query: { page: '1', limit: String(RECENT) },
    }),
  )
  return (
    <RecordCard
      testId="account-changes"
      title={m.activity_changes()}
      empty={m.activity_changesEmpty()}
      recent={recent}
      row={(change: Change) => <ChangeRow change={change} />}
      whole={<AllChanges />}
    />
  )
}

/** every sign-in, a numbered page at a time, within the days and outcome asked for */
function AllSignIns({ person }: { person: RecordPerson | undefined }) {
  const describe = useLoadFailure()
  const [outcome, setOutcome] = useState<'all' | 'success' | 'failure'>('all')
  const [range, setRange] = useState<DateRange>({ start: '', end: '' })
  const [page, setPage] = useState(1)
  const signIns = useSignIns(
    person,
    {
      ...(outcome === 'all' ? {} : { outcome }),
      ...periodOf(range),
      page: String(page),
      limit: String(PAGE_SIZE),
    },
    true,
  )
  const items = signIns.data?.items ?? []
  return (
    <div {...stylex.props(styles.whole)}>
      <div {...stylex.props(styles.tools)}>
        <ToggleGroup
          value={outcome}
          aria-label={m.signIns_filter()}
          onValueChange={(next) => {
            if (next === '') return
            setOutcome(next as typeof outcome)
            setPage(1)
          }}
        >
          <ToggleGroupItem value="all">{m.signIns_filterAll()}</ToggleGroupItem>
          <ToggleGroupItem value="success">{m.signIns_filterSucceeded()}</ToggleGroupItem>
          <ToggleGroupItem value="failure">{m.signIns_filterRefused()}</ToggleGroupItem>
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
          error={signIns.isError ? describe.of(signIns.error) : null}
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void signIns.refetch()}
          skeleton={<TableSkeleton rows={6} />}
        >
          {items.length === 0 ? (
            <CardEmpty>{m.signIns_empty()}</CardEmpty>
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

  const describe = useLoadFailure()
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
          error={changes.isError ? describe.of(changes.error) : null}
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void changes.refetch()}
          skeleton={<TableSkeleton rows={6} />}
        >
          {items.length === 0 ? (
            <CardEmpty>{m.activity_changesEmpty()}</CardEmpty>
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
