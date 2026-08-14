import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { entryRefusalMessage } from './refusals.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { EntryDialog } from './EntryDialog.tsx'
import { EntryHistory } from './EntryHistory.tsx'
import {
  trimAmount,
  entryStatusMessage,
  entryStatusVariant,
  type EntryDto,
  type ItemDto,
} from './model.ts'

// One's own filings, question by question. Each card answers the only three
// things a participant came to ask: what is this question, where does my
// claim on it stand, and what can I do to it right now.

export default function MyEntriesPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.myEntriesTab)} description={format(m.myEntriesHint)}>
      {(batch) => <Body batchId={batch.id} materialRange={batch.materialRange} />}
    </BatchScreen>
  )
}

/** a score group as this screen reads it, already placed in the tree */
interface GroupRow {
  id: string
  parentGroupId: string | null
  name: string
  depth: number
}

function Body({
  batchId,
  materialRange,
}: {
  batchId: string
  materialRange: { start: string; end: string }
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const queryClient = useQueryClient()
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const groups = useQuery(query.assessment.listScoreGroups.queryOptions({ params: { batchId } }))
  // what the round has already granted, so a group can say where it stands.
  // It is part of the first paint like the rest: an amount that arrives a
  // moment later moves every card underneath it out from under the cursor
  const standing = useQuery(query.assessment.getMyResult.queryOptions({ params: { batchId } }))
  const mine = useQuery(
    query.assessment.listMyEntries.queryOptions({ params: { batchId }, query: {} }),
  )
  const [editing, setEditing] = useState<{ item: ItemDto; entry: EntryDto | null } | null>(null)
  const [history, setHistory] = useState<string | null>(null)

  const entriesByItem = useMemo(() => {
    const grouped = new Map<string, EntryDto[]>()
    for (const entry of (mine.data?.entries ?? []) as readonly EntryDto[]) {
      const bucket = grouped.get(entry.itemId)
      if (bucket === undefined) grouped.set(entry.itemId, [entry])
      else bucket.push(entry)
    }
    return grouped
  }, [mine.data])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  }

  const setStatus = useMutation({
    mutationFn: (input: { entryId: string; status: 'in_review' | 'draft' }) =>
      run(
        api.assessment.setEntryStatus({
          params: { entryId: input.entryId },
          payload: { status: input.status },
        }),
      ),
    onSuccess: refresh,
    onError: (error: unknown) => {
      const refusal = entryRefusalMessage(error)
      toast.error(refusal === null ? formatError(error) : format(refusal))
    },
  })

  // questions this person files themselves; what staff recorded about them
  // still shows through their own entry rows below the same card
  const visible = useMemo(
    () =>
      ((items.data?.items ?? []) as readonly ItemDto[]).filter(
        (item) =>
          // a draft question reaches this screen only for a reader who also
          // composes the paper, and it is not theirs to file either
          item.status !== 'draft' &&
          (item.currentRevision?.entrySource === 'student' ||
            (entriesByItem.get(item.id)?.length ?? 0) > 0),
      ),
    [items.data, entriesByItem],
  )

  // the score tree, as the filing screen reads it: a group, then the groups
  // inside it, then the questions that file under each
  const tree = useMemo(() => {
    const childrenOf = new Map<string | null, GroupRow[]>()
    for (const group of groups.data?.groups ?? []) {
      const bucket = childrenOf.get(group.parentGroupId)
      const row = {
        id: group.id,
        parentGroupId: group.parentGroupId,
        name: group.name,
        depth: 0,
      }
      if (bucket === undefined) childrenOf.set(group.parentGroupId, [row])
      else bucket.push(row)
    }
    const out: GroupRow[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const group of childrenOf.get(parent) ?? []) {
        out.push({ ...group, depth })
        walk(group.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [groups.data])

  // a group earns its heading by holding questions, or by holding a group
  // that does. The rest of the paper is a structure this participant can put
  // nothing into, and a filing screen is not the place to read it.
  const filled = useMemo(() => {
    const parentOf = new Map(tree.map((group) => [group.id, group.parentGroupId]))
    const found = new Set<string>()
    for (const item of visible) {
      let at: string | null = item.scoreGroupId
      while (at !== null && !found.has(at)) {
        found.add(at)
        at = parentOf.get(at) ?? null
      }
    }
    return found
  }, [tree, visible])

  // a question whose group is missing from the response is still a question
  // this participant may file; it stands on its own rather than falling out
  // of the loop below
  const placed = useMemo(() => new Set(tree.map((group) => group.id)), [tree])
  const loose = visible.filter((item) => !placed.has(item.scoreGroupId))

  const standingOf = (groupId: string) =>
    (standing.data?.groups ?? []).find((group) => group.groupId === groupId)

  const card = (item: ItemDto) => (
    <QuestionCard
      key={item.id}
      item={item}
      entries={entriesByItem.get(item.id) ?? []}
      busy={setStatus.isPending}
      onFile={() => setEditing({ item, entry: null })}
      onEdit={(entry) => setEditing({ item, entry })}
      onHistory={setHistory}
      onStatus={(entryId, status) => setStatus.mutate({ entryId, status })}
    />
  )

  return (
    <AsyncSection
      pending={items.isPending || mine.isPending || groups.isPending || standing.isPending}
      error={
        items.error
          ? formatError(items.error)
          : groups.error
            ? formatError(groups.error)
            : mine.error
              ? formatError(mine.error)
              : null
      }
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void items.refetch()
        void groups.refetch()
        void mine.refetch()
        void standing.refetch()
      }}
      skeleton={
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground">{format(m.myEntriesEmpty)}</p>
        )}
        {loose.length > 0 && <div className="flex flex-col gap-4">{loose.map(card)}</div>}
        {tree
          .filter((group) => filled.has(group.id))
          .map((group) => {
            const own = visible.filter((item) => item.scoreGroupId === group.id)
            const score = standingOf(group.id)
            return (
              <section key={group.id} style={{ marginLeft: `${group.depth * 1.25}rem` }}>
                <div className="flex items-baseline justify-between border-b pb-1">
                  <h3 className="text-sm font-medium">{group.name}</h3>
                  {score !== undefined && (
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {trimAmount(score.final)}
                      {score.cap !== null && ` / ${trimAmount(score.cap)}`}
                    </p>
                  )}
                </div>
                {own.length > 0 && <div className="flex flex-col gap-4 pt-3">{own.map(card)}</div>}
              </section>
            )
          })}
      </div>

      {editing !== null && mine.data !== undefined && (
        <EntryDialog
          batchId={batchId}
          materialRange={materialRange}
          participantId={mine.data.participantId}
          item={editing.item}
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
      {history !== null && <EntryHistory entryId={history} onClose={() => setHistory(null)} />}
    </AsyncSection>
  )
}

function QuestionCard({
  item,
  entries,
  busy,
  onFile,
  onEdit,
  onHistory,
  onStatus,
}: {
  item: ItemDto
  entries: readonly EntryDto[]
  busy: boolean
  onFile: () => void
  onEdit: (entry: EntryDto) => void
  onHistory: (entryId: string) => void
  onStatus: (entryId: string, status: 'in_review' | 'draft') => void
}) {
  const { format } = useI18n()
  const live = entries.filter((entry) => entry.status !== 'voided')
  const mayFile =
    item.status === 'active' &&
    item.currentRevision?.entrySource === 'student' &&
    (item.maxEntries === null || live.length < item.maxEntries)
  const fixedValue = (
    item.currentRevision?.scoringConfig as
      { calculator?: { config?: { value?: string } } } | undefined
  )?.calculator?.config?.value

  return (
    <section className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{item.title}</h3>
          <p className="pt-0.5 text-xs text-muted-foreground">
            {item.status === 'voided'
              ? format(m.itemVoided)
              : fixedValue !== undefined
                ? format(m.entryCountsFor, { value: trimAmount(fixedValue) })
                : null}
          </p>
        </div>
        {mayFile && (
          <Button size="sm" onClick={onFile}>
            {format(m.entryNew)}
          </Button>
        )}
      </div>
      {entries.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2 text-sm">
                <Badge variant={entryStatusVariant[entry.status]}>
                  {format(entryStatusMessage[entry.status])}
                </Badge>
                <span className="text-muted-foreground">
                  {format(m.entryUpdatedAt, {
                    when: new Date(entry.createdAt).toLocaleDateString(),
                  })}
                </span>
                {entry.currentRevision?.note !== null &&
                  entry.currentRevision?.note !== undefined && (
                    <span className="hidden max-w-48 truncate text-muted-foreground sm:inline">
                      {entry.currentRevision.note}
                    </span>
                  )}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => onHistory(entry.id)}>
                  {format(m.entryHistoryOpen)}
                </Button>
                {entry.capabilities.canEdit && item.status === 'active' && (
                  <Button variant="outline" size="sm" onClick={() => onEdit(entry)}>
                    {format(m.entryEdit)}
                  </Button>
                )}
                {entry.capabilities.canSubmit && item.status === 'active' && (
                  <Button size="sm" disabled={busy} onClick={() => onStatus(entry.id, 'in_review')}>
                    {format(m.entrySubmit)}
                  </Button>
                )}
                {entry.capabilities.canWithdraw && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onStatus(entry.id, 'draft')}
                  >
                    {format(m.entryWithdraw)}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
