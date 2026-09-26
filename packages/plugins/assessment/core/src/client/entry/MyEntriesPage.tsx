import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import {
  useApi,
  useApiQuery,
  usePageQueryState,
  usePageQueryUpdate,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { useMyEntriesQuery } from './my-entries.ts'
import { entryRefusalMessage } from './refusals.ts'
import { issueSentence, payloadIssuesOf } from './issues.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AppealDialog } from './AppealDialog.tsx'
import { SupplementAnswerDialog } from './SupplementAnswerDialog.tsx'
import { EntryDialog } from './EntryDialog.tsx'
import { EntrySheet } from './EntrySheet.tsx'
import { standingRows } from './standing.ts'
import { answerOf, fieldsOf, type EntryDto, type FilingGateDto, type ItemDto } from './model.ts'
import { EntriesWorkspace } from './workspace/EntriesWorkspace.tsx'
import { StandingNotice } from './workspace/StandingNotice.tsx'
import { useLineWords } from './workspace/calc.ts'
import { entryLineOf, type RoundState } from './workspace/model.ts'
import { useWorkspaceMode } from './workspace/layout.ts'

// One's own filings: the round's structure, one question of it opened, and
// every claim filed under that question - with the way to file another.
//
// The layout is the entries workspace, which a staff reader checking the
// same account also reads. What this page adds is the owner's own: the
// filing form, the drawer's acts on one's own claim, the appeal and the
// answer to a reviewer's ask, and the unread marks only the owner has.

const styles = stylex.create({
  fill: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  empty: { padding: 24, fontSize: 14, color: tokens.mutedForeground },
  // the page it is about to become, greyed
  skeleton: {
    display: 'grid',
    minHeight: 0,
    flexGrow: 1,
    gridTemplateColumns: { default: '300px minmax(0, 1fr)', '@media (max-width: 767.98px)': '1fr' },
  },
  skRail: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
    padding: 20,
  },
  skMain: {
    display: { default: 'flex', '@media (max-width: 767.98px)': 'none' },
    flexDirection: 'column',
    gap: 14,
    padding: 28,
  },
  skTitle: { height: 20, width: 96 },
  skTotal: { height: 34, width: 120 },
  skBar: { height: 6, width: '100%', borderRadius: 3 },
  skStats: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 },
  skStat: { height: 52, borderRadius: tokens.radiusMd },
  skRow: { height: 16 },
  skHeading: { height: 24, width: '40%' },
  skLine: { height: 14, width: '60%' },
  skClaim: { height: 56, width: '100%', borderRadius: tokens.radiusMd },
})

export default function MyEntriesPage() {
  const { format } = useI18n()
  return (
    // no band: the rail carries the page's own name and numbers, and the
    // workspace fills whatever the shell gives it
    <BatchScreen title={format(m.myEntriesTab)} size="full" chrome="none">
      {(batch) => (
        <Body
          batchId={batch.id}
          materialRange={batch.materialRange}
          round={{ status: batch.status, phaseName: batch.currentPhaseName }}
        />
      )}
    </BatchScreen>
  )
}

