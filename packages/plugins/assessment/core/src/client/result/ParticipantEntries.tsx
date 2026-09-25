import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PenLineIcon } from 'lucide-react'
import {
  PageLink,
  useApi,
  useApiQuery,
  usePageQueryState,
  usePageQueryUpdate,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { ManagedEntrySheet } from '../entry/ManagedEntrySheet.tsx'
import type { RedetermineInput } from '../entry/RedetermineDialog.tsx'
import { sayEntryFailure } from '../entry/refusals.ts'
import { standingRows, type Standing } from '../entry/standing.ts'
import { opensTo, type EntryDto, type ItemDto } from '../entry/model.ts'
import { EntriesWorkspace } from '../entry/workspace/EntriesWorkspace.tsx'
import { useWorkspaceMode } from '../entry/workspace/layout.ts'
import { useParticipantEntries } from './participant-entries.ts'
import { entryLineOf } from '../entry/workspace/model.ts'

// One person's filings, read the way they read them: the same workspace as
// their own page, with the staff reader's acts in place of the owner's.
//
// Nothing here files or submits - that is the owner's alone. What a staff
// reader may do is the server's to say, claim by claim: send one back, take
// an administrative determination off it, re-examine it or re-determine it,
// and record a finding into a question the office records.

const styles = stylex.create({
  skeleton: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: { default: '300px minmax(0, 1fr)', '@media (max-width: 767.98px)': '1fr' },
    paddingBlock: 12,
  },
  skColumn: { display: 'flex', flexDirection: 'column', gap: 12 },
  skBone: { height: 14, borderRadius: 4 },
  skBlock: { height: 56, borderRadius: tokens.radiusMd },
  empty: {
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
  onEntry: (entryId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const mode = useWorkspaceMode()
  // which question is open: the same address key the owner's page keeps
  const [open, setOpen] = usePageQueryState('open', '', {
    history: mode === 'phone' ? 'push' : 'replace',
  })

  const entries = useQuery(useParticipantEntries(batchId, participantId))
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
      toast.success(format(kind === 'void' ? m.staffVoided : m.staffReturned))
      refresh()
    },
    onError: (error) => toast.error(sayEntryFailure(error, { format, formatError })),
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
      toast.success(format(m.staffReopened))
      refresh()
    },
    onError: (error) => toast.error(sayEntryFailure(error, { format, formatError })),
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
      toast.success(format(m.staffRedetermined))
      refresh()
    },
    onError: (error) => setCorrectionProblem(sayEntryFailure(error, { format, formatError })),
  })

  const opened = claims.find((one) => one.entry.id === entryId) ?? null
  // kept mounted while the drawer shuts, or it would vanish rather than close
  const lingering = useLingering(opened)
  const itemsById = new Map(visible.map((item) => [item.id, item] as const))
  const rowsById = new Map(rows.map((row) => [row.id, row] as const))

  // A claim the address names opens on its own question: following a number
  // back from the account lands on the question it was filed under. Written
  // into the address in place, so closing the drawer leaves the reader on
  // that question rather than on whichever one the page would land on.
  const address = usePageQueryUpdate()
  const landedOn = opened !== null && open === '' ? opened.entry.itemId : null
  useEffect(() => {
    if (landedOn !== null) address({ open: landedOn }, { history: 'replace' })
  }, [landedOn, address])
  const openItem = landedOn ?? open

  return (
    <>
      <AsyncSection
        pending={entries.isPending || items.isPending || groups.isPending}
        error={
          entries.isError
            ? formatError(entries.error)
            : items.isError
              ? formatError(items.error)
              : null
        }
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => {
          void entries.refetch()
          void items.refetch()
          void groups.refetch()
        }}
        skeleton={
          <div {...stylex.props(styles.skeleton)}>
            <div {...stylex.props(styles.skColumn)}>
              {['60%', '80%', '45%', '70%', '55%'].map((width, index) => (
                <Skeleton
                  key={index}
                  className={stylex.props(styles.skBone).className}
                  width={width}
                />
              ))}
            </div>
            <div {...stylex.props(styles.skColumn)}>
              {[0, 1, 2].map((one) => (
                <Skeleton key={one} className={stylex.props(styles.skBlock).className} />
              ))}
            </div>
          </div>
        }
      >
        {rows.length === 0 ? (
          <p {...stylex.props(styles.empty)}>{format(m.entriesNoItems)}</p>
        ) : (
          <EntriesWorkspace
            viewer="staff"
            heading={format(m.entriesStaffHeading)}
            totalLabel={format(m.entriesStaffTotal)}
            rows={rows}
            entriesByItem={entriesByItem}
            entries={flat}
            standing={standing}
            scored={result.data !== undefined}
            open={openItem}
            onOpen={(id) => setOpen(id)}
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
                    {format(m.entriesRecordFor)}
                  </PageLink>
                </Button>
              ) : null
            }
            fit="window"
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
          onIntervene={(kind, reason) =>
            intervene.mutate({ entryId: lingering.entry.id, kind, reason })
          }
          summary={entryLineOf(lingering.entry, itemsById.get(lingering.entry.itemId)!, standing)}
        />
      )}
    </>
  )
}
