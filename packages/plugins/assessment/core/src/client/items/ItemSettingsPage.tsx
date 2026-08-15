import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PencilIcon, TriangleAlertIcon } from 'lucide-react'
import { useApi, useApiQuery, usePageQueryState, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { DropdownMenuItem, DropdownMenuSeparator } from '@qualy/ui/dropdown-menu'
import { Drill, type DrillMove } from '@qualy/ui/reveal'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { ItemConfigEditor } from './ItemConfigEditor.tsx'
import { GroupEditor } from './GroupEditor.tsx'
import { PaperStart } from './PaperStart.tsx'
import { StructureTable } from './StructureTable.tsx'
import { itemCeiling, structureRows, type StructureRow } from './structure.ts'
import type { GroupTarget, Placement, TreeDraft, TreeGroup, TreeSelection } from './paper.ts'
import type { Draft as QuestionDraft } from './ItemConfigEditor.tsx'
import { ReasonDialog } from './ReasonDialog.tsx'
import { VoidQuestionDialog } from './VoidQuestionDialog.tsx'
import { trimAmount, type ItemDto } from '../entry/model.ts'

// Composing a round: the paper's structure, and one question opened out.
//
// Opening a question is a level down, not a different screen - the structure
// it was opened from is the same page, and going back lands on the row that
// was pressed, so the content area travels sideways and says so. Stepping to
// the next question is a shorter move up or down the same stack. A group is
// three fields, so it opens in a panel over the structure instead: nothing
// about it is worth losing sight of the tree for.
//
// Which question is open is in the address, so a reload, a shared link and
// the browser's own back button all land where the reader was. A question
// still being composed has no id to put there and stays where it is.
//
// Which way the screen moved is worked out from where it was a moment ago
// rather than recorded at each press: back and forward are moves nobody in
// this file gets told about, and they deserve the same direction as the
// buttons that do the same thing.
const moveBetween = (from: string, to: string, questions: readonly { id: string }[]): DrillMove => {
  if (from === to) return 'none'
  if (from === STRUCTURE) return 'in'
  if (to === STRUCTURE) return 'out'
  // a question being composed became the saved question: the reader pressed
  // save and is looking at the same thing, so nothing arrives
  if (from.startsWith('draft:') && to.startsWith('item:')) return 'none'
  const at = (key: string) => questions.findIndex((one) => `item:${one.id}` === key)
  return at(to) < at(from) ? 'previous' : 'next'
}

const STRUCTURE = 'structure'

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

export default function ItemSettingsPage() {
  const { format } = useI18n()
  // Both held out here because the band at the top of the page is the one the
  // open question speaks through, and the page has to know when to give it
  // up. The saved one is in the address; the one still being composed cannot
  // be, so it is the only piece of this kept in memory.
  const [question, setQuestion] = usePageQueryState('question', '', { history: 'push' })
  const [composing, setComposing] = useState<string | null>(null)
  return (
    <BatchScreen
      title={format(m.itemsTab)}
      description={format(m.itemsHint)}
      banner={question === '' && composing === null ? 'section' : 'open'}
    >
      {(batch) => (
        <Editor
          batchId={batch.id}
          batchStatus={batch.status}
          materialRange={batch.materialRange}
          question={question}
          onQuestion={setQuestion}
          composing={composing}
          onComposing={setComposing}
        />
      )}
    </BatchScreen>
  )
}

function Editor({
  batchId,
  batchStatus,
  materialRange,
  question,
  onQuestion,
  composing: composingId,
  onComposing,
}: {
  batchId: string
  batchStatus: string
  materialRange: { start: string; end: string }
  /** the saved question the address says is open, or '' for the structure */
  question: string
  onQuestion: (itemId: string) => void
  /** the unsaved question being written, which has no id to put in the address */
  composing: string | null
  onComposing: (localId: string | null) => void
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
  // what has been composed and not yet saved. Each press of add puts one more
  // here, so the tree shows what is waiting rather than swallowing the press.
  const [drafts, setDrafts] = useState<readonly TreeDraft[]>([])
  const [held, setHeld] = useState<Readonly<Record<string, QuestionDraft>>>({})
  const [voiding, setVoiding] = useState<ItemDto | null>(null)
  // the group whose panel is open over the structure, if any
  const [group, setGroup] = useState<GroupTarget | null>(null)
  // set by the open editor: publishing what is on screen would be a lie while
  // the screen says something the round has not been told
  const [unsaved, setUnsaved] = useState(false)
  // a drop that crosses groups on a running round waits here for its sentence
  const [pendingMove, setPendingMove] = useState<{
    itemId: string
    groupId: string
    orderedItemIds: readonly string[]
  } | null>(null)
  /** which screen was on show last commit, which is what says which way it moved */
  const wasAt = useRef(STRUCTURE)

  const selection: TreeSelection | null =
    composingId !== null
      ? { kind: 'draft', localId: composingId }
      : question !== ''
        ? { kind: 'item', id: question }
        : null
  const drillKey =
    composingId !== null ? `draft:${composingId}` : question !== '' ? `item:${question}` : STRUCTURE

  /** leave whatever is open and go back to the structure */
  const close = () => {
    onComposing(null)
    onQuestion('')
  }

  // one more question being composed, opened so it can be written straight away
  const compose = (groupId: string) => {
    const localId = `local-${(composed += 1)}`
    setDrafts((current) => [...current, { localId, groupId, title: '' }])
    onQuestion('')
    onComposing(localId)
  }

  const closeDraft = (localId: string) => {
    setDrafts((current) => current.filter((draft) => draft.localId !== localId))
    setHeld((current) => {
      const { [localId]: gone, ...rest } = current
      return rest
    })
    if (composingId === localId) onComposing(null)
  }

  const hold = useCallback((localId: string, composition: QuestionDraft) => {
    setHeld((current) => ({ ...current, [localId]: composition }))
    setDrafts((current) =>
      current.map((draft) =>
        draft.localId === localId ? { ...draft, title: composition.title } : draft,
      ),
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
      close()
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

  const paper = (allGroups as readonly TreeGroup[]).find((group) => group.parentGroupId === null)
  const roots = (allGroups as readonly TreeGroup[]).filter(
    (group) => group.parentGroupId === (paper?.id ?? null),
  )
  const rows = structureRows(allGroups as readonly TreeGroup[], allItems, drafts, paper?.id ?? null)

  const selectedItem =
    selection?.kind === 'item' ? (allItems.find((item) => item.id === selection.id) ?? null) : null

  // every question of the round in the order the structure reads them, which
  // is the order the arrows in the band step through
  const everyQuestion = rows.flatMap((row) =>
    row.kind === 'item' ? [{ id: row.id, title: row.name }] : [],
  )

  // worked out from where the screen was a moment ago, so the browser's own
  // back and forward move the same way the buttons that do the same thing do
  const move = moveBetween(wasAt.current, drillKey, everyQuestion)
  useEffect(() => {
    wasAt.current = drillKey
  }, [drillKey])

  const openRow = (row: StructureRow) => {
    if (row.kind === 'group') {
      const found = (allGroups as readonly TreeGroup[]).find((one) => one.id === row.id)
      if (found !== undefined) setGroup({ kind: 'edit', group: found })
    } else if (row.kind === 'item') onQuestion(row.id)
    else onComposing(row.id)
  }

  // a dropped row lands where the line was drawn: inside a group, or beside
  // the row it was dropped on, in that row's own group
  const moveRow = (
    dragged: StructureRow,
    target: StructureRow,
    edge: 'before' | 'after' | 'into',
  ) => {
    if (dragged.kind === 'draft') return
    const parentOf = (row: StructureRow): string | null =>
      row.kind === 'group'
        ? ((allGroups.find((one) => one.id === row.id)?.parentGroupId as string | null) ?? null)
        : ((allItems.find((one) => one.id === row.id)?.scoreGroupId as string | null) ?? null)
    const landing = edge === 'into' ? target.id : parentOf(target)
    if (landing === null) return

    if (dragged.kind === 'item') {
      const siblings = allItems
        .filter((one) => one.scoreGroupId === landing && one.id !== dragged.id)
        .map((one) => one.id)
      const at = edge === 'into' ? siblings.length : siblings.indexOf(target.id)
      siblings.splice(at < 0 ? siblings.length : edge === 'before' ? at : at + 1, 0, dragged.id)
      const moved = allItems.find((one) => one.id === dragged.id)
      if (moved?.status === 'voided') return
      if (
        moved !== undefined &&
        moved.scoreGroupId !== landing &&
        batchStatus === 'active' &&
        moved.status === 'active'
      ) {
        setPendingMove({ itemId: dragged.id, groupId: landing, orderedItemIds: siblings })
        return
      }
      moveItem.mutate({
        itemId: dragged.id,
        groupId: landing,
        orderedItemIds: siblings,
        reason: null,
      })
      return
    }

    const siblings = (allGroups as readonly TreeGroup[])
      .filter((one) => one.parentGroupId === landing && one.id !== dragged.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((one) => one.id)
    const at = edge === 'into' ? siblings.length : siblings.indexOf(target.id)
    siblings.splice(at < 0 ? siblings.length : edge === 'before' ? at : at + 1, 0, dragged.id)
    reorderGroups.mutate({ parentId: landing, orderedGroupIds: siblings })
  }

  const writing =
    composingId === null ? null : (drafts.find((one) => one.localId === composingId) ?? null)

  // stable for as long as the same thing is being composed: the editor keeps
  // this in an effect's dependencies, and a new function every render would
  // hand it back its own state forever
  const onHold = useMemo(
    () =>
      composingId === null
        ? undefined
        : (composition: QuestionDraft) => hold(composingId, composition),
    [hold, composingId],
  )

  const openGroupId = selectedItem?.scoreGroupId ?? writing?.groupId ?? null

  const editorArea =
    (selectedItem !== null || writing !== null) && options.data !== undefined ? (
      <ItemConfigEditor
        key={selectedItem?.id ?? writing?.localId ?? 'item'}
        batchId={batchId}
        batchStatus={batchStatus}
        materialRange={materialRange}
        item={selectedItem}
        groups={allGroups.map((one) => ({ id: one.id, name: one.name }))}
        trail={trailOf(allGroups as readonly TreeGroup[], openGroupId)}
        placement={placementOf(
          allGroups as readonly TreeGroup[],
          allItems,
          openGroupId,
          paper?.id ?? null,
        )}
        paper={everyQuestion}
        defaultGroupId={writing?.groupId}
        options={options.data}
        held={writing === null ? undefined : held[writing.localId]}
        onHold={onHold}
        onDirty={setUnsaved}
        menu={
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
        onCancel={() => (writing === null ? close() : closeDraft(writing.localId))}
        onSaved={async (itemId) => {
          // the created row has to be in hand before it can be opened, or the
          // screen has nothing to show between the save and the refetch. The
          // reader stays where they were, so nothing travels.
          await refresh()
          if (writing !== null) closeDraft(writing.localId)
          onQuestion(itemId)
        }}
      />
    ) : null

  const structure =
    paper === undefined ? (
      <PaperStart batchId={batchId} onCreated={() => void refresh()} />
    ) : (
      <div className="flex flex-1 flex-col gap-4">
        <PaperSummary
          paper={paper as TreeGroup}
          roots={roots as readonly TreeGroup[]}
          onEdit={() => setGroup({ kind: 'edit', group: paper as TreeGroup })}
        />
        <StructureTable
          rows={rows}
          selectedKey={null}
          onOpen={openRow}
          onAddGroup={(parentId) => setGroup({ kind: 'new', parentId: parentId ?? paper.id })}
          onAddItem={(groupId) => compose(groupId ?? paper.id)}
          onMove={moveRow}
          onPublish={(itemId) => publish.mutate(itemId)}
          onVoid={(itemId) => {
            const item = allItems.find((one) => one.id === itemId)
            if (item !== undefined) setVoiding(item)
          }}
          onRestore={(itemId) => restore.mutate(itemId)}
          onDelete={(itemId) => remove.mutate(itemId)}
        />
      </div>
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
        {(alerts.data?.groups ?? []).length > 0 && selection === null && (
          <section className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-destructive">{format(m.itemsStuckTitle)}</p>
              <ul className="pt-1 text-sm">
                {(alerts.data?.groups ?? []).map((row) => (
                  <li key={`${row.nodeId}:${row.roleNames.join(',')}`}>
                    {format(m.itemsStuckRow, {
                      unit: row.nodeName,
                      roles: row.roleNames.join(format(m.listSeparator)),
                      count: row.waiting,
                    })}
                  </li>
                ))}
              </ul>
              <p className="pt-1 text-xs text-muted-foreground">{format(m.itemsStuckHint)}</p>
            </div>
          </section>
        )}

        <Drill move={move} drillKey={drillKey} className="flex flex-1 flex-col">
          {selection === null ? structure : editorArea}
        </Drill>
      </div>

      {group !== null && (
        <GroupEditor
          key={group.kind === 'edit' ? group.group.id : `new:${group.parentId}`}
          batchId={batchId}
          batchStatus={batchStatus}
          groups={allGroups as readonly TreeGroup[]}
          version={groupsVersion ?? 0}
          editing={group.kind === 'edit' ? group.group : null}
          parentId={group.kind === 'new' ? group.parentId : null}
          onClose={() => setGroup(null)}
          onDone={() => {
            setGroup(null)
            void refresh()
          }}
        />
      )}

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

/** where something sits, read from the outermost group inwards */
const trailOf = (groups: readonly TreeGroup[], groupId: string | null): readonly string[] => {
  const names: string[] = []
  let at = groupId
  const seen = new Set<string>()
  while (at !== null && !seen.has(at)) {
    seen.add(at)
    const group = groups.find((one) => one.id === at)
    if (group === undefined) break
    names.unshift(group.name)
    at = group.parentGroupId
  }
  return names
}

/** the ceilings one question's score passes through, innermost group first */
const placementOf = (
  groups: readonly TreeGroup[],
  items: readonly ItemDto[],
  groupId: string | null,
  paperId: string | null,
): Placement => {
  const sections: { id: string; name: string; cap: string | null }[] = []
  let at = groupId
  const seen = new Set<string>()
  while (at !== null && at !== paperId && !seen.has(at)) {
    seen.add(at)
    const group = groups.find((one) => one.id === at)
    if (group === undefined) break
    sections.push({ id: group.id, name: group.name, cap: group.cap })
    at = group.parentGroupId
  }

  let subtotal: number | null = 0
  for (const item of items.filter((one) => one.scoreGroupId === groupId)) {
    const most = itemCeiling(item)
    if (most === null) subtotal = null
    else if (subtotal !== null) subtotal += most
  }

  return {
    sections,
    subtotal: subtotal === null ? null : String(subtotal),
    total: groups.find((one) => one.id === paperId)?.cap ?? null,
  }
}

/**
 * The paper itself, above its own structure.
 *
 * Almost everything this used to say is said again twenty pixels below it:
 * how many questions there are, how many sections, which are unpublished,
 * what each section is worth - that is the table. Repeating it here bought
 * nothing and cost a boxed block of prose at the top of every visit.
 *
 * What is left is what the table cannot answer: what the whole round is
 * worth, and how much of that has been handed out to sections so far. The
 * bar answers the second at a glance and the caption puts a number on it.
 * Anything actually wrong - sections adding up past the total, a section
 * with no limit at all - earns a line of its own, because an exception is
 * worth space and a steady state is not.
 */
function PaperSummary({
  paper,
  roots,
  onEdit,
}: {
  paper: TreeGroup
  roots: readonly TreeGroup[]
  onEdit: () => void
}) {
  const { format } = useI18n()
  const capped = roots.length > 0 && roots.every((group) => group.cap !== null)
  const cents = roots.reduce((total, group) => total + Math.round(Number(group.cap ?? 0) * 100), 0)
  const total = paper.cap === null ? null : Math.round(Number(paper.cap) * 100)
  const sum = capped ? trimAmount(String(cents / 100)) : null
  const over = sum !== null && total !== null && cents > total

  const limits = [
    `${format(m.paperTotal)} ${paper.cap === null ? format(m.structureUncapped) : trimAmount(paper.cap)}`,
    paper.floor === null
      ? format(m.paperFloorNone)
      : `${format(m.itemsGroupFloor)} ${trimAmount(paper.floor)}`,
  ].join(' · ')

  return (
    <section className="flex flex-col gap-2.5 rounded-lg bg-muted/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="min-w-0 truncate text-sm font-semibold">
          {paper.name.trim() === '' ? format(m.itemsGroupUnnamed) : paper.name}
        </h3>
        <p className="text-xs tabular-nums text-muted-foreground">{limits}</p>
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onEdit}>
          <PencilIcon aria-hidden />
          {format(m.paperEdit)}
        </Button>
        <span className="flex-1" />
        {sum !== null && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {total === null
              ? format(m.paperAllocatedFree, { sum })
              : format(m.paperAllocated, { sum, total: trimAmount(paper.cap!) })}
          </p>
        )}
      </div>

      {/* measured against the paper, so the part nobody has handed out yet
          reads as the part nobody has handed out */}
      {sum !== null && total !== null && total > 0 && (
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-background">
          {roots.map((group, index) => (
            <div
              key={group.id}
              style={{
                width: `${Math.min(100, (Math.round(Number(group.cap) * 100) / Math.max(cents, total)) * 100)}%`,
                background: `var(--chart-${(index % 4) + 2})`,
              }}
            />
          ))}
        </div>
      )}

      {over && (
        <p className="text-xs font-medium text-destructive">
          {format(m.paperCapOver, { sum: sum!, total: trimAmount(paper.cap!) })}
        </p>
      )}
      {sum === null && roots.length > 0 && (
        <p className="text-xs text-muted-foreground">{format(m.paperCapUnset)}</p>
      )}
    </section>
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
    <>
      {item.status === 'draft' && (
        <DropdownMenuItem disabled={busy || unsaved} onSelect={onPublish}>
          {unsaved ? format(m.itemsPublishAfterSave) : format(m.itemsPublish)}
        </DropdownMenuItem>
      )}
      {item.status === 'active' && batchStatus !== 'draft' && (
        <DropdownMenuItem onSelect={onVoid}>{format(m.itemsVoid)}</DropdownMenuItem>
      )}
      {item.status === 'voided' && (
        <DropdownMenuItem disabled={busy} onSelect={onRestore}>
          {format(m.itemsRestore)}
        </DropdownMenuItem>
      )}
      {/* one never published leaves without a trace; one published keeps its
          record and can only be withdrawn */}
      {(item.status === 'draft' || batchStatus === 'draft') && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={busy} onSelect={onDelete}>
            {format(m.itemsDelete)}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}
