import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PencilIcon } from 'lucide-react'
import {
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageQueryState,
  usePageQueryUpdate,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@qualy/ui/dropdown-menu'
import { Drill, type DrillMove } from '@qualy/ui/reveal'
import { useLingering } from '@qualy/ui/use-lingering'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'

import { BatchScreen } from '../batch/BatchScreen.tsx'
import { ItemEditor } from './editor/ItemEditor.tsx'
import { GroupEditor } from './GroupEditor.tsx'
import { PaperStart } from './PaperStart.tsx'
import { StructureTable } from './StructureTable.tsx'
import { itemCeiling, sortOrdersAfterDrop, structureRows, type StructureRow } from './structure.ts'
import type { GroupTarget, Placement, TreeDraft, TreeGroup, TreeSelection } from './paper.ts'
import type { Draft as QuestionDraft } from './editor/model.ts'
import { ReasonDialog } from './ReasonDialog.tsx'
import { ReviewGapNotice } from './ReviewGapNotice.tsx'
import { VoidQuestionDialog } from './VoidQuestionDialog.tsx'
import { amountOf, trimAmount, unitsOf, type ItemDto } from '../entry/model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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

/** the round itself gone: nothing under it is there to read again */
const BATCH_MISSING = 'ASSESSMENT_BATCH_NOT_FOUND'

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

const styles = stylex.create({
  grow: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  // a reading that failed is a card as tall as what it says, not the
  // height of the paper that did not arrive
  failure: { flexGrow: 0 },
  structureArea: {
    gap: 16,
  },
  editorColumn: {
    gap: 20,
  },
  // The page as it will be, in outline: a heading over a card of rows, twice.
  // One slab the height of the screen said only that something large was
  // coming, and then everything under it moved when it arrived.
  skeletonStack: { display: 'flex', width: '100%', flexDirection: 'column', gap: 28 },
  skeletonBlock: { display: 'flex', flexDirection: 'column', gap: 12 },
  skeletonCard: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}`,
  },
  skeletonRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)',
    columnGap: 24,
    alignItems: 'center',
    height: 42,
    paddingInline: 16,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  skeletonHeading: { width: 96, height: 14, borderRadius: 4 },
  skeletonHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  skeletonFill: { flexGrow: 1 },
  skeletonTool: { width: 160, height: 28, borderRadius: 8 },
  skeletonButton: { width: 72, height: 28, borderRadius: 8 },
  skeletonShare: {
    paddingInline: 16,
    paddingBlock: 14,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  skeletonShareBar: { width: '60%', height: 6, borderRadius: 9999 },
  skeletonStrip: {
    height: 32,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  skeletonLead: { display: 'flex', minWidth: 0 },
  // the question's three views, standing on their rule the way the real row does
  skeletonTabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    height: 39,
    marginBottom: -4,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  skeletonTab: { height: 12, borderRadius: 4 },
  skeletonBar: { height: 12, borderRadius: 4 },
  skeletonBarLong: { width: '62%' },
  skeletonBarMid: { width: '46%' },
  skeletonBarShort: { width: '30%' },
  // The paper's own line inside the structure card: how much of it has been
  // handed out to sections, and the way to change what it is worth.
  strip: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingInline: 16,
    paddingBlock: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  stripLine: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 14,
    rowGap: 6,
  },
  stripBar: { flexGrow: 1, flexShrink: 1, flexBasis: '12rem', minWidth: 0 },
  stripMeta: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  editButton: {
    color: tokens.mutedForeground,
  },
  limits: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  limitRule: {
    width: 1,
    height: 10,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
  },
  bar: {
    display: 'flex',
    height: 6,
    gap: 2,
    overflow: 'hidden',
    borderRadius: '9999px',
    backgroundColor: tokens.surfaceMuted,
  },
  // Four steps of one hue, not four unrelated colours: the segments are shares
  // of a single paper's cap, and what a reader compares is their lengths. The
  // previous four `var(--chart-N)` were declared by the utility sheet this
  // product retired, so every segment had been painting transparent.
  segment0: { backgroundColor: tokens.primary },
  segment1: { backgroundColor: `color-mix(in oklab, ${tokens.primary} 76%, ${tokens.surface})` },
  segment2: { backgroundColor: `color-mix(in oklab, ${tokens.primary} 52%, ${tokens.surface})` },
  segment3: { backgroundColor: `color-mix(in oklab, ${tokens.primary} 30%, ${tokens.surface})` },
  overNote: {
    margin: 0,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.danger,
  },
  unsetNote: {
    margin: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
})

/** the ramp, in order, so a segment picks its step by position */
const segments = [styles.segment0, styles.segment1, styles.segment2, styles.segment3] as const

/** a counter, so two things composed in one session never share a handle */
let composed = 0

/** how the address spells a question that has no id yet */
const DRAFT = 'draft:'

const BAR_LENGTH = {
  long: styles.skeletonBarLong,
  mid: styles.skeletonBarMid,
  short: styles.skeletonBarShort,
} as const

const bar = (length: keyof typeof BAR_LENGTH) => (
  <Skeleton className={stylex.props(styles.skeletonBar, BAR_LENGTH[length]).className} />
)

/** one heading over a card of that many rows */
function SkeletonBlock({ rows }: { rows: number }) {
  return (
    <div {...stylex.props(styles.skeletonBlock)}>
      <Skeleton className={stylex.props(styles.skeletonHeading).className} />
      <div {...stylex.props(styles.skeletonCard)}>
        {Array.from({ length: rows }, (_unused, row) => (
          <div key={row} {...stylex.props(styles.skeletonRow)}>
            {bar(row % 2 === 0 ? 'long' : 'mid')}
            {bar(row % 2 === 0 ? 'mid' : 'long')}
            {bar('short')}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The structure in outline while it loads: the card it will be, its head
 * and the paper's line, the grey strip of column words, and rows set in by
 * level the way sections and their questions will be.
 */
function StructureSkeleton() {
  const depths = [0, 1, 1, 0, 1, 2, 2]
  return (
    <div {...stylex.props(styles.skeletonCard)} aria-hidden data-testid="structure-skeleton">
      <div {...stylex.props(styles.skeletonHead)}>
        <Skeleton className={stylex.props(styles.skeletonHeading).className} />
        <span {...stylex.props(styles.skeletonFill)} />
        <Skeleton className={stylex.props(styles.skeletonTool).className} />
        <Skeleton className={stylex.props(styles.skeletonButton).className} />
      </div>
      <div {...stylex.props(styles.skeletonShare)}>
        <Skeleton className={stylex.props(styles.skeletonShareBar).className} />
      </div>
      <div {...stylex.props(styles.skeletonStrip)} />
      {depths.map((depth, row) => (
        <div key={row} {...stylex.props(styles.skeletonRow)}>
          <span {...stylex.props(styles.skeletonLead)} style={{ paddingLeft: depth * 20 }}>
            {bar(depth === 0 ? 'mid' : row % 2 === 0 ? 'long' : 'mid')}
          </span>
          {bar('short')}
          {bar('short')}
        </div>
      ))}
    </div>
  )
}

/**
 * A question on its way: the row of its three views, then its first view's
 * blocks. The band above keeps the section's own heading until the question
 * can take it over, and the two are one height, so nothing moves when it does.
 */
function QuestionSkeleton() {
  return (
    <div {...stylex.props(styles.skeletonStack)} aria-hidden data-testid="question-skeleton">
      <div {...stylex.props(styles.skeletonTabs)}>
        {[56, 72, 64].map((width) => (
          <Skeleton
            key={width}
            className={stylex.props(styles.skeletonTab).className}
            width={width}
          />
        ))}
      </div>
      <SkeletonBlock rows={2} />
      <SkeletonBlock rows={3} />
    </div>
  )
}

export default function ItemSettingsPage() {
  // Held out here because the band at the top of the page is the one the
  // open question speaks through, and the page has to know when to give it
  // up.
  //
  // Both kinds live in the address, a saved question by its id and one still
  // being composed as `draft:<handle>` with the group it is being composed
  // into beside it. A composition used to be the one thing kept in memory,
  // which meant a reload - or a shared link, or the back button used once
  // too often - put the reader back on the structure with no sign that
  // anything had been open.
  const [question] = usePageQueryState('question', '', { history: 'push' })
  const [group] = usePageQueryState('group', '', { history: 'push' })
  // which tab of the open question is showing; read here only to be put
  // back (see the hold below)
  const [panel] = usePageQueryState('panel', '', { history: 'replace' })
  // One write, two keys. Setting them through two state hooks made the
  // second overwrite the first's pending address, so a composition arrived
  // with no group and a close arrived with no question cleared.
  const address = usePageQueryUpdate()
  const composing = question.startsWith(DRAFT) ? question.slice(DRAFT.length) : null
  const setQuestion = (itemId: string) =>
    address({ question: itemId, group: '' }, { history: 'push' })
  const setComposing = (localId: string | null, groupId?: string) =>
    address(
      localId === null
        ? { question: '', group: '' }
        : { question: `${DRAFT}${localId}`, group: groupId ?? group },
      { history: 'push' },
    )

  // What is open is what the address says - until the address moves away
  // from a saved question with unsaved changes. The browser's back button,
  // the band's arrows and every other move of the address arrive after the
  // fact, so the question stays on screen until the reader lets its changes
  // go. A composition needs no such hold: it is kept in the structure.
  //
  // Held here rather than in the editor, because the band at the top speaks
  // for whatever is on screen: a band that followed the address while the
  // question stayed put changed shape under the question being asked about.
  // The tab the question was on is kept with it, because the address the
  // back button left has none - read from there, the question on hold fell
  // back to its first tab, and staying came back to a different one.
  const [unsaved, setUnsaved] = useState(false)
  const [kept, setKept] = useState({ question, composing, panel })
  const moved = kept.question !== question || kept.composing !== composing
  const holding = moved && unsaved && kept.composing === null && kept.question !== ''
  if (moved && !holding) setKept({ question, composing, panel })
  else if (!moved && kept.panel !== panel) setKept({ ...kept, panel })
  const shown = holding ? kept.question : question
  // Staying puts the question back in the address once: the dialog answers
  // a cancel twice, and a second entry in the history would take the next
  // back press nowhere.
  const restoring = useRef(false)
  useEffect(() => {
    if (!moved) restoring.current = false
  }, [moved])
  const stay = () => {
    if (restoring.current) return
    restoring.current = true
    address({ question: kept.question, group: '', panel: kept.panel }, { history: 'push' })
  }
  // the dialog answers a confirm with a cancel as it closes; that one must
  // not put the discarded question back in the address
  const letGo = () => {
    restoring.current = true
    setUnsaved(false)
  }
  // The band is handed over once the question is there to take it. Handed
  // over on the address alone, it stood empty while the round was still
  // being read, and grew into the question's heading when that arrived.
  const [questionUp, setQuestionUp] = useState(false)

  return (
    <BatchScreen
      title={m.items_tab()}
      description={m.items_hint()}
      banner={shown !== '' && questionUp ? 'open' : 'section'}
      // the round's notes belong to the structure: an address naming a
      // question drops them at once, so the outline of the question stands
      // where the question will
      notes={shown === ''}
    >
      {(batch) => (
        <Editor
          batchId={batch.id}
          batchStatus={batch.status}
          materialRange={batch.materialRange}
          participantCount={batch.participantCount}
          canAppoint={batch.capabilities.manage}
          question={shown}
          onQuestion={setQuestion}
          composing={holding ? kept.composing : composing}
          composingGroup={group}
          onComposing={setComposing}
          unsaved={unsaved}
          onUnsaved={setUnsaved}
          holding={holding}
          heldPanel={holding ? kept.panel : undefined}
          onStay={stay}
          onLetGo={letGo}
          onQuestionUp={setQuestionUp}
        />
      )}
    </BatchScreen>
  )
}

function Editor({
  batchId,
  batchStatus,
  materialRange,
  participantCount,
  canAppoint,
  question,
  onQuestion,
  composing: composingId,
  composingGroup,
  onComposing,
  unsaved,
  onUnsaved,
  holding,
  heldPanel,
  onStay,
  onLetGo,
  onQuestionUp,
}: {
  batchId: string
  batchStatus: string
  materialRange: { start: string; end: string }
  /** how many people are on the roster, for a question granted to all of them */
  participantCount: number
  /** whether the reader may put people into this round's roles */
  canAppoint: boolean
  /** the saved question the address says is open, or '' for the structure */
  question: string
  onQuestion: (itemId: string) => void
  /** the unsaved question being written, which has no id to put in the address */
  composing: string | null
  /** which group the composition in the address belongs to */
  composingGroup: string
  onComposing: (localId: string | null, groupId?: string) => void
  /**
   * Whether the open question holds edits the round has not been told
   * about. Set by the editor, kept by the page: it decides whether a move
   * of the address is held.
   */
  unsaved: boolean
  onUnsaved: (unsaved: boolean) => void
  /** the address has moved on, and the question is held until the reader says */
  holding: boolean
  /** the tab the held question was on, which the address no longer says */
  heldPanel: string | undefined
  /** keep the held question: it goes back into the address */
  onStay: () => void
  /** let the held question's changes go */
  onLetGo: () => void
  /** whether a question is on screen to speak through the band */
  onQuestionUp: (up: boolean) => void
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const { formatError } = useI18n()
  const failures = useLoadFailure()
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
  // deleting leaves no record behind, so it is asked for out loud
  const [deleting, setDeleting] = useState<ItemDto | null>(null)
  // the group whose panel is open over the structure, if any
  const [group, setGroup] = useState<GroupTarget | null>(null)
  const lingeringGroup = useLingering(group)
  const lingeringVoid = useLingering(voiding)
  // a drop that crosses groups on a running round waits here for its sentence
  const [pendingMove, setPendingMove] = useState<{
    itemId: string
    groupId: string
    orderedItemIds: readonly string[]
  } | null>(null)
  const lingeringMove = useLingering(pendingMove)
  /** which screen was on show last commit, which is what says which way it moved */
  const wasAt = useRef(STRUCTURE)
  // where the reader is, read after a wait: a save's answer arrives with the
  // round read again, and by then the reader may have gone to another page
  const { pathname } = useLocation()
  const here = useRef<string | null>(pathname)
  useEffect(() => {
    here.current = pathname
    return () => {
      here.current = null
    }
  }, [pathname])

  const selection: TreeSelection | null =
    composingId !== null
      ? { kind: 'draft', localId: composingId }
      : question !== ''
        ? { kind: 'item', id: question }
        : null
  const drillKey =
    composingId !== null ? `draft:${composingId}` : question !== '' ? `item:${question}` : STRUCTURE

  // A reload arrives with the address naming a composition this session has
  // never held, so the row is made again from what the address says. What
  // was typed into it is gone - that was never anywhere but this tab - but
  // the reader lands back on the question they were writing rather than on
  // the structure, wondering whether they imagined it.
  useEffect(() => {
    if (composingId === null) return
    setDrafts((current) =>
      current.some((one) => one.localId === composingId)
        ? current
        : [...current, { localId: composingId, groupId: composingGroup, title: '' }],
    )
  }, [composingId, composingGroup])

  /** leave whatever is open and go back to the structure, its changes let go already */
  const close = () => {
    onUnsaved(false)
    onComposing(null)
    onQuestion('')
  }

  // one more question being composed, opened so it can be written straight away
  const compose = (groupId: string) => {
    const localId = `local-${(composed += 1)}`
    setDrafts((current) => [...current, { localId, groupId, title: '' }])
    onComposing(localId, groupId)
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
      toast.success(m.items_published())
      void refresh()
    },
    onError: (error) => toast.error(refusedPublish(error, formatError)),
  })

  const remove = useMutation({
    mutationFn: (itemId: string) => run(api.assessment.deleteItem({ params: { itemId } })),
    onSuccess: () => {
      close()
      void refresh()
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
      const sequence = input.orderedItemIds.flatMap((id) => {
        const current = allItems.find((item) => item.id === id)
        return current === undefined
          ? []
          : [{ id, sortOrder: current.sortOrder, voided: current.status === 'voided' }]
      })
      // a voided question keeps the place it had: nothing about it may be
      // written any more, its place in the order included, so the live ones
      // are numbered around it
      const placed = sortOrdersAfterDrop(sequence)
      for (const id of input.orderedItemIds) {
        const current = allItems.find((item) => item.id === id)
        const sortOrder = placed.get(id)
        if (current === undefined || sortOrder === undefined) continue
        const movedGroup = id === input.itemId && current.scoreGroupId !== input.groupId
        if (current.sortOrder !== sortOrder || movedGroup) {
          await run(
            api.assessment.updateItem({
              params: { itemId: id },
              payload: {
                sortOrder,
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
      void refresh()
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
      void refresh()
    },
  })

  // Each question whose route finds some of the roster nowhere, by how many
  // and on which route: a submission refused is said before an appeal is.
  const unreachable = new Map<string, { route: 'normal' | 'escalation'; count: number }>()
  for (const one of alerts.data?.unreachable.routes ?? []) {
    const said = unreachable.get(one.itemId)
    if (said === undefined || (said.route === 'escalation' && one.route === 'normal')) {
      unreachable.set(one.itemId, { route: one.route, count: one.participants })
    }
  }

  const paper = (allGroups as readonly TreeGroup[]).find((group) => group.parentGroupId === null)
  const roots = (allGroups as readonly TreeGroup[]).filter(
    (group) => group.parentGroupId === (paper?.id ?? null),
  )
  const rows = structureRows(allGroups, allItems, drafts, paper?.id ?? null)

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
    else onComposing(row.id, drafts.find((one) => one.localId === row.id)?.groupId)
  }

  const parentOf = (row: StructureRow): string | null =>
    row.kind === 'group'
      ? ((allGroups.find((one) => one.id === row.id)?.parentGroupId as string | null) ?? null)
      : ((allItems.find((one) => one.id === row.id)?.scoreGroupId as string | null) ?? null)
  // A section is reordered among its siblings by dragging, and nothing more:
  // moving one under another parent changes what its cap covers, and that
  // is a change the section's own editor asks a reason for.
  const acceptsDrop = (
    dragged: StructureRow,
    target: StructureRow,
    edge: 'before' | 'after' | 'into',
  ) => dragged.kind !== 'group' || (edge !== 'into' && parentOf(target) === parentOf(dragged))

  // a dropped row lands where the line was drawn: inside a group, or beside
  // the row it was dropped on, in that row's own group
  const moveRow = (
    dragged: StructureRow,
    target: StructureRow,
    edge: 'before' | 'after' | 'into',
  ) => {
    if (dragged.kind === 'draft' || !acceptsDrop(dragged, target, edge)) return
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

  /** a saved question, opened where the reader already is */
  const opened = async (itemId: string) => {
    // saved, so nothing on screen is waiting to be let go
    onUnsaved(false)
    const from = here.current
    // the created row has to be in hand before it can be opened, or the
    // screen has nothing to show between the save and the refetch. The
    // reader stays where they were, so nothing travels.
    await refresh()
    // Gone to another page meanwhile, the reader is not brought back: the
    // address is written relative to this page, and written now it took
    // them back to the question they had just left.
    if (here.current !== from) return
    // and the question is named before the draft is let go: the other
    // order leaves one render with neither, which is the structure, so
    // the screen travels out to the list and back in again on a press
    // that never left the question. A saved question the address already
    // names is left as it is.
    if (question !== itemId) onQuestion(itemId)
    if (writing !== null) closeDraft(writing.localId)
  }

  const editorArea =
    (selectedItem !== null || writing !== null) && options.data !== undefined ? (
      <ItemEditor
        key={selectedItem?.id ?? writing?.localId ?? 'item'}
        batchId={batchId}
        batchStatus={batchStatus}
        materialRange={materialRange}
        participantCount={participantCount}
        item={selectedItem}
        groups={allGroups.map((one) => ({ id: one.id, name: one.name }))}
        trail={trailOf(allGroups, openGroupId)}
        placement={placementOf(allGroups, allItems, openGroupId, paper?.id ?? null)}
        paper={everyQuestion}
        defaultGroupId={writing?.groupId}
        options={options.data}
        held={writing === null ? undefined : held[writing.localId]}
        onHold={onHold}
        onDirty={onUnsaved}
        panelHeld={heldPanel}
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
              onDelete={() => setDeleting(selectedItem)}
            />
          )
        }
        onCancel={() => (writing === null ? close() : closeDraft(writing.localId))}
        onReload={refresh}
        onSaved={(itemId) => void opened(itemId)}
      />
    ) : null
  const questionUp = editorArea !== null
  useEffect(() => onQuestionUp(questionUp), [questionUp, onQuestionUp])

  const structure =
    paper === undefined ? (
      <PaperStart batchId={batchId} version={groupsVersion ?? 0} onCreated={() => void refresh()} />
    ) : (
      <div {...stylex.props(styles.grow, styles.structureArea)}>
        <StructureTable
          batchId={batchId}
          title={paper.name.trim() === '' ? m.items_groupUnnamed() : paper.name}
          note={<PaperLimits paper={paper} />}
          summary={
            <PaperShare
              paper={paper}
              roots={roots}
              onEdit={() => setGroup({ kind: 'edit', group: paper })}
            />
          }
          rows={rows}
          unreachable={unreachable}
          selectedKey={null}
          onOpen={openRow}
          onAddGroup={(parentId) => setGroup({ kind: 'new', parentId: parentId ?? paper.id })}
          onAddItem={(groupId) => compose(groupId ?? paper.id)}
          onMove={moveRow}
          accepts={acceptsDrop}
          onPublish={(itemId) => publish.mutate(itemId)}
          onVoid={(itemId) => {
            const item = allItems.find((one) => one.id === itemId)
            if (item !== undefined) setVoiding(item)
          }}
          onRestore={(itemId) => restore.mutate(itemId)}
          onDelete={(itemId) => {
            const item = allItems.find((one) => one.id === itemId)
            if (item !== undefined) setDeleting(item)
          }}
        />
      </div>
    )

  // The paper, its questions and what a question may be set to are one
  // reading as far as the reader is concerned: a question cannot be opened
  // without the last, and it failing alone left the question a blank pane.
  const unread = groups.error ?? items.error ?? options.error ?? null
  return (
    <AsyncSection
      pending={groups.isPending || items.isPending || options.isPending}
      error={unread === null ? null : failures.of(unread, { missing: [BATCH_MISSING] })}
      framed
      retrying={groups.isFetching || items.isFetching || options.isFetching}
      loadingLabel={commonMessages.state_loading()}
      retryLabel={commonMessages.action_retry()}
      onRetry={() => {
        if (groups.isError) void groups.refetch()
        if (items.isError) void items.refetch()
        if (options.isError) void options.refetch()
      }}
      skeleton={question === '' ? <StructureSkeleton /> : <QuestionSkeleton />}
      xstyle={unread === null ? styles.grow : styles.failure}
    >
      <div {...stylex.props(styles.grow, styles.editorColumn)}>
        {selection === null && (
          <ReviewGapNotice
            batchId={batchId}
            groups={alerts.data?.groups ?? []}
            canAppoint={canAppoint}
          />
        )}

        <Drill move={move} drillKey={drillKey} className={stylex.props(styles.grow).className}>
          {selection === null ? structure : editorArea}
        </Drill>
      </div>

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {lingeringGroup !== null && (
        <GroupEditor
          key={
            lingeringGroup.kind === 'edit'
              ? lingeringGroup.group.id
              : `new:${lingeringGroup.parentId}`
          }
          open={group !== null}
          batchId={batchId}
          batchStatus={batchStatus}
          groups={allGroups}
          version={groupsVersion ?? 0}
          editing={lingeringGroup.kind === 'edit' ? lingeringGroup.group : null}
          parentId={lingeringGroup.kind === 'new' ? lingeringGroup.parentId : null}
          onClose={() => setGroup(null)}
          onDone={() => {
            setGroup(null)
            void refresh()
          }}
        />
      )}

      {lingeringMove !== null && (
        <ReasonDialog
          open={pendingMove !== null}
          title={m.items_moveReasonTitle()}
          description={m.items_reasonHint()}
          busy={moveItem.isPending}
          onConfirm={(reason) => {
            moveItem.mutate({ ...lingeringMove, reason })
            setPendingMove(null)
          }}
          onClose={() => {
            setPendingMove(null)
            void refresh()
          }}
        />
      )}

      <ConfirmDialog
        open={holding}
        tone="destructive"
        title={m.items_leaveUnsaved()}
        confirmLabel={m.plan_discard()}
        cancelLabel={commonMessages.action_cancel()}
        onConfirm={onLetGo}
        onCancel={onStay}
      />

      <ConfirmDialog
        open={deleting !== null}
        tone="destructive"
        title={m.items_deleteConfirm({ title: deleting?.title ?? '' })}
        description={m.items_deleteConfirmHint()}
        confirmLabel={m.items_delete()}
        cancelLabel={commonMessages.action_cancel()}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const item = deleting
          setDeleting(null)
          if (item !== null) remove.mutate(item.id)
        }}
      />

      {lingeringVoid !== null && (
        <VoidQuestionDialog
          open={voiding !== null}
          item={lingeringVoid}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null)
            void refresh()
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
    subtotal: subtotal === null ? null : amountOf(subtotal),
    total: groups.find((one) => one.id === paperId)?.cap ?? null,
  }
}

/** what the whole paper is worth, and the least it may come to */
function PaperLimits({ paper }: { paper: TreeGroup }) {
  return (
    <span {...stylex.props(styles.limits)}>
      <span>
        {m.items_paperTotal()}{' '}
        {paper.cap === null ? m.items_structureUncapped() : trimAmount(paper.cap)}
      </span>
      <span aria-hidden {...stylex.props(styles.limitRule)} />
      <span>
        {paper.floor === null
          ? m.items_paperFloorNone()
          : `${m.items_groupFloor()} ${trimAmount(paper.floor)}`}
      </span>
    </span>
  )
}

/**
 * How much of the paper has been handed out to its sections, on the card's
 * first line under its name.
 *
 * What the table cannot answer: the bar says it at a glance and the caption
 * puts a number on it. Anything actually wrong - sections adding up past the
 * total, a section with no limit at all - earns a line of its own, because an
 * exception is worth space and a steady state is not.
 */
function PaperShare({
  paper,
  roots,
  onEdit,
}: {
  paper: TreeGroup
  roots: readonly TreeGroup[]
  onEdit: () => void
}) {
  const capped = roots.length > 0 && roots.every((group) => group.cap !== null)
  const held = roots.reduce((total, group) => total + unitsOf(group.cap ?? 0), 0)
  const total = paper.cap === null ? null : unitsOf(paper.cap)
  const sum = capped ? amountOf(held) : null
  const over = sum !== null && total !== null && held > total

  return (
    <div {...stylex.props(styles.strip)} data-testid="paper-share">
      <div {...stylex.props(styles.stripLine)}>
        {/* measured against the paper, so the part nobody has handed out yet
            reads as the part nobody has handed out */}
        {sum !== null && total !== null && total > 0 ? (
          <div {...stylex.props(styles.bar, styles.stripBar)} aria-hidden>
            {roots.map((group, index) => (
              <div
                key={group.id}
                {...stylex.props(segments[index % segments.length])}
                style={{
                  width: `${Math.min(100, (unitsOf(group.cap ?? 0) / Math.max(held, total)) * 100)}%`,
                }}
              />
            ))}
          </div>
        ) : (
          <span {...stylex.props(styles.stripBar)}>
            {sum === null && roots.length > 0 && (
              <span {...stylex.props(styles.unsetNote)}>{m.items_paperCapUnset()}</span>
            )}
          </span>
        )}
        {sum !== null && (
          <span {...stylex.props(styles.stripMeta)}>
            {total === null
              ? m.items_paperAllocatedFree({ sum })
              : m.items_paperAllocated({ sum, total: trimAmount(paper.cap!) })}
          </span>
        )}
        <Button
          variant="ghost"
          size="xs"
          className={stylex.props(styles.editButton).className}
          onClick={onEdit}
        >
          <PencilIcon aria-hidden />
          {m.items_paperEdit()}
        </Button>
      </div>
      {over && (
        <p {...stylex.props(styles.overNote)}>
          {m.items_paperCapOver({ sum: sum, total: trimAmount(paper.cap!) })}
        </p>
      )}
    </div>
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
  return (
    <>
      {item.status === 'draft' && (
        <DropdownMenuItem disabled={busy || unsaved} onSelect={onPublish}>
          {unsaved ? m.items_publishAfterSave() : m.items_publish()}
        </DropdownMenuItem>
      )}
      {item.status === 'active' && batchStatus !== 'draft' && (
        <DropdownMenuItem onSelect={onVoid}>{m.items_void()}</DropdownMenuItem>
      )}
      {item.status === 'voided' && (
        <DropdownMenuItem disabled={busy} onSelect={onRestore}>
          {m.items_restore()}
        </DropdownMenuItem>
      )}
      {/* one never published leaves without a trace; one published keeps its
          record and can only be withdrawn */}
      {(item.status === 'draft' || batchStatus === 'draft') && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={busy} onSelect={onDelete}>
            {m.items_delete()}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}
