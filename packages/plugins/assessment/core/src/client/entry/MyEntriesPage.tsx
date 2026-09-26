import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import {
  useApi,
  useApiQuery,
  useClaimScreenFill,
  usePageQueryState,
  usePageQueryUpdate,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { useMyEntriesQuery } from './my-entries.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AppealDialog } from './AppealDialog.tsx'
import { SupplementAnswerDialog } from './SupplementAnswerDialog.tsx'
import { EntryDialog } from './EntryDialog.tsx'
import { EntrySheet } from './EntrySheet.tsx'
import { useMarkEntryRead, useOwnClaimActs, useOwnFailure } from './own-acts.ts'
import { standingRows } from './standing.ts'
import type { EntryDto, FilingGateDto, ItemDto } from './model.ts'
import { EntriesWorkspace } from './workspace/EntriesWorkspace.tsx'
import { WorkspaceSkeleton } from './workspace/WorkspaceSkeleton.tsx'
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
})

export default function MyEntriesPage() {
  const { format } = useI18n()
  // From a tablet up the page is a workbench: its columns scroll each in
  // their own place and the window never does, so it says so to the shell,
  // which then keeps no room for a scroll bar that never comes. On a phone
  // it is a page like any other.
  useClaimScreenFill(useWorkspaceMode() !== 'phone')
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
  const { live, lost, heard } = useBatchLive(batchId, (kind) => {
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
  // An account that no longer moves is not said to be kept current: the
  // round is archived, or the participant is off the roster - which is when
  // the server hides the filing gate of every question, as it never does
  // for anybody still on it.
  const offRoster =
    gates.size > 0 && [...gates.values()].every((gate) => gate.create.state === 'hidden')
  const closed = round.status === 'archived' || offRoster

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

  const lineWords = useLineWords()
  // the owner's acts from the list and the drawer, said the way every page
  // with the drawer says them
  const questions = useMemo(() => (items.data?.items ?? []) as readonly ItemDto[], [items.data])
  const acts = useOwnClaimActs({ items: questions, entries, materialRange })
  const sayFailure = useOwnFailure({ items: questions, entries, materialRange })

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
      const seen = questions.find((one) => one.id === input.itemId)?.currentRevision?.id
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

  // Every question of the round this person takes part in, whoever fills it
  // in: one the school records is still theirs to read. A question still
  // being composed is the only one nobody outside the paper can see.
  const visible = useMemo(() => questions.filter((item) => item.status !== 'draft'), [questions])
  const unreadEntries = useMemo(
    () => new Set(mine.data?.attention?.unreadEntryIds ?? []),
    [mine.data?.attention?.unreadEntryIds],
  )
  const rows = useMemo(
    () =>
      standingRows({
        groups: groups.data?.groups ?? [],
        items: visible,
        entriesByItem,
        standing: standing.data ?? null,
        unreadEntries,
      }),
    [groups.data, visible, entriesByItem, standing.data, unreadEntries],
  )

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

  // A claim's news is read by opening that claim (§32.72, amended): its
  // drawer, or its form, which opens on the words it came back with. Opening
  // the question it sits under reads nothing. News that lands while the
  // claim is open is read as it lands.
  const markRead = useMarkEntryRead(batchId).mutate
  const reading = [detailed?.entry.id, writing?.entry?.id].filter(
    (id): id is string => id !== undefined && unreadEntries.has(id),
  )
  const readingKey = reading.join()
  useEffect(() => {
    for (const id of reading) markRead(id)
    // what matters is which open claims hold news, not the array's identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingKey, markRead])

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
      // the workspace it is about to become, column for column
      skeleton={<WorkspaceSkeleton viewer="owner" open={open !== ''} />}
      xstyle={styles.fill}
    >
      {rows.length === 0 ? (
        <p {...stylex.props(styles.empty)}>{format(m.myEntriesEmpty)}</p>
      ) : (
        <EntriesWorkspace
          viewer="owner"
          heading={format(m.myEntriesTab)}
          totalLabel={format(m.entriesCountedTotal)}
          live={closed ? null : { live, lost, heard }}
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
          busy={acts.isPending || declare.isPending}
          refreshing={anyFetching}
          onRefresh={refetchAll}
          openEntryId={detail}
          onEntry={(entry) => setDetail(entry.id)}
          onFile={(item) =>
            item.itemType === 'declaration'
              ? declare.mutate({ itemId: item.id })
              : openAndFile(item.id, 'new')
          }
          unreadEntries={unreadEntries}
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
          busy={acts.isPending || declare.isPending}
          onClose={() => setDetail('')}
          onEdit={() => openAndFile(lingeringDetail.item.id, lingeringDetail.entry.id)}
          onStatus={(status, expectedItemRevisionId) => {
            // the version the sheet is showing is the one handed on
            const shownRevision = (detailed?.entry ?? lingeringDetail.entry).currentRevision?.id
            acts.mutate({
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
