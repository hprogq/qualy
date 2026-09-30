import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PenLineIcon } from 'lucide-react'
import {
  PageLink,
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageQueryState,
  usePageQueryUpdate,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'

import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import type { LiveLine } from '@qualy/ui/live-mark'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentApi } from '../api.ts'

import { ManagedEntrySheet } from '../entry/ManagedEntrySheet.tsx'
import type { RedetermineInput } from '../entry/RedetermineDialog.tsx'
import { sayEntryFailure } from '../entry/refusals.ts'
import { standingRows, type Standing } from '../entry/standing.ts'
import { opensTo, type EntryDto, type ItemDto } from '../entry/model.ts'
import { EntriesWorkspace } from '../entry/workspace/EntriesWorkspace.tsx'
import { WorkspaceSkeleton } from '../entry/workspace/WorkspaceSkeleton.tsx'
import { StandingNotice } from '../entry/workspace/StandingNotice.tsx'
import { useLineWords } from '../entry/workspace/calc.ts'
import { useParticipantEntries } from './participant-entries.ts'
import { useReviewQueueQuery } from '../review/queue.ts'
import { entryLineOf } from '../entry/workspace/model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One person's filings, read the way they read them: the same workspace as
// their own page, with the staff reader's acts in place of the owner's.
//
// Nothing here files or submits - that is the owner's alone. What a staff
// reader may do is the server's to say, claim by claim: send one back, take
// an administrative determination off it, re-examine it or re-determine it,
// and record a finding into a question the office records.

