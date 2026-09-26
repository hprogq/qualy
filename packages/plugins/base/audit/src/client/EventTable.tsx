import { useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { CardEmpty, Status } from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { auditMessages as m } from './i18n.ts'

// Recorded operations, newest first, one row each: when, who, what, on
// what, how it ended and from where. A row opens into its correlation ids
// and details. The same table wherever the trail is read - the whole of it,
// or the part of it about one person.

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
  // what somebody opened this page for: stacked, it keeps the end of the
  // row rather than queueing behind the actor and the object, so a column
  // of rows can be scanned for the one that did not go through
  outcome: {
    fontSize: 12,
    color: tokens.mutedForeground,
    order: { default: null, [breakpoints.phone]: 1 },
    marginInlineStart: { default: null, [breakpoints.phone]: 'auto' },
  },
  ip: {
    display: { default: 'block', [breakpoints.phone]: 'none' },
    textAlign: 'right',
    fontFamily: MONO,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  detail: {
    display: 'grid',
    gridTemplateColumns: {
      default: '6.5rem minmax(0, 1fr)',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
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
  detailName: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color: tokens.mutedForeground,
    paddingTop: 2,
  },
  // a value and the way to take it elsewhere: these are read in order to be
  // pasted into a ticket, a log search, another screen
  valueRow: { display: 'flex', minWidth: 0, alignItems: 'flex-start', gap: 6 },
  valueText: { minWidth: 0, flexGrow: 1, paddingTop: 2 },
  copy: {
    display: 'inline-flex',
    width: 18,
    height: 18,
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

/** one recorded operation, as the table shows it */
export type EventRow = {
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

export function EventTable({
  rows,
  empty,
  onlyActor,
}: {
  rows: readonly EventRow[]
  /** what an empty table says */
  empty: string
  /** narrows the reading to one actor, where the reader can; absent, the press is not offered */
  onlyActor?: (actorUserId: string) => void
}) {
  const { format, formatText, locale } = useI18n()
  const [openId, setOpenId] = useState('')
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
          <CardEmpty>{empty}</CardEmpty>
        ) : (
          rows.map((row) => (
            <div key={row.id} {...stylex.props(styles.rowSeat)}>
              <button
                type="button"
                aria-expanded={row.id === openId}
                data-testid="audit-row"
                data-event-outcome={row.outcome}
                data-action={row.actionCode}
                onClick={() => setOpenId(row.id === openId ? '' : row.id)}
                {...stylex.props(styles.row, row.id === openId && styles.rowOpen)}
              >
                <span {...stylex.props(styles.ellipsis, styles.when)}>{when(row.occurredAt)}</span>
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
                <span {...stylex.props(styles.ellipsis, styles.ip)}>{row.clientIp ?? '—'}</span>
              </button>
              {row.id === openId && (
                <dl {...stylex.props(styles.detail)} data-testid="audit-detail">
                  <Detail label={format(m.columnActor)} copy={row.actorUserId ?? undefined}>
                    {actorOf(row)}
                    {row.actorUserId !== null && onlyActor !== undefined && (
                      <>
                        {' '}
                        <button
                          type="button"
                          {...stylex.props(styles.inlineAction)}
                          onClick={() => onlyActor(row.actorUserId ?? '')}
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
      {/* the press sits with the NAME of what it copies, not at the far end
          of a value of unpredictable length: a column of presses drifting
          left and right down the panel is hard to aim at, and one of them
          landing under a wrapped line reads as belonging to the next row */}
      <dt {...stylex.props(styles.detailName)}>
        {label}
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
      </dt>
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
      </dd>
    </>
  )
}
