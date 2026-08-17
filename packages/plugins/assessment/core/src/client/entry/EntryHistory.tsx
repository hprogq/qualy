import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, SidePanel } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { cn } from '@qualy/ui/cn'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { AttachmentLink } from './AttachmentLink.tsx'
import { fieldsOf } from './model.ts'
import { reviewEventMessage } from '../review/events.ts'

// The whole account of one claim, as one line down the page.
//
// It used to nest: a box per version, a box per round inside it, a box per
// event inside that - three borders deep, and the reader had to collate the
// order themselves. It is one story and it happened in one order, so it is
// drawn as one thread with a node per thing that happened, newest first.
// What kind of thing each node is, it says in its own words; a rejection's
// suggestion is a block of its own, marked as advice, because it is the one
// thing here that is not a fact about the past.

/** one thing that happened to a claim, whatever kind of thing it was */
interface Node {
  readonly key: string
  readonly at: string
  readonly kind: 'version' | 'act' | 'ask' | 'answer' | 'suggestion'
  /** how loudly the thread marks it: a decision against you, or the newest word */
  readonly weight: 'plain' | 'strong' | 'alert'
  readonly render: () => ReactNode
}

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
        skeleton={<Skeleton className="h-40 w-full" />}
      >
        {data !== undefined && <Trail data={data} subject={subject} />}
      </AsyncSection>
    </SidePanel>
  )
}

type History = ApiResult<typeof assessmentApi, 'assessment', 'getEntryHistory'>
type Round = History['rounds'][number]
type Revision = History['revisions'][number]
type Supplement = Round['supplements'][number]

function Trail({ data, subject }: { data: History; subject: string | undefined }) {
  const { format } = useI18n()
  const nodes = useNodes(data, subject)
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">{format(m.entryTrailEmpty)}</p>
  }
  return (
    <div className="flex flex-col gap-4 text-sm">
      {/* the thread itself: one border, and every node hangs a dot on it */}
      <div className="ml-[5px] flex flex-col border-l pl-5">
        {nodes.map((node) => (
          <div key={node.key} className="relative flex min-w-0 flex-col gap-1.5 pb-5">
            <span
              aria-hidden
              className={cn(
                'absolute top-1 -left-[25px] size-[9px] rounded-full border-[1.5px]',
                node.weight === 'alert'
                  ? 'border-destructive bg-destructive'
                  : node.weight === 'strong'
                    ? 'border-foreground bg-foreground'
                    : 'border-muted-foreground bg-background',
              )}
            />
            {node.render()}
          </div>
        ))}
      </div>
      <p className="pl-[25px] text-xs leading-relaxed text-muted-foreground">
        {format(m.entryTrailFoot)}
      </p>
    </div>
  )
}

/**
 * Everything that happened, in one order.
 *
 * Versions, decisions, requests for material and the answers to them are
 * four tables and one story; they are merged on the only thing they all
 * carry, which is when they happened. Ties keep the order the server listed
 * them in, so two things recorded in the same transaction still read the way
 * they were written.
 */
