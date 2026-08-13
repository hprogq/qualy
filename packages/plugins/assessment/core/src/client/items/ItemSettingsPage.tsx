import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { Skeleton } from '@qualy/ui/skeleton'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { ItemConfigEditor } from './ItemConfigEditor.tsx'
import type { ItemDto } from '../entry/model.ts'

// The round's questions and the groups their scores add up in - the least
// configuration screen that can run a real round. The full configuration
// travels as JSON on purpose: its shape belongs to the item type, and the
// server answers with named problems when it cannot accept one.

interface GroupRow {
  id?: string
  name: string
  cap: string
  floor: string
}

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
  const [rows, setRows] = useState<GroupRow[]>([])
  const [editing, setEditing] = useState<{ item: ItemDto | null } | null>(null)
  const [voiding, setVoiding] = useState<ItemDto | null>(null)

  useEffect(() => {
    if (groups.data !== undefined) {
      setRows(
        groups.data.groups.map((group) => ({
          id: group.id,
          name: group.name,
          cap: group.cap ?? '',
          floor: group.floor ?? '',
        })),
      )
    }
  }, [groups.data])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  }

  const saveGroups = useMutation({
    mutationFn: () =>
      run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: rows.map((row) => ({
              name: row.name,
              cap: row.cap.trim() === '' ? null : row.cap.trim(),
              floor: row.floor.trim() === '' ? null : row.floor.trim(),
            })),
          },
        }),
      ),
    onSuccess: () => {
      toast.success(format(m.itemsGroupsSaved))
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const setStatus = useMutation({
    mutationFn: (itemId: string) =>
      run(
        api.assessment.setItemStatus({
          params: { itemId },
          payload: { status: 'active' },
        }),
      ),
    onSuccess: refresh,
    onError: (error) => toast.error(formatError(error)),
  })

  const remove = useMutation({
    mutationFn: (itemId: string) => run(api.assessment.deleteItem({ params: { itemId } })),
    onSuccess: refresh,
    onError: (error) => toast.error(formatError(error)),
  })

  return (
    <AsyncSection
      pending={groups.isPending || items.isPending}
      error={
        groups.error ? formatError(groups.error) : items.error ? formatError(items.error) : null
      }
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void groups.refetch()
        void items.refetch()
      }}
      skeleton={<Skeleton className="h-48 w-full" />}
    >
      <div className="flex flex-col gap-6">
        <section className="rounded-lg border p-4">
          <div className="flex items-center justify-between pb-3">
            <h3 className="text-sm font-medium">{format(m.itemsGroupsTitle)}</h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRows([...rows, { name: '', cap: '', floor: '' }])}
              >
                {format(m.itemsGroupAdd)}
              </Button>
              <Button size="sm" disabled={saveGroups.isPending} onClick={() => saveGroups.mutate()}>
                {format(m.itemsGroupsSave)}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <div key={row.id ?? `new-${index}`} className="grid grid-cols-3 gap-2">
                <Input
                  aria-label={format(m.itemsGroupName)}
                  placeholder={format(m.itemsGroupName)}
                  value={row.name}
                  onChange={(event) =>
                    setRows(
                      rows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)),
                    )
                  }
                />
                <Input
                  aria-label={format(m.itemsGroupCap)}
                  placeholder={format(m.itemsGroupCap)}
                  value={row.cap}
                  onChange={(event) =>
                    setRows(
                      rows.map((r, i) => (i === index ? { ...r, cap: event.target.value } : r)),
                    )
                  }
                />
                <Input
                  aria-label={format(m.itemsGroupFloor)}
                  placeholder={format(m.itemsGroupFloor)}
                  value={row.floor}
                  onChange={(event) =>
                    setRows(
                      rows.map((r, i) => (i === index ? { ...r, floor: event.target.value } : r)),
                    )
                  }
                />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <div className="flex items-center justify-between pb-3">
            <h3 className="text-sm font-medium">{format(m.itemsListTitle)}</h3>
            <Button size="sm" onClick={() => setEditing({ item: null })}>
              {format(m.itemsNew)}
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {((items.data?.items ?? []) as readonly ItemDto[]).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {item.title}
                  {item.status === 'voided' && (
                    <Badge variant="outline">{format(m.itemsStatusVoided)}</Badge>
                  )}
                </span>
                <span className="flex gap-1">
                  {item.status === 'active' && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing({ item })}>
                      {format(m.entryEdit)}
                    </Button>
                  )}
                  {item.status === 'active' && batchStatus !== 'draft' && (
                    <Button variant="ghost" size="sm" onClick={() => setVoiding(item)}>
                      {format(m.itemsVoid)}
                    </Button>
                  )}
                  {item.status === 'voided' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate(item.id)}
                    >
                      {format(m.itemsRestore)}
                    </Button>
                  )}
                  {batchStatus === 'draft' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(item.id)}
                    >
                      {format(m.itemsDelete)}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {editing !== null && options.data !== undefined && (
        <ItemConfigEditor
          batchId={batchId}
          materialRange={materialRange}
          item={editing.item}
          groups={(groups.data?.groups ?? []).map((group) => ({ id: group.id, name: group.name }))}
          options={options.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
      {voiding !== null && (
        <VoidDialog
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

function VoidDialog({
  item,
  onClose,
  onDone,
}: {
  item: ItemDto
  onClose: () => void
  onDone: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [reason, setReason] = useState('')

  const act = useMutation({
    mutationFn: () =>
      run(
        api.assessment.setItemStatus({
          params: { itemId: item.id },
          payload: { status: 'voided', reason: reason.trim() },
        }),
      ),
    onSuccess: onDone,
    onError: (error) => toast.error(formatError(error)),
  })

  return (
    <FormDialog
      open
      title={format(m.itemsVoidTitle)}
      description={format(m.itemsVoidHint)}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button
            variant="destructive"
            disabled={act.isPending || reason.trim() === ''}
            onClick={() => act.mutate()}
          >
            {format(m.itemsVoid)}
          </Button>
        </div>
      }
    >
      <Field label={format(m.itemsVoidReason)}>
        {(id) => (
          <Input id={id} value={reason} onChange={(event) => setReason(event.target.value)} />
        )}
      </Field>
    </FormDialog>
  )
}
