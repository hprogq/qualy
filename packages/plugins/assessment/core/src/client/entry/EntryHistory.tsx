import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, SidePanel } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { AttachmentLink } from './AttachmentLink.tsx'
import { displayValueOf, fieldsOf } from './model.ts'
import { ownReviewEventMessage, reviewEventMessage } from '../review/events.ts'

// The whole account of one claim, read the way records are read: newest
// first, all the way down - and grouped by the unit a reader actually
// reasons about, which is the review round.
//
// A round is a section, not a badge beside every line. Rounds run newest
// first; inside one, its own moments run newest first too, so the top of a
// section says how the round stands or ended and the bottom says how it
// began. Both ends are said in so many words - "this round began", "this
// round ended" - because a lifecycle a reader must infer from event
// wording is one they will infer wrongly. A policy re-route is one act
// that ends one round and opens the next: the old section closes with
// where the work went, the new one opens with where it came from, and the
// same administrator's act is never listed as two.

const styles = stylex.create({
  skeleton: {
    height: 160,
    width: '100%',
  },
  empty: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  trail: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    fontSize: 14,
  },
  roundSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  headRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  roundTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  ongoingBadge: {
    borderColor: `color-mix(in oklab, ${tokens.success} 45%, transparent)`,
    color: tokens.successForeground,
  },
  thread: {
    marginLeft: 5,
    display: 'flex',
    flexDirection: 'column',
    borderLeftWidth: 1,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
    paddingLeft: 20,
  },
  node: {
    position: 'relative',
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
    paddingBottom: {
      default: 20,
      ':last-child': 4,
    },
  },
  dot: {
    position: 'absolute',
    top: 4,
    left: -25,
    width: 9,
    height: 9,
    borderRadius: '9999px',
    borderWidth: 1.5,
    borderStyle: 'solid',
  },
  dotAlert: {
    borderColor: tokens.danger,
    backgroundColor: tokens.danger,
  },
  dotStrong: {
    borderColor: tokens.foreground,
    backgroundColor: tokens.foreground,
  },
  dotPlain: {
    borderColor: tokens.mutedForeground,
    backgroundColor: tokens.background,
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  lineTitle: {
    minWidth: 0,
    fontSize: 14,
  },
  lineAlert: {
    fontWeight: 600,
    color: tokens.danger,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  lineWhen: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  mark: {
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  quoted: {
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
    paddingLeft: 12,
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
  },
  quotedAlert: {
    borderLeftColor: `color-mix(in oklab, ${tokens.danger} 30%, transparent)`,
  },
  quietNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  mutedInk: {
    color: tokens.mutedForeground,
  },
  reasonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  plainBadge: {
    fontWeight: 400,
  },
  standingBadge: {
    flexShrink: 0,
    fontWeight: 400,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 8,
    paddingBlock: 2,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  chipKind: {
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
    padding: 12,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '4rem minmax(0, 1fr)',
    columnGap: 12,
    rowGap: 6,
    fontSize: 14,
  },
  gridRow: {
    gridColumn: 'span 2',
    display: 'grid',
    gridTemplateColumns: 'subgrid',
  },
  term: {
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  detail: {
    minWidth: 0,
  },
  softNote: {
    fontSize: 12,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  asideNote: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  filed: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  filedTerm: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  filedFiles: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
  },
})

/** one thing that happened, whatever kind of thing it was */
interface Node {
  readonly key: string
  readonly at: string
  /** its place in the served ascending order, for same-instant ordering */
  readonly seq: number
  readonly kind: 'version' | 'act' | 'ask' | 'answer' | 'suggestion' | 'transition'
  /** how loudly the thread marks it: a decision against you, or the newest word */
  readonly weight: 'plain' | 'strong' | 'alert'
  readonly render: () => ReactNode
}

/** a round's worth of nodes, or one thing that belongs to no round */
type TrailItem =
  | {
      readonly kind: 'round'
      readonly key: string
      readonly at: string
      readonly round: Round
      readonly nodes: readonly Node[]
    }
  | { readonly kind: 'loose'; readonly key: string; readonly at: string; readonly node: Node }

export function EntryHistory({
  open,
  entryId,
  itemTitle,
  subject,
  onClose,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  entryId: string
  /** the question this claim answers, for the panel's second line */
  itemTitle?: string | undefined
  /**
   * Whose claim this is, when the reader is not that person.
   *
   * The account is one account and it is told the same way to everybody,
   * but not in the same voice: "I submitted version 2" is the right sentence
   * for the person who submitted it and the wrong one for the reviewer
   * reading over their shoulder. Absent, the reader is the subject.
   */
  subject?: string | undefined
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const history = useQuery(query.assessment.getEntryHistory.queryOptions({ params: { entryId } }))
  const data = history.data
  const asks =
    data === undefined
      ? 0
      : data.rounds.reduce((count, round) => count + round.supplements.length, 0)

  return (
    <SidePanel
      open={open}
      title={format(m.entryHistoryTitle)}
      description={
        data === undefined
          ? undefined
          : format(m.entryTrailSubtitle, {
              item: itemTitle ?? '',
              versions: data.revisions.length,
              rounds: data.rounds.length,
              asks,
            })
      }
      onClose={onClose}
    >
      <AsyncSection
        pending={history.isPending}
        error={history.error ? formatError(history.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void history.refetch()}
        skeleton={<Skeleton className={stylex.props(styles.skeleton).className} />}
      >
        {data !== undefined && <Trail data={data} subject={subject} />}
      </AsyncSection>
    </SidePanel>
  )
}

/**
 * The account alone, for a host that brings its own shell: the detail
 * drawer shows it as one tab beside the filed content, and a second panel
 * around it there would be a drawer inside a drawer.
 */
export function EntryTrail({
  entryId,
  subject,
}: {
  entryId: string
  subject?: string | undefined
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const history = useQuery(query.assessment.getEntryHistory.queryOptions({ params: { entryId } }))
  return (
    <AsyncSection
      pending={history.isPending}
      error={history.error ? formatError(history.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void history.refetch()}
      skeleton={<Skeleton className={stylex.props(styles.skeleton).className} />}
    >
      {history.data !== undefined && <Trail data={history.data} subject={subject} />}
    </AsyncSection>
  )
}

type History = ApiResult<typeof assessmentApi, 'assessment', 'getEntryHistory'>
type Round = History['rounds'][number]
type Revision = History['revisions'][number]
type Supplement = Round['supplements'][number]

function Trail({ data, subject }: { data: History; subject: string | undefined }) {
  const { format } = useI18n()
  const items = useTrail(data, subject)
  if (items.length === 0) {
    return <p {...stylex.props(styles.empty)}>{format(m.entryTrailEmpty)}</p>
  }
  return (
    <div {...stylex.props(styles.trail)}>
      {items.map((item) =>
        item.kind === 'round' ? (
          <section
            key={item.key}
            data-testid="trail-round"
            data-round-no={item.round.roundNo}
            data-standing={item.round.state === 'completed' ? 'ended' : 'ongoing'}
            {...stylex.props(styles.roundSection)}
          >
            <div {...stylex.props(styles.headRow)}>
              <h4 {...stylex.props(styles.roundTitle)}>
                {format(m.entryTrailRound, { no: item.round.roundNo })}
              </h4>
              {item.round.state === 'completed' ? (
                <Badge variant="secondary">{format(m.entryRoundEnded)}</Badge>
              ) : (
                <Badge variant="outline" className={stylex.props(styles.ongoingBadge).className}>
                  {format(m.entryRoundOngoing)}
                </Badge>
              )}
            </div>
            <Thread nodes={item.nodes} />
          </section>
        ) : (
          <Thread key={item.key} nodes={[item.node]} />
        ),
      )}
    </div>
  )
}

/** one border, and every node hangs a dot on it */
function Thread({ nodes }: { nodes: readonly Node[] }) {
  return (
    <div {...stylex.props(styles.thread)}>
      {nodes.map((node) => (
        <div
          key={node.key}
          // what kind of thing happened, said as a fact: a test about the
          // account's shape asks for the nodes, not for their sentences
          data-testid="trail-node"
          data-kind={node.kind}
          {...stylex.props(styles.node)}
        >
          <span
            aria-hidden
            {...stylex.props(
              styles.dot,
              node.weight === 'alert'
                ? styles.dotAlert
                : node.weight === 'strong'
                  ? styles.dotStrong
                  : styles.dotPlain,
            )}
          />
          {node.render()}
        </div>
      ))}
    </div>
  )
}

/** newest first; the served order breaks the ties one transaction leaves */
const newestFirst = (a: { at: string; seq: number }, b: { at: string; seq: number }) =>
  Date.parse(b.at) - Date.parse(a.at) || b.seq - a.seq

/**
 * The account as sections: one per round, newest round first, each round's
 * own moments newest first inside it - plus, between them, whatever belongs
 * to no round (a version drafted and never submitted, an administrator's
 * hand on the claim itself).
 */
function useTrail(data: History, subject: string | undefined): readonly TrailItem[] {
  const { format } = useI18n()
  // the round a version opened, for seating the version inside it
  const roundOfRevision = new Map<string, Round>()
  for (const round of data.rounds) {
    if (!roundOfRevision.has(round.revisionId)) roundOfRevision.set(round.revisionId, round)
  }
  const byId = new Map(data.rounds.map((round) => [round.id, round]))
  const successorOf = new Map<string, Round>()
  for (const round of data.rounds) {
    if (round.supersedesInstanceId !== null) {
      const before = byId.get(round.supersedesInstanceId)
      if (before !== undefined) successorOf.set(before.id, round)
    }
  }
  /** the administrator's stated reason for a re-route, off the old round's own event */
  const rerouteReasonOf = (round: Round): string | null => {
    const before =
      round.supersedesInstanceId === null ? undefined : byId.get(round.supersedesInstanceId)
    const said = [...(before?.events ?? [])].reverse().find((event) => event.kind === 'rerouted')
    return said?.comment ?? null
  }

  const items: TrailItem[] = []
  let seq = 0

  for (const round of data.rounds) {
    const nodes: Node[] = []
    // A legacy re-routed round carried a copy of the administrator's event;
    // the section opener below says the same thing once. The supplement
    // exchange is likewise told once, by its structured ask-and-answer
    // cards - the raw events behind them would say every step twice.
    const events = round.events.filter(
      (event) =>
        event.kind !== 'supplement-requested' &&
        event.kind !== 'supplement-submitted' &&
        event.kind !== 'supplement-cancelled' &&
        !(round.origin === 'reroute' && event.kind === 'rerouted'),
    )
    const opener = roundOfRevision.get(round.revisionId)?.id === round.id ? 'version' : 'event'
    const ended = round.state === 'completed'
    // which version this round judges, for the acts that should name it
    const judgedNo = data.revisions.find((one) => one.id === round.revisionId)?.revisionNo ?? null

    if (round.origin === 'reroute') {
      // the section's own opener: one act of the administrator's, told as
      // where this round came from rather than as a second copy of it
      nodes.push({
        key: `t:${round.id}`,
        at: round.submittedAt,
        seq: seq++,
        kind: 'transition',
        weight: 'plain',
        render: () => (
          <RerouteStart
            no={round.roundNo}
            from={
              round.supersedesInstanceId === null
                ? null
                : (byId.get(round.supersedesInstanceId)?.roundNo ?? null)
            }
            reason={rerouteReasonOf(round)}
            at={round.submittedAt}
          />
        ),
      })
    }

    for (const [index, event] of events.entries()) {
      const decisive = event.kind === 'rejected' || event.kind === 'revision-required'
      const opensRound = round.origin !== 'reroute' && opener === 'event' && index === 0
      const endsRound = ended && index === events.length - 1
      nodes.push({
        key: `e:${round.id}:${index}`,
        at: event.at,
        seq: seq++,
        kind: 'act',
        weight: decisive ? 'alert' : event.kind === 'approved' ? 'strong' : 'plain',
        render: () => (
          <Act
            event={event}
            subject={subject}
            roundNo={round.roundNo}
            revisionNo={judgedNo}
            marker={endsRound ? 'ended' : opensRound ? 'started' : undefined}
            continuedBy={
              endsRound && event.kind === 'rerouted'
                ? (successorOf.get(round.id)?.roundNo ?? null)
                : null
            }
          />
        ),
      })
      // advice, not a fact about the past: its own block, and it says so
      if (event.suggestedPayload != null) {
        const revision = data.revisions.find((one) => one.id === round.revisionId)
        nodes.push({
          key: `s:${round.id}:${index}`,
          at: event.at,
          seq: seq++,
          kind: 'suggestion',
          weight: 'plain',
          render: () => (
            <Suggestion
              payload={event.suggestedPayload}
              formConfig={revision?.formConfig}
              subject={subject}
            />
          ),
        })
      }
    }

    for (const supplement of round.supplements) {
      nodes.push({
        key: `a:${supplement.id}`,
        at: supplement.requestedAt,
        seq: seq++,
        kind: 'ask',
        weight: supplement.status === 'open' ? 'alert' : 'plain',
        render: () => <Ask supplement={supplement} subject={subject} />,
      })
      if (supplement.response !== null) {
        const revision = data.revisions.find((one) => one.id === round.revisionId)
        nodes.push({
          key: `r:${supplement.id}`,
          at: supplement.response.respondedAt,
          seq: seq++,
          kind: 'answer',
          weight: 'strong',
          render: () => (
            <Answer
              supplement={supplement}
              revisionNo={revision?.revisionNo ?? null}
              subject={subject}
            />
          ),
        })
      }
    }

    // the version that opened this round sits at its foot: what was filed
    // is how the round began
    if (opener === 'version') {
      const revision = data.revisions.find((one) => one.id === round.revisionId)
      if (revision !== undefined) {
        nodes.push({
          key: `v:${revision.id}`,
          at: revision.createdAt,
          seq: -1,
          kind: 'version',
          weight: 'plain',
          render: () => (
            <Version
              revision={revision}
              subject={subject}
              marker="started"
              markerNo={round.roundNo}
            />
          ),
        })
      }
    }

    nodes.sort(newestFirst)
    items.push({
      kind: 'round',
      key: `round:${round.id}`,
      at: nodes[0]?.at ?? round.submittedAt,
      round,
      nodes,
    })
  }

  // versions no round ever judged: drafts still on the desk, edits between
  for (const revision of data.revisions) {
    if (roundOfRevision.has(revision.id)) continue
    items.push({
      kind: 'loose',
      key: `v:${revision.id}`,
      at: revision.createdAt,
      node: {
        key: `v:${revision.id}`,
        at: revision.createdAt,
        seq: seq++,
        kind: 'version',
        weight: 'plain',
        render: () => <Version revision={revision} subject={subject} />,
      },
    })
  }

  // what happened to the claim that no round explains - being sent back
  // because the question changed, most of all
  for (const [index, event] of data.events.entries()) {
    items.push({
      kind: 'loose',
      key: `o:${index}`,
      at: event.at,
      node: {
        key: `o:${index}`,
        at: event.at,
        seq: seq++,
        kind: 'act',
        weight: 'plain',
        render: () => (
          <div {...stylex.props(styles.stack)}>
            <Line title={actTitle(format, event, subject)} at={event.at} />
            {event.reason !== null && <Quoted>{event.reason}</Quoted>}
          </div>
        ),
      },
    })
  }

  // Sections and loose pieces share one clock, newest first. A re-route
  // ends one round and opens the next in the same instant, so the tie goes
  // to the higher round: the section that says where the work went sits
  // under the one that says where it now is.
  return items.sort(
    (a, b) =>
      Date.parse(b.at) - Date.parse(a.at) ||
      (b.kind === 'round' ? b.round.roundNo : -1) - (a.kind === 'round' ? a.round.roundNo : -1),
  )
}

/** the head of a node: what it is, and when - always in that order */
function Line({
  title,
  aside,
  at,
  tone,
}: {
  title: string
  aside?: ReactNode
  at: string
  tone?: 'alert'
}) {
  return (
    <div {...stylex.props(styles.headRow)}>
      <p {...stylex.props(styles.lineTitle, tone === 'alert' && styles.lineAlert)}>{title}</p>
      {aside}
      <span {...stylex.props(styles.spacer)} />
      <p {...stylex.props(styles.lineWhen)}>{timeOf(at)}</p>
    </div>
  )
}

/**
 * The round's own lifecycle, said in so many words rather than inferred -
 * and by number, because "this round" under an ended section reads as the
 * one currently running.
 */
function LifecycleMark({ marker, no }: { marker: 'started' | 'ended'; no: number }) {
  const { format } = useI18n()
  return (
    <p data-testid="round-mark" data-mark={marker} {...stylex.props(styles.mark)}>
      {format(marker === 'started' ? m.entryRoundStartedMark : m.entryRoundEndedMark, { no })}
    </p>
  )
}

/** somebody's own words, quoted rather than restated */
function Quoted({ children, tone }: { children: ReactNode; tone?: 'alert' }) {
  return <p {...stylex.props(styles.quoted, tone === 'alert' && styles.quotedAlert)}>{children}</p>
}

/** how a re-routed round begins: where it came from, and on whose word */
function RerouteStart({
  no,
  from,
  reason,
  at,
}: {
  no: number
  from: number | null
  reason: string | null
  at: string
}) {
  const { format } = useI18n()
  return (
    <div {...stylex.props(styles.stack)}>
      <Line title={format(m.entryRoundReroutedStart)} at={at} />
      <LifecycleMark marker="started" no={no} />
      {from !== null && (
        <p {...stylex.props(styles.quietNote)}>{format(m.entryRoundReroutedFrom, { no: from })}</p>
      )}
      {reason !== null && reason !== '' && <Quoted>{reason}</Quoted>}
    </div>
  )
}

function Version({
  revision,
  subject,
  marker,
  markerNo,
}: {
  revision: Revision
  subject: string | undefined
  marker?: 'started'
  markerNo?: number
}) {
  const { format } = useI18n()
  return (
    <>
      <Line
        title={
          subject === undefined
            ? format(revision.revisionNo === 1 ? m.entryTrailVersionFirst : m.entryTrailVersion, {
                no: revision.revisionNo,
              })
            : format(
                revision.revisionNo === 1 ? m.entryTrailVersionFirstBy : m.entryTrailVersionBy,
                { who: subject, no: revision.revisionNo },
              )
        }
        at={revision.createdAt}
      />
      {marker !== undefined && markerNo !== undefined && (
        <LifecycleMark marker={marker} no={markerNo} />
      )}
      <FiledFields
        payload={revision.payload}
        formConfig={revision.formConfig}
        attachments={revision.attachments}
      />
      {revision.note !== null && <p {...stylex.props(styles.mutedInk)}>{revision.note}</p>}
    </>
  )
}

/**
 * One event's headline in the right voice: the reader's own acts speak to
 * them where the reader is the filer, and carry the actor's name for
 * everybody else.
 */
const actTitle = (
  format: ReturnType<typeof useI18n>['format'],
  event: { kind: string; actorName?: string | null },
  subject: string | undefined,
): string => {
  const own = subject === undefined ? ownReviewEventMessage(event.kind) : undefined
  if (own !== undefined) return format(own)
  const said = reviewEventMessage(event.kind, event.actorName != null)
  return format(
    said.message,
    said.needsActor ? { who: event.actorName ?? format(m.eventSomebody) } : {},
  )
}

function Act({
  event,
  subject,
  roundNo,
  revisionNo,
  marker,
  continuedBy,
}: {
  event: Round['events'][number]
  subject: string | undefined
  roundNo: number
  /** the version the round judges, so a submission can name what it carried */
  revisionNo?: number | null
  /** whether this act is the round's own beginning or end */
  marker?: 'started' | 'ended' | undefined
  /** the round that carries on from here, when a re-route ended this one */
  continuedBy?: number | null
}) {
  const { format } = useI18n()
  // "submitted" alone does not say WHAT went in; where the version is
  // known, the sentence carries it
  const title =
    event.kind === 'submitted' && revisionNo != null
      ? subject === undefined
        ? format(m.entryTrailSubmitted, { no: revisionNo })
        : format(m.entryTrailSubmittedBy, { who: subject, no: revisionNo })
      : actTitle(format, event, subject)
  return (
    <>
      <Line title={title} at={event.at} />
      {marker !== undefined && <LifecycleMark marker={marker} no={roundNo} />}
      {continuedBy != null && (
        <p {...stylex.props(styles.quietNote)}>
          {format(m.entryRoundReroutedNext, { no: continuedBy })}
        </p>
      )}
      {event.reason !== null && (
        <div {...stylex.props(styles.reasonRow)}>
          <Badge variant="secondary" className={stylex.props(styles.plainBadge).className}>
            {format(m.entryTrailReason, { value: event.reason })}
          </Badge>
        </div>
      )}
      {event.comment !== null && event.comment !== '' && <Quoted>{event.comment}</Quoted>}
    </>
  )
}

function Ask({ supplement, subject }: { supplement: Supplement; subject: string | undefined }) {
  const { format } = useI18n()
  const standing: MessageDescriptor =
    supplement.status === 'answered'
      ? m.supplementStatusAnswered
      : supplement.status === 'cancelled'
        ? m.entryTrailAskCancelled
        : supplement.status === 'superseded'
          ? m.entryTrailAskSuperseded
          : m.entryTrailAskWaiting
  return (
    <>
      <Line
        title={format(subject === undefined ? m.entrySupplementTitle : m.entryTrailAskOut)}
        tone="alert"
        aside={
          <Badge variant="secondary" className={stylex.props(styles.standingBadge).className}>
            {format(standing)}
          </Badge>
        }
        at={supplement.requestedAt}
      />
      {supplement.requestedByName !== null && (
        <p {...stylex.props(styles.quietNote)}>{supplement.requestedByName}</p>
      )}
      <Quoted tone="alert">{supplement.instructions}</Quoted>
      <div {...stylex.props(styles.chipRow)}>
        {supplement.requirements.map((asked) => (
          <span key={asked.key} {...stylex.props(styles.chip)}>
            {asked.label}
            <span {...stylex.props(styles.chipKind)}>
              {format(asked.kind === 'file' ? m.supplementAddFile : m.supplementAddText)}
            </span>
          </span>
        ))}
      </div>
    </>
  )
}

function Answer({
  supplement,
  revisionNo,
  subject,
}: {
  supplement: Supplement
  revisionNo: number | null
  subject: string | undefined
}) {
  const { format } = useI18n()
  const response = supplement.response
  if (response === null) return null
  const answers = (response.payload ?? {}) as Record<string, unknown>
  return (
    <>
      <Line
        title={
          subject === undefined
            ? format(m.entryTrailAnswered)
            : format(m.entryTrailAnsweredBy, { who: subject })
        }
        at={response.respondedAt}
      />
      <div {...stylex.props(styles.card)}>
        <dl {...stylex.props(styles.grid)}>
          {supplement.requirements
            .filter((asked) => asked.kind === 'text')
            .map((asked) => (
              <div key={asked.key} {...stylex.props(styles.gridRow)}>
                <dt {...stylex.props(styles.term)}>{asked.label}</dt>
                <dd {...stylex.props(styles.detail)}>
                  {typeof answers[asked.key] === 'string' ? (answers[asked.key] as string) : '—'}
                </dd>
              </div>
            ))}
        </dl>
        {response.attachments.map((attachment) => (
          <AttachmentLink
            key={attachment.attachmentId}
            attachmentId={attachment.attachmentId}
            variant="line"
          />
        ))}
        {/* the one thing about a supplement a reader cannot see for
            themselves: it did not overwrite what they had already filed */}
        {revisionNo !== null && (
          <p {...stylex.props(styles.softNote)}>
            {format(subject === undefined ? m.entryTrailAnswerKept : m.entryTrailAnswerKeptOut, {
              no: revisionNo,
            })}
          </p>
        )}
      </div>
    </>
  )
}

function Suggestion({
  payload,
  formConfig,
  subject,
}: {
  payload: unknown
  formConfig?: unknown
  subject: string | undefined
}) {
  const { format } = useI18n()
  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.headRow)}>
        <p {...stylex.props(styles.cardTitle)}>{format(m.entrySuggestionTitle)}</p>
        <span {...stylex.props(styles.spacer)} />
        <p {...stylex.props(styles.asideNote)}>{format(m.entrySuggestionAdvisory)}</p>
      </div>
      <FiledFields payload={payload} formConfig={formConfig} />
      <p {...stylex.props(styles.softNote)}>
        {format(subject === undefined ? m.entrySuggestionHint : m.entrySuggestionHintOut)}
      </p>
    </div>
  )
}

/**
 * Business data as the person filed it, under the names they answered, in
 * the order the form asked - file fields included. Files used to be pulled
 * out and stacked at the bottom, which turned "certificate" and "photo of
 * the award" into one anonymous pile; each file field keeps its place and
 * its files sit under its own name. Values the form no longer names stand
 * under their raw handle, and files nothing cites any more close the list:
 * the account must never come up short.
 */
function FiledFields({
  payload,
  formConfig,
  attachments,
}: {
  payload: unknown
  formConfig?: unknown
  attachments?: readonly { readonly attachmentId: string }[]
}) {
  const { format } = useI18n()
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const fields = fieldsOf(formConfig ?? null)
  const known = new Set(fields.map((field) => field.key))
  const filesOf = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
  const rows: {
    key: string
    label: string
    value: { kind: 'text'; text: string } | { kind: 'files'; ids: readonly string[] }
  }[] = []
  for (const field of fields) {
    const value = record[field.key]
    if (field.type === 'attachment') {
      const ids = filesOf(value)
      if (ids.length > 0)
        rows.push({ key: field.key, label: field.label, value: { kind: 'files', ids } })
      continue
    }
    // a field somebody filled and then cleared is part of what they filed:
    // the row stands and says it is empty, rather than reading as a field
    // that was never there
    if (typeof value === 'string' || typeof value === 'number') {
      rows.push({
        key: field.key,
        label: field.label,
        // through the field's own words: a number prints, a choice reads as
        // the administrator's label rather than the stable value
        value: { kind: 'text', text: displayValueOf(field, value) },
      })
    }
  }
  for (const key of Object.keys(record)) {
    if (known.has(key)) continue
    const value = record[key]
    if (typeof value === 'string') {
      rows.push({ key, label: key, value: { kind: 'text', text: value } })
    }
  }
  // files this version carries that no field claims any more: still filed,
  // so still shown, at the end rather than nowhere
  const cited = new Set(rows.flatMap((row) => (row.value.kind === 'files' ? row.value.ids : [])))
  const orphaned = (attachments ?? []).map((one) => one.attachmentId).filter((id) => !cited.has(id))
  if (rows.length === 0 && orphaned.length === 0) return null
  return (
    <div {...stylex.props(styles.filed)}>
      <dl {...stylex.props(styles.grid)}>
        {rows.map((row) => (
          <div key={row.key} {...stylex.props(styles.gridRow)}>
            <dt {...stylex.props(styles.filedTerm)}>{row.label}</dt>
            {row.value.kind === 'text' ? (
              <dd {...stylex.props(styles.detail, row.value.text === '' && styles.mutedInk)}>
                {row.value.text === '' ? format(m.entryFieldCleared) : row.value.text}
              </dd>
            ) : (
              <dd {...stylex.props(styles.filedFiles)}>
                {row.value.ids.map((attachmentId) => (
                  <AttachmentLink key={attachmentId} attachmentId={attachmentId} variant="line" />
                ))}
              </dd>
            )}
          </div>
        ))}
      </dl>
      {orphaned.map((attachmentId) => (
        <AttachmentLink key={attachmentId} attachmentId={attachmentId} variant="line" />
      ))}
    </div>
  )
}

/**
 * A record's clock: to the second, because records are compared and cited,
 * and with the year whenever it is not this one - "12/31" across a year
 * boundary reads as the wrong year with no warning.
 */
const timeOf = (iso: string): string => {
  const then = new Date(iso)
  return then.toLocaleString(undefined, {
    ...(then.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
