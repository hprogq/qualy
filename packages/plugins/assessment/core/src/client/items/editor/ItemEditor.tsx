import { Fragment, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeftIcon, ChevronRightIcon, EllipsisVerticalIcon, EyeIcon } from 'lucide-react'
import { useApi, useRunApi, usePageQueryState, useUiCollection } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { kindOf, type AtomicSchema, type ChoiceSchema } from '@qualy/value-schema'
import type { FieldDraft as ValueDraft } from '@qualy/web-value-form/model'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ConfirmDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@qualy/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { toast } from '@qualy/ui/toast'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useLingering } from '@qualy/ui/use-lingering'
import { useSettled } from '@qualy/ui/use-settled'
import { calculatorAuthoringOptions } from '../../../surfaces.ts'
import { assessmentApi } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { BatchBanner } from '../../batch/BatchScreen.tsx'
import type { ItemDto } from '../../entry/model.ts'
import { ImpactDialog, type ChangeEffects, type ChangeImpact } from '../ImpactDialog.tsx'
import { ReasonDialog } from '../ReasonDialog.tsx'
import { StageSheet, type StageDraft } from '../StageSheet.tsx'
import type { ItemOptions } from '../options.ts'
import type { Placement } from '../paper.ts'
import { AddFieldDialog } from './AddFieldDialog.tsx'
import { BasicsTab } from './BasicsTab.tsx'
import { ChoiceMappingDialog } from './ChoiceMappingDialog.tsx'
import { FieldSheet } from './FieldSheet.tsx'
import { PendingList } from './PendingList.tsx'
import { PreviewSheet } from './PreviewSheet.tsx'
import { RecognitionSheet } from './RecognitionSheet.tsx'
import { Dot, Tag } from './Rows.tsx'
import { RulesTab } from './RulesTab.tsx'
import { FailureList, FailureNotice } from './SaveFailure.tsx'
import { ScoringTab, type ContractState } from './ScoringTab.tsx'
import {
  admittedSchemaOf,
  blankField,
  blankStage,
  configOf,
  describedRefinement,
  draftOf,
  fieldFromSchema,
  fieldSchemaOf,
  fieldTypeOf,
  freshRecognition,
  handleFor,
  itemTypeOf,
  linkOf,
  maxEntriesOf,
  mergedProblems,
  nextKey,
  nextOptionKey,
  parameterSchemaOf,
  parameterTitle,
  problemsFromIssues,
  problemsOf,
  recognitionRows,
  stated,
  type Contract,
  type Draft,
  type EditorArea,
  type EditorProblem,
  type FieldDraft,
  type FieldType,
  type Mode,
  type RecognitionDraft,
  type ScoringDraft,
} from './model.ts'
import { boundsWords, type LinkVerdict } from './words.ts'

// One question, composed rather than typed. The editor holds the draft and
// the contract; the three tabs render it; the panels edit one thing at a
// time; and the list of what is left is computed from the draft, never
// kept. Every dialog here says three things: what cannot be done or what
// will happen, why, and where to go next.

const styles = stylex.create({
  root: { display: 'flex', minHeight: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%', flexDirection: 'column' },
  // three rows, each doing one thing: where this is, what it is, and the
  // ways around it. The last row is the tabs, and it stands on the band's
  // own bottom rule.
  band: { display: 'flex', flexDirection: 'column', gap: 14 },
  trailRow: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  trail: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  // the way back IS the first level of where this is
  back: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 28,
    marginLeft: -8,
    paddingInline: 8,
    borderRadius: 8,
    borderWidth: 0,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    cursor: 'pointer',
  },
  backIcon: { width: 15, height: 15 },
  crumbRule: { width: 12, height: 12, flexShrink: 0 },
  crumb: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: { default: null, [breakpoints.phone]: 'none' },
  },
  crumbHere: { color: tokens.foreground },
  meta: {
    display: { default: 'inline-flex', [breakpoints.phone]: 'none' },
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  metaRule: { width: 1, height: 10, backgroundColor: tokens.border },
  metaUnsaved: { display: 'inline-flex', alignItems: 'center', gap: 6, color: tokens.foreground },
  titleRow: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' },
  titleLine: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  title: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 22,
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  titleUnset: { color: tokens.mutedForeground },
  actions: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8 },
  tabsRow: { display: 'flex', alignItems: 'flex-end', gap: 24, minWidth: 0 },
  tabsSeat: { minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' },
  tabList: { gap: 24 },
  tab: { height: 38, paddingInline: 2 },
  tabLabel: { display: 'inline-flex', alignItems: 'center', gap: 7 },
  spacer: { flexGrow: 1 },
  body: { display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 4, paddingBottom: 40 },
  menu: { width: 176 },
})

const AREAS: readonly EditorArea[] = ['basics', 'scoring', 'rules']

const REFUSED_TITLE = {
  conflict: m.itemsFailConflictTitle,
  voided: m.itemsFailVoidedTitle,
  'read-only': m.itemsFailReadOnlyTitle,
  denied: m.itemsFailDeniedTitle,
  gone: m.itemsFailGoneTitle,
  scoring: m.itemsFailScoringTitle,
  incompatible: m.itemsFailIncompatibleTitle,
  other: m.itemsFailOtherTitle,
} as const

const REFUSED_HINT = {
  conflict: m.itemsFailConflictHint,
  voided: m.itemsFailVoidedHint,
  'read-only': m.itemsFailReadOnlyHint,
  denied: m.itemsFailDeniedHint,
  gone: m.itemsFailGoneHint,
  scoring: m.itemsFailScoringHint,
  loose: m.itemsFailLooseHint,
} as const

type OpenSheet =
  | { kind: 'recognition'; handle: string }
  | { kind: 'field'; key: string }
  // `fresh` is a step being composed: it is not in the chain until it is whole
  | { kind: 'stage'; key: string; fresh?: StageDraft }
  | { kind: 'preview' }

type Ask =
  | { kind: 'unlink'; handle: string }
  | { kind: 'delete-field'; key: string }
  | { kind: 'delete-blocked'; key: string; handle: string }
  | { kind: 'disable-option'; key: string; optionId: string }
  | { kind: 'to-direct'; handles: readonly string[] }
  | { kind: 'to-automatic'; parameters: readonly string[] }
  | { kind: 'adjust'; handle: string; fieldId: string }
  | { kind: 'mapping'; handle: string; fieldId: string }

type Issue = { readonly path: string; readonly reason: string; readonly handle?: string }

