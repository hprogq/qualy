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
import { entryStatusMessage, entryStatusVariant, type EntryDto, type ItemDto } from './model.ts'

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
  // what the round has already granted, so a group can say where it stands
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
  const visible = ((items.data?.items ?? []) as readonly ItemDto[]).filter(
    (item) =>
      item.currentRevision?.entrySource === 'student' ||
      (entriesByItem.get(item.id)?.length ?? 0) > 0,
  )

  // the score tree, as the filing screen reads it: a group, then the groups
  // inside it, then the questions that file under each
  const tree = useMemo(() => {
    const childrenOf = new Map<string | null, { id: string; name: string; depth: number }[]>()
    for (const group of groups.data?.groups ?? []) {
      const bucket = childrenOf.get(group.parentGroupId)
      const row = { id: group.id, name: group.name, depth: 0 }
      if (bucket === undefined) childrenOf.set(group.parentGroupId, [row])
      else bucket.push(row)
    }
    const out: { id: string; name: string; depth: number }[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const group of childrenOf.get(parent) ?? []) {
        out.push({ ...group, depth })
        walk(group.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [groups.data])

  const standingOf = (groupId: string) =>
    (standing.data?.groups ?? []).find((group) => group.groupId === groupId)

  return (
    <AsyncSection
      pending={items.isPending || mine.isPending || groups.isPending}
      error={items.error ? formatError(items.error) : mine.error ? formatError(mine.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void items.refetch()
        void mine.refetch()
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
        {tree.map((group) => {
          const own = visible.filter((item) => item.scoreGroupId === group.id)
          const score = standingOf(group.id)
          if (own.length === 0 && score === undefined) return null
          return (
            <section key={group.id} style={{ marginLeft: `${group.depth * 1.25}rem` }}>
              <div className="flex items-baseline justify-between border-b pb-1">
                <h3 className="text-sm font-medium">{group.name}</h3>
                {score !== undefined && (
                  <p className="text-sm tabular-nums text-muted-foreground">
                    {score.final}
                    {score.cap !== null && ` / ${score.cap}`}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-4 pt-3">
                {own.length === 0 && (
                  <p className="text-sm text-muted-foreground">{format(m.myEntriesGroupEmpty)}</p>
                )}
                {own.map((item) => {
                  const owned = entriesByItem.get(item.id) ?? []
                  const live = owned.filter((entry) => entry.status !== 'voided')
                  const mayFile =
                    item.status === 'active' &&
                    item.currentRevision?.entrySource === 'student' &&
                    (item.maxEntries === null || live.length < item.maxEntries)
                  const fixedValue = (
                    item.currentRevision?.scoringConfig as
                      { calculator?: { config?: { value?: string } } } | undefined
                  )?.calculator?.config?.value
                  return (
                    <section key={item.id} className="rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium">{item.title}</h3>
                          <p className="pt-0.5 text-xs text-muted-foreground">
                            {item.status === 'voided'
                              ? format(m.itemVoided)
                              : fixedValue !== undefined
                                ? format(m.entryCountsFor, { value: fixedValue })
                                : null}
                          </p>
                        </div>
                        {mayFile && (
                          <Button size="sm" onClick={() => setEditing({ item, entry: null })}>
                            {format(m.entryNew)}
                          </Button>
                        )}
                      </div>
                      {owned.length > 0 && (
                        <ul className="mt-3 flex flex-col gap-2">
                          {owned.map((entry) => (
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
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setHistory(entry.id)}
                                >
                                  {format(m.entryHistoryOpen)}
                                </Button>
                                {entry.capabilities.canEdit && item.status === 'active' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditing({ item, entry })}
                                  >
                                    {format(m.entryEdit)}
                                  </Button>
                                )}
                                {entry.capabilities.canSubmit && item.status === 'active' && (
                                  <Button
                                    size="sm"
                                    disabled={setStatus.isPending}
                                    onClick={() =>
                                      setStatus.mutate({ entryId: entry.id, status: 'in_review' })
                                    }
                                  >
                                    {format(m.entrySubmit)}
                                  </Button>
                                )}
                                {entry.capabilities.canWithdraw && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={setStatus.isPending}
                                    onClick={() =>
                                      setStatus.mutate({ entryId: entry.id, status: 'draft' })
                                    }
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
                })}
              </div>
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
