import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import { Feedback, Field, PageHeader } from '@qualy/ui/admin'
import { useLingering } from '@qualy/ui/use-lingering'
import { cn } from '@qualy/ui/cn'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@qualy/ui/dropdown-menu'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@qualy/ui/input-group'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../i18n.ts'
import { amountOf, trimAmount, unitsOf, type ItemDto } from '../entry/model.ts'
import { Choice } from './Choice.tsx'
import { FieldList, type FieldDraft } from './FieldTable.tsx'
import { StageSheet, type StageDraft } from './StageSheet.tsx'
import { ImpactDialog, type ChangeEffects, type ChangeImpact } from './ImpactDialog.tsx'
import { ReasonDialog } from './ReasonDialog.tsx'
import { BatchBanner } from '../batch/BatchScreen.tsx'
import type { ItemOptions } from './options.ts'
import type { Placement } from './paper.ts'

const blankField = (key: string): FieldDraft => ({
  // minted together and both immutable: the key is where the answer sits,
  // the id is what says this is still the same question next revision
  id: key,
  key,
  type: 'text',
  label: '',
  required: false,
  maxLength: '',
  min: '',
  max: '',
  maxCount: '1',
  maxSizeMb: '',
  accept: '',
})

/**
 * A step's permanent name. Saved with the policy, because whether an
 * in-flight round can carry on under a newer one is answered by asking
 * whether the step it stands at is still there - a question positions
 * cannot answer, and a handle minted fresh on every load answers wrongly.
 */