/** a save the page has no row to pin on: what happened, in the words it has */
type Refused =
  | { kind: 'conflict' | 'voided' | 'read-only' | 'denied' | 'gone' | 'scoring' }
  | { kind: 'incompatible' | 'other'; words: string }
  | { kind: 'loose'; reasons: readonly string[] }

export function ItemEditor({
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
  held,
  onHold,
  onDirty,
  onCancel,
  onReload,
  onSaved,
}: {
  batchId: string
  batchStatus: string
  /** the round's own window; a date field can only narrow it, never widen it */
  materialRange: { start: string; end: string }
  participantCount: number
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
  paper: readonly { id: string; title: string }[]
  /** what was being composed when this last unmounted, if anything */
  held?: Draft | undefined
  /** every keystroke, so the page can hand the same composition back later */
  onHold?: ((draft: Draft) => void) | undefined
  /** whether the pane holds edits the round has not been told about yet */
  onDirty?: ((dirty: boolean) => void) | undefined
  onCancel: () => void
  /** read the question again, because somebody else has changed it */
  onReload?: (() => Promise<unknown>) | undefined
  onSaved: (itemId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError, locale } = useI18n()
  const listJoin = useList()
  const [draft, setDraft] = useState<Draft>(() => {
    if (held !== undefined) return held
    const seeded = draftOf(item, groups, options)
    return defaultGroupId === undefined ? seeded : { ...seeded, scoreGroupId: defaultGroupId }
  })
  useEffect(() => {
    onHold?.(draft)
  }, [draft, onHold])

  const [panelParam, setPanelParam] = usePageQueryState('panel', 'basics', { history: 'replace' })
  const area: EditorArea = AREAS.includes(panelParam as EditorArea) ? (panelParam as EditorArea) : 'basics'
  const [sheet, setSheet] = useState<OpenSheet | null>(null)
  const lingeringSheet = useLingering(sheet)
  const [adding, setAdding] = useState<{ open: true } | null>(null)
  const askedAdding = useLingering(adding)
  const [ask, setAsk] = useState<Ask | null>(null)
  const lingeringAsk = useLingering(ask)
  // what a save was refused for, and the composition it was refused on
  const [refusal, setRefusal] = useState<{ at: string; when: number; issues: readonly Issue[] } | null>(null)
  const [refused, setRefused] = useState<Refused | null>(null)
  const [failed, setFailed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [askingReason, setAskingReason] = useState(false)
  const askedOnce = useLingering(askingReason ? true : null) === true
  const [impact, setImpact] = useState<ChangeImpact | null>(null)
  const [draftReason, setDraftReason] = useState<string | null>(null)
  const lingeringImpact = useLingering(impact)

  const patch = (next: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...next }))
  const patchScoring = (next: (scoring: Extract<ScoringDraft, { language: 'v2' }>) => Partial<Extract<ScoringDraft, { language: 'v2' }>>) =>
    setDraft((previous) =>
      previous.scoring.language === 'v2'
        ? { ...previous, scoring: { ...previous.scoring, ...next(previous.scoring), touched: true } }
        : previous,
    )

  // ---- the arithmetic and its contract ------------------------------------
  const calculators = useUiCollection(calculatorAuthoringOptions)
  const chosenCalculator =
    draft.scoring.language === 'v2'
      ? draft.scoring.calculator
      : { ref: 'fixed@1', config: { value: draft.fixedValue } }
  /**
   * The arithmetic chosen and configured in one act.
   *
   * The legacy language keeps its own amount for as long as the method is
   * the fixed one; anything else moves the question into the versioned
   * language, and once there it never goes back. A different reference
   * clears the facts and bindings: they answered the old contract.
   */
  const onCalculatorApply = (next: { ref: string; config: unknown }) =>
    setDraft((previous) => {
      if (previous.scoring.language === 'unsupported') return previous
      const amount = String((next.config as { value?: unknown } | null)?.value ?? '')
      if (previous.scoring.language === 'v1') {
        if (next.ref === 'fixed@1') return { ...previous, fixedValue: amount }
        return {
          ...previous,
          scoring: {
            language: 'v2',
            original: null,
            calculator: next,
            recognitions: {},
            bindings: {},
            touched: true,
            configured: true,
          },
        }
      }
      const rebound = next.ref !== previous.scoring.calculator.ref
      return {
        ...previous,
        ...(next.ref === 'fixed@1' ? { fixedValue: amount } : {}),
        scoring: {
          ...previous.scoring,
          calculator: next,
          ...(rebound ? { recognitions: {}, bindings: {} } : {}),
          touched: true,
          configured: true,
        },
      }
    })

  // asked a beat after the typing stops: the form only decides which
  // fields may feed a parameter, and re-asking on every letter rebuilt the
  // parameter list under the hand that was typing
  const formConfigNow = configOf(draft, item, null, locale).formConfig
  const askedForm = useSettled(JSON.stringify(formConfigNow), 500)
  const contractQuery = useQuery({
    queryKey: [
      'assessment',
      'scoring-preview',
      batchId,
      item?.id ?? 'new',
      itemTypeOf(draft, item),
      askedForm,
      chosenCalculator.ref,
      JSON.stringify(chosenCalculator.config),
    ],
    queryFn: () =>
      run(
        api.assessment.previewScoring({
          params: { batchId },
          payload: {
            itemType: itemTypeOf(draft, item),
            formConfig: formConfigNow,
            calculator: chosenCalculator,
            ...(item === null ? {} : { itemId: item.id }),
          },
        }),
      ),
    enabled: draft.scoring.language === 'v2' && draft.scoring.configured,
    placeholderData: keepPreviousData,
  })
  const contract = (contractQuery.data as Contract | undefined) ?? null
  const contractRefused =
    contractQuery.isError &&
    (contractQuery.error as { _tag?: string } | null)?._tag === 'ASSESSMENT_ITEM_CONFIG_INVALID'
  const contractState: ContractState =
    draft.scoring.language !== 'v2' || !draft.scoring.configured
      ? { kind: 'idle' }
      : contractQuery.isError
        ? { kind: contractRefused ? 'refused' : 'unavailable' }
        : contractQuery.isSuccess
          ? { kind: 'ready' }
          : { kind: 'pending' }

  const local = useMemo(
    () => problemsOf({ draft, options, contract, contractRefused: contractQuery.isError, locale }),
    [draft, options, contract, contractQuery.isError, locale],
  )

  // The server reads the composition as it is typed, a beat after the typing
  // stops: the same reading a save would get, with nothing written. It is
  // what knows whether a narrowing can still be met, whether a linked field
  // can carry its determination, whether a fixed value fits its parameter.
  const configNow = configOf(draft, item, contract, locale)
  const checkKey = JSON.stringify([itemTypeOf(draft, item), draft.scoreGroupId, configNow])
  const askedCheck = useSettled(checkKey, 600)
  const checkQuery = useQuery({
    queryKey: ['assessment', 'item-check', batchId, item?.id ?? 'new', askedCheck],
    queryFn: () =>
      run(
        api.assessment.checkItem({
          params: { batchId },
          payload: {
            itemType: itemTypeOf(draft, item),
            scoreGroupId: draft.scoreGroupId,
            config: configNow as never,
            ...(item === null ? {} : { itemId: item.id }),
          },
        }),
      ),
    enabled:
      draft.scoreGroupId !== '' && draft.scoring.language !== 'unsupported' && contractState.kind !== 'pending',
    placeholderData: keepPreviousData,
    retry: false,
  })
  const serverIssues = ((): readonly Issue[] => {
    const checked = (checkQuery.data as { issues: readonly Issue[] } | undefined)?.issues
    const fresh = checkQuery.isSuccess && !checkQuery.isPlaceholderData && askedCheck === checkKey
    if (refusal !== null && refusal.at === checkKey) {
      // nothing has changed since the save was refused, so the save's word
      // stands; a reading taken since adds the handles a save cannot name
      const since = fresh && checkQuery.dataUpdatedAt >= refusal.when ? (checked ?? []) : []
      const said = new Set(since.map((one) => `${one.path}\n${one.reason}`))
      return [...since, ...refusal.issues.filter((one) => !said.has(`${one.path}\n${one.reason}`))]
    }
    // the newest word on exactly what is on screen
    if (fresh) return checked ?? []
    // the reading cannot be had: what was said of another composition is dropped
    if (checkQuery.isError) return []
    // a newer answer is on its way; until it lands, what was last said stands
    return checked ?? refusal?.issues ?? []
  })()
  const server = useMemo(
    () => problemsFromIssues({ draft, contract, locale, issues: serverIssues }),
    // the issues are compared by what they say, not by which array holds them
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, contract, locale, JSON.stringify(serverIssues)],
  )
  const problems = useMemo(() => mergedProblems(local, server.placed), [local, server.placed])
  const wrong = problems.some((one) => one.tone === 'error')
  const toneOf = (one: EditorArea): 'ok' | 'pending' | 'error' => {
    const here = problems.filter((candidate) => candidate.area === one)
    return here.some((candidate) => candidate.tone === 'error') ? 'error' : here.length > 0 ? 'pending' : 'ok'
  }
  // a refused save is over once everything it was refused for is corrected
  useEffect(() => {
    if (failed && problems.length === 0) setFailed(false)
  }, [failed, problems.length])

  // ---- dirtiness and the reason a live change needs -----------------------
  const wasSaid = useMemo(
    () => (item === null ? null : stated(draftOf(item, groups, options), item, contract, locale)),
    [item, groups, options, contract, locale],
  )
  const dirty = wasSaid !== null && stated(draft, item, contract, locale) !== wasSaid
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  const scoringMoved =
    item?.currentRevision !== null &&
    item?.currentRevision !== undefined &&
    JSON.stringify(configOf(draft, item, contract, locale).scoringConfig) !==
      JSON.stringify(item.currentRevision.scoringConfig)
  const placementMoved = item !== null && draft.scoreGroupId !== item.scoreGroupId
  const needsReason =
    item !== null && item.status === 'active' && batchStatus === 'active' && (scoringMoved || placementMoved)

  // ---- fields -------------------------------------------------------------
  const patchField = (key: string, next: FieldDraft) =>
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field) => (field.key === key ? next : field)),
    }))
  /** a different type is a different field: nothing filed carries over */
  const retypeField = (key: string, type: FieldType) => {
    const minted = nextKey()
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field) =>
        field.key === key
          ? { ...blankField(type, minted), label: field.label, description: field.description, required: field.required }
          : field,
      ),
    }))
    setSheet((open) => (open?.kind === 'field' && open.key === key ? { kind: 'field', key: minted } : open))
  }
  const storedOptionIds = useMemo(() => {
    const ids = new Set<string>()
    if (item?.status !== 'active') return ids
    const fields = (item.currentRevision?.formConfig as { fields?: unknown } | null)?.fields
    if (!Array.isArray(fields)) return ids
    for (const field of fields as { options?: { id?: string; value?: string }[] }[]) {
      for (const option of field.options ?? []) ids.add(String(option.id ?? option.value ?? ''))
    }
    return ids
  }, [item])

  // ---- determinations and their filing side -------------------------------
  const recognitionOf = (handle: string): RecognitionDraft | undefined =>
    draft.scoring.language === 'v2' ? draft.scoring.recognitions[handle] : undefined
  const parameterOf = (handle: string): { parameter: string; schema: AtomicSchema } | undefined => {
    if (draft.scoring.language !== 'v2') return undefined
    const parameter = Object.entries(draft.scoring.bindings).find(
      ([, binding]) => binding.kind === 'recognition' && binding.handle === handle,
    )?.[0]
    const schema = parameter === undefined ? undefined : parameterSchemaOf(contract, parameter)
    return parameter === undefined || schema === undefined ? undefined : { parameter, schema }
  }
  const patchRecognition = (handle: string, next: Partial<RecognitionDraft>) =>
    patchScoring((scoring) => {
      const current = scoring.recognitions[handle]
      if (current === undefined) return {}
      const merged = { ...current, ...next }
      const seat = parameterOf(handle)
      // the words follow the narrowing wherever it lives
      const refinement =
        next.description !== undefined && seat !== undefined
          ? describedRefinement(seat.schema, merged.refinement, merged.description)
          : merged.refinement
      return { recognitions: { ...scoring.recognitions, [handle]: { ...merged, refinement } } }
    })
  const setRefinement = (handle: string, refinement: AtomicSchema | null) =>
    patchScoring((scoring) => {
      const current = scoring.recognitions[handle]
      return current === undefined ? {} : { recognitions: { ...scoring.recognitions, [handle]: { ...current, refinement } } }
    })

  /** the shape a linked field would keep if it stood alone */
  const standaloneField = (field: FieldDraft, recognition: RecognitionDraft, parameter: AtomicSchema): FieldDraft => {
    const admitted = admittedSchemaOf(recognition, parameter)
    // its own name and hint stay: a linked field was never called by the
    // determination's name, so there is nothing to give back
    return {
      ...fieldFromSchema(admitted, field, locale, (value) => field.options.find((one) => one.value === value)?.id),
      label: field.label.trim() === '' ? recognition.label : field.label,
      description: field.description.trim() === '' ? recognition.description : field.description,
    }
  }
  const linkNewField = (handle: string) => {
    const recognition = recognitionOf(handle)
    const seat = parameterOf(handle)
    if (recognition === undefined || seat === undefined) return
    const admitted = admittedSchemaOf(recognition, seat.schema)
    const key = nextKey()
    const field: FieldDraft = {
      ...fieldFromSchema(admitted, blankField(fieldTypeOf(kindOf(admitted)), key), locale),
      label: recognition.label,
      description: recognition.description,
      required: true,
    }
    setDraft((previous) => ({ ...previous, fields: [...previous.fields, field] }))
    patchRecognition(handle, { fieldId: field.id })
  }
  const linkField = (handle: string, fieldId: string) => {
    patchRecognition(handle, { fieldId })
    if (draft.mode === 'direct') {
      setDraft((previous) => ({
        ...previous,
        fields: previous.fields.map((one) => (one.id === fieldId ? { ...one, required: true } : one)),
      }))
    }
  }
  const linkExisting = (handle: string, fieldId: string, verdict: LinkVerdict) => {
    const field = draft.fields.find((one) => one.id === fieldId)
    if (field === undefined) return
    if (verdict.kind === 'fits') {
      linkField(handle, fieldId)
      return
    }
    if (field.type === 'choice') setAsk({ kind: 'mapping', handle, fieldId })
    else setAsk({ kind: 'adjust', handle, fieldId })
  }
  const applyMapping = (handle: string, fieldId: string, mapping: Readonly<Record<string, string>>) => {
    const recognition = recognitionOf(handle)
    const seat = parameterOf(handle)
    if (recognition === undefined || seat === undefined) return
    const admitted = admittedSchemaOf(recognition, seat.schema) as ChoiceSchema
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field) => {
        if (field.id !== fieldId) return field
        // each admitted value keeps the identity of the option that stood for it
        const options = admitted.enum.map((value) => {
          const stood = Object.entries(mapping).find(([, mapped]) => mapped === value)?.[0]
          const before = field.options.find((one) => one.id === stood)
          return {
            id: before?.id ?? nextOptionKey(),
            value,
            label: (admitted['x-qualy-enumLabels'] as Record<string, string> | undefined)?.[value] ?? value,
            enabled: true,
          }
        })
        return { ...field, options }
      }),
    }))
    linkField(handle, fieldId)
    setAsk(null)
  }
  const unlink = (handle: string) => {
    const recognition = recognitionOf(handle)
    const seat = parameterOf(handle)
    if (recognition === undefined || seat === undefined) return
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field) =>
        field.id === recognition.fieldId ? standaloneField(field, recognition, seat.schema) : field,
      ),
    }))
    patchRecognition(handle, { fieldId: null })
  }
  const removeField = (key: string) => {
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.filter((one) => one.key !== key),
      summaryFieldIds: previous.summaryFieldIds.filter((id) => previous.fields.some((one) => one.key !== key && one.id === id)),
    }))
    setSheet((open) => (open?.kind === 'field' && open.key === key ? null : open))
  }
  const disableOption = (key: string, optionId: string) =>
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field) =>
        field.key === key
          ? { ...field, options: field.options.map((one) => (one.id === optionId ? { ...one, enabled: false } : one)) }
          : field,
      ),
    }))

  /** what feeds a parameter, chosen in its row */
  const onSource = (parameter: string, source: 'recognition' | 'constant' | 'filed') => {
    if (draft.scoring.language !== 'v2') return
    const binding = draft.scoring.bindings[parameter]
    if (source === 'constant') {
      if (binding?.kind === 'constant') return
      const handle = binding?.kind === 'recognition' ? binding.handle : null
      const recognition = handle === null ? undefined : recognitionOf(handle)
      const seat = handle === null ? undefined : parameterOf(handle)
      // the filing side stays on the form as a field of its own
      if (recognition !== undefined && seat !== undefined && recognition.fieldId !== null) {
        setDraft((previous) => ({
          ...previous,
          fields: previous.fields.map((field) =>
            field.id === recognition.fieldId ? standaloneField(field, recognition, seat.schema) : field,
          ),
        }))
      }
      patchScoring((scoring) => {
        const recognitions = { ...scoring.recognitions }
        if (handle !== null) delete recognitions[handle]
        return { recognitions, bindings: { ...scoring.bindings, [parameter]: { kind: 'constant', value: undefined } } }
      })
      return
    }
    if (binding?.kind === 'recognition') return
    const handle = handleFor(parameter)
    patchScoring((scoring) => ({
      recognitions: { ...scoring.recognitions, [handle]: freshRecognition(contract, parameter, locale) },
      bindings: { ...scoring.bindings, [parameter]: { kind: 'recognition', handle } },
    }))
    if (source === 'filed') {
      // under direct handling the form IS the determination's source, so
      // the field is minted with it; the state update above has not landed
      // yet, so the field is shaped from the same contract directly
      const schema = parameterSchemaOf(contract, parameter)
      if (schema === undefined) return
      const key = nextKey()
      const fresh = freshRecognition(contract, parameter, locale)
      const field: FieldDraft = {
        ...fieldFromSchema(schema, blankField(fieldTypeOf(kindOf(schema)), key), locale),
        label: fresh.label,
        description: fresh.description,
        required: true,
      }
      setDraft((previous) => ({ ...previous, fields: [...previous.fields, field] }))
      patchScoring((scoring) => {
        const current = scoring.recognitions[handle]
        return current === undefined ? {} : { recognitions: { ...scoring.recognitions, [handle]: { ...current, fieldId: field.id } } }
      })
    }
  }
  const onConstant = (parameter: string, value: ValueDraft) =>
    patchScoring((scoring) => {
      const binding = scoring.bindings[parameter]
      return binding?.kind === 'constant'
        ? { bindings: { ...scoring.bindings, [parameter]: { ...binding, draft: value } } }
        : {}
    })

  // ---- the handling, and the migrations a change of it asks first ---------
  const setMode = (next: Mode) => {
    if (next === draft.mode) return
    if (next === 'automatic') {
      const determined = recognitionRows(draft, contract).map((row) => row.parameter)
      if (determined.length > 0) {
        setAsk({ kind: 'to-automatic', parameters: determined })
        return
      }
      patch({ mode: 'automatic' })
      return
    }
    const doors = draft.participant || draft.administrative ? {} : { participant: true }
    if (next === 'direct') {
      const unlinked = recognitionRows(draft, contract).filter((row) => row.recognition.fieldId === null)
      if (unlinked.length > 0) {
        setAsk({ kind: 'to-direct', handles: unlinked.map((row) => row.handle) })
        return
      }
      const linkedIds = new Set(recognitionRows(draft, contract).map((row) => row.recognition.fieldId))
      setDraft((previous) => ({
        ...previous,
        ...doors,
        mode: 'direct',
        fields: previous.fields.map((field) => (linkedIds.has(field.id) ? { ...field, required: true } : field)),
      }))
      return
    }
    patch({ ...doors, mode: next })
  }

  // ---- review steps -------------------------------------------------------
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
      return { ...previous, stages: stage.chain === 'normal' ? [...reordered, ...others] : [...others, ...reordered] }
    })
  /** a new step is composed in its panel; the chain does not hold it yet */
  const addStage = (chain: 'normal' | 'escalation') => {
    const stage = blankStage(options, chain)
    setSheet({ kind: 'stage', key: stage.key, fresh: stage })
  }
  /** a whole step, put at the end of its chain or over what stood there */
  const applyStage = (next: StageDraft, fresh: boolean) => {
    if (!fresh) {
      patchStage(next.key, next)
      return
    }
    setDraft((previous) => {
      const own = previous.stages.filter((one) => one.chain === next.chain)
      const others = previous.stages.filter((one) => one.chain !== next.chain)
      return { ...previous, stages: next.chain === 'normal' ? [...own, next, ...others] : [...others, ...own, next] }
    })
  }
  const removeStage = (key: string) =>
    setDraft((previous) => ({ ...previous, stages: previous.stages.filter((one) => one.key !== key) }))

  // ---- going to what is unfinished ---------------------------------------
  const jumpTo = (target: EditorProblem) => {
    setPanelParam(target.area)
    const entity = target.entity
    if (entity?.kind === 'recognition') setSheet({ kind: 'recognition', handle: entity.handle })
    else if (entity?.kind === 'field') setSheet({ kind: 'field', key: entity.key })
    else if (entity?.kind === 'stage') setSheet({ kind: 'stage', key: entity.key })
    if (entity !== undefined && entity.kind !== 'parameter') return
    const seat =
      entity !== undefined
        ? `[data-parameter-row="${CSS.escape(entity.parameter)}"]`
        : target.block === undefined
          ? null
          : `[data-block="${target.block}"]`
    if (seat === null) return
    // the tab has to be on screen before anything in it can be found
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const found = document.querySelector(seat)
        found?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        const control =
          found?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
          found?.querySelector<HTMLElement>('input, textarea, [role="combobox"]')
        control?.focus({ preventScroll: true })
      }),
    )
  }

  // ---- saving -------------------------------------------------------------
  const save = useMutation({
    mutationFn: ({
      reason,
      effects,
      over,
    }: {
      reason: string | null
      effects?: ChangeEffects
      /** the revision to save over, when somebody else's has been read and is to be replaced */
      over?: string | null
    }) => {
      const config = configOf(draft, item, contract, locale)
      const maxEntries = maxEntriesOf(draft)
      const itemType = itemTypeOf(draft, item)
      if (item === null) {
        return run(
          api.assessment.createItem({
            params: { batchId },
            payload: {
              itemType,
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
            ...(itemType === item.itemType ? {} : { itemType }),
            config: config as never,
            expectedRevisionId: over === undefined ? (item.currentRevision?.id ?? null) : over,
            ...(reason === null ? {} : { reason }),
            ...(effects === undefined ? {} : { effects }),
          },
        }),
      )
    },
    onMutate: ({ reason }) => {
      setRefused(null)
      setDismissed(false)
      setDraftReason(reason)
    },
    onSuccess: (result: { item: { id: string } }) => {
      toast.success(format(m.itemsSaved))
      setAskingReason(false)
      setImpact(null)
      setRefusal(null)
      setFailed(false)
      onSaved(result.item.id)
    },
    onError: (error: unknown) => {
      const said = error as { _tag?: string; issues?: readonly Issue[] } & ChangeImpact
      if (said?._tag === 'ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED') {
        setAskingReason(false)
        setImpact({ impactToken: said.impactToken, form: said.form, review: said.review, scoring: said.scoring })
        return
      }
      setImpact(null)
      if (said?._tag !== 'ASSESSMENT_ITEM_CONFIG_INVALID') {
        setAskingReason(false)
        setRefused(
          said?._tag === 'ASSESSMENT_BATCH_READ_ONLY'
            ? { kind: 'read-only' }
            : said?._tag === 'ACCESS_DENIED'
              ? { kind: 'denied' }
              : said?._tag === 'ASSESSMENT_ITEM_NOT_FOUND'
                ? { kind: 'gone' }
                : said?._tag === 'ASSESSMENT_SCORING_UNAVAILABLE'
                  ? { kind: 'scoring' }
                  : {
                      kind: said?._tag === 'ASSESSMENT_ITEM_SCORING_INCOMPATIBLE' ? 'incompatible' : 'other',
                      words: formatError(error),
                    },
        )
        return
      }
      const issues = said.issues ?? []
      // a live change with no reason given is asked for one, not told off
      if (issues.some((one) => one.reason === 'reason-required')) {
        setAskingReason(true)
        return
      }
      setAskingReason(false)
      if (issues.some((one) => one.reason === 'item-revision-conflict')) {
        setRefused({ kind: 'conflict' })
        return
      }
      if (issues.some((one) => one.reason === 'item-voided')) {
        setRefused({ kind: 'voided' })
        return
      }
      const read = problemsFromIssues({ draft, contract, locale, issues })
      if (read.placed.length > 0) {
        setRefusal({ at: checkKey, when: Date.now(), issues })
        setFailed(true)
        // the live reading names a new determination by the handle this
        // screen holds it under; a save names it by an id nobody here has
        void checkQuery.refetch()
        const first = read.placed[0]
        if (first !== undefined) setPanelParam(first.area)
      }
      if (read.loose.length > 0) {
        setRefused({ kind: 'loose', reasons: read.loose.map((one) => `${one.path}: ${one.reason}`) })
      }
    },
  })
  const onSave = () => {
    setAttempted(true)
    const first = problems[0]
    if (first !== undefined) {
      jumpTo(first)
      return
    }
    setRefused(null)
    if (needsReason) setAskingReason(true)
    else save.mutate({ reason: null })
  }

  /** the question as the server holds it now, read past every cache */
  const readAgain = async (): Promise<ItemDto | null> => {
    if (item === null) return null
    const listed = (await run(api.assessment.listItems({ params: { batchId } }))) as {
      items: readonly ItemDto[]
    }
    return listed.items.find((one) => one.id === item.id) ?? null
  }
  /** drop what was composed here and take what the server holds */
  const reload = async () => {
    setReloading(true)
    try {
      const fresh = await readAgain()
      if (fresh === null) {
        setRefused({ kind: 'gone' })
        return
      }
      setDraft(draftOf(fresh, groups, options))
      setRefused(null)
      setRefusal(null)
      setFailed(false)
      setAttempted(false)
      await onReload?.()
    } catch (error) {
      setRefused({ kind: 'other', words: formatError(error) })
    } finally {
      setReloading(false)
    }
  }
  /** keep what was composed here, over what somebody else has saved meanwhile */
  const overwrite = async () => {
    setReloading(true)
    try {
      const fresh = await readAgain()
      if (fresh === null) {
        setRefused({ kind: 'gone' })
        return
      }
      save.mutate({ reason: draftReason, over: fresh.currentRevision?.id ?? null })
    } catch (error) {
      setRefused({ kind: 'other', words: formatError(error) })
    } finally {
      setReloading(false)
    }
  }
  const retry = () => save.mutate({ reason: draftReason })

  // ---- what the band says --------------------------------------------------
  const revision = item?.currentRevision ?? null
  const heading = draft.title.trim() === '' ? format(m.itemsUntitled) : draft.title
  const modeChip = format(
    draft.mode === 'automatic' ? m.itemsModeAutomatic : draft.mode === 'direct' ? m.itemsModeDirect : m.itemsModeReview,
  )
  const savedWhen = ((): string | null => {
    if (revision === null) return null
    const at = new Date(revision.createdAt)
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at)
    return at.toDateString() === new Date().toDateString()
      ? format(m.itemsTodayAt, { time })
      : new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)
  })()
  const recognitionHandles = recognitionRows(draft, contract).map((row) => row.handle)
  const methodLabel = calculators.find((one) => one.ref === chosenCalculator.ref)?.label ?? null
  const automaticLocked = item !== null && item.status !== 'draft'

  const askWords = (asked: Ask) => {
    switch (asked.kind) {
      case 'unlink': {
        const name = recognitionOf(asked.handle)?.label ?? ''
        return { title: format(m.itemsUnlinkTitle), body: format(m.itemsUnlinkHint, { field: name }), confirm: format(m.itemsUnlink) }
      }
      case 'delete-field': {
        const field = draft.fields.find((one) => one.key === asked.key)
        return {
          title: format(m.itemsDeleteFieldTitle, { name: field?.label ?? '' }),
          body: format(m.itemsDeleteFieldHint),
          confirm: format(m.itemsDelete),
          tone: 'destructive' as const,
        }
      }
      case 'delete-blocked': {
        const name = recognitionOf(asked.handle)?.label ?? ''
        return {
          title: format(m.itemsDeleteBlockedTitle, { name }),
          body: format(m.itemsDeleteBlockedHint, { recognition: name }),
          confirm: format(m.itemsGoToRecognition),
        }
      }
      case 'disable-option': {
        const field = draft.fields.find((one) => one.key === asked.key)
        const option = field?.options.find((one) => one.id === asked.optionId)
        return {
          title: format(m.itemsDisableOptionTitle, { name: option?.label ?? '' }),
          body: format(m.itemsDisableOptionHint),
          confirm: format(m.itemsDisable),
        }
      }
      case 'to-direct':
        return {
          title: format(m.itemsToDirectTitle),
          body: format(m.itemsToDirectHint, {
            count: asked.handles.length,
            names: listJoin(asked.handles.map((handle) => recognitionOf(handle)?.label ?? '')),
          }),
          confirm: format(m.itemsToDirectConfirm),
        }
      case 'to-automatic':
        return {
          title: format(m.itemsToAutomaticTitle),
          body: format(m.itemsToAutomaticHint, {
            count: asked.parameters.length,
            names: listJoin(asked.parameters.map((parameter) => parameterTitle(contract, parameter, locale))),
          }),
          confirm: format(m.itemsGoToScoring),
        }
      case 'adjust': {
        const recognition = recognitionOf(asked.handle)
        const seat = parameterOf(asked.handle)
        const field = draft.fields.find((one) => one.id === asked.fieldId)
        const admitted = recognition === undefined || seat === undefined ? null : admittedSchemaOf(recognition, seat.schema)
        return {
          title: format(m.itemsAdjustTitle),
          body: format(m.itemsAdjustHint, {
            field: field?.label ?? '',
            current: field === undefined ? '' : fieldWords(field),
            next: admitted === null ? '' : boundsWords(admitted, locale, format, listJoin),
          }),
          confirm: format(m.itemsLinkAdjustAction),
        }
      }
      case 'mapping':
        return null
    }
  }
  const fieldWords = (field: FieldDraft) => {
    const schema = fieldSchemaOf(field)
    return schema === null ? '' : boundsWords(schema, locale, format, listJoin)
  }
  const onAskConfirm = (asked: Ask) => {
    switch (asked.kind) {
      case 'unlink':
        unlink(asked.handle)
        break
      case 'delete-field':
        removeField(asked.key)
        break
      case 'delete-blocked':
        setSheet({ kind: 'recognition', handle: asked.handle })
        setPanelParam('scoring')
        break
      case 'disable-option':
        disableOption(asked.key, asked.optionId)
        break
      case 'to-direct': {
        for (const handle of asked.handles) linkNewField(handle)
        const linkedIds = new Set(recognitionRows(draft, contract).map((row) => row.recognition.fieldId))
        setDraft((previous) => ({
          ...previous,
          mode: 'direct',
          ...(previous.participant || previous.administrative ? {} : { participant: true }),
          fields: previous.fields.map((field) => (linkedIds.has(field.id) ? { ...field, required: true } : field)),
        }))
        break
      }
      case 'to-automatic':
        setPanelParam('scoring')
        break
      case 'adjust':
        linkField(asked.handle, asked.fieldId)
        break
      case 'mapping':
        break
    }
    setAsk(null)
  }

  return (
    <div {...stylex.props(styles.root)} data-testid="item-editor" data-mode={draft.mode} data-panel={area}>
      <BatchBanner>
        <div {...stylex.props(styles.band)} data-testid="item-band">
          <div {...stylex.props(styles.trailRow)}>
            <nav aria-label={format(m.itemsBack)} {...stylex.props(styles.trail)}>
              <button type="button" {...stylex.props(styles.back)} onClick={onCancel} data-testid="item-back">
                <ArrowLeftIcon aria-hidden {...stylex.props(styles.backIcon)} />
                {format(m.itemsCrumbRoot)}
              </button>
              {trail.map((name, index) => (
                <Fragment key={`${index}:${name}`}>
                  <ChevronRightIcon aria-hidden {...stylex.props(styles.crumbRule)} />
                  <span {...stylex.props(styles.crumb)}>{name}</span>
                </Fragment>
              ))}
              <ChevronRightIcon aria-hidden {...stylex.props(styles.crumbRule, styles.crumb)} />
              <span {...stylex.props(styles.crumb, styles.crumbHere)} aria-current="page">
                {heading}
              </span>
            </nav>
            <span {...stylex.props(styles.spacer)} />
            <span
              {...stylex.props(styles.meta)}
              data-testid="item-meta"
              data-revision={revision?.revisionNo ?? 0}
              data-standing={item?.status ?? 'new'}
            >
              <span>{revision === null ? format(m.itemsVersionNew) : format(m.itemsVersionNo, { no: revision.revisionNo })}</span>
              <span aria-hidden {...stylex.props(styles.metaRule)} />
              <span>{format(item?.status === 'active' ? m.structureStatusLive : m.itemsStatusDraft)}</span>
              {(dirty || savedWhen !== null) && <span aria-hidden {...stylex.props(styles.metaRule)} />}
              {dirty ? (
                <span {...stylex.props(styles.metaUnsaved)} data-testid="item-unsaved">
                  <Dot tone="pending" />
                  {format(m.itemsUnsaved)}
                </span>
              ) : (
                savedWhen !== null && <span>{format(m.itemsSavedAt, { when: savedWhen })}</span>
              )}
            </span>
          </div>

          <div {...stylex.props(styles.titleRow)}>
            <div {...stylex.props(styles.titleLine)}>
              <h1 {...stylex.props(styles.title, draft.title.trim() === '' && styles.titleUnset)}>{heading}</h1>
              <Tag tall testId="item-standing">
                {item === null || item.status === 'draft'
                  ? format(m.itemsStatusComposing)
                  : item.status === 'voided'
                    ? format(m.itemsStatusVoided)
                    : format(m.structureStatusLive)}
              </Tag>
              {/* said, not offered: the handling is changed where its consequences are laid out */}
              <Tag tall outline testId="item-mode">
                {modeChip}
              </Tag>
            </div>
            <span {...stylex.props(styles.spacer)} />
            <div {...stylex.props(styles.actions)}>
              <Button variant="outline" onClick={() => setSheet({ kind: 'preview' })}>
                <EyeIcon aria-hidden />
                {format(m.itemsPreview)}
              </Button>
              <Button
                disabled={save.isPending || reloading || wrong}
                onClick={onSave}
                data-testid="item-save"
                data-blocked={wrong}
              >
                {format(m.entrySave)}
              </Button>
              {menu !== undefined && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label={format(m.itemsMoreActions)}>
                      <EllipsisVerticalIcon aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className={stylex.props(styles.menu).className}>
                    {menu}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <div {...stylex.props(styles.tabsRow)}>
            <div {...stylex.props(styles.tabsSeat)}>
              <Tabs value={area} onValueChange={(next) => setPanelParam(next)}>
                <TabsList xstyle={styles.tabList}>
                  {AREAS.filter((one) => one !== 'rules' || draft.mode !== 'automatic').map((one) => (
                    <TabsTrigger
                      key={one}
                      value={one}
                      xstyle={styles.tab}
                      data-area={one}
                      data-pending={toneOf(one) !== 'ok'}
                      data-tone={toneOf(one)}
                    >
                      <span {...stylex.props(styles.tabLabel)}>
                        <Dot tone={toneOf(one)} />
                        {format(
                          one === 'basics'
                            ? m.itemsTabBasics
                            : one === 'scoring'
                              ? draft.mode === 'automatic'
                                ? m.itemsTabScoring
                                : m.itemsTabForm
                              : m.itemsTabRules,
                        )}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <span {...stylex.props(styles.spacer)} />
            <PendingList problems={problems} failed={failed} onGo={jumpTo} />
          </div>
        </div>
      </BatchBanner>

      <div {...stylex.props(styles.body)}>
        {failed && !dismissed && (
          <FailureList problems={problems} onGo={jumpTo} onDismiss={() => setDismissed(true)} />
        )}
        {refused !== null && (
          <FailureNotice
            kind={refused.kind}
            title={
              refused.kind === 'loose'
                ? format(m.itemsFailLooseTitle, { count: refused.reasons.length })
                : format(REFUSED_TITLE[refused.kind])
            }
            hint={
              refused.kind === 'incompatible' || refused.kind === 'other'
                ? refused.words
                : format(REFUSED_HINT[refused.kind])
            }
            reasons={refused.kind === 'loose' ? refused.reasons : undefined}
            actions={
              refused.kind === 'conflict' ? (
                <>
                  <Button variant="outline" size="sm" disabled={reloading || save.isPending} onClick={() => void reload()}>
                    {format(m.itemsFailReload)}
                  </Button>
                  <Button size="sm" disabled={reloading || save.isPending || wrong} onClick={() => void overwrite()}>
                    {format(m.itemsFailOverwrite)}
                  </Button>
                </>
              ) : refused.kind === 'loose' && item !== null ? (
                <Button variant="outline" size="sm" disabled={reloading} onClick={() => void reload()}>
                  {format(m.itemsFailReload)}
                </Button>
              ) : refused.kind === 'scoring' || refused.kind === 'other' ? (
                <Button variant="outline" size="sm" disabled={save.isPending || wrong} onClick={retry}>
                  {format(m.itemsFailRetry)}
                </Button>
              ) : undefined
            }
          />
        )}
        {area === 'basics' && (
          <BasicsTab
            draft={draft}
            groups={groups}
            automaticLocked={automaticLocked}
            problems={problems}
            attempted={attempted}
            onPatch={patch}
            onMode={setMode}
          />
        )}
        {area === 'scoring' && (
          <ScoringTab
            draft={draft}
            batchId={batchId}
            itemId={item?.id ?? null}
            contract={contract}
            contractState={contractState}
            calculators={calculators}
            chosenCalculator={chosenCalculator}
            placement={placement}
            problems={problems}
            onCalculatorApply={onCalculatorApply}
            onSource={onSource}
            onConstant={onConstant}
            onOpenRecognition={(handle) => setSheet({ kind: 'recognition', handle })}
            onOpenField={(key) => setSheet({ kind: 'field', key })}
            onAddField={() => setAdding({ open: true })}
            onReorderFields={(orderedKeys) =>
              setDraft((previous) => ({
                ...previous,
                fields: orderedKeys.flatMap((key) => {
                  const found = previous.fields.find((one) => one.key === key)
                  return found === undefined ? [] : [found]
                }),
              }))
            }
            onSummary={(summaryFieldIds) => patch({ summaryFieldIds })}
          />
        )}
        {area === 'rules' && draft.mode !== 'automatic' && (
          <RulesTab
            draft={draft}
            batchId={batchId}
            options={options}
            placement={placement}
            method={{ ref: chosenCalculator.ref, label: methodLabel }}
            problems={problems}
            onPatch={patch}
            onOpenStage={(key) => setSheet({ kind: 'stage', key })}
            onAddStage={addStage}
          />
        )}
      </div>

      {/* kept mounted while they shut, or they would vanish rather than close */}
      {lingeringSheet?.kind === 'recognition' && (
        <RecognitionSheet
          open={sheet?.kind === 'recognition'}
          draft={draft}
          contract={contract}
          handle={lingeringSheet.handle}
          siblings={recognitionHandles}
          onPatch={(next) => patchRecognition(lingeringSheet.handle, next)}
          onRefinement={(next) => setRefinement(lingeringSheet.handle, next)}
          onLinkRequired={(required) => {
            const fieldId = recognitionOf(lingeringSheet.handle)?.fieldId
            setDraft((previous) => ({
              ...previous,
              fields: previous.fields.map((one) => (one.id === fieldId ? { ...one, required } : one)),
            }))
          }}
          onUnlink={() => setAsk({ kind: 'unlink', handle: lingeringSheet.handle })}
          onLinkNew={() => linkNewField(lingeringSheet.handle)}
          onLinkExisting={(fieldId, verdict) => linkExisting(lingeringSheet.handle, fieldId, verdict)}
          onPage={(handle) => setSheet({ kind: 'recognition', handle })}
          onClose={() => setSheet(null)}
        />
      )}
      {lingeringSheet?.kind === 'field' && (
        <FieldSheet
          open={sheet?.kind === 'field'}
          draft={draft}
          contract={contract}
          fieldKey={lingeringSheet.key}
          materialRange={materialRange}
          storedOptionIds={storedOptionIds}
          onChange={(next) => patchField(lingeringSheet.key, next)}
          onRetype={(type) => retypeField(lingeringSheet.key, type)}
          onRecognition={patchRecognition}
          onRefinement={setRefinement}
          onDisableOption={(optionId) => setAsk({ kind: 'disable-option', key: lingeringSheet.key, optionId })}
          onDelete={() => {
            const field = draft.fields.find((one) => one.key === lingeringSheet.key)
            const link = field === undefined ? undefined : linkOf(draft, contract, field.id)
            setAsk(
              link === undefined
                ? { kind: 'delete-field', key: lingeringSheet.key }
                : { kind: 'delete-blocked', key: lingeringSheet.key, handle: link.handle },
            )
          }}
          onGoToRecognition={(handle) => setSheet({ kind: 'recognition', handle })}
          onPage={(key) => setSheet({ kind: 'field', key })}
          onClose={() => setSheet(null)}
        />
      )}
      {lingeringSheet?.kind === 'stage' &&
        (() => {
          const composing = lingeringSheet.fresh
          const stage = composing ?? draft.stages.find((one) => one.key === lingeringSheet.key)
          if (stage === undefined) return null
          const chain = draft.stages.filter((one) => one.chain === stage.chain)
          const at = chain.findIndex((one) => one.key === stage.key)
          return (
            <StageSheet
              // the panel edits a copy, and a copy belongs to one step
              key={stage.key}
              open={sheet?.kind === 'stage'}
              batchId={batchId}
              stage={stage}
              fresh={composing !== undefined}
              options={options}
              panelable={stage.chain === 'escalation' && at >= 0 && at < chain.length - 1}
              place={at < 0 ? undefined : { index: at, total: chain.length }}
              removable={stage.chain === 'escalation' || chain.length > 1}
              onApply={(next) => {
                applyStage(next, composing !== undefined)
                setSheet(null)
              }}
              onMove={(delta) => moveStage(stage.key, delta)}
              onRemove={() => {
                removeStage(stage.key)
                setSheet(null)
              }}
              onClose={() => setSheet(null)}
            />
          )
        })()}
      {lingeringSheet?.kind === 'preview' && (
        <PreviewSheet open={sheet?.kind === 'preview'} draft={draft} onClose={() => setSheet(null)} />
      )}

      {askedAdding !== null && (
        <AddFieldDialog
          open={adding !== null}
          materialRange={materialRange}
          onAdd={(field) => {
            setDraft((previous) => ({ ...previous, fields: [...previous.fields, field] }))
            setAdding(null)
          }}
          onClose={() => setAdding(null)}
        />
      )}

      {lingeringAsk !== null &&
        lingeringAsk.kind === 'mapping' &&
        (() => {
          const recognition = recognitionOf(lingeringAsk.handle)
          const seat = parameterOf(lingeringAsk.handle)
          const field = draft.fields.find((one) => one.id === lingeringAsk.fieldId)
          if (recognition === undefined || seat === undefined || field === undefined) return null
          const admitted = admittedSchemaOf(recognition, seat.schema) as ChoiceSchema
          const labels = (admitted['x-qualy-enumLabels'] as Record<string, string> | undefined) ?? {}
          return (
            <ChoiceMappingDialog
              open={ask?.kind === 'mapping'}
              fieldName={field.label}
              recognitionName={recognition.label}
              fieldOptions={field.options.filter((one) => one.enabled).map((one) => ({ id: one.id, label: one.label }))}
              recognitionOptions={admitted.enum.map((value) => ({ value, label: labels[value] ?? value }))}
              onConfirm={(mapping) => applyMapping(lingeringAsk.handle, lingeringAsk.fieldId, mapping)}
              onClose={() => setAsk(null)}
            />
          )
        })()}
      {lingeringAsk !== null &&
        lingeringAsk.kind !== 'mapping' &&
        (() => {
          const words = askWords(lingeringAsk)
          if (words === null) return null
          return (
            <ConfirmDialog
              open={ask !== null && ask.kind !== 'mapping'}
              title={words.title}
              description={words.body}
              confirmLabel={words.confirm}
              cancelLabel={format(commonMessages.cancel)}
              tone={words.tone ?? 'default'}
              onConfirm={() => onAskConfirm(lingeringAsk)}
              onCancel={() => setAsk(null)}
            />
          )
        })()}

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

