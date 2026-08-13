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
import { GroupPanel } from './GroupPanel.tsx'
import { ItemConfigEditor } from './ItemConfigEditor.tsx'
import { PaperOutline, type Selection } from './PaperOutline.tsx'
import { VoidQuestionDialog } from './VoidQuestionDialog.tsx'
import type { ItemDto } from '../entry/model.ts'

// Composing a round the way a paper is composed: the whole structure down the
// left, one part open beside it. Nothing here is a dialog over the paper -
// somebody setting questions is constantly comparing what they are writing
// with what is already there, and a modal takes exactly that away.

export default function ItemSettingsPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.itemsTab)} description={format(m.itemsHint)} size="wide">
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
  const [selection, setSelection] = useState<Selection | null>(null)
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
      <div className="flex flex-col gap-4">
        {(alerts.data?.groups ?? []).length > 0 && (
          <section className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-destructive">{format(m.itemsStuckTitle)}</p>
              <ul className="pt-1 text-sm">
                {(alerts.data?.groups ?? []).map((group) => (
                  <li key={`${group.nodeId}:${group.roleNames.join(',')}`}>
                    {format(m.itemsStuckRow, {
                      unit: group.nodeName,
                      roles: group.roleNames.join('、'),
                      count: group.waiting,
                    })}
                  </li>
                ))}
              </ul>
              <p className="pt-1 text-xs text-muted-foreground">{format(m.itemsStuckHint)}</p>
            </div>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
          {/* the paper's shape, always on screen */}
          <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-9rem)] lg:self-start lg:overflow-y-auto">
            <div className="rounded-lg border p-2">
              <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
                {format(m.itemsOutlineTitle)}
              </p>
              <PaperOutline
                groups={allGroups}
                items={allItems}
                selection={selection}
                onSelect={setSelection}
              />
            </div>
          </aside>

          <div className="min-w-0 rounded-lg border p-5">
            {selection === null && (
              <div className="flex min-h-64 flex-col items-center justify-center gap-1 text-center">
                <p className="text-sm text-muted-foreground">{format(m.itemsPickSomething)}</p>
                <p className="text-xs text-muted-foreground">{format(m.itemsPickHint)}</p>
              </div>
            )}

            {(selection?.kind === 'group' || selection?.kind === 'new-group') && (
              <GroupPanel
                batchId={batchId}
                batchStatus={batchStatus}
                groups={allGroups}
                editing={selectedGroup}
                parentId={selection.kind === 'new-group' ? selection.parentId : null}
                onCancel={() => setSelection(null)}
                onSaved={(groupId) => {
                  setSelection(groupId === null ? null : { kind: 'group', id: groupId })
                  refresh()
                }}
              />
            )}

            {(selection?.kind === 'item' || selection?.kind === 'new-item') &&
              options.data !== undefined && (
                <ItemConfigEditor
                  key={selection.kind === 'item' ? selection.id : `new:${selection.groupId}`}
                  batchId={batchId}
                  materialRange={materialRange}
                  item={selectedItem}
                  groups={allGroups.map((group) => ({ id: group.id, name: group.name }))}
                  defaultGroupId={selection.kind === 'new-item' ? selection.groupId : undefined}
                  options={options.data}
                  actions={
                    selectedItem === null ? undefined : (
                      <div className="flex items-center gap-1">
                        {selectedItem.status === 'voided' && (
                          <Badge variant="outline">{format(m.itemsStatusVoided)}</Badge>
                        )}
                        {selectedItem.status === 'active' && batchStatus !== 'draft' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setVoiding(selectedItem)}
                          >
                            {format(m.itemsVoid)}
                          </Button>
                        )}
                        {selectedItem.status === 'voided' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={restore.isPending}
                            onClick={() => restore.mutate(selectedItem.id)}
                          >
                            {format(m.itemsRestore)}
                          </Button>
                        )}
                        {batchStatus === 'draft' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(selectedItem.id)}
                          >
                            {format(m.itemsDelete)}
                          </Button>
                        )}
                      </div>
                    )
                  }
                  onClose={() => setSelection(null)}
                  onSaved={() => {
                    setSelection(null)
                    refresh()
                  }}
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