const styles = stylex.create({
  // what waits on this reader, said once over the account with the way there
  waiting: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 10%, ${tokens.background})`,
    paddingInline: 16,
    paddingBlock: 8,
  },
  waitingWords: { flexGrow: 1, fontSize: 13, color: tokens.surfaceMutedForeground },
  // The workspace runs to the edges of the room it is given, and so does its
  // outline while it loads; what stands in for it otherwise - why it could
  // not be read, a paper with no questions - is set in from them the way a
  // page is, or it reads as the layout having broken against the column
  // beside it.
  seat: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  // the outline stands in the whole seat while it loads, down to the foot
  // of the room, as the workspace will
  fill: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  inset: {
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingTop: { default: 20, [breakpoints.phone]: 16 },
    paddingBottom: 24,
  },
  empty: {
    marginInline: { default: 24, [breakpoints.phone]: 16 },
    marginTop: { default: 20, [breakpoints.phone]: 16 },
    marginBottom: 24,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    paddingBlock: 48,
    textAlign: 'center',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
})

export function ParticipantEntries({
  batchId,
  participantId,
  entryId,
  may,
  line,
  closed,
  onEntry,
}: {
  batchId: string
  participantId: string
  entryId: string
  /** the corrections and records this reader can make in this round at all */
  may: {
    readonly returnForRevision: boolean
    readonly withdraw: boolean
    /** recording a finding into a question the office records */
    readonly record: boolean
  }
  /** the round's wake-up line; while no word arrives on it the queue polls */
  line: LiveLine
  /** the round is archived or this person is off it: nothing here moves any more */
  closed: boolean
  onEntry: (entryId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { formatError } = useI18n()
  const failures = useLoadFailure()
  const lineWords = useLineWords()
  // which question is open: the same address key the owner's page keeps
  const [open] = usePageQueryState('open')
  const address = usePageQueryUpdate()

  const entries = useQuery(useParticipantEntries(batchId, participantId))
  // Which of these claims wait on this reader's own decision: the server's
  // queue answers that, so nothing here guesses who may review what. Read
  // only by a reader who reviews in this round, and shared with the queue
  // page under the same key - so the wake-ups that move the queue there
  // move it here too, and it polls at the queue page's pace without them.
  const batch = useQuery(query.assessment.getBatch.queryOptions({ params: { batchId } }))
  const reviews = batch.data?.batch.capabilities.review === true
  const queue = useQuery({
    ...useReviewQueueQuery(batchId),
    enabled: reviews,
    refetchInterval: line.live ? 60_000 : 30_000,
  })
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const groups = useQuery(query.assessment.listScoreGroups.queryOptions({ params: { batchId } }))
  // read, not fetched twice: the detail above has it open already
  const result = useQuery(
    query.assessment.getParticipantResult.queryOptions({ params: { batchId, participantId } }),
  )

  const claims = useMemo(() => entries.data?.entries ?? [], [entries.data])
  const flat = useMemo(() => claims.map((one) => one.entry as EntryDto), [claims])
  const entriesByItem = useMemo(() => {
    const grouped = new Map<string, EntryDto[]>()
    for (const entry of flat) {
      const bucket = grouped.get(entry.itemId)
      if (bucket === undefined) grouped.set(entry.itemId, [entry])
      else bucket.push(entry)
    }
    return grouped
  }, [flat])
  const visible = useMemo(
    () =>
      ((items.data?.items ?? []) as readonly ItemDto[]).filter((item) => item.status !== 'draft'),
    [items.data],
  )
  const standing = (result.data ?? null) as Standing | null
  const rows = useMemo(
    () =>
      standingRows({
        groups: groups.data?.groups ?? [],
        items: visible,
        entriesByItem,
        standing,
      }),
    [groups.data, visible, entriesByItem, standing],
  )

  // Every correction changes what the score is made of - so the account,
  // the claims and the claim itself are all asked again, not patched.
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: query.assessment.listParticipantEntries.key({
        params: { batchId, participantId },
        query: {},
      }),
    })
    void queryClient.invalidateQueries({
      queryKey: query.assessment.getParticipantResult.key({
        params: { batchId, participantId },
      }),
    })
  }
  const intervene = useMutation({
    mutationFn: (input: {
      entryId: string
      kind: 'return-for-revision' | 'void'
      reason: string
    }) =>
      run(
        api.assessment.interveneOnEntry({
          params: { entryId: input.entryId },
          payload: { kind: input.kind, reason: input.reason },
        }),
      ).then(() => input.kind),
    onSuccess: (kind) => {
      toast.success((kind === 'void' ? m.staff_voided : m.staff_returned)())
      refresh()
    },
    onError: (error) => toast.error(sayEntryFailure(error, { formatError })),
  })
  const reopen = useMutation({
    mutationFn: (input: { entryId: string; reason: string }) =>
      run(
        api.assessment.reopenEntry({
          params: { entryId: input.entryId },
          payload: { reason: input.reason },
        }),
      ),
    onSuccess: () => {
      toast.success(m.staff_reopened())
      refresh()
    },
    onError: (error) => toast.error(sayEntryFailure(error, { formatError })),
  })
  const [correctionProblem, setCorrectionProblem] = useState<string | null>(null)
  const redetermine = useMutation({
    mutationFn: (input: { entryId: string; value: RedetermineInput }) =>
      run(
        api.assessment.redetermineEntry({
          params: { entryId: input.entryId },
          payload: {
            decision: input.value.decision,
            reason: input.value.reason,
            ...(input.value.recognition === undefined
              ? {}
              : { recognition: { values: input.value.recognition.values } }),
          },
        }),
      ),
    onMutate: () => setCorrectionProblem(null),
    onSuccess: () => {
      toast.success(m.staff_redetermined())
      refresh()
    },
    onError: (error) => setCorrectionProblem(sayEntryFailure(error, { formatError })),
  })

  const mine = new Set(flat.map((entry) => entry.id))
  const awaiting = new Map(
    (reviews ? (queue.data?.items ?? []) : [])
      .filter((row) => mine.has(row.entryId))
      .map((row) => [row.entryId, row.instanceId] as const),
  )
  const firstAwaiting = [...awaiting.values()][0]

  const opened = claims.find((one) => one.entry.id === entryId) ?? null
  // kept mounted while the drawer shuts, or it would vanish rather than close
  const lingering = useLingering(opened)
  const itemsById = new Map(visible.map((item) => [item.id, item] as const))
  const rowsById = new Map(rows.map((row) => [row.id, row] as const))

  // A claim the address names opens on its own question, whichever question
  // the address had open before: following a number back from the account
  // lands on the question it was filed under, every time. Written into the
  // address in place, so closing the drawer leaves the reader on that
  // question rather than on the one they were reading before they followed.
  const landedOn = opened !== null && opened.entry.itemId !== open ? opened.entry.itemId : null
  useEffect(() => {
    if (landedOn !== null) address({ open: landedOn }, { history: 'replace' })
  }, [landedOn, address])
  const openItem = landedOn ?? open

  // the score out of reach, or read once and failing since
  const scoreless = result.data === undefined && result.error !== null
  const scoreStale = result.data !== undefined && result.isError

  const pending = entries.isPending || items.isPending || groups.isPending
  // A read that failed with nothing to show is the section's failure - the
  // groups too, or the structure would draw as a paper with no sections at
  // all. One that failed later keeps what it showed.
  const failed = [entries, items, groups].find(
    (read) => read.data === undefined && read.error !== null,
  )
  const failure = failed === undefined ? null : failures.of(failed.error)

  return (
    <div
      data-testid="participant-entries"
      data-state={pending ? 'loading' : failure !== null ? 'failed' : 'ready'}
      {...stylex.props(styles.seat, !pending && failure !== null && styles.inset)}
    >
      <AsyncSection
        pending={pending}
        error={failure}
        retrying={failed?.isFetching ?? false}
        framed
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => {
          void entries.refetch()
          void items.refetch()
          void groups.refetch()
        }}
        // the workspace it is about to become, edge to edge like it
        skeleton={<WorkspaceSkeleton viewer="staff" open={openItem !== ''} />}
        // only the outline is stood in the whole seat: what it becomes, and
        // why it could not, keep the room the seat gives them
        {...(pending ? { xstyle: styles.fill } : {})}
      >
        {rows.length === 0 ? (
          <p {...stylex.props(styles.empty)}>{m.entries_noItems()}</p>
        ) : (
          <EntriesWorkspace
            viewer="staff"
            heading={m.entries_staffHeading()}
            totalLabel={m.entries_staffTotal()}
            rows={rows}
            entriesByItem={entriesByItem}
            entries={flat}
            standing={standing}
            scored={result.data !== undefined}
            open={openItem}
            // the workspace says which moves the back key undoes, as on the owner's page
            onOpen={(id, how) => address({ open: id }, { history: how })}
            live={closed ? null : line}
            busy={intervene.isPending || reopen.isPending || redetermine.isPending}
            refreshing={entries.isFetching || result.isFetching}
            onRefresh={() => {
              void entries.refetch()
              void result.refetch()
              void items.refetch()
              void groups.refetch()
            }}
            openEntryId={entryId}
            onEntry={(entry) => onEntry(entry.id)}
            itemAction={(item) =>
              // the office's own way to write a finding for a question it
              // records, where this reader holds the power that does
              may.record && item.status === 'active' && opensTo(item, 'administrative') ? (
                <Button asChild size="sm" variant="outline" data-testid="staff-record">
                  <PageLink
                    page="assessment/batch-record"
                    params={{ batchId }}
                    search={{ mode: 'manual' }}
                  >
                    <PenLineIcon aria-hidden />
                    {m.entries_recordFor()}
                  </PageLink>
                </Button>
              ) : null
            }
            awaitingMe={new Set(awaiting.keys())}
            notice={
              <>
                {/* every figure below is unknown while this stands, and says so */}
                {(scoreless || scoreStale) && (
                  <StandingNotice
                    error={result.error}
                    stale={scoreStale}
                    retrying={result.isFetching}
                    onRetry={() => void result.refetch()}
                  />
                )}
                {firstAwaiting !== undefined && (
                  <div
                    data-testid="awaiting-me"
                    data-count={awaiting.size}
                    {...stylex.props(styles.waiting)}
                  >
                    <span {...stylex.props(styles.waitingWords)}>
                      {m.entries_awaitingYouCount({ count: awaiting.size })}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <PageLink
                        page="assessment/review-instance"
                        params={{ batchId, instanceId: firstAwaiting }}
                      >
                        {m.entries_goReview()}
                      </PageLink>
                    </Button>
                  </div>
                )}
              </>
            }
            fit="parent"
          />
        )}
      </AsyncSection>

      {lingering !== null && itemsById.get(lingering.entry.itemId) !== undefined && (
        <ManagedEntrySheet
          key={lingering.entry.id}
          open={opened !== null}
          entry={lingering.entry}
          item={itemsById.get(lingering.entry.itemId)!}
          recognition={lingering.recognition}
          corrections={lingering.corrections}
          correctionProblem={correctionProblem}
          onReopen={(reason) => reopen.mutate({ entryId: lingering.entry.id, reason })}
          onRedetermine={(value) =>
            redetermine.mutateAsync({ entryId: lingering.entry.id, value }).then(
              () => true,
              () => false,
            )
          }
          trail={rowsById.get(lingering.entry.itemId)?.trail ?? []}
          busy={intervene.isPending || reopen.isPending || redetermine.isPending}
          may={may}
          onClose={() => onEntry('')}
          provenance={
            awaiting.has(lingering.entry.id) ? (
              <Button asChild size="sm" variant="outline" data-testid="staff-review">
                <PageLink
                  page="assessment/review-instance"
                  params={{ batchId, instanceId: awaiting.get(lingering.entry.id)! }}
                >
                  {m.entries_goReview()}
                </PageLink>
              </Button>
            ) : undefined
          }
          onIntervene={(kind, reason) =>
            intervene.mutate({ entryId: lingering.entry.id, kind, reason })
          }
          summary={entryLineOf(
            lingering.entry,
            itemsById.get(lingering.entry.itemId)!,
            standing,
            lineWords,
          )}
        />
      )}
    </div>
  )
}
