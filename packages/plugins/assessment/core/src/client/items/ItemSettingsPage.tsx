import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlertIcon } from 'lucide-react'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { GroupEditor } from './GroupEditor.tsx'
import { ItemConfigEditor } from './ItemConfigEditor.tsx'
import { PaperTree, type TreeGroup, type TreeSelection } from './PaperTree.tsx'
import { VoidQuestionDialog } from './VoidQuestionDialog.tsx'
import type { ItemDto } from '../entry/model.ts'

// Composing a round with the paper always in sight: its structure down the
// left, the selected part opened for editing on the right. A drag in the
// tree is persisted here - the tree only says what should now come where.

export default function ItemSettingsPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.itemsTab)} description={format(m.itemsHint)} size="full" flush>
      {(batch) => (
        <Editor batchId={batch.id} batchStatus={batch.status} materialRange={batch.materialRange} />
      )}
    </BatchScreen>
  )
}

function Editor({
  batchId,
  batchStatus,
  materialRange,
}: {
  batchId: string
  batchStatus: string
  materialRange: { start: string; end: string }
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const groups = useQuery(query.assessment.listScoreGroups.queryOptions({ params: { batchId } }))
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const options = useQuery(query.assessment.itemOptions.queryOptions({ params: { batchId } }))
  const alerts = useQuery({
    ...query.assessment.reviewAlerts.queryOptions({ params: { batchId } }),
    refetchInterval: 60_000,
  })
  const [selection, setSelection] = useState<TreeSelection | null>(null)
  const [voiding, setVoiding] = useState<ItemDto | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  }

  const restore = useMutation({
    mutationFn: (itemId: string) =>
      run(api.assessment.setItemStatus({ params: { itemId }, payload: { status: 'active' } })),
    onSuccess: refresh,
    onError: (error) => toast.error(formatError(error)),
  })

  const remove = useMutation({
    mutationFn: (itemId: string) => run(api.assessment.deleteItem({ params: { itemId } })),
    onSuccess: () => {
      setSelection(null)
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const allGroups = groups.data?.groups ?? []
  const allItems = (items.data?.items ?? []) as readonly ItemDto[]

  const addItem = useMutation({
    mutationFn: (groupId: string) =>
      run(
        api.assessment.createItem({
          params: { batchId },
          payload: {
            itemType: 'evidence',
            title: format(m.itemsUntitled),
            scoreGroupId: groupId,
            maxEntries: 1,
            config: {
              entrySource: 'student',
              formConfig: {
                fields: [{ key: 'f1', type: 'text', label: format(m.itemsDefaultFieldLabel) }],
              },
              scoringConfig: {
                calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                aggregator: { ref: 'sum@1', config: {} },
              },
              reviewPolicy: {
                stages: [
                  {
                    selector: {
                      kind: 'roleAt',
                      nodeTypeId: options.data?.orgTypes[0]?.id ?? '',
                      roleIds: [options.data?.roles[0]?.id ?? ''],
                    },
                    quorum: { type: 'any' },
                  },
                ],
                normalTerminal: 0,
              },
            } as never,
          },
        }),
      ),
    onSuccess: (result: { item: { id: string } }) => {
      setSelection({ kind: 'item', id: result.item.id })
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const addGroup = useMutation({
    mutationFn: (parentId: string | null) =>
      run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: [
              ...allGroups.map((group) => ({
                id: group.id,
                parentGroupId: group.parentGroupId,
                name: group.name,
                cap: group.cap,
                floor: group.floor,
              })),
              {
                parentGroupId: parentId,
                name: format(m.itemsGroupUnnamed),
                cap: null,
                floor: null,
              },
            ],
          },
        }),
      ),
    onSuccess: (result: { groups: readonly { id: string }[] }) => {
      const known = new Set(allGroups.map((group) => group.id))
      const created = result.groups.find((group) => !known.has(group.id))
      if (created !== undefined) setSelection({ kind: 'group', id: created.id })
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  // a drop, made durable: only the rows whose place actually changed are
  // written, so an idle drag costs nothing
  const moveItem = useMutation({
    mutationFn: async (input: {
      itemId: string
      groupId: string
      orderedItemIds: readonly string[]
    }) => {
      for (const [index, id] of input.orderedItemIds.entries()) {
        const current = allItems.find((item) => item.id === id)
        if (current === undefined) continue
        const movedGroup = id === input.itemId && current.scoreGroupId !== input.groupId
        if (current.sortOrder !== index || movedGroup) {
          await run(
            api.assessment.updateItem({
              params: { itemId: id },
              payload: {
                sortOrder: index,
                ...(movedGroup ? { scoreGroupId: input.groupId } : {}),
              },
            }),
          )
        }
      }
    },
    onSuccess: refresh,
    onError: (error) => {
      toast.error(formatError(error))
      refresh()
    },
  })

  const reorderGroups = useMutation({
    mutationFn: (input: { parentId: string | null; orderedGroupIds: readonly string[] }) =>
      run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: allGroups.map((group) => ({
              id: group.id,
              parentGroupId: group.parentGroupId,
              name: group.name,
              cap: group.cap,
              floor: group.floor,
              sortOrder:
                group.parentGroupId === input.parentId
                  ? input.orderedGroupIds.indexOf(group.id)
                  : group.sortOrder,
            })),
          },
        }),
      ),
    onSuccess: refresh,
    onError: (error) => {
      toast.error(formatError(error))
      refresh()
    },
  })

  const roots = (allGroups as readonly TreeGroup[]).filter((group) => group.parentGroupId === null)
  const capSum =
    roots.length > 0 && roots.every((group) => group.cap !== null)
      ? String(roots.reduce((cents, group) => cents + Math.round(Number(group.cap) * 100), 0) / 100)
      : null

  const selectedItem =
    selection?.kind === 'item' ? (allItems.find((item) => item.id === selection.id) ?? null) : null
  const selectedGroup =
    selection?.kind === 'group'
      ? (allGroups.find((group) => group.id === selection.id) ?? null)
      : null

  return (
    <AsyncSection
      pending={groups.isPending || items.isPending || options.isPending}
      error={
        groups.error ? formatError(groups.error) : items.error ? formatError(items.error) : null
      }
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void groups.refetch()
        void items.refetch()
      }}
      skeleton={<Skeleton className="h-96 w-full" />}
    >
      <div className="flex flex-col">
        {(alerts.data?.groups ?? []).length > 0 && (
          <section className="mx-6 mt-4 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-destructive">{format(m.itemsStuckTitle)}</p>
              <ul className="pt-1 text-sm">
                {(alerts.data?.groups ?? []).map((row) => (
                  <li key={`${row.nodeId}:${row.roleNames.join(',')}`}>
                    {format(m.itemsStuckRow, {
                      unit: row.nodeName,
                      roles: row.roleNames.join('、'),
                      count: row.waiting,
                    })}
                  </li>
                ))}
              </ul>
              <p className="pt-1 text-xs text-muted-foreground">{format(m.itemsStuckHint)}</p>
            </div>
          </section>
        )}

        {/* the one line, floor to ceiling: the rail's cell stretches with the
            row, so the border is the divider the whole way down */}
        <div className="grid min-h-[calc(100dvh-16rem)] lg:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)]">
          <aside className="border-b bg-muted/30 lg:border-r lg:border-b-0">
            <div className="flex flex-col lg:sticky lg:top-0 lg:max-h-dvh">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <span className="text-sm font-medium">{format(m.itemsTreeTitle)}</span>
                <span className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs text-primary"
                  onClick={() => addGroup.mutate(null)}
                >
                  {format(m.itemsGroupAdd)}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                <PaperTree
                  groups={allGroups as readonly TreeGroup[]}
                  items={allItems}
                  selection={selection}
                  onSelect={setSelection}
                  onAddItem={(groupId) => addItem.mutate(groupId)}
                  onAddGroup={(parentId) => addGroup.mutate(parentId)}
                  onMoveItem={(itemId, groupId, orderedItemIds) =>
                    moveItem.mutate({ itemId, groupId, orderedItemIds })
                  }
                  onReorderGroups={(parentId, orderedGroupIds) =>
                    reorderGroups.mutate({ parentId, orderedGroupIds })
                  }
                />
              </div>
              {capSum !== null && (
                <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                  {format(m.itemsCapSum, { sum: capSum })}
                </p>
              )}
            </div>
          </aside>

          <div className="min-w-0 px-6 py-6 lg:px-8">
            {selection === null && (
              <div className="flex min-h-64 items-center justify-center">
                <p className="text-sm text-muted-foreground">{format(m.itemsPickTarget)}</p>
              </div>
            )}

            {selectedGroup !== null && (
              <GroupEditor
                key={selectedGroup.id}
                batchId={batchId}
                batchStatus={batchStatus}
                groups={allGroups as readonly TreeGroup[]}
                editing={selectedGroup as TreeGroup}
                onDone={refresh}
              />
            )}

            {selectedItem !== null && options.data !== undefined && (
              <ItemConfigEditor
                key={selectedItem.id}
                batchId={batchId}
                materialRange={materialRange}
                item={selectedItem}
                groups={allGroups.map((one) => ({ id: one.id, name: one.name }))}
                options={options.data}
                actions={
                  <QuestionActions
                    item={selectedItem}
                    batchStatus={batchStatus}
                    busy={restore.isPending || remove.isPending}
                    onVoid={() => setVoiding(selectedItem)}
                    onRestore={() => restore.mutate(selectedItem.id)}
                    onDelete={() => remove.mutate(selectedItem.id)}
                  />
                }
                onSaved={refresh}
              />
            )}
          </div>
        </div>
      </div>

      {voiding !== null && (
        <VoidQuestionDialog
          item={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null)
            refresh()
          }}
        />
      )}
    </AsyncSection>
  )
}

function QuestionActions({
  item,
  batchStatus,
  busy,
  onVoid,
  onRestore,
  onDelete,
}: {
  item: ItemDto
  batchStatus: string
  busy: boolean
  onVoid: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const { format } = useI18n()
  return (
    <div className="flex items-center gap-1">
      {item.status === 'voided' && <Badge variant="outline">{format(m.itemsStatusVoided)}</Badge>}
      {item.status === 'active' && batchStatus !== 'draft' && (
        <Button variant="outline" size="sm" onClick={onVoid}>
          {format(m.itemsVoid)}
        </Button>
      )}
      {item.status === 'voided' && (
        <Button variant="outline" size="sm" disabled={busy} onClick={onRestore}>
          {format(m.itemsRestore)}
        </Button>
      )}
      {batchStatus === 'draft' && (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={busy}
          onClick={onDelete}
        >
          {format(m.itemsDelete)}
        </Button>
      )}
    </div>
  )
}
