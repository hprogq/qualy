import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { trimAmount } from '../entry/model.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'

// Where one's approved claims put them right now, straight from the one
// scorer. Group by group, then every line with its own provenance: an
// approved claim with its amount, a refusal at zero, a group's limit as a
// visible adjustment - never a silent clamp.
//
// A group inside a group is shown inside it, because that is how it counts:
// its own questions and the groups under it add up first, and only then does
// its own limit apply. Read flat, the two limits look like one wrong sum.

export default function MyResultPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.resultTab)} description={format(m.resultHint)}>
      {(batch) => <Standing batchId={batch.id} />}
    </BatchScreen>
  )
}

/**
 * The scorer answers each group after the ones inside it, so it arrives
 * child first. Read top down here; a group naming a parent that is not in
 * the response stands as its own root rather than dropping out.
 */
const inTreeOrder = <Group extends { groupId: string; parentGroupId: string | null }>(
  groups: readonly Group[],
): Group[] => {
  const present = new Set(groups.map((group) => group.groupId))
  const childrenOf = new Map<string | null, Group[]>()
  for (const group of groups) {
    const parent =
      group.parentGroupId !== null && present.has(group.parentGroupId) ? group.parentGroupId : null
    const bucket = childrenOf.get(parent)
    if (bucket === undefined) childrenOf.set(parent, [group])
    else bucket.push(group)
  }
  const out: Group[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null) => {
    for (const group of childrenOf.get(parent) ?? []) {
      if (seen.has(group.groupId)) continue
      seen.add(group.groupId)
      out.push(group)
      walk(group.groupId)
    }
  }
  walk(null)
  return out
}

function Standing({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const result = useQuery(query.assessment.getMyResult.queryOptions({ params: { batchId } }))
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const data = result.data
  // a line names its item; which group that item adds up in is the item's
  // own configuration, so no line can be placed until both have landed
  const groupOfItem = new Map((items.data?.items ?? []).map((item) => [item.id, item.scoreGroupId]))
  const groups = data === undefined ? [] : inTreeOrder(data.groups)
  const parents = new Set(
    groups.flatMap((group) => (group.parentGroupId === null ? [] : [group.parentGroupId])),
  )

  return (
    <AsyncSection
      pending={result.isPending || items.isPending}
      error={result.error ? formatError(result.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void result.refetch()
        void items.refetch()
      }}
      skeleton={<Skeleton className="h-40 w-full" />}
    >
      {data !== undefined && (
        <div className="flex max-w-xl flex-col gap-4">
          <header className="flex items-baseline justify-between rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{format(m.resultTotal)}</span>
              <Badge variant="outline">{format(m.resultProvisional)}</Badge>
            </div>
            <span className="text-2xl font-semibold tabular-nums">{trimAmount(data.total)}</span>
          </header>

          {data.lines.length === 0 && (
            <p className="text-sm text-muted-foreground">{format(m.resultEmpty)}</p>
          )}

          {groups.map((group) => {
            const lines = data.lines.filter(
              (line) =>
                line.lineId.startsWith(`grp:${group.groupId}:`) ||
                (line.itemId !== undefined && groupOfItem.get(line.itemId) === group.groupId),
            )
            // said only where a limit actually moved the group, so the two
            // numbers on the heading always add up to what is shown
            const bounded =
              group.cap !== null && Number(group.final) < Number(group.raw)
                ? format(m.resultGroupCapped, {
                    raw: trimAmount(group.raw),
                    cap: trimAmount(group.cap),
                  })
                : group.floor !== null && Number(group.final) > Number(group.raw)
                  ? format(m.resultGroupFloored, {
                      raw: trimAmount(group.raw),
                      floor: trimAmount(group.floor),
                    })
                  : null
            return (
              <section
                key={group.groupId}
                className="rounded-lg border p-4"
                style={{ marginLeft: `${group.depth * 1.25}rem` }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 pb-2">
                  <h3 className="text-sm font-medium">{group.name}</h3>
                  <p className="text-sm tabular-nums">
                    <span className="pr-3 text-muted-foreground">
                      {format(m.resultGroupItems)} {trimAmount(group.itemsTotal)}
                    </span>
                    {parents.has(group.groupId) && (
                      <span className="pr-3 text-muted-foreground">
                        {format(m.resultGroupChildren)} {trimAmount(group.childrenTotal)}
                      </span>
                    )}
                    <span className="font-medium">
                      {format(m.resultGroupFinal)} {trimAmount(group.final)}
                    </span>
                  </p>
                </div>
                {bounded !== null && (
                  <p className="pb-2 text-xs text-muted-foreground">{bounded}</p>
                )}
                <ul className="flex flex-col gap-1 text-sm">
                  {lines.map((line) => (
                    <li key={line.lineId} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {line.label}
                        {line.kind === 'excluded-evidence' && (
                          <span className="pl-2 text-xs text-muted-foreground">
                            {format(m.resultLineExcluded)}
                          </span>
                        )}
                        {line.kind === 'entry-not-counted' && (
                          <span className="pl-2 text-xs text-muted-foreground">
                            {format(m.resultNotCounted)}
                          </span>
                        )}
                        {line.kind === 'item-voided' && (
                          <span className="pl-2 text-xs text-muted-foreground">
                            {format(m.resultLineVoided)}
                          </span>
                        )}
                        {line.kind === 'group-adjustment' && (
                          <span className="pl-2 text-xs text-muted-foreground">
                            {format(m.resultLineAdjustment)}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums">{trimAmount(line.value)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </AsyncSection>
  )
}
