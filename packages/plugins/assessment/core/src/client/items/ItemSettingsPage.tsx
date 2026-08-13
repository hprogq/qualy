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
import { GroupDialog } from './GroupDialog.tsx'
import { ItemConfigEditor } from './ItemConfigEditor.tsx'
import { PaperSheet, type SheetGroup } from './PaperSheet.tsx'
import { VoidQuestionDialog } from './VoidQuestionDialog.tsx'
import type { ItemDto } from '../entry/model.ts'

// The round's paper. The sheet is the whole resting state; a question's
// details open in a drawer over the margin and a group's in a small dialog,
// so the paper never leaves the screen while a part of it is being written.

type QuestionEditing = { item: ItemDto | null; groupId?: string }
type GroupEditing = { group: SheetGroup | null; parentId: string | null }

export default function ItemSettingsPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.itemsTab)} description={format(m.itemsHint)}>
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
  const [question, setQuestion] = useState<QuestionEditing | null>(null)
  const [group, setGroup] = useState<GroupEditing | null>(null)
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
      setQuestion(null)
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const allGroups = groups.data?.groups ?? []
  const allItems = (items.data?.items ?? []) as readonly ItemDto[]

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
          <section className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
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

        <PaperSheet
          groups={allGroups}
          items={allItems}
          onEditGroup={(edited) => setGroup({ group: edited, parentId: null })}
          onAddGroup={(parentId) => setGroup({ group: null, parentId })}
          onAddItem={(groupId) => setQuestion({ item: null, groupId })}
          onEditItem={(item) => setQuestion({ item })}
        />
      </div>

      {question !== null && options.data !== undefined && (
        <ItemConfigEditor
          batchId={batchId}
          materialRange={materialRange}
          item={question.item}
          groups={allGroups.map((one) => ({ id: one.id, name: one.name }))}
          defaultGroupId={question.groupId}
          options={options.data}
          actions={
            question.item === null ? undefined : (
              <QuestionActions
                item={question.item}
                batchStatus={batchStatus}
                busy={restore.isPending || remove.isPending}
                onVoid={() => setVoiding(question.item)}
                onRestore={() => restore.mutate(question.item!.id)}
                onDelete={() => remove.mutate(question.item!.id)}
              />
            )
          }
          onClose={() => setQuestion(null)}
          onSaved={() => {
            setQuestion(null)
            refresh()
          }}
        />
      )}

      {group !== null && (
        <GroupDialog
          batchId={batchId}
          batchStatus={batchStatus}
          groups={allGroups}
          editing={group.group}
          parentId={group.parentId}
          onClose={() => setGroup(null)}
          onDone={() => {
            setGroup(null)
            refresh()
          }}
        />
      )}

      {voiding !== null && (
        <VoidQuestionDialog
          item={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null)
            setQuestion(null)
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
        <Button variant="ghost" size="sm" onClick={onVoid}>
          {format(m.itemsVoid)}
        </Button>
      )}
      {item.status === 'voided' && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRestore}>
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
