import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlertIcon } from 'lucide-react'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@qualy/ui/resizable'
import { Separator } from '@qualy/ui/separator'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { ItemConfigEditor } from './ItemConfigEditor.tsx'
import { GroupEditor, type GroupDraft } from './GroupEditor.tsx'
import { PaperTree, type TreeDraft, type TreeGroup, type TreeSelection } from './PaperTree.tsx'
import type { Draft as QuestionDraft } from './ItemConfigEditor.tsx'
import { ReasonDialog } from './ReasonDialog.tsx'
import { VoidQuestionDialog } from './VoidQuestionDialog.tsx'
import type { ItemDto } from '../entry/model.ts'

// Composing a round with the paper always in sight: its structure down the
// left, the selected part opened for editing on the right. A drag in the
// tree is persisted here - the tree only says what should now come where.

/**
 * What a refused publish or restore actually says.
 *
 * The api answers with the save's own refusal, whose sentence is about
 * saving; nobody pressed save. The question's own problems are what the
 * reader needs, so they are named when the refusal carries them.
 */
const refusedPublish = (error: unknown, fallback: (value: unknown) => string): string => {
  const issues = (error as { issues?: readonly { path: string; reason: string }[] }).issues
  return Array.isArray(issues) && issues.length > 0
    ? issues.map((issue) => `${issue.path}: ${issue.reason}`).join('; ')
    : fallback(error)
}

/** a counter, so two things composed in one session never share a handle */
let composed = 0