const nextStageId = (): string =>
  `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const blankStage = (options: ItemOptions, chain: 'normal' | 'escalation'): StageDraft => ({
  key: nextStageId(),
  kind: 'roleAt',
  nodeTypeId: options.orgTypes[0]?.id ?? '',
  roleIds: [],
  roleId: options.roles[0]?.id ?? '',
  chain,
})

// One question, composed rather than typed: the fields participants will
// fill, what each approved entry counts, and who reviews at which level.
// The editor builds the same configuration object the api validates, so the
// server stays the judge and this stays a pen.
//
// The review chain is drawn as what it is - a path from submission to a
// finished review - with one step open for editing at a time and the rest
// folded to what they resolve to.

/**
 * The key is the payload's own word for a field, so it is minted once and
 * never reused: renaming one would leave every filed answer pointing at a
 * field that no longer exists. Nobody types it - the label is what a person
 * writes.
 *
 * Not a counter. `f1` is a name the next question of the next round would
 * mint as well, and a name two different questions answer to is the one
 * thing a permanent identity may not be.
 */
const nextKey = (): string => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export interface Draft {
  title: string
  scoreGroupId: string
  maxEntries: string
  /** what kind of question this is; frozen once created */
  itemType: 'evidence' | 'declaration' | 'constant'
  entrySource: 'student' | 'administrative'
  /** whether submissions answer to a review route at all */
  reviewMode: 'workflow' | 'none'
  description: string
  fields: FieldDraft[]
  fixedValue: string
  /** how approved lines fold into the item's amount */
  folding: 'sum' | 'max' | 'top-n'
  topN: string
  stages: StageDraft[]
}

/** the stored configuration back into the pen; a shape this pen cannot hold starts fresh */
const draftOf = (
  item: ItemDto | null,
  groups: readonly { id: string }[],
  options: ItemOptions,
): Draft => {
  const revision = item?.currentRevision ?? null
  const config = revision as {
    entrySource?: 'student' | 'administrative'
    formConfig?: unknown
    scoringConfig?: unknown
    reviewPolicy?: unknown
    displayConfig?: unknown
  } | null
  const fields = Array.isArray((config?.formConfig as { fields?: unknown[] })?.fields)
    ? ((config!.formConfig as { fields: Record<string, unknown>[] }).fields.map(
        (field): FieldDraft => ({
          // a form saved before identities existed is not rewritten to gain
          // them: its key is its identity, which is what it always was
          id: String(field['id'] ?? field['key'] ?? ''),
          key: String(field['key'] ?? ''),
          type: (field['type'] as FieldDraft['type']) ?? 'text',
          label: String(field['label'] ?? ''),
          required: field['required'] === true,
          maxLength: field['maxLength'] === undefined ? '' : String(field['maxLength']),
          min: String(field['min'] ?? ''),
          max: String(field['max'] ?? ''),
          maxCount: field['maxCount'] === undefined ? '1' : String(field['maxCount']),
          maxSizeMb:
            field['maxFileBytes'] === undefined
              ? ''
              : String(Math.round(Number(field['maxFileBytes']) / (1024 * 1024))),
          accept: Array.isArray(field['accept']) ? (field['accept'] as string[]).join(', ') : '',
        }),
      ) ?? [])
    : []
  const scoring = config?.scoringConfig as
    | {
        calculator?: { config?: { value?: string } }
        aggregator?: { ref?: string; config?: { n?: number } }
      }
    | undefined
  const aggregatorRef = scoring?.aggregator?.ref ?? 'sum@1'
  const stages = stagesOf(config?.reviewPolicy, options)
  return {
    title: item?.title ?? '',
    scoreGroupId:
      item !== null && item.scoreGroupId !== '' ? item.scoreGroupId : (groups[0]?.id ?? ''),
    maxEntries: item === null ? '1' : item.maxEntries === null ? '' : String(item.maxEntries),
    itemType:
      item?.itemType === 'constant'
        ? 'constant'
        : item?.itemType === 'declaration'
          ? 'declaration'
          : 'evidence',
    entrySource: config?.entrySource ?? 'student',
    reviewMode:
      item?.itemType === 'constant' ||
      (config?.reviewPolicy as { mode?: unknown } | undefined)?.mode === 'none'
        ? 'none'
        : 'workflow',
    description: String((config?.displayConfig as { description?: unknown })?.description ?? ''),
    fields: fields.length > 0 ? fields : [blankField(nextKey())],
    // 100.0000 is how it is stored, not how anybody types it
    fixedValue: trimAmount(scoring?.calculator?.config?.value ?? '1'),
    folding: aggregatorRef === 'max@1' ? 'max' : aggregatorRef === 'top-n-sum@1' ? 'top-n' : 'sum',
    topN: String(scoring?.aggregator?.config?.n ?? 2),
    stages: stages.length > 0 ? stages : [blankStage(options, 'normal')],
  }
}

/**
 * The stored policy back into the pen, whichever version wrote it.
 *
 * A policy written as one list with `normalTerminal` in it is read as the
 * split it always described, and its steps keep the names they are known by
 * elsewhere - the same names the round rows were backfilled with - so
 * opening an old question in the editor does not silently rebuild its
 * policy out of new steps.
 */
const stagesOf = (stored: unknown, options: ItemOptions): StageDraft[] => {
  const held = stored as
    | {
        normal?: { stages?: StoredStage[] }
        escalation?: { stages?: StoredStage[] }
        /** the escalation route while it was still called the doubt route */
        doubt?: { stages?: StoredStage[] }
        stages?: StoredStage[]
        normalTerminal?: number
      }
    | undefined
  const other = held?.escalation ?? held?.doubt
  const draftOne = (stage: StoredStage, chain: 'normal' | 'escalation', id: string): StageDraft =>
    stage.selector?.kind === 'nearestRole'
      ? {
          key: id,
          kind: 'nearestRole',
          nodeTypeId: options.orgTypes[0]?.id ?? '',
          roleIds: [],
          roleId: stage.selector.roleId ?? options.roles[0]?.id ?? '',
          chain,
        }
      : {
          key: id,
          kind: 'roleAt',
          nodeTypeId: stage.selector?.nodeTypeId ?? options.orgTypes[0]?.id ?? '',
          roleIds: stage.selector?.roleIds ?? [],
          roleId: options.roles[0]?.id ?? '',
          chain,
        }
  if (Array.isArray(held?.normal?.stages) || Array.isArray(other?.stages)) {
    return [
      ...(held?.normal?.stages ?? []).map((stage, index) =>
        draftOne(stage, 'normal', stage.id ?? `legacy-${index}`),
      ),
      ...(other?.stages ?? []).map((stage, index) =>
        draftOne(stage, 'escalation', stage.id ?? `legacy-${index}`),
      ),
    ]
  }
  const terminal = held?.normalTerminal ?? 0
  return (held?.stages ?? []).map((stage, index) =>
    draftOne(stage, index > terminal ? 'escalation' : 'normal', stage.id ?? `legacy-${index}`),
  )
}

interface StoredStage {
  id?: string
  selector?: { kind?: string; nodeTypeId?: string; roleIds?: string[]; roleId?: string }
}

const storedStage = (stage: StageDraft) => ({
  id: stage.key,
  selector:
    stage.kind === 'roleAt'
      ? { kind: 'roleAt', nodeTypeId: stage.nodeTypeId, roleIds: stage.roleIds }
      : { kind: 'nearestRole', roleId: stage.roleId },
  quorum: { type: 'any' },
})

/** the pen back into the configuration the api validates */
const configOf = (draft: Draft) =>
  draft.itemType === 'declaration'
    ? {
        // one press is the whole filing: no fields, review as configured
        entrySource: draft.entrySource,
        formConfig: {},
        scoringConfig: {
          calculator: { ref: 'fixed@1', config: { value: draft.fixedValue.trim() } },
          aggregator: aggregatorOf(draft),
        },
        ...(draft.description.trim() !== ''
          ? { displayConfig: { description: draft.description.trim() } }
          : {}),
        reviewPolicy: reviewPolicyOf(draft),
      }
    : draft.itemType === 'constant'
      ? {
          // granted, never filed: no form, no route, only the amount
          entrySource: 'administrative' as const,
          formConfig: {},
          scoringConfig: {
            calculator: { ref: 'fixed@1', config: { value: draft.fixedValue.trim() } },
            aggregator: { ref: 'sum@1', config: {} },
          },
          ...(draft.description.trim() !== ''
            ? { displayConfig: { description: draft.description.trim() } }
            : {}),
          reviewPolicy: { mode: 'none' },
        }
      : evidenceConfigOf(draft)

const aggregatorOf = (draft: Draft) =>
  draft.folding === 'max'
    ? { ref: 'max@1', config: {} }
    : draft.folding === 'top-n'
      ? { ref: 'top-n-sum@1', config: { n: Math.max(1, Number(draft.topN) || 1) } }
      : { ref: 'sum@1', config: {} }

const reviewPolicyOf = (draft: Draft) =>
  draft.reviewMode === 'none'
    ? { mode: 'none' }
    : {
        normal: { stages: draft.stages.filter((one) => one.chain === 'normal').map(storedStage) },
        escalation: {
          stages: draft.stages.filter((one) => one.chain === 'escalation').map(storedStage),
        },
      }

const evidenceConfigOf = (draft: Draft) => ({
  entrySource: draft.entrySource,
  formConfig: {
    fields: draft.fields.map((field) => ({
      id: field.id.trim() === '' ? field.key.trim() : field.id.trim(),
      key: field.key.trim(),
      type: field.type,
      label: field.label.trim(),
      ...(field.required ? { required: true } : {}),
      ...(field.type === 'text' && field.maxLength.trim() !== ''
        ? { maxLength: Number(field.maxLength) }
        : {}),
      ...(field.type === 'date' && field.min.trim() !== '' ? { min: field.min.trim() } : {}),
      ...(field.type === 'date' && field.max.trim() !== '' ? { max: field.max.trim() } : {}),
      ...(field.type === 'attachment'
        ? {
            maxCount: Number(field.maxCount) > 0 ? Number(field.maxCount) : 1,
            ...(field.maxSizeMb.trim() !== ''
              ? { maxFileBytes: Number(field.maxSizeMb) * 1024 * 1024 }
              : {}),
            ...(field.accept.trim() !== ''
              ? {
                  accept: field.accept
                    .split(',')
                    .map((kind) => kind.trim())
                    .filter((kind) => kind !== ''),
                }
              : {}),
          }
        : {}),
    })),
  },
  scoringConfig: {
    calculator: { ref: 'fixed@1', config: { value: draft.fixedValue.trim() } },
    aggregator: aggregatorOf(draft),
  },
  ...(draft.description.trim() !== ''
    ? { displayConfig: { description: draft.description.trim() } }
    : {}),
  reviewPolicy: reviewPolicyOf(draft),
})

/**
 * A composition reduced to what a save would actually send.
 *
 * The handles the pen uses to tell one field or one review step from another
 * are its own bookkeeping - they are minted fresh every time a stored
 * question is read back into it, and they never leave the browser. Comparing
 * them would be comparing two readings rather than two questions.
 */
const stated = (draft: Draft): string =>
  JSON.stringify({
    title: draft.title.trim(),
    scoreGroupId: draft.scoreGroupId,
    maxEntries: draft.maxEntries.trim() === '' ? null : Math.max(1, Number(draft.maxEntries)),
    config: configOf(draft),
  })

export function ItemConfigEditor({
  batchId,
  batchStatus,
  materialRange,
  item,
  groups,
  defaultGroupId,
  options,
  menu,
  trail,
  placement,
  paper,
  held,
  onHold,
  onDirty,
  onCancel,
  onSaved,
}: {
  batchId: string
  batchStatus: string
  /** the round's own window; a date field can only narrow it, never widen it */
  materialRange: { start: string; end: string }
  /** null while a question is being composed and has never been saved */
  item: ItemDto | null
  groups: readonly { id: string; name: string }[]
  /** the group a new question was opened inside */
  defaultGroupId?: string | undefined
  options: ItemOptions
  /** what else can be done to the question, as the rows of its own menu */
  menu?: React.ReactNode
  /** where this sits in the paper, outermost group first */
  trail: readonly string[]
  /** the limits this question's score has to pass through */
  placement: Placement
  /**
   * Every question of the round, in the order the paper reads them, so this
   * one can say which of them it is. Counted across the whole paper rather
   * than the group: an author reading through what a round asks does not
   * stop at a group boundary.
   */
  paper: readonly { id: string; title: string }[]
  /** what was being composed when this last unmounted, if anything */
  held?: Draft | undefined
  /** every keystroke, so the page can hand the same composition back later */
  onHold?: ((draft: Draft) => void) | undefined
  /** whether the pane holds edits the round has not been told about yet */
  onDirty?: ((dirty: boolean) => void) | undefined
  onCancel: () => void
  onSaved: (itemId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [draft, setDraft] = useState<Draft>(() => {
    if (held !== undefined) return held
    const seeded = draftOf(item, groups, options)
    return defaultGroupId === undefined ? seeded : { ...seeded, scoreGroupId: defaultGroupId }
  })
  // the page keeps what is being composed, so selecting another row and
  // coming back finds the work rather than a blank form
  useEffect(() => {
    onHold?.(draft)
  }, [draft, onHold])

  // What the round would be told if this were saved now, against what it was
  // told last: publishing a question while the pane says something else would
  // ship the older answer under the newer one's name.
  //
  // Compared as what a save would send, not as the pen holding it. The pen
  // mints a fresh handle for every review step each time it reads a question
  // back, so comparing the two pens said "changed" for ever, and every saved
  // question refused to publish because it thought it was unsaved.
  const wasSaid = useMemo(
    () => (item === null ? null : stated(draftOf(item, groups, options))),
    [item, groups, options],
  )
  const dirty = wasSaid !== null && stated(draft) !== wasSaid
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  const [problem, setProblem] = useState<string | null>(null)
  const [issues, setIssues] = useState<readonly { path: string; reason: string }[]>([])
  const [openField, setOpenField] = useState<string | null>(null)
  const [openStage, setOpenStage] = useState<string | null>(null)
  const [askingReason, setAskingReason] = useState(false)
  // what a save would disturb, when the server hands it back to be answered.
  // The reason travels with it: the first pass may already have carried one,
  // and answering the question does not make the round stop needing it.
  const [impact, setImpact] = useState<ChangeImpact | null>(null)
  const [draftReason, setDraftReason] = useState<string | null>(null)
  const lingeringImpact = useLingering(impact)

  const patch = (next: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...next }))

  /**
   * Changing what a field asks for is not editing that field.
   *
   * "2026-04-12" is not an answer to a question now asking for text, so a
   * type change mints a new key and a new identity: the old field is gone
   * and a new one stands in its place, and nothing already filed is carried
   * into it. Everything else about a field - its label, its bounds, whether
   * it is required - is an edit of the same question.
   */
  const patchField = (key: string, next: Partial<FieldDraft>) => {
    const standing = draft.fields.find((one) => one.key === key)
    const retyped = standing !== undefined && next.type !== undefined && next.type !== standing.type
    const minted = retyped ? nextKey() : null
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field) =>
        field.key === key
          ? { ...field, ...next, ...(minted === null ? {} : { id: minted, key: minted }) }
          : field,
      ),
    }))
    if (minted !== null) setOpenField((open) => (open === key ? minted : open))
  }

  const save = useMutation({
    mutationFn: ({ reason, effects }: { reason: string | null; effects?: ChangeEffects }) => {
      const config = configOf(draft)
      const maxEntries =
        draft.maxEntries.trim() === '' ? null : Math.max(1, Number(draft.maxEntries))
      if (item === null) {
        return run(
          api.assessment.createItem({
            params: { batchId },
            payload: {
              itemType: draft.itemType,
              title: draft.title.trim(),
              scoreGroupId: draft.scoreGroupId,
              maxEntries,
              config: config as never,
            },
          }),
        )
      }
      return run(
        api.assessment.updateItem({
          params: { itemId: item.id },
          payload: {
            title: draft.title.trim(),
            scoreGroupId: draft.scoreGroupId,
            maxEntries,
            config: config as never,
            // which version this edit was composed against: two people with
            // the same question open must not both save over each other
            expectedRevisionId: item.currentRevision?.id ?? null,
            ...(reason === null ? {} : { reason }),
            ...(effects === undefined ? {} : { effects }),
          },
        }),
      )
    },
    onMutate: ({ reason }) => {
      setProblem(null)
      setIssues([])
      setDraftReason(reason)
    },
    onSuccess: (result: { item: { id: string } }) => {
      toast.success(format(m.itemsSaved))
      setAskingReason(false)
      setImpact(null)
      onSaved(result.item.id)
    },
    onError: (error: unknown) => {
      // not a refusal: the save is waiting to be told what should happen to
      // the work it would disturb, and asks in its own dialog
      const asked = error as { _tag?: string } & ChangeImpact
      if (asked?._tag === 'ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED') {
        setAskingReason(false)
        setImpact({ impactToken: asked.impactToken, form: asked.form, review: asked.review })
        return
      }
      const config = error as { issues?: readonly { path: string; reason: string }[] }
      if (Array.isArray(config.issues)) setIssues(config.issues)
      setProblem(formatError(error))
      setAskingReason(false)
      setImpact(null)
    },
  })

  // by key, never by index: a step deleted above must not silently turn the
  // step below it into something else
  const patchStage = (key: string, next: Partial<StageDraft>) =>
    setDraft((previous) => ({
      ...previous,
      stages: previous.stages.map((stage) => (stage.key === key ? { ...stage, ...next } : stage)),
    }))

  const moveStage = (key: string, delta: -1 | 1) =>
    setDraft((previous) => {
      const stage = previous.stages.find((candidate) => candidate.key === key)
      if (stage === undefined) return previous
      const siblings = previous.stages.filter((candidate) => candidate.chain === stage.chain)
      const at = siblings.findIndex((candidate) => candidate.key === key)
      const target = at + delta
      if (target < 0 || target >= siblings.length) return previous
      const reordered = [...siblings]
      const [moved] = reordered.splice(at, 1)
      reordered.splice(target, 0, moved!)
      const others = previous.stages.filter((candidate) => candidate.chain !== stage.chain)
      return {
        ...previous,
        stages: stage.chain === 'normal' ? [...reordered, ...others] : [...others, ...reordered],
      }
    })

  /**
   * A step goes where the author points, not on the end.
   *
   * Adding to the end and expecting people to walk it up with arrows is
   * asking them to do the insertion themselves, one press at a time, in a
   * chain whose order is its whole meaning.
   */
  /**
   * A step goes where the author pointed, not on the end.
   *
   * Adding to the end and expecting people to walk it up with arrows is
   * asking them to do the insertion themselves, one press at a time, in a
   * chain whose order is its whole meaning.
   */
  const addStage = (chain: 'normal' | 'escalation', at?: number) => {
    const stage = blankStage(options, chain)
    setDraft((previous) => {
      const own = previous.stages.filter((one) => one.chain === chain)
      const others = previous.stages.filter((one) => one.chain !== chain)
      const placed = [...own]
      placed.splice(at ?? own.length, 0, stage)
      return {
        ...previous,
        stages: chain === 'normal' ? [...placed, ...others] : [...others, ...placed],
      }
    })
    setOpenStage(stage.key)
  }

  const stageReady = (stage: StageDraft) =>
    stage.kind === 'roleAt'
      ? stage.nodeTypeId !== '' && stage.roleIds.length > 0
      : stage.roleId !== ''

  /**
   * Everything standing between this and a save, in the words of the thing
   * that is missing.
   *
   * Collected rather than reduced to a boolean, because a button that is
   * merely dead tells the reader they have done something wrong without ever
   * saying what - and the answer is always known here.
   */
  const granted = draft.itemType === 'constant'
  const fielded = draft.itemType === 'evidence'
  const routed = !granted && draft.reviewMode === 'workflow'
  const missing: string[] = [
    draft.title.trim() === '' ? format(m.itemsNeedTitle) : '',
    draft.scoreGroupId === '' ? format(m.itemsNeedGroup) : '',
    draft.fixedValue.trim() === '' ? format(m.itemsNeedValue) : '',
    fielded && draft.fields.some((field) => field.label.trim() === '')
      ? format(m.itemsNeedFieldLabel)
      : '',
    routed && draft.stages.some((stage) => !stageReady(stage)) ? format(m.itemsNeedStage) : '',
  ].filter((one) => one !== '')

  // The api asks for a sentence when a live question's scoring or placement
  // moves, and only then. Asking any wider trains people to invent one.
  const scoringMoved =
    item?.currentRevision !== null &&
    item?.currentRevision !== undefined &&
    JSON.stringify(configOf(draft).scoringConfig) !==
      JSON.stringify(item.currentRevision.scoringConfig)
  const placementMoved = item !== null && draft.scoreGroupId !== item.scoreGroupId
  const needsReason =
    item !== null &&
    item.status === 'active' &&
    batchStatus === 'active' &&
    (scoringMoved || placementMoved)

  const stage = draft.stages.find((one) => one.key === openStage) ?? null
  const lingeringStage = useLingering(stage)
  // once asked, it stays mounted so closing it is a close and not a vanish
  const askedOnce = useLingering(askingReason ? true : null) === true

  const at = paper.findIndex((one) => one.id === item?.id)
  // what this question can contribute before any group has its say
  const entries = draft.maxEntries.trim() === '' ? null : Number(draft.maxEntries)
  const each = Number(draft.fixedValue.trim())
  const ceiling =
    entries === null || !Number.isFinite(each)
      ? null
      : amountOf(unitsOf(draft.fixedValue.trim()) * entries)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The page's own band says which question this is - built to the same
          two lines every section heading has, name over context, so taking
          the band over changes what it says and not where anything sits. */}
      <BatchBanner>
        <PageHeader
          variant="banner"
          title={
            <>
              <span className="min-w-0 truncate">
                {draft.title.trim() === '' ? format(m.itemsUntitled) : draft.title}
              </span>
              <StandingChip item={item} />
            </>
          }
          description={
            <>
              {/* text-sized rather than a button's own size: a control as tall
                  as a control in a line of prose makes that line taller than
                  the same line in the heading it hands over from */}
              <button
                type="button"
                aria-label={format(m.itemsBack)}
                className="shrink-0 transition-colors hover:text-foreground"
                onClick={onCancel}
              >
                <ArrowLeftIcon aria-hidden className="size-3.5" />
              </button>
              <span className="min-w-0 truncate">
                {trail.map((name, index) => (
                  <span key={`${index}:${name}`}>
                    {index > 0 && <span className="px-1.5 text-muted-foreground/60">&rsaquo;</span>}
                    {name}
                  </span>
                ))}
              </span>
              {at >= 0 && paper.length > 1 && (
                <>
                  <span aria-hidden className="text-muted-foreground/50">
                    &middot;
                  </span>
                  <span className="shrink-0">
                    {format(m.itemsPaperPosition, { index: at + 1, total: paper.length })}
                  </span>
                </>
              )}
            </>
          }
          actions={
            <>
              {menu !== undefined && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={format(m.structureRowMenu)}
                      className="shrink-0 text-muted-foreground"
                    >
                      <EllipsisVerticalIcon aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {menu}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="outline" onClick={onCancel}>
                {format(commonMessages.cancel)}
              </Button>
              {/* pressable even when it cannot go through: the press is how
                  the reader asks what is wrong, and the answer is right here */}
              <Button
                disabled={save.isPending}
                onClick={() => {
                  if (missing.length > 0) {
                    setProblem(
                      format(m.itemsCannotSave, {
                        reasons: missing.join(format(m.listSeparator)),
                      }),
                    )
                    return
                  }
                  setProblem(null)
                  if (needsReason) setAskingReason(true)
                  else save.mutate({ reason: null })
                }}
              >
                {format(m.entrySave)}
              </Button>
            </>
          }
        />
      </BatchBanner>

      <div className="grid min-h-0 flex-1 gap-x-9 xl:grid-cols-[minmax(0,1fr)_19.5rem]">
        <div className="flex min-w-0 flex-col">
          {(problem !== null || issues.length > 0) && (
            <div className="flex flex-col gap-2 pt-4">
              <Feedback message={problem} />
              {issues.length > 0 && (
                <ul className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                  {issues.map((issue, index) => (
                    <li key={index}>
                      {issue.path}: {issue.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Section title={format(m.itemsTabBasics)} hint={format(m.itemsBasicsHint)}>
            <div className="flex flex-col gap-4">
              <Field label={format(m.itemsFieldTitle)}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.title}
                    placeholder={format(m.itemsTitlePlaceholder)}
                    onChange={(event) => patch({ title: event.target.value })}
                  />
                )}
              </Field>
              <Field label={format(m.itemsKind)} hint={format(m.itemsKindHint)}>
                {(id) => (
                  <Choice
                    id={id}
                    value={draft.itemType}
                    // what a question is cannot change once claims exist on it
                    disabled={item !== null}
                    options={[
                      { value: 'evidence', label: format(m.itemsKindEvidence) },
                      { value: 'declaration', label: format(m.itemsKindDeclaration) },
                      { value: 'constant', label: format(m.itemsKindConstant) },
                    ]}
                    onChange={(next) => patch({ itemType: next as Draft['itemType'] })}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={format(m.itemsFieldGroup)}>
                  {(id) => (
                    <Choice
                      id={id}
                      value={draft.scoreGroupId}
                      options={groups.map((group) => ({ value: group.id, label: group.name }))}
                      onChange={(scoreGroupId) => patch({ scoreGroupId })}
                    />
                  )}
                </Field>
                {!granted && (
                  <Field label={format(m.itemsFieldEntrySource)}>
                    {(id) => (
                      <Choice
                        id={id}
                        value={draft.entrySource}
                        options={[
                          { value: 'student', label: format(m.itemsEntrySourceStudent) },
                          {
                            value: 'administrative',
                            label: format(m.itemsEntrySourceAdministrative),
                          },
                        ]}
                        onChange={(next) => patch({ entrySource: next as Draft['entrySource'] })}
                      />
                    )}
                  </Field>
                )}
              </div>
              <Field label={format(m.itemsFieldDescription)}>
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    value={draft.description}
                    onChange={(event) => patch({ description: event.target.value })}
                  />
                )}
              </Field>
            </div>
          </Section>

          {granted && (
            <Section title={format(m.itemsGrantedTitle)} hint={format(m.itemsGrantedHint)}>
              <p className="text-sm text-muted-foreground">{format(m.itemsGrantedBody)}</p>
            </Section>
          )}
          {!granted && (
            <Section title={format(m.itemsTabFields)} hint={format(m.itemsFieldsHint)}>
              <FieldList
                fields={draft.fields}
                materialRange={materialRange}
                openKey={openField}
                onOpen={setOpenField}
                onChange={patchField}
                onReorder={(orderedKeys) =>
                  setDraft((previous) => ({
                    ...previous,
                    fields: orderedKeys.flatMap((key) => {
                      const found = previous.fields.find((one) => one.key === key)
                      return found === undefined ? [] : [found]
                    }),
                  }))
                }
                onRemove={(key) => {
                  setDraft((previous) => ({
                    ...previous,
                    fields: previous.fields.filter((one) => one.key !== key),
                  }))
                  setOpenField(null)
                }}
                onAdd={() => {
                  const key = nextKey()
                  patch({ fields: [...draft.fields, blankField(key)] })
                  setOpenField(key)
                }}
              />
            </Section>
          )}
          <Section title={format(m.itemsTabScoring)} hint={format(m.itemsScoringHint)}>
            <div className="flex flex-col gap-4">
              {/* the width belongs to the wrapper: a field stretches whatever
                  control it is given to its own width */}
              <div className="flex flex-wrap items-start gap-5">
                <div className="w-38">
                  <Field label={format(m.itemsFixedValue)}>
                    {(id) => (
                      <InputGroup>
                        <InputGroupInput
                          id={id}
                          className="tabular-nums"
                          value={draft.fixedValue}
                          onChange={(event) => patch({ fixedValue: event.target.value })}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>{format(m.itemsFixedValueUnit)}</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                    )}
                  </Field>
                </div>
                <div className="w-52">
                  <Field label={format(m.itemsFolding)} hint={format(m.itemsFoldingHint)}>
                    {(id) => (
                      <NativeSelect
                        id={id}
                        value={draft.folding}
                        onChange={(event) =>
                          patch({ folding: event.target.value as Draft['folding'] })
                        }
                      >
                        <option value="sum">{format(m.itemsFoldingSum)}</option>
                        <option value="max">{format(m.itemsFoldingMax)}</option>
                        <option value="top-n">{format(m.itemsFoldingTopN)}</option>
                      </NativeSelect>
                    )}
                  </Field>
                </div>
                {draft.folding === 'top-n' && (
                  <div className="w-28">
                    <Field label={format(m.itemsFoldingN)}>
                      {(id) => (
                        <Input
                          id={id}
                          className="tabular-nums"
                          value={draft.topN}
                          onChange={(event) => patch({ topN: event.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                )}
                <div className="w-60">
                  <Field label={format(m.itemsFieldMax)}>
                    {(id) => (
                      <div className="flex items-center gap-2.5">
                        <Input
                          id={id}
                          type="number"
                          min={1}
                          className="w-24 tabular-nums"
                          disabled={entries === null}
                          value={draft.maxEntries}
                          onChange={(event) => patch({ maxEntries: event.target.value })}
                        />
                        <label className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
                          <Checkbox
                            checked={entries === null}
                            onCheckedChange={(next) =>
                              patch({ maxEntries: next === true ? '' : '1' })
                            }
                          />
                          {format(m.itemsMaxEntriesAny)}
                        </label>
                      </div>
                    )}
                  </Field>
                </div>
                <div className="w-44">
                  <Field label={format(m.itemsScoringMethod)}>
                    {(id) => (
                      // one calculator so far; the control is here because the
                      // choice belongs to the question, not because it is empty
                      <Choice
                        id={id}
                        value="fixed"
                        disabled
                        options={[{ value: 'fixed', label: format(m.itemsScoringMethodFixed) }]}
                        onChange={() => undefined}
                      />
                    )}
                  </Field>
                </div>
              </div>
              <ScoringSummary
                ceiling={ceiling}
                entries={entries}
                each={draft.fixedValue}
                placement={placement}
              />
            </div>
          </Section>

          {/* A recorded question still carries a chain: recording does not
              walk it, but a later challenge resolves the chain from this very
              revision, so a question saved without one would be history with
              no way back. What differs is when it runs, which is what the
              hint has to say. */}
          {!granted && (
            <Section
              title={format(m.itemsTabReview)}
              hint={format(
                draft.entrySource === 'administrative'
                  ? m.itemsChainHintRecorded
                  : m.itemsChainHintNew,
              )}
            >
              <div className="flex flex-col gap-5">
                {/* "no review" is said, never implied by an empty route */}
                <Choice
                  value={draft.reviewMode}
                  options={[
                    { value: 'workflow', label: format(m.itemsReviewWorkflow) },
                    { value: 'none', label: format(m.itemsReviewNone) },
                  ]}
                  onChange={(next) => patch({ reviewMode: next as Draft['reviewMode'] })}
                />
                {draft.reviewMode === 'none' ? (
                  <p className="text-sm text-muted-foreground">{format(m.itemsReviewNoneHint)}</p>
                ) : (
                  <>
                    <ChainFlow
                      batchId={batchId}
                      chain="normal"
                      steps={draft.stages.filter((one) => one.chain === 'normal')}
                      options={options}
                      onOpen={setOpenStage}
                      onAdd={(at) => addStage('normal', at)}
                      onRemove={(key) =>
                        setDraft((previous) => ({
                          ...previous,
                          stages: previous.stages.filter((one) => one.key !== key),
                        }))
                      }
                    />
                    {draft.stages.some((one) => one.chain === 'escalation') ? (
                      <div className="flex flex-col gap-3 border-t pt-4">
                        <div>
                          <h4 className="text-sm font-medium">{format(m.itemsEscalationTitle)}</h4>
                          <p className="pt-0.5 text-xs text-muted-foreground">
                            {format(m.itemsEscalationHint)}
                          </p>
                        </div>
                        <ChainFlow
                          batchId={batchId}
                          chain="escalation"
                          steps={draft.stages.filter((one) => one.chain === 'escalation')}
                          options={options}
                          onOpen={setOpenStage}
                          onAdd={(at) => addStage('escalation', at)}
                          onRemove={(key) =>
                            setDraft((previous) => ({
                              ...previous,
                              stages: previous.stages.filter((one) => one.key !== key),
                            }))
                          }
                        />
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2.5 border-t pt-4 text-xs font-medium">
                        <InlineAdd
                          label={format(m.itemsEscalationAddStep)}
                          onClick={() => addStage('escalation')}
                        />
                        <span className="font-normal text-muted-foreground">
                          {format(m.itemsEscalationEmpty)}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col py-6">
          <div className="flex flex-col rounded-xl bg-muted p-4">
            <ParticipantPreview draft={draft} />
            <Placed ceiling={ceiling} placement={placement} />
            <Versions item={item} />
          </div>
        </aside>
      </div>

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {lingeringStage !== null && (
        <StageSheet
          open={stage !== null}
          batchId={batchId}
          stage={lingeringStage}
          options={options}
          onChange={(next) => patchStage(lingeringStage.key, next)}
          onClose={() => setOpenStage(null)}
        />
      )}

      {askedOnce && (
        <ReasonDialog
          open={askingReason}
          title={format(m.itemsReasonTitle)}
          description={format(m.itemsReasonHint)}
          busy={save.isPending}
          onConfirm={(reason) => save.mutate({ reason })}
          onClose={() => setAskingReason(false)}
        />
      )}

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {lingeringImpact !== null && (
        <ImpactDialog
          open={impact !== null}
          impact={lingeringImpact}
          busy={save.isPending}
          onConfirm={(effects) => save.mutate({ reason: draftReason, effects })}
          onClose={() => setImpact(null)}
        />
      )}
    </div>
  )
}

/**
 * One part of the question: what it decides on the left, the controls that
 * decide it on the right. No box around either - a rule between two parts is
 * enough to separate them, and a screen of rounded boxes inside rounded
 * boxes is what these controls used to disappear into.
 */
function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-x-7 gap-y-4 border-t py-6 first-of-type:border-t-0 md:grid-cols-[10.5rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/** where the question stands, and which version of it is on screen */
function StandingChip({ item }: { item: ItemDto | null }) {
  const { format } = useI18n()
  if (item === null) {
    return (
      <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs whitespace-nowrap">
        {format(m.itemsNew)}
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs whitespace-nowrap">
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          item.status === 'active' ? 'bg-foreground' : 'bg-muted-foreground/60',
        )}
      />
      {item.status === 'voided'
        ? format(m.itemsStatusVoided)
        : format(item.status === 'active' ? m.itemsPublishedVersion : m.itemsDraftVersion, {
            no: item.currentRevision?.revisionNo ?? 1,
          })}
    </span>
  )
}

function InlineAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 transition-colors hover:text-muted-foreground"
      onClick={onClick}
    >
      <PlusIcon aria-hidden className="size-3.5" />
      {label}
    </button>
  )
}

/** the arithmetic behind the number, so nobody has to reconstruct it */
function ScoringSummary({
  ceiling,
  entries,
  each,
  placement,
}: {
  ceiling: string | null
  entries: number | null
  each: string
  placement: Placement
}) {
  const { format } = useI18n()
  const chain = placement.sections
    .map((section) =>
      section.cap === null
        ? format(m.itemsCeilingSectionFree, { name: section.name })
        : format(m.itemsCeilingSectionCapped, {
            name: section.name,
            value: trimAmount(section.cap),
          }),
    )
    .join(format(m.listSeparator))
  return (
    <div className="flex items-center gap-3.5 rounded-lg bg-muted px-3.5 py-3">
      <div className="flex shrink-0 flex-col gap-0.5">
        <p className="text-xs whitespace-nowrap text-muted-foreground">{format(m.itemsCeiling)}</p>
        <p className="text-base font-semibold tabular-nums">
          {ceiling === null ? format(m.structureUnlimited) : ceiling}
        </p>
      </div>
      <div aria-hidden className="h-7 w-px bg-border" />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {entries === null
          ? format(m.itemsCeilingHowAny)
          : format(m.itemsCeilingHow, { value: trimAmount(each.trim()), count: entries })}
        {chain !== '' && ` ${format(m.itemsCeilingNote, { chain })}`}
      </p>
    </div>
  )
}

/**
 * The path a submission takes, drawn as one line from where it enters to
 * where it leaves. Both routes get both ends: an escalation route that starts and
 * finishes nowhere is a row of boxes, not a route.
 *
 * Markers on their own track, labels under them. Drawn as a row of columns
 * instead, the line between two of them runs from the end of one column to
 * the start of the next - which is nowhere near either marker, and leaves a
 * long blank wherever a label was short. Here each line starts at the marker
 * it leaves and ends at the marker it reaches.
 *
 * Every line is also where another step can go, which is one place per gap:
 * before the first, between any two, after the last.
 */
function ChainFlow({
  batchId,
  chain,
  steps,
  options,
  onOpen,
  onAdd,
  onRemove,
}: {
  batchId: string
  chain: 'normal' | 'escalation'
  steps: readonly StageDraft[]
  options: ItemOptions
  onOpen: (key: string) => void
  /** put one more here: 0 before the first step, steps.length after the last */
  onAdd: (at: number) => void
  onRemove: (key: string) => void
}) {
  const { format } = useI18n()
  const nodes = [
    {
      key: 'start',
      mark: (
        <Marker>
          <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />
        </Marker>
      ),
      label: (
        <NodeLabel
          title={format(chain === 'normal' ? m.itemsFlowSubmit : m.itemsEscalated)}
          sub={format(chain === 'normal' ? m.itemsFlowSubmitBy : m.itemsEscalationBy)}
        />
      ),
    },
    ...steps.map((one, index) => ({
      key: one.key,
      mark: <StageMarker stage={one} options={options} index={index} />,
      label: (
        <StageLabel
          batchId={batchId}
          stage={one}
          options={options}
          removable={chain === 'escalation' || steps.length > 1}
          onOpen={() => onOpen(one.key)}
          onRemove={() => onRemove(one.key)}
        />
      ),
    })),
    {
      key: 'end',
      mark: (
        <Marker>
          <CheckIcon aria-hidden className="size-3" />
        </Marker>
      ),
      label: (
        <NodeLabel
          title={format(chain === 'normal' ? m.itemsFlowDone : m.itemsEscalationSettled)}
          sub={format(chain === 'normal' ? m.itemsFlowDoneSub : m.itemsEscalationSettledSub)}
        />
      ),
    },
  ]

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="grid w-max" style={{ gridTemplateColumns: `repeat(${nodes.length}, 11rem)` }}>
        {nodes.map((node, index) => (
          <div key={`mark:${node.key}`} className="flex items-center">
            {node.mark}
            {index < nodes.length - 1 && (
              <Gap label={format(m.itemsStageAdd)} onAdd={() => onAdd(index)} />
            )}
          </div>
        ))}
        {nodes.map((node) => (
          <div key={`label:${node.key}`} className="flex min-w-0 flex-col gap-1 pt-2 pr-6">
            {node.label}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The line from one marker to the next, and the place to put one more step.
 *
 * The button only shows itself when the line is pointed at, so a chain at
 * rest reads as a line rather than as a row of plus signs.
 */
function Gap({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <span className="group/gap relative flex h-6 flex-1 items-center">
      <span aria-hidden className="h-px w-full bg-border" />
      <button
        type="button"
        aria-label={label}
        title={label}
        className="absolute left-1/2 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 transition-opacity group-hover/gap:opacity-100 focus-visible:opacity-100"
        onClick={onAdd}
      >
        <PlusIcon aria-hidden className="size-3" />
      </button>
    </span>
  )
}

/** where a submission enters the path, and where it leaves it */
function Marker({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-muted-foreground">
      {children}
    </span>
  )
}

function NodeLabel({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </>
  )
}

/** a step's own marker: its place in the order, or that it has none yet */
function StageMarker({
  stage,
  options,
  index,
}: {
  stage: StageDraft
  options: ItemOptions
  index: number
}) {
  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
        settledStage(stage, options)
          ? 'bg-foreground text-background'
          : 'border border-dashed border-destructive/60 text-destructive',
      )}
    >
      {index + 1}
    </span>
  )
}

function StageLabel({
  batchId,
  stage,
  options,
  removable,
  onOpen,
  onRemove,
}: {
  batchId: string
  stage: StageDraft
  options: ItemOptions
  removable: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const { format } = useI18n()
  const settled = settledStage(stage, options)
  return (
    <div className="group flex min-w-0 flex-col gap-1">
      <button
        type="button"
        className={cn(
          'min-w-0 text-left text-sm font-medium break-words underline-offset-4 hover:underline',
          !settled && 'text-destructive',
        )}
        onClick={onOpen}
      >
        {settled ? whoReviews(stage, options, format) : format(m.itemsStageUnset)}
      </button>
      {settled ? (
        <StageCoverage batchId={batchId} stage={stage} />
      ) : (
        <p className="text-xs text-muted-foreground">{format(m.itemsStageUnsetHint)}</p>
      )}
      {removable && (
        <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onRemove}
            aria-label={format(m.itemsStageRemove)}
          >
            <XIcon aria-hidden />
          </Button>
        </span>
      )}
    </div>
  )
}

/**
 * A step nobody has finished naming cannot say who reviews at it, and a dash
 * in that space reads as a word rather than as an absence.
 */
const settledStage = (stage: StageDraft, options: ItemOptions): boolean => {
  const where = stage.kind === 'roleAt' ? stage.nodeTypeId !== '' : true
  const who =
    stage.kind === 'roleAt'
      ? options.roles.some((role) => stage.roleIds.includes(role.id))
      : options.roles.some((role) => role.id === stage.roleId)
  return where && who
}

const whoReviews = (
  stage: StageDraft,
  options: ItemOptions,
  format: (message: MessageDescriptor) => string,
): string => {
  const where =
    stage.kind === 'roleAt'
      ? (options.orgTypes.find((one) => one.id === stage.nodeTypeId)?.name ?? '')
      : format(m.itemsStageWalkUp)
  const who =
    stage.kind === 'roleAt'
      ? options.roles
          .filter((role) => stage.roleIds.includes(role.id))
          .map((role) => role.name)
          .join(format(m.listSeparator))
      : (options.roles.find((role) => role.id === stage.roleId)?.name ?? '')
  return `${where} / ${who}`
}

/**
 * Whether anybody can actually act at this step. A chain whose second step
 * has no reviewer in two of twelve units strands whoever files there, and
 * nothing in the step's own settings would say so.
 */
function StageCoverage({ batchId, stage }: { batchId: string; stage: StageDraft }) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const roleIds = stage.kind === 'roleAt' ? stage.roleIds : [stage.roleId]
  const coverage = useQuery({
    ...query.assessment.reviewCoverage.queryOptions({
      params: { batchId },
      query: { nodeTypeId: stage.nodeTypeId, roleIds },
    }),
    // only the level-anchored kind surveys units; the nearest-holder kind is
    // answered per participant, where its answer actually lives
    enabled: stage.kind === 'roleAt' && stage.nodeTypeId !== '' && roleIds.length > 0,
  })
  if (coverage.data === undefined) return null
  const uncovered = coverage.data.nodes.filter((node) => node.reviewers === 0)
  return (
    <p
      className={cn('text-xs', uncovered.length > 0 ? 'text-destructive' : 'text-muted-foreground')}
    >
      {coverage.data.nodes.length === 0
        ? format(m.itemsReviewNoUnits)
        : uncovered.length === 0
          ? format(m.itemsReviewCovered, { count: coverage.data.nodes.length })
          : // named in the step's own panel, where there is room for a list;
            // here the count is what fits and what the reader acts on
            format(m.itemsReviewUncoveredCount, { count: uncovered.length })}
    </p>
  )
}

/**
 * The filing screen this draft produces, drawn from the draft alone. It
 * answers "what will they see" without saving anything.
 */
function ParticipantPreview({ draft }: { draft: Draft }) {
  const { format } = useI18n()
  return (
    <>
      <p className="pb-3 text-xs font-semibold">{format(m.itemsPreviewTitle)}</p>
      <div className="flex flex-col gap-2.5 rounded-lg bg-background p-3.5">
        <h4 className="text-sm font-semibold">
          {draft.title.trim() === '' ? format(m.itemsUntitled) : draft.title}
        </h4>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {draft.description.trim() === '' ? '' : `${draft.description.trim()} `}
          {draft.maxEntries.trim() === ''
            ? format(m.itemsPreviewNoMax)
            : format(m.itemsPreviewMax, { count: Number(draft.maxEntries) })}
          {format(m.listSeparator)}
          {format(m.itemsPreviewValue, { value: trimAmount(draft.fixedValue.trim()) })}
        </p>
        <div className="flex flex-col gap-2.5">
          {draft.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                {field.label.trim() === '' ? '—' : field.label}
                {field.required && <span className="pl-0.5 text-destructive">*</span>}
              </p>
              {field.type === 'attachment' ? (
                <div className="flex h-9 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                  {format(m.itemsPreviewUpload, { count: Number(field.maxCount) || 1 })}
                </div>
              ) : (
                <div className="h-9 rounded-lg border" />
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/** every ceiling this question's score has to pass through, innermost first */
function Placed({ ceiling, placement }: { ceiling: string | null; placement: Placement }) {
  const { format } = useI18n()
  const innermost = placement.sections[0]
  return (
    <div className="mt-4 flex flex-col gap-2 border-t pt-3.5">
      <p className="text-xs font-semibold">{format(m.itemsPlacementTitle)}</p>
      <Amount
        label={format(m.itemsCeiling)}
        value={ceiling === null ? format(m.structureUnlimited) : ceiling}
      />
      {innermost !== undefined && placement.subtotal !== null && (
        <Amount
          label={format(m.itemsPlacementSubtotal, { name: innermost.name })}
          value={trimAmount(placement.subtotal)}
        />
      )}
      {placement.sections.map((section) =>
        section.cap === null ? null : (
          <Amount
            key={section.id}
            label={format(m.itemsPlacementCap, { name: section.name })}
            value={trimAmount(section.cap)}
          />
        ),
      )}
      <Amount
        label={format(m.itemsPlacementPaper)}
        value={placement.total === null ? format(m.structureUncapped) : trimAmount(placement.total)}
      />
    </div>
  )
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

/** what saving does to entries already filed, said before it is pressed */
function Versions({ item }: { item: ItemDto | null }) {
  const { format } = useI18n()
  const revision = item?.currentRevision ?? null
  return (
    <div className="mt-4 flex flex-col gap-1.5 border-t pt-3.5">
      <p className="text-xs font-semibold">{format(m.itemsVersionTitle)}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {revision === null
          ? format(m.itemsVersionNew)
          : format(m.itemsVersionNote, {
              no: revision.revisionNo,
              date: revision.createdAt.slice(0, 10),
            })}
      </p>
    </div>
  )
}