function Body({
  batchId,
  materialRange,
  round,
}: {
  batchId: string
  materialRange: { start: string; end: string }
  /** the stage the round is in, for saying which one shut filing */
  round: RoundState
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const queryClient = useQueryClient()
  const mode = useWorkspaceMode()
  // Every layer lives in the address - which question is open, which claim
  // is in the drawer, which claim is being written - so a reload keeps it, a
  // link carries it, and a phone's back key walks out of it one layer at a
  // time. Side by side the layers are furniture beside a list, and choosing
  // ten questions must not cost ten presses of back to undo.
  const history = mode === 'phone' ? 'push' : 'replace'
  const [open] = usePageQueryState('open')
  const [filing, setFiling] = usePageQueryState('entry', '', { history })
  const [detail, setDetail] = usePageQueryState('detail', '', { history })
  const updateQuery = usePageQueryUpdate()

  // Wake-ups from the server, mapped to the exact reads they stale. The
  // workspace redraws itself from fresh answers; nothing here touches the
  // form a person may be filling - the open dialog holds its own snapshot.
  const { live } = useBatchLive(batchId, (kind) => {
    const stale = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key })
    switch (kind) {
      // a phase switch may have flipped every capability on this screen, so
      // it re-reads the lot, exactly like a fresh connection
      case 'sync':
      case 'phase-changed':
        stale(query.assessment.key())
        return
      case 'entries-changed':
        stale(query.assessment.listMyEntries.key({ params: { batchId }, query: {} }))
        stale(query.assessment.listAwaitingSupplements.key({ query: { batchId } }))
        return
      case 'item-changed':
        stale(query.assessment.listItems.key({ params: { batchId } }))
        stale(query.assessment.listScoreGroups.key({ params: { batchId } }))
        return
      case 'result-changed':
        stale(query.assessment.getMyResult.key({ params: { batchId } }))
        return
      default:
        return
    }
  })

  const items = useQuery({
    ...query.assessment.listItems.queryOptions({ params: { batchId } }),
    refetchInterval: live ? 120_000 : 30_000,
  })
  const groups = useQuery({
    ...query.assessment.listScoreGroups.queryOptions({ params: { batchId } }),
    refetchInterval: live ? 120_000 : 30_000,
  })
  // what the round has already granted, part of the first paint: an amount
  // that arrives a moment later moves everything under it
  const standing = useQuery({
    ...query.assessment.getMyResult.queryOptions({ params: { batchId } }),
    refetchInterval: live ? 60_000 : 30_000,
  })
  const mine = useQuery({
    ...useMyEntriesQuery(batchId),
    refetchInterval: live ? 60_000 : 30_000,
  })
  const [appealing, setAppealing] = useState<EntryDto | null>(null)
  const lingeringAppeal = useLingering(appealing)
  const [answering, setAnswering] = useState<EntryDto | null>(null)
  const lingeringAnswer = useLingering(answering)

  const entries = useMemo(() => (mine.data?.entries ?? []) as readonly EntryDto[], [mine.data])
  const entriesByItem = useMemo(() => {
    const grouped = new Map<string, EntryDto[]>()
    for (const entry of entries) {
      const bucket = grouped.get(entry.itemId)
      if (bucket === undefined) grouped.set(entry.itemId, [entry])
      else bucket.push(entry)
    }
    return grouped
  }, [entries])
  // the phase gate's word on filing into each question, by item
  const gates = useMemo(
    () =>
      new Map(
        ((mine.data?.filing ?? []) as readonly FilingGateDto[]).map((gate) => [gate.itemId, gate]),
      ),
    [mine.data],
  )

  // the refresh key's one press: every read this screen stands on, again -
  // the batch's own standing included, which carries the current phase
  const refetchAll = () => {
    void items.refetch()
    void groups.refetch()
    void mine.refetch()
    void standing.refetch()
    void queryClient.invalidateQueries({
      queryKey: query.assessment.getBatch.key({ params: { batchId } }),
    })
  }
  const anyFetching =
    items.isFetching || groups.isFetching || mine.isFetching || standing.isFetching
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  }

  // A press made from the list or the drawer has no form open, so a refusal
  // over the claim's fields (a date outside the round, found only when the
  // claim is handed on) is said by those fields' names and what is wrong
  // with each - not as a failed save.
  const listJoin = useList()
  const lineWords = useLineWords()
  const sayFailure = (
    error: unknown,
    itemId: string,
    /** what the refused claim carried, where the press sent one */
    payload: Readonly<Record<string, unknown>> = {},
  ): string => {
    const issues = payloadIssuesOf(error)
    if (issues !== null) {
      const asked = (items.data?.items ?? []).find((one) => one.id === itemId) as
        | ItemDto
        | undefined
      const fields = fieldsOf(asked?.currentRevision?.formConfig)
      const said = issues.map((issue) => {
        const field = fields.find((one) => one.key === issue.field)
        const sentence = issueSentence(issue.reason, field, {
          value: answerOf(payload, issue.field),
          materialRange,
        })
        return `${field?.label ?? issue.field} ${format(sentence)}`
      })
      return format(m.entryListIssues, { issues: listJoin(said) })
    }
    const refusal = entryRefusalMessage(error)
    return refusal === null ? formatError(error) : format(refusal)
  }

  /**
   * A declaration filed in its one press: created and handed on in the same
   * breath. The dialog never opens - there is nothing in it to fill - and
   * the toast says what the press amounted to.
   */
  const declare = useMutation({
    mutationFn: async (input: { itemId: string }) => {
      if (mine.data === undefined) throw new Error('roster not loaded')
      // a declaration has no fields, but its worth and its route are still
      // the question's current version - the press names what it saw
      const seen = (items.data?.items ?? []).find((one) => one.id === input.itemId)?.currentRevision
        ?.id
      const created = await run(
        api.assessment.createEntry({
          payload: {
            itemId: input.itemId,
            participantId: mine.data.participantId,
            payload: {},
            ...(seen === undefined ? {} : { expectedItemRevisionId: seen }),
          },
        }),
      )
      const sent = await run(
        api.assessment.setEntryStatus({
          params: { entryId: created.entry.id },
          payload: {
            status: 'in_review',
            ...(seen === undefined ? {} : { expectedItemRevisionId: seen }),
          },
        }),
      )
      return sent.entry
    },
    onSuccess: (entry) => {
      toast.success(
        format(entry.status === 'approved' ? m.entryDeclaredCounted : m.entryDeclaredFiled),
      )
      refresh()
    },
    onError: (error: unknown, input) => toast.error(sayFailure(error, input.itemId)),
  })

  const setStatus = useMutation({
    mutationFn: (input: {
      entryId: string
      /** the question it answers, so a refusal can name the question's fields */
      itemId: string
      status: 'in_review' | 'draft' | 'voided'
      expectedItemRevisionId?: string
      expectedEntryRevisionId?: string
    }) =>
      run(
        api.assessment.setEntryStatus({
          params: { entryId: input.entryId },
          payload: {
            status: input.status,
            ...(input.expectedItemRevisionId === undefined
              ? {}
              : { expectedItemRevisionId: input.expectedItemRevisionId }),
            ...(input.expectedEntryRevisionId === undefined
              ? {}
              : { expectedEntryRevisionId: input.expectedEntryRevisionId }),
          },
        }),
      ),
    // said out loud, per act: three different things just happened to the
    // claim, and a silently refreshed list reports none of them
    onSuccess: (_result, input) => {
      toast.success(
        format(
          input.status === 'in_review'
            ? m.entrySubmittedToast
            : input.status === 'draft'
              ? m.entryWithdrawnToast
              : m.entryAbandonedToast,
        ),
      )
      refresh()
    },
    onError: (error: unknown, input) =>
      toast.error(
        sayFailure(
          error,
          input.itemId,
          (entries.find((one) => one.id === input.entryId)?.currentRevision?.payload ??
            {}) as Record<string, unknown>,
        ),
      ),
  })

  // Every question of the round this person takes part in, whoever fills it
  // in: one the school records is still theirs to read. A question still
  // being composed is the only one nobody outside the paper can see.
  const visible = useMemo(
    () =>
      ((items.data?.items ?? []) as readonly ItemDto[]).filter((item) => item.status !== 'draft'),
    [items.data],
  )
  const unreadItems = useMemo(
    () => new Set(mine.data?.attention?.unreadItemIds ?? []),
    [mine.data?.attention?.unreadItemIds],
  )
  const rows = useMemo(
    () =>
      standingRows({
        groups: groups.data?.groups ?? [],
        items: visible,
        entriesByItem,
        standing: standing.data ?? null,
        unreadItems,
      }),
    [groups.data, visible, entriesByItem, standing.data, unreadItems],
  )

  // Looking silences the dot (§32.72): a question on screen is a question
  // looked at. The cache is corrected locally: a look is not a business
  // change, so no refetch and no announcement ride on it.
  const listKey = query.assessment.listMyEntries.key({ params: { batchId }, query: {} })
  const markRead = useMutation({
    mutationFn: (itemId: string) =>
      run(api.assessment.markMyEntryRead({ params: { batchId, itemId } })),
    onSuccess: (_result, itemId) => {
      queryClient.setQueryData(
        listKey,
        (old: { attention: { unreadItemIds: readonly string[] } } | undefined) =>
          old === undefined
            ? old
            : {
                ...old,
                attention: {
                  unreadItemIds: old.attention.unreadItemIds.filter((id) => id !== itemId),
                },
              },
      )
    },
  })

  // The claim being written, resolved from the address: 'new' is one about
  // to exist on the open question, anything else is one of that question's
  // own claims by id. A parameter naming a claim that is gone opens nothing.
  const itemById = useMemo(
    () => new Map(rows.flatMap((row) => (row.item === undefined ? [] : [[row.id, row] as const]))),
    [rows],
  )
  const writingRow = filing === '' ? null : (itemById.get(open) ?? null)
  const writing =
    writingRow?.item === undefined
      ? null
      : {
          item: writingRow.item,
          trail: writingRow.trail,
          entry:
            filing === 'new'
              ? null
              : ((entriesByItem.get(writingRow.id) ?? []).find((one) => one.id === filing) ?? null),
        }
  const lingeringFiling = useLingering(writing)
  // the claim the drawer is holding, resolved the same way
  const detailed = (() => {
    if (detail === '') return null
    const found = entries.find((one) => one.id === detail)
    const itemRow = found === undefined ? undefined : itemById.get(found.itemId)
    return found === undefined || itemRow?.item === undefined
      ? null
      : { entry: found, item: itemRow.item, trail: itemRow.trail }
  })()
  const lingeringDetail = useLingering(detailed)

  // opening a question AND starting a claim on it is one address write: two
  // writes from one press race on the router's snapshot, and the second
  // silently drops the first
  const openAndFile = (itemId: string, entryId: string) =>
    updateQuery({ open: itemId, entry: entryId, detail: '' }, { history })

  // The score is read apart from the paper. Filing never waits on it, so a
  // score that cannot be computed right now takes away the figures and
  // nothing else - never drawn as a settled zero.
  const scored = standing.data !== undefined
  const scoreless = !scored && standing.error !== null
  // a score read once and not again stays, and says it may be behind
  const stale = scored && standing.isError
  // a read that failed only in the background keeps what it last showed:
  // replacing the page would take an open form down with it
  const failed = (read: { error: unknown; data: unknown }) =>
    read.data === undefined && read.error !== null ? formatError(read.error) : null

  return (
    <AsyncSection
      pending={items.isPending || mine.isPending || groups.isPending || standing.isPending}
      error={failed(items) ?? failed(groups) ?? failed(mine)}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void items.refetch()
        void groups.refetch()
        void mine.refetch()
        void standing.refetch()
      }}
      skeleton={
        <div {...stylex.props(styles.skeleton)}>
          <div {...stylex.props(styles.skRail)}>
            <Skeleton className={stylex.props(styles.skTitle).className} />
            <Skeleton className={stylex.props(styles.skTotal).className} />
            <Skeleton className={stylex.props(styles.skBar).className} />
            <div {...stylex.props(styles.skStats)}>
              {[0, 1, 2].map((one) => (
                <Skeleton key={one} className={stylex.props(styles.skStat).className} />
              ))}
            </div>
            {['70%', '55%', '80%', '45%', '65%'].map((width, index) => (
              <Skeleton
                key={index}
                className={stylex.props(styles.skRow).className}
                style={{ width }}
              />
            ))}
          </div>
          <div {...stylex.props(styles.skMain)}>
            <Skeleton className={stylex.props(styles.skLine).className} />
            <Skeleton className={stylex.props(styles.skHeading).className} />
            {[0, 1, 2].map((one) => (
              <Skeleton key={one} className={stylex.props(styles.skClaim).className} />
            ))}
          </div>
        </div>
      }
      xstyle={styles.fill}
    >
      {rows.length === 0 ? (
        <p {...stylex.props(styles.empty)}>{format(m.myEntriesEmpty)}</p>
      ) : (
        <EntriesWorkspace
          viewer="owner"
          heading={format(m.myEntriesTab)}
          totalLabel={format(m.entriesCountedTotal)}
          rows={rows}
          entriesByItem={entriesByItem}
          entries={entries}
          standing={standing.data ?? null}
          scored={scored}
          notice={
            (scoreless || stale) && (
              <StandingNotice
                error={standing.error}
                stale={stale}
                retrying={standing.isFetching}
                onRetry={() => void standing.refetch()}
              />
            )
          }
          open={open}
          // the workspace says which moves are somewhere to come back from:
          // a phone's step into a question, and going up to a section
          onOpen={(id, how) => updateQuery({ open: id }, { history: how })}
          gates={gates}
          round={round}
          busy={setStatus.isPending || declare.isPending}
          refreshing={anyFetching}
          onRefresh={refetchAll}
          openEntryId={detail}
          onEntry={(entry) => setDetail(entry.id)}
          onFile={(item) =>
            item.itemType === 'declaration'
              ? declare.mutate({ itemId: item.id })
              : openAndFile(item.id, 'new')
          }
          onShow={(row) => {
            if (row.unread) markRead.mutate(row.id)
          }}
          fit="parent"
        />
      )}

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {lingeringFiling !== null && mine.data !== undefined && (
        <EntryDialog
          key={lingeringFiling.entry?.id ?? `new:${lingeringFiling.item.id}`}
          open={writing !== null}
          batchId={batchId}
          materialRange={materialRange}
          participantId={mine.data.participantId}
          item={lingeringFiling.item}
          entry={lingeringFiling.entry}
          submitGate={gates.get(lingeringFiling.item.id)?.submit}
          trail={lingeringFiling.trail}
          siblings={(entriesByItem.get(lingeringFiling.item.id) ?? []).filter(
            (one) => one.id !== lingeringFiling.entry?.id,
          )}
          onClose={() => setFiling('')}
          onSaved={() => {
            setFiling('')
            refresh()
          }}
          onStale={() => void items.refetch()}
          onChangedElsewhere={refresh}
        />
      )}
      {/* the drawer that holds the whole claim; its account is a tab inside */}
      {lingeringDetail !== null && (
        <EntrySheet
          open={detailed !== null}
          entry={detailed?.entry ?? lingeringDetail.entry}
          item={lingeringDetail.item}
          resubmit={gates.get(lingeringDetail.item.id)?.submit}
          trail={lingeringDetail.trail}
          busy={setStatus.isPending || declare.isPending}
          onClose={() => setDetail('')}
          onEdit={() => openAndFile(lingeringDetail.item.id, lingeringDetail.entry.id)}
          onStatus={(status, expectedItemRevisionId) => {
            // the version the sheet is showing is the one handed on
            const shownRevision = (detailed?.entry ?? lingeringDetail.entry).currentRevision?.id
            setStatus.mutate({
              entryId: lingeringDetail.entry.id,
              itemId: lingeringDetail.item.id,
              status,
              ...(expectedItemRevisionId === undefined ? {} : { expectedItemRevisionId }),
              ...(status !== 'in_review' || shownRevision === undefined
                ? {}
                : { expectedEntryRevisionId: shownRevision }),
            })
          }}
          onAppeal={() => setAppealing(lingeringDetail.entry)}
          onSupplement={() => setAnswering(lingeringDetail.entry)}
          summary={entryLineOf(
            detailed?.entry ?? lingeringDetail.entry,
            lingeringDetail.item,
            standing.data ?? null,
            lineWords,
          )}
        />
      )}
      {lingeringAppeal != null && (
        <AppealDialog
          /* keyed by what it is about, so a second request does not open on
             the first one's typing */
          key={lingeringAppeal.id}
          open={appealing !== null}
          entryId={lingeringAppeal.id}
          onClose={() => setAppealing(null)}
          onDone={() => {
            setAppealing(null)
            refresh()
          }}
        />
      )}
      {lingeringAnswer?.supplement != null && (
        <SupplementAnswerDialog
          key={lingeringAnswer.supplement.requestId}
          open={answering !== null}
          entry={lingeringAnswer}
          supplement={lingeringAnswer.supplement}
          onClose={() => setAnswering(null)}
          onDone={() => {
            setAnswering(null)
            refresh()
          }}
        />
      )}
    </AsyncSection>
  )
}