/** whether two columns fit side by side; below that the rail stacks on top */
const useTwoColumns = () => {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setWide(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return wide
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
  const alerts = useQuery({
    ...query.assessment.reviewAlerts.queryOptions({ params: { batchId } }),
    refetchInterval: 60_000,
  })
  const [selection, setSelection] = useState<TreeSelection | null>(null)
  // what has been composed and not yet saved. Each press of add puts one more
  // here, so the tree shows what is waiting rather than swallowing the press.
  const [drafts, setDrafts] = useState<readonly TreeDraft[]>([])
  const [held, setHeld] = useState<Readonly<Record<string, QuestionDraft | GroupDraft>>>({})
  const [voiding, setVoiding] = useState<ItemDto | null>(null)
  // set by the open editor: publishing what is on screen would be a lie while
  // the screen says something the round has not been told
  const [unsaved, setUnsaved] = useState(false)
  // a drop that crosses groups on a running round waits here for its sentence
  const [pendingMove, setPendingMove] = useState<{
    itemId: string
    groupId: string
    orderedItemIds: readonly string[]
  } | null>(null)
  const twoColumns = useTwoColumns()

  // one more thing being composed, selected so it can be written straight away
  const compose = (
    where: { kind: 'item'; groupId: string } | { kind: 'group'; parentId: string | null },
  ) => {
    const localId = `local-${(composed += 1)}`
    setDrafts((current) => [
      ...current,
      where.kind === 'item'
        ? { localId, kind: 'item', groupId: where.groupId, title: '' }
        : { localId, kind: 'group', parentId: where.parentId, title: '' },
    ])
    setSelection({ kind: 'draft', localId })
  }

  const closeDraft = (localId: string) => {
    setDrafts((current) => current.filter((draft) => draft.localId !== localId))
    setHeld((current) => {
      const { [localId]: gone, ...rest } = current
      return rest
    })
    setSelection((current) =>
      current?.kind === 'draft' && current.localId === localId ? null : current,
    )
  }

  const hold = useCallback((localId: string, composition: QuestionDraft | GroupDraft) => {
    setHeld((current) => ({ ...current, [localId]: composition }))
    const title = 'title' in composition ? composition.title : composition.name
    setDrafts((current) =>
      current.map((draft) => (draft.localId === localId ? { ...draft, title } : draft)),
    )
  }, [])

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })

  const restore = useMutation({
    mutationFn: (itemId: string) =>
      run(api.assessment.setItemStatus({ params: { itemId }, payload: { status: 'active' } })),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(refusedPublish(error, formatError)),
  })

  // publishing and restoring are the same write; they are separate here
  // because they answer different questions and say different things
  const publish = useMutation({
    mutationFn: (itemId: string) =>
      run(api.assessment.setItemStatus({ params: { itemId }, payload: { status: 'active' } })),
    onSuccess: () => {
      toast.success(format(m.itemsPublished))
      void refresh()
    },
    onError: (error) => toast.error(refusedPublish(error, formatError)),
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
  // every save states the tree it was composed against; before the first read
  // lands there is nothing to state, and the api refuses rather than guess
  const groupsVersion = groups.data?.version ?? null

  // a drop, made durable: only the rows whose place actually changed are
  // written, so an idle drag costs nothing
  const moveItem = useMutation({
    mutationFn: async (input: {
      itemId: string
      groupId: string
      orderedItemIds: readonly string[]
      reason: string | null
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
                // where a live question counts is scoring semantics, and the
                // api refuses to move one on a running round unsaid
                ...(movedGroup && input.reason !== null ? { reason: input.reason } : {}),
              },
            }),
          )
        }
      }
    },
    onSuccess: () => void refresh(),
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
            expectedVersion: groupsVersion ?? 0,
          },
        }),
      ),
    onSuccess: () => void refresh(),
    onError: (error) => {
      toast.error(formatError(error))
      refresh()
    },
  })

  const roots = (allGroups as readonly TreeGroup[]).filter((group) => group.parentGroupId === null)
  const questionCount = allItems.filter((item) => item.status === 'active').length
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

  const rail = (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-2 pb-2">
        <span className="text-sm font-medium">{format(m.itemsTreeTitle)}</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs text-primary"
          onClick={() => compose({ kind: 'group', parentId: null })}
        >
          {format(m.itemsGroupAdd)}
        </Button>
      </div>
      <div className="py-2">
        <PaperTree
          groups={allGroups as readonly TreeGroup[]}
          items={allItems}
          drafts={drafts}
          selection={selection}
          onSelect={setSelection}
          onAddItem={(groupId) => compose({ kind: 'item', groupId })}
          // the tree cannot be written until its version has arrived: asking
          // the api to accept a guessed one is a conflict nobody can act on
          onAddGroup={
            groupsVersion === null ? undefined : (parentId) => compose({ kind: 'group', parentId })
          }
          onMoveItem={(itemId, groupId, orderedItemIds) => {
            const moved = allItems.find((item) => item.id === itemId)
            if (moved?.status === 'voided') return
            const crosses = moved !== undefined && moved.scoreGroupId !== groupId
            if (crosses && batchStatus === 'active' && moved.status === 'active') {
              setPendingMove({ itemId, groupId, orderedItemIds })
              return
            }
            moveItem.mutate({ itemId, groupId, orderedItemIds, reason: null })
          }}
          onReorderGroups={(parentId, orderedGroupIds) =>
            reorderGroups.mutate({ parentId, orderedGroupIds })
          }
        />
      </div>
      <p className="border-t px-2 pt-2 text-xs text-muted-foreground">
        {capSum === null
          ? format(m.itemsTreeSummaryNoCap, { count: questionCount })
          : format(m.itemsTreeSummary, { count: questionCount, sum: capSum })}
      </p>
    </div>
  )

  const composing =
    selection?.kind === 'draft'
      ? (drafts.find((draft) => draft.localId === selection.localId) ?? null)
      : null

  // stable for as long as the same thing is being composed: the editor keeps
  // this in an effect's dependencies, and a new function every render would
  // hand it back its own state forever
  const composingId = composing?.localId ?? null
  const onHold = useMemo(
    () =>
      composingId === null
        ? undefined
        : (composition: QuestionDraft | GroupDraft) => hold(composingId, composition),
    [hold, composingId],
  )

  const editorArea = (
    <>
      {selection === null && (
        <div className="flex min-h-64 items-center justify-center">
          <p className="text-sm text-muted-foreground">{format(m.itemsPickTarget)}</p>
        </div>
      )}

      {(selectedGroup !== null || composing?.kind === 'group') && (
        <GroupEditor
          key={selectedGroup?.id ?? composing?.localId ?? 'group'}
          batchId={batchId}
          batchStatus={batchStatus}
          groups={allGroups as readonly TreeGroup[]}
          version={groupsVersion ?? 0}
          editing={selectedGroup as TreeGroup | null}
          parentId={composing?.kind === 'group' ? (composing.parentId ?? null) : null}
          held={
            composing === null ? undefined : (held[composing.localId] as GroupDraft | undefined)
          }
          onHold={onHold}
          onCancel={() => (composing === null ? setSelection(null) : closeDraft(composing.localId))}
          onDone={async (groupId) => {
            await refresh()
            if (composing !== null) closeDraft(composing.localId)
            setSelection(groupId === null ? null : { kind: 'group', id: groupId })
          }}
        />
      )}

      {(selectedItem !== null || composing?.kind === 'item') && options.data !== undefined && (
        <ItemConfigEditor
          key={selectedItem?.id ?? composing?.localId ?? 'item'}
          batchId={batchId}
          batchStatus={batchStatus}
          materialRange={materialRange}
          item={selectedItem}
          groups={allGroups.map((one) => ({ id: one.id, name: one.name }))}
          defaultGroupId={composing?.kind === 'item' ? composing.groupId : undefined}
          options={options.data}
          held={
            composing === null ? undefined : (held[composing.localId] as QuestionDraft | undefined)
          }
          onHold={onHold}
          onDirty={setUnsaved}
          actions={
            selectedItem === null ? undefined : (
              <QuestionActions
                item={selectedItem}
                batchStatus={batchStatus}
                busy={restore.isPending || remove.isPending || publish.isPending}
                unsaved={unsaved}
                onPublish={() => publish.mutate(selectedItem.id)}
                onVoid={() => setVoiding(selectedItem)}
                onRestore={() => restore.mutate(selectedItem.id)}
                onDelete={() => remove.mutate(selectedItem.id)}
              />
            )
          }
          onCancel={() => (composing === null ? setSelection(null) : closeDraft(composing.localId))}
          onSaved={async (itemId) => {
            // the created row has to be in hand before it can be selected, or
            // the pane has nothing to show between the save and the refetch
            await refresh()
            if (composing !== null) closeDraft(composing.localId)
            setSelection({ kind: 'item', id: itemId })
          }}
        />
      )}
    </>
  )

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
      className="flex flex-1 flex-col"
    >
      <div className="flex flex-1 flex-col gap-5">
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

        {/* the paper's structure and the part being written, divided by a
            handle that can be dragged rather than a line drawn down the page */}
        {twoColumns ? (
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 items-stretch">
            <ResizablePanel defaultSize="28" minSize="18" maxSize="46">
              <div className="h-full overflow-y-auto">{rail}</div>
            </ResizablePanel>
            <ResizableHandle withHandle className="mx-4" />
            <ResizablePanel defaultSize="72" minSize="40">
              <div className="h-full overflow-y-auto">{editorArea}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex flex-col gap-5">
            {rail}
            <Separator />
            {editorArea}
          </div>
        )}
      </div>

      {pendingMove !== null && (
        <ReasonDialog
          title={format(m.itemsMoveReasonTitle)}
          description={format(m.itemsReasonHint)}
          busy={moveItem.isPending}
          onConfirm={(reason) => {
            moveItem.mutate({ ...pendingMove, reason })
            setPendingMove(null)
          }}
          onClose={() => {
            setPendingMove(null)
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
            refresh()
          }}
        />
      )}
    </AsyncSection>
  )
}

/** what can be done to a question, by where it stands in its own life */
function QuestionActions({
  item,
  batchStatus,
  busy,
  unsaved,
  onPublish,
  onVoid,
  onRestore,
  onDelete,
}: {
  item: ItemDto
  batchStatus: string
  busy: boolean
  /** the pane holds edits the round has not been told about */
  unsaved: boolean
  onPublish: () => void
  onVoid: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const { format } = useI18n()
  return (
    <div className="flex items-center gap-1.5">
      {item.status === 'draft' && <Badge variant="secondary">{format(m.itemsStatusDraft)}</Badge>}
      {item.status === 'voided' && <Badge variant="outline">{format(m.itemsStatusVoided)}</Badge>}
      {/* one never published leaves without a trace; one published keeps its
          record and can only be withdrawn */}
      {(item.status === 'draft' || batchStatus === 'draft') && (
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
      {item.status === 'draft' && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy || unsaved}
          title={unsaved ? format(m.itemsPublishAfterSave) : undefined}
          onClick={onPublish}
        >
          {format(m.itemsPublish)}
        </Button>
      )}
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
    </div>
  )
}
