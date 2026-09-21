import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon, UserRoundIcon, XIcon } from 'lucide-react'
import { peoplePicker, type PeoplePickerContext } from '@qualy/ui-contract'
import * as stylex from '@stylexjs/stylex'
import {
  UiSlot,
  useApi,
  useApiQuery,
  usePageQueryState,
  useRunApi,
  cursorPages,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, FormDialog } from '@qualy/ui/admin'
import { Card, CardEmpty, CardFoot, FootNote, Screen, Spacer, Status } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { auditMessages as m } from './i18n.ts'
import { auditApi } from './api.ts'

// The trail, newest first. One table, two filters, a row opens into its
// correlation ids and details - reading is the whole page, because writing
// is done by operations, never here.

// the select refuses an empty value, and "everything" is a real choice
const ALL = 'all'

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"

/** the six columns, stated once so the head and every row agree */
const COLUMNS = '11rem minmax(0, 0.9fr) minmax(0, 1.3fr) minmax(0, 1.1fr) 4.5rem 8rem'

const styles = stylex.create({
  ellipsis: {
    minWidth: 0,
    // stacked, a fact that will not fit takes a second line instead of
    // losing its end, since there is no column head left to guess it from
    overflow: { default: 'hidden', [breakpoints.phone]: 'visible' },
    textOverflow: { default: 'ellipsis', [breakpoints.phone]: 'clip' },
    whiteSpace: { default: 'nowrap', [breakpoints.phone]: 'normal' },
  },
  filters: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  actionFilter: { width: { default: '14rem', [breakpoints.phone]: '100%' } },
  outcomeFilter: { width: { default: '9rem', [breakpoints.phone]: '100%' } },
  // Six columns do not fit a phone, and a table that scrolls sideways hides
  // the outcome - the one thing a reader scans this list for - off the edge.
  // So there a row is what happened, with who, when and how it ended under it;
  // everything else is one press away in the opened row.
  scroll: { overflowX: { default: 'auto', [breakpoints.phone]: 'visible' } },
  measure: {
    display: 'flex',
    minWidth: { default: '46rem', [breakpoints.phone]: 0 },
    flexDirection: 'column',
  },
  head: {
    display: { default: 'grid', [breakpoints.phone]: 'none' },
    gridTemplateColumns: COLUMNS,
    alignItems: 'center',
    columnGap: 16,
    height: 32,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  right: { textAlign: 'right' },
  rowSeat: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  row: {
    display: { default: 'grid', [breakpoints.phone]: 'flex' },
    flexWrap: { default: null, [breakpoints.phone]: 'wrap' },
    rowGap: { default: null, [breakpoints.phone]: 3 },
    paddingBlock: { default: 0, [breakpoints.phone]: 10 },
    width: '100%',
    minWidth: 0,
    minHeight: 40,
    gridTemplateColumns: COLUMNS,
    alignItems: 'center',
    columnGap: 16,
    paddingInline: 16,
    textAlign: 'left',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  rowOpen: { backgroundColor: tokens.surfaceMuted },
  when: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  actor: { fontSize: 13 },
  // Stacked, the head strip is gone and "李思思 王五" is two names with no
  // stated relation. Each fact takes its column's word with it.
  said: {
    display: { default: 'none', [breakpoints.phone]: 'inline' },
    marginInlineEnd: 5,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  action: {
    fontSize: { default: 13, [breakpoints.phone]: 14 },
    fontWeight: 500,
    order: { default: null, [breakpoints.phone]: -1 },
    flexBasis: { default: null, [breakpoints.phone]: '100%' },
  },
  target: { fontSize: 12, color: tokens.mutedForeground },
  outcome: { fontSize: 12, color: tokens.mutedForeground },
  ip: {
    display: { default: 'block', [breakpoints.phone]: 'none' },
    textAlign: 'right',
    fontFamily: MONO,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  detail: {
    display: 'grid',
    gridTemplateColumns: '5rem minmax(0, 1fr)',
    columnGap: 16,
    rowGap: 5,
    margin: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    paddingInline: 16,
    paddingBlock: 12,
    fontSize: 12,
  },
  detailName: { color: tokens.mutedForeground, paddingTop: 2 },
  // a value and the way to take it elsewhere: these are read in order to be
  // pasted into a ticket, a log search, another screen
  valueRow: { display: 'flex', minWidth: 0, alignItems: 'flex-start', gap: 6 },
  valueText: { minWidth: 0, flexGrow: 1, paddingTop: 2 },
  copy: {
    display: 'inline-flex',
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    borderRadius: 5,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  copyGlyph: { width: 12, height: 12 },
  quietId: { color: tokens.mutedForeground },
  actorFilter: { maxWidth: '14rem' },
  actorWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pickerSeat: { minHeight: '20rem' },
  inlineAction: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: tokens.mutedForeground,
    cursor: 'pointer',
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
  },
  detailValue: { margin: 0, minWidth: 0 },
  // correlation ids are copied into other systems, so they are read glyph
  // by glyph rather than as words
  mono: { fontFamily: MONO },
  // anything but success is the reason someone opened this page
  bad: { color: tokens.danger },
  agent: { color: tokens.mutedForeground },
  pre: {
    margin: 0,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontFamily: MONO,
    fontSize: 11.5,
    lineHeight: 1.6,
    color: tokens.surfaceMutedForeground,
  },
})

type EventRow = {
  id: string
  occurredAt: string
  actionCode: string
  actionName:
    | { kind: 'message'; id: string; defaultMessage: string }
    | { kind: 'literal'; value: string }
    | null
  actorKind: 'user' | 'system' | 'service' | 'anonymous'
  actorUserId: string | null
  actorLabel: string | null
  targetLabel: string | null
  targetId: string | null
  outcome: 'success' | 'denied' | 'failure'
  reasonCode: string | null
  details: Record<string, unknown>
  source: 'http' | 'job' | 'cli' | 'system'
  requestId: string | null
  traceId: string | null
  clientIp: string | null
  userAgent: string | null
}

export default function AuditEventsPage() {
  const api = useApi(auditApi)
  const runApi = useRunApi()
  const query = useApiQuery(auditApi)
  const { format, formatText, locale } = useI18n()
  const [action, setAction] = usePageQueryState('action')
  const [outcome, setOutcome] = usePageQueryState('outcome')
  const [openId, setOpenId] = useState('')
  const [actor, setActor] = usePageQueryState('actor')
  const [pickingActor, setPickingActor] = useState(false)

  const options = useQuery(query.audit.getAuditEventOptions.queryOptions({}))

  const outcomeFilter: 'success' | 'denied' | 'failure' | undefined =
    outcome === 'success' || outcome === 'denied' || outcome === 'failure' ? outcome : undefined
  const filter = {
    ...(action ? { actionCode: action } : {}),
    ...(actor ? { actorUserId: actor } : {}),
    ...(outcomeFilter !== undefined ? { outcome: outcomeFilter } : {}),
  }
  const events = useInfiniteQuery({
    queryKey: [...query.audit.listAuditEvents.key({ query: filter }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.audit.listAuditEvents({
          query: { ...filter, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        }),
      ),
    ...cursorPages,
  })
  const rows = useMemo(() => events.data?.pages.flatMap((page) => page.items) ?? [], [events.data])

  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium' })
  const actorOf = (row: EventRow) =>
    row.actorLabel ??
    (row.actorKind === 'anonymous'
      ? format(m.actorAnonymous)
      : row.actorKind === 'user'
        ? (row.actorUserId?.slice(0, 8) ?? '—')
        : format(m.actorSystem))
  const actionOf = (row: EventRow) => (row.actionName ? formatText(row.actionName) : row.actionCode)
  const outcomeLabel = {
    success: m.outcomeSuccess,
    denied: m.outcomeDenied,
    failure: m.outcomeFailure,
  }

  return (
    <Screen title={format(m.title)} description={format(m.hint)} size="broad">
      <div {...stylex.props(styles.filters)}>
        <Select
          value={action || ALL}
          onValueChange={(value) => setAction(value === ALL ? '' : value)}
        >
          <SelectTrigger size="sm" xstyle={styles.actionFilter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{format(m.anyAction)}</SelectItem>
            {(options.data?.actions ?? []).map((entry) => (
              <SelectItem key={entry.code} value={entry.code}>
                {formatText(entry.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={outcome || ALL}
          onValueChange={(value) => setOutcome(value === ALL ? '' : value)}
        >
          <SelectTrigger size="sm" xstyle={styles.outcomeFilter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{format(m.anyOutcome)}</SelectItem>
            <SelectItem value="success">{format(m.outcomeSuccess)}</SelectItem>
            <SelectItem value="denied">{format(m.outcomeDenied)}</SelectItem>
            <SelectItem value="failure">{format(m.outcomeFailure)}</SelectItem>
          </SelectContent>
        </Select>
        {actor === '' ? (
          <Button size="sm" variant="outline" onClick={() => setPickingActor(true)}>
            <UserRoundIcon aria-hidden />
            {format(m.anyActor)}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className={stylex.props(styles.actorFilter).className}
            data-testid="actor-filter"
            data-actor={actor}
            onClick={() => setActor('')}
          >
            <span {...stylex.props(styles.actorWord)}>
              {rows.find((row) => row.actorUserId === actor)?.actorLabel ?? format(m.oneActor)}
            </span>
            <XIcon aria-hidden />
          </Button>
        )}
      </div>

      <AsyncSection
        pending={events.isPending}
        error={events.isError ? format(m.loadFailed) : undefined}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void events.refetch()}
      >
        <Card data-testid="audit-table">
          <div {...stylex.props(styles.scroll)}>
            <div {...stylex.props(styles.measure)}>
              <div {...stylex.props(styles.head)}>
                <span>{format(m.columnTime)}</span>
                <span>{format(m.columnActor)}</span>
                <span>{format(m.columnAction)}</span>
                <span>{format(m.columnTarget)}</span>
                <span>{format(m.columnOutcome)}</span>
                <span {...stylex.props(styles.right)}>{format(m.columnIp)}</span>
              </div>
              {rows.length === 0 ? (
                <CardEmpty>{format(m.empty)}</CardEmpty>
              ) : (
                rows.map((row) => (
                  <div key={row.id} {...stylex.props(styles.rowSeat)}>
                    <button
                      type="button"
                      aria-expanded={row.id === openId}
                      data-event-outcome={row.outcome}
                      onClick={() => setOpenId(row.id === openId ? '' : row.id)}
                      {...stylex.props(styles.row, row.id === openId && styles.rowOpen)}
                    >
                      <span {...stylex.props(styles.ellipsis, styles.when)}>
                        {when(row.occurredAt)}
                      </span>
                      <span {...stylex.props(styles.ellipsis, styles.actor)}>
                        <span aria-hidden {...stylex.props(styles.said)}>
                          {format(m.columnActor)}
                        </span>
                        {actorOf(row)}
                      </span>
                      <span {...stylex.props(styles.ellipsis, styles.action)}>{actionOf(row)}</span>
                      <span {...stylex.props(styles.ellipsis, styles.target)}>
                        <span aria-hidden {...stylex.props(styles.said)}>
                          {format(m.columnTarget)}
                        </span>
                        {row.targetLabel ?? row.targetId ?? '—'}
                      </span>
                      <span {...stylex.props(styles.outcome)}>
                        <Status tone={row.outcome === 'success' ? 'plain' : 'bad'}>
                          {format(outcomeLabel[row.outcome])}
                        </Status>
                      </span>
                      <span {...stylex.props(styles.ellipsis, styles.ip)}>
                        {row.clientIp ?? '—'}
                      </span>
                    </button>
                    {row.id === openId && (
                      <dl {...stylex.props(styles.detail)} data-testid="audit-detail">
                        <Detail label={format(m.columnActor)} copy={row.actorUserId ?? undefined}>
                          {actorOf(row)}
                          {row.actorUserId !== null && (
                            <>
                              {' '}
                              <button
                                type="button"
                                {...stylex.props(styles.inlineAction)}
                                onClick={() => setActor(row.actorUserId ?? '')}
                              >
                                {format(m.onlyThisActor)}
                              </button>
                            </>
                          )}
                        </Detail>
                        {(row.targetLabel !== null || row.targetId !== null) && (
                          <Detail
                            label={format(m.columnTarget)}
                            copy={row.targetId ?? row.targetLabel ?? undefined}
                          >
                            {row.targetLabel ?? row.targetId}
                            {row.targetLabel !== null && row.targetId !== null && (
                              <span {...stylex.props(styles.quietId, styles.mono)}> {row.targetId}</span>
                            )}
                          </Detail>
                        )}
                        <Detail label={format(m.detailSource)}>{row.source}</Detail>
                        {row.reasonCode && (
                          <Detail label={format(m.detailReason)} copy={row.reasonCode} mono bad>
                            {row.reasonCode}
                          </Detail>
                        )}
                        {row.requestId && (
                          <Detail label={format(m.detailRequest)} copy={row.requestId} mono>
                            {row.requestId}
                          </Detail>
                        )}
                        {row.traceId && (
                          <Detail label={format(m.detailTrace)} copy={row.traceId} mono>
                            {row.traceId}
                          </Detail>
                        )}
                        {row.clientIp && (
                          <Detail label={format(m.columnIp)} copy={row.clientIp} mono>
                            {row.clientIp}
                          </Detail>
                        )}
                        {row.userAgent && (
                          <Detail label={format(m.detailUserAgent)} copy={row.userAgent} quiet>
                            {row.userAgent}
                          </Detail>
                        )}
                        {Object.keys(row.details).length > 0 && (
                          <Detail
                            label={format(m.detailDetails)}
                            copy={JSON.stringify(row.details, null, 2)}
                          >
                            <pre {...stylex.props(styles.pre)}>
                              {JSON.stringify(row.details, null, 2)}
                            </pre>
                          </Detail>
                        )}
                      </dl>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <CardFoot>
            <FootNote>
              <span data-testid="audit-count" data-count={rows.length}>
                {format(m.loadedCount, { count: rows.length })}
              </span>
            </FootNote>
            <Spacer />
            {events.hasNextPage && (
              <Button
                size="sm"
                variant="outline"
                disabled={events.isFetchingNextPage}
                onClick={() => void events.fetchNextPage()}
              >
                {format(m.loadMore)}
              </Button>
            )}
          </CardFoot>
        </Card>
      </AsyncSection>
      <FormDialog
        open={pickingActor}
        size="medium"
        title={format(m.pickActor)}
        onClose={() => setPickingActor(false)}
      >
        <div {...stylex.props(styles.pickerSeat)}>
          <UiSlot
            token={peoplePicker}
            context={
              {
                value: actor === '' ? [] : [actor],
                onChange: (ids) => {
                  setActor(ids[0] ?? '')
                  setPickingActor(false)
                },
                single: true,
              } satisfies PeoplePickerContext
            }
            fallback={<p {...stylex.props(styles.detailName)}>{format(m.pickActorUnavailable)}</p>}
          />
        </div>
      </FormDialog>
    </Screen>
  )
}

/** one line of an opened event: what it is, what it says, and the way to copy it */
function Detail({
  label,
  copy,
  mono = false,
  bad = false,
  quiet = false,
  children,
}: {
  label: string
  /** what goes to the clipboard; a line with nothing worth pasting has no button */
  copy?: string | undefined
  mono?: boolean
  bad?: boolean
  quiet?: boolean
  children: ReactNode
}) {
  const { format } = useI18n()
  const [copied, setCopied] = useState(false)
  return (
    <>
      <dt {...stylex.props(styles.detailName)}>{label}</dt>
      <dd {...stylex.props(styles.detailValue, styles.valueRow)}>
        <span
          {...stylex.props(
            styles.valueText,
            mono && styles.mono,
            bad && styles.bad,
            quiet && styles.agent,
          )}
        >
          {children}
        </span>
        {copy !== undefined && (
          <button
            type="button"
            aria-label={format(m.copyValue, { label })}
            data-copied={copied}
            {...stylex.props(styles.copy)}
            onClick={() => {
              void navigator.clipboard.writeText(copy).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? (
              <CheckIcon aria-hidden {...stylex.props(styles.copyGlyph)} />
            ) : (
              <CopyIcon aria-hidden {...stylex.props(styles.copyGlyph)} />
            )}
          </button>
        )}
      </dd>
    </>
  )
}