function useNodes(data: History, subject: string | undefined): readonly Node[] {
  const { format } = useI18n()
  const nodes: Node[] = []
  const roundOfRevision = new Map<string, number>()
  for (const round of data.rounds) {
    if (!roundOfRevision.has(round.revisionId)) roundOfRevision.set(round.revisionId, round.roundNo)
  }

  for (const revision of data.revisions) {
    nodes.push({
      key: `v:${revision.id}`,
      at: revision.createdAt,
      kind: 'version',
      weight: 'plain',
      render: () => (
        <Version
          revision={revision}
          openedRound={roundOfRevision.get(revision.id)}
          subject={subject}
        />
      ),
    })
  }

  for (const round of data.rounds) {
    for (const [index, event] of round.events.entries()) {
      const decisive = event.kind === 'rejected' || event.kind === 'revision-required'
      nodes.push({
        key: `e:${round.id}:${index}`,
        at: event.at,
        kind: 'act',
        weight: decisive ? 'alert' : event.kind === 'approved' ? 'strong' : 'plain',
        render: () => <Act event={event} roundNo={round.roundNo} />,
      })
      // advice, not a fact about the past: its own block, and it says so
      if (event.suggestedPayload != null) {
        const revision = data.revisions.find((one) => one.id === round.revisionId)
        nodes.push({
          key: `s:${round.id}:${index}`,
          at: event.at,
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
        kind: 'ask',
        weight: supplement.status === 'open' ? 'alert' : 'plain',
        render: () => <Ask supplement={supplement} subject={subject} />,
      })
      if (supplement.response !== null) {
        const revision = data.revisions.find((one) => one.id === round.revisionId)
        nodes.push({
          key: `r:${supplement.id}`,
          at: supplement.response.respondedAt,
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
  }

  // what happened to the claim that no round explains - being sent back
  // because the question changed, most of all
  for (const [index, event] of data.events.entries()) {
    nodes.push({
      key: `o:${index}`,
      at: event.at,
      kind: 'act',
      weight: 'plain',
      render: () => (
        <div className="flex flex-col gap-1">
          <Line
            title={format(reviewEventMessage(event.kind).message, {
              who: event.actorName ?? format(m.eventSomebody),
            })}
            at={event.at}
          />
          {event.reason !== null && <Quoted>{event.reason}</Quoted>}
        </div>
      ),
    })
  }

  return nodes.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
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
    <div className="flex items-baseline gap-2">
      <p className={cn('min-w-0 text-sm', tone === 'alert' && 'font-semibold text-destructive')}>
        {title}
      </p>
      {aside}
      <span className="flex-1" />
      <p className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {timeOf(at)}
      </p>
    </div>
  )
}

/** somebody's own words, quoted rather than restated */
function Quoted({ children, tone }: { children: ReactNode; tone?: 'alert' }) {
  return (
    <p
      className={cn(
        'border-l-2 pl-3 text-sm leading-relaxed text-pretty',
        tone === 'alert' ? 'border-destructive/30' : 'border-border',
      )}
    >
      {children}
    </p>
  )
}

function Version({
  revision,
  openedRound,
  subject,
}: {
  revision: Revision
  openedRound: number | undefined
  subject: string | undefined
}) {
  const { format } = useI18n()
  return (
    <>
      <Line
        title={
          subject === undefined
            ? format(m.entryTrailVersion, { no: revision.revisionNo })
            : format(m.entryTrailVersionBy, { who: subject, no: revision.revisionNo })
        }
        aside={
          openedRound === undefined ? undefined : (
            <p className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {format(m.entryTrailRoundOpened, { no: openedRound })}
            </p>
          )
        }
        at={revision.createdAt}
      />
      <PayloadLines payload={revision.payload} formConfig={revision.formConfig} />
      {revision.note !== null && <p className="text-muted-foreground">{revision.note}</p>}
      {revision.attachments.map((attachment) => (
        <AttachmentLink
          key={attachment.attachmentId}
          attachmentId={attachment.attachmentId}
          variant="line"
        />
      ))}
    </>
  )
}

function Act({ event, roundNo }: { event: Round['events'][number]; roundNo: number }) {
  const { format } = useI18n()
  const said = reviewEventMessage(event.kind)
  return (
    <>
      <Line
        title={format(
          said.message,
          said.needsActor ? { who: event.actorName ?? format(m.eventSomebody) } : {},
        )}
        at={event.at}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {format(m.entryTrailRound, { no: roundNo })}
        </span>
        {event.reason !== null && (
          <Badge variant="secondary" className="font-normal">
            {format(m.entryTrailReason, { value: event.reason })}
          </Badge>
        )}
      </div>
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
        : m.entryTrailAskWaiting
  return (
    <>
      <Line
        title={format(subject === undefined ? m.entrySupplementTitle : m.entryTrailAskOut)}
        tone="alert"
        aside={
          <Badge variant="secondary" className="shrink-0 font-normal">
            {format(standing)}
          </Badge>
        }
        at={supplement.requestedAt}
      />
      {supplement.requestedByName !== null && (
        <p className="text-xs text-muted-foreground">{supplement.requestedByName}</p>
      )}
      <Quoted tone="alert">{supplement.instructions}</Quoted>
      <div className="flex flex-wrap gap-2">
        {supplement.requirements.map((asked) => (
          <span
            key={asked.key}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground"
          >
            {asked.label}
            <span className="text-muted-foreground/70">
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
      <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
        <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          {supplement.requirements
            .filter((asked) => asked.kind === 'text')
            .map((asked) => (
              <div key={asked.key} className="col-span-2 grid grid-cols-subgrid">
                <dt className="whitespace-nowrap text-muted-foreground">{asked.label}</dt>
                <dd className="min-w-0">
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
          <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
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
    <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-medium">{format(m.entrySuggestionTitle)}</p>
        <span className="flex-1" />
        <p className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {format(m.entrySuggestionAdvisory)}
        </p>
      </div>
      <PayloadLines payload={payload} formConfig={formConfig} />
      <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
        {format(subject === undefined ? m.entrySuggestionHint : m.entrySuggestionHintOut)}
      </p>
    </div>
  )
}

/**
 * Business data as the person filed it, under the names they answered.
 *
 * The account is of what was filed, so every value in the payload gets a
 * row: a form edited afterwards no longer names some of them, and those
 * stand under their raw handle rather than leaving the history short. Only
 * labels are free text - the keys are what the form guarantees unique.
 */
function PayloadLines({ payload, formConfig }: { payload: unknown; formConfig?: unknown }) {
  const { format } = useI18n()
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const fields = fieldsOf(formConfig ?? null)
  const named = fields.filter((field) => field.type !== 'attachment')
  const labels = new Map(named.map((field) => [field.key, field.label]))
  // cited files are listed as files, not as a line of ids
  const cited = new Set(
    fields.filter((field) => field.type === 'attachment').map((field) => field.key),
  )
  const keys = [
    ...named.map((field) => field.key),
    ...Object.keys(record).filter((key) => !labels.has(key) && !cited.has(key)),
  ]
  const rows = keys.flatMap((key) => {
    const value = record[key]
    // a field somebody filled and then cleared is part of what they filed:
    // the row stands and says it is empty, rather than reading as a field
    // that was never there
    return typeof value === 'string' ? [{ key, label: labels.get(key) ?? key, value }] : []
  })
  if (rows.length === 0) return null
  return (
    <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {rows.map((row) => (
        <div key={row.key} className="col-span-2 grid grid-cols-subgrid">
          <dt className="min-w-0 truncate text-muted-foreground">{row.label}</dt>
          <dd className={cn('min-w-0', row.value === '' && 'text-muted-foreground')}>
            {row.value === '' ? format(m.entryFieldCleared) : row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
