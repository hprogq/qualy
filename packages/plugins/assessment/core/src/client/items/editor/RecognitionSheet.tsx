import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { LinkIcon, LockIcon } from 'lucide-react'
import { useI18n, useList } from '@qualy/web-i18n'
import {
  choiceLabel,
  kindOf,
  DATE_MAXIMUM,
  DATE_MINIMUM,
  IN_MATERIAL_RANGE,
  type AtomicSchema,
  type ChoiceSchema,
} from '@qualy/value-schema'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { DatePicker } from '@qualy/ui/date-picker'
import { Field as FieldRow, FieldContent, FieldDescription, FieldLabel } from '@qualy/ui/field'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { assessmentMessages as m } from '../../i18n.ts'
import { EditorSheet } from './EditorSheet.tsx'
import { sheetStyles } from './shared-styles.ts'
import {
  admittedSchemaOf,
  boundProblem,
  parameterSchemaOf,
  refinementOf,
  type Contract,
  type Draft,
  type RecognitionDraft,
  type Standing,
} from './model.ts'
import {
  TYPE_LABEL,
  boundsWords,
  fieldBoundsWords,
  kindWords,
  linkVerdictOf,
  type LinkVerdict,
} from './words.ts'

// One determination, owned here in full: what it is called, what it admits,
// and which submission field starts it. The field it is linked to keeps its
// own name and hint - what a participant is asked and what a reviewer
// determines may be worded differently - and takes its type and range from
// here.

const styles = stylex.create({
  group: { display: 'flex', flexDirection: 'column', gap: 12 },
  block: { display: 'flex', flexDirection: 'column', gap: 10 },
  blockHead: { display: 'flex', alignItems: 'center', gap: 8 },
  blockTitle: { fontSize: 13, fontWeight: 600 },
  spacer: { flexGrow: 1 },
  linkButton: {
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    color: {
      default: tokens.foreground,
      ':disabled': `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
    },
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  optionRow: { display: 'flex', alignItems: 'center', gap: 10 },
  optionInput: { flexGrow: 1, minWidth: 0 },
  optionOff: { color: tokens.mutedForeground },
  optionLock: {
    display: 'inline-flex',
    flexShrink: 0,
    color: tokens.mutedForeground,
    cursor: 'help',
  },
  optionLockIcon: { width: 14, height: 14 },
  heldHint: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  pair: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
  linkBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: tokens.surfaceInset,
  },
  linkLine: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' },
  linkIcon: { width: 14, height: 14, flexShrink: 0, color: tokens.foreground },
  linkName: { fontWeight: 500 },
  quiet: { fontSize: 12, color: tokens.mutedForeground },
  quietLine: { margin: 0, fontSize: 12.5, color: tokens.mutedForeground },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' },
  actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  problem: { margin: 0, fontSize: 12, color: tokens.danger },
  candidates: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 10,
    boxShadow: `0 0 0 1px ${tokens.border}`,
  },
  candidate: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  candidateDim: { color: tokens.mutedForeground },
  candidateWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  candidateName: { fontSize: 13.5, fontWeight: 500 },
  candidateTakes: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  verdict: { fontSize: 12, color: tokens.mutedForeground, whiteSpace: 'nowrap' },
  verdictDiffers: { color: tokens.warningForeground },
  hint: { margin: 0, fontSize: 12.5, color: tokens.mutedForeground },
})

export function RecognitionSheet({
  open,
  draft,
  contract,
  handle,
  siblings,
  standing,
  onPatch,
  onRefinement,
  onLinkRequired,
  onUnlink,
  onLinkNew,
  onLinkExisting,
  onPage,
  onClose,
}: {
  open: boolean
  draft: Draft
  contract: Contract | null
  handle: string
  /** every determination's handle, in the arithmetic's order */
  siblings: readonly string[]
  /** what each saved determination already holds, by its stored identity */
  standing: readonly Standing[]
  onPatch: (next: Partial<RecognitionDraft>) => void
  onRefinement: (next: AtomicSchema | null) => void
  onLinkRequired: (required: boolean) => void
  onUnlink: () => void
  onLinkNew: () => void
  /** a field chosen from the list; the editor decides whether to ask first */
  onLinkExisting: (fieldId: string, verdict: LinkVerdict) => void
  onPage: (handle: string) => void
  onClose: () => void
}) {
  const { format, locale } = useI18n()
  const listJoin = useList()
  const [choosing, setChoosing] = useState(false)
  const row =
    draft.scoring.language === 'v2'
      ? Object.entries(draft.scoring.bindings).find(
          ([, binding]) => binding.kind === 'recognition' && binding.handle === handle,
        )
      : undefined
  const parameter = row?.[0]
  const recognition =
    draft.scoring.language === 'v2' ? draft.scoring.recognitions[handle] : undefined
  const schema = parameter === undefined ? undefined : parameterSchemaOf(contract, parameter)
  if (recognition === undefined || schema === undefined || parameter === undefined) return null
  const admitted = admittedSchemaOf(recognition, schema)
  const linked = draft.fields.find((one) => one.id === recognition.fieldId)
  const at = siblings.indexOf(handle)
  const title = recognition.label.trim() === '' ? format(m.itemsFieldUnnamed) : recognition.label

  if (choosing) {
    return (
      <EditorSheet
        open={open}
        title={format(m.itemsLinkExisting)}
        onBack={() => setChoosing(false)}
        onClose={onClose}
        testId="link-existing-sheet"
      >
        <p {...stylex.props(styles.hint)}>
          {format(m.itemsLinkExistingHint, {
            name: title,
            type: [kindWords(admitted, format), boundsWords(admitted, locale, format, listJoin)]
              .filter((one) => one !== '')
              .join(format(m.listSeparator)),
          })}
        </p>
        {draft.fields.length === 0 ? (
          <p {...stylex.props(styles.hint)}>{format(m.itemsLinkExistingNone)}</p>
        ) : (
          <div {...stylex.props(styles.candidates)}>
            {draft.fields.map((field) => {
              const verdict = linkVerdictOf(
                draft,
                contract,
                admitted,
                field,
                format,
                listJoin,
                locale,
              )
              const dim = verdict.kind === 'kind-mismatch' || verdict.kind === 'taken'
              const name = field.label.trim() === '' ? format(m.itemsFieldUnnamed) : field.label
              return (
                <div
                  key={field.key}
                  {...stylex.props(styles.candidate, dim && styles.candidateDim)}
                  data-testid="link-candidate"
                  data-field-key={field.key}
                  data-verdict={verdict.kind}
                >
                  <span {...stylex.props(styles.candidateWords)}>
                    <span {...stylex.props(styles.candidateName)}>{name}</span>
                    <span {...stylex.props(styles.candidateTakes)}>
                      {format(TYPE_LABEL[field.type])} {fieldBoundsWords(field, format, listJoin)}
                    </span>
                  </span>
                  {verdict.kind === 'fits' && (
                    <>
                      <span {...stylex.props(styles.verdict)}>{format(m.itemsLinkFits)}</span>
                      <Button size="sm" onClick={() => onLinkExisting(field.id, verdict)}>
                        {format(m.itemsLinkAction)}
                      </Button>
                    </>
                  )}
                  {verdict.kind === 'differs' && (
                    <>
                      <span {...stylex.props(styles.verdict, styles.verdictDiffers)}>
                        {format(m.itemsLinkDiffers)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onLinkExisting(field.id, verdict)}
                      >
                        {format(m.itemsLinkAdjustAction)}
                      </Button>
                    </>
                  )}
                  {verdict.kind === 'kind-mismatch' && (
                    <span {...stylex.props(styles.verdict)}>{format(m.itemsLinkKindMismatch)}</span>
                  )}
                  {verdict.kind === 'taken' && (
                    <span {...stylex.props(styles.verdict)}>{format(m.itemsLinkTaken)}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </EditorSheet>
    )
  }

  return (
    <EditorSheet
      open={open}
      title={title}
      tag={format(m.itemsRecognitionTag)}
      pager={{
        index: at,
        total: siblings.length,
        onPrevious: () => {
          const previous = siblings[at - 1]
          if (previous !== undefined) onPage(previous)
        },
        onNext: () => {
          const next = siblings[at + 1]
          if (next !== undefined) onPage(next)
        },
      }}
      onClose={onClose}
      footer={
        <>
          <span {...stylex.props(sheetStyles.footerSpacer)} />
          <Button variant="outline" onClick={onClose}>
            {format(m.itemsDone)}
          </Button>
        </>
      }
      testId="recognition-sheet"
    >
      <div {...stylex.props(styles.group)}>
        <Field label={format(m.itemsName)}>
          {(id) => (
            <Input
              id={id}
              value={recognition.label}
              maxLength={50}
              required
              aria-invalid={recognition.label.trim() === '' || undefined}
              onChange={(event) => onPatch({ label: event.target.value })}
            />
          )}
        </Field>
        <Field label={format(m.itemsRecognitionDescription)}>
          {(id) => (
            <Input
              id={id}
              value={recognition.description}
              maxLength={200}
              placeholder={format(m.itemsRecognitionDescriptionPlaceholder)}
              onChange={(event) => onPatch({ description: event.target.value })}
            />
          )}
        </Field>
      </div>

      <RangeEditor
        key={handle}
        parameter={schema}
        recognition={recognition}
        standing={standing.find((one) => one.recognitionId === recognition.id)}
        onRefinement={onRefinement}
      />

      <div {...stylex.props(styles.block)}>
        <span {...stylex.props(styles.blockTitle)}>{format(m.itemsLinkSection)}</span>
        <div
          {...stylex.props(styles.linkBox)}
          data-testid="recognition-link"
          data-linked={linked !== undefined}
        >
          {linked === undefined ? (
            <>
              <p {...stylex.props(styles.quietLine)}>{format(m.itemsUnlinkedHint)}</p>
              <div {...stylex.props(styles.actions)}>
                <Button size="sm" onClick={onLinkNew}>
                  {format(m.itemsLinkNew)}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setChoosing(true)}>
                  {format(m.itemsLinkExisting)}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div {...stylex.props(styles.linkLine)}>
                <LinkIcon aria-hidden {...stylex.props(styles.linkIcon)} />
                <span {...stylex.props(styles.linkName)} data-testid="recognition-linked-field">
                  {linked.label.trim() === '' ? format(m.itemsFieldUnnamed) : linked.label}
                </span>
                <span {...stylex.props(styles.quiet)}>{format(m.itemsLinkedHint)}</span>
              </div>
              <label {...stylex.props(styles.checkLabel)}>
                <Checkbox
                  checked={linked.required}
                  onCheckedChange={(next) => onLinkRequired(next === true)}
                />
                {format(m.itemsLinkRequired)}
                <span {...stylex.props(styles.quiet)}>{format(m.itemsLinkRequiredHint)}</span>
              </label>
              <div {...stylex.props(styles.actions)}>
                <Button size="sm" variant="outline" onClick={onUnlink}>
                  {format(m.itemsUnlink)}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </EditorSheet>
  )
}

/**
 * What the determination admits, narrowed inside what the parameter does.
 *
 * A choice is the parameter's own options, each in or out, each with the
 * words it goes by; a number is two bounds; text is two lengths. Restoring
 * the default is the parameter exactly as the formula published it.
 */
export function RangeEditor({
  parameter,
  recognition,
  standing,
  onRefinement,
  title,
}: {
  parameter: AtomicSchema
  recognition: RecognitionDraft
  /**
   * What this determination already holds. An option a claim was determined
   * as, or that a round still open may settle on, cannot be taken out of the
   * range - so it is held shut here, where the hand is, rather than let go
   * and refused afterwards.
   */
  standing?: Standing | undefined
  onRefinement: (next: AtomicSchema | null) => void
  title?: string
}) {
  const { format, locale } = useI18n()
  const words = usePickerWords()
  const kind = kindOf(parameter)
  const admitted = admittedSchemaOf(recognition, parameter)
  const description = recognition.description
  const [typed, setTyped] = useState<{ min: string; max: string }>(() =>
    boundsTyped(admitted, parameter),
  )
  if (kind === 'boolean') return null
  // narrowed means narrowed: a description alone rides on the annotation
  // layer and is not something "restore default" should offer to undo
  const narrowed =
    JSON.stringify(recognition.refinement) !==
    JSON.stringify(refinementOf(parameter, {}, description))
  const heading = title ?? format(kind === 'choice' ? m.itemsOptions : m.itemsRange)

  if (kind === 'choice') {
    const source = parameter as ChoiceSchema
    const held = admitted as ChoiceSchema
    const pinnedBy = (value: string): 'determined' | null =>
      standing?.determined.includes(value) === true ? 'determined' : null
    const options = source.enum.map((value) => ({
      value,
      enabled: held.enum.includes(value),
      label: held.enum.includes(value)
        ? choiceLabel(held, value, locale)
        : choiceLabel(source, value, locale),
    }))
    const write = (next: typeof options) =>
      onRefinement(refinementOf(parameter, { options: next }, description))
    return (
      <div {...stylex.props(styles.block)} data-testid="recognition-range" data-kind="choice">
        <div {...stylex.props(styles.blockHead)}>
          <span {...stylex.props(styles.blockTitle)}>{heading}</span>
          <span {...stylex.props(styles.spacer)} />
          <button
            type="button"
            {...stylex.props(styles.linkButton)}
            disabled={!narrowed}
            onClick={() => onRefinement(refinementOf(parameter, {}, description))}
          >
            {format(m.itemsRestoreDefault)}
          </button>
        </div>
        {options.map((option) => (
          <div
            key={option.value}
            {...stylex.props(styles.optionRow, !option.enabled && styles.optionOff)}
            data-testid="recognition-option"
            data-value={option.value}
            data-enabled={option.enabled}
          >
            {/* An option nothing stands on is a box to tick. One a record
                is already determined as cannot be let go of, so its seat
                holds the lock that says why instead of a box that refuses
                every press - a disabled control says only "no". */}
            {option.enabled && pinnedBy(option.value) !== null ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      {...stylex.props(styles.optionLock)}
                      tabIndex={0}
                      role="img"
                      aria-label={format(m.itemsOptionHeldDetermined)}
                      data-testid="option-held"
                      data-held-by={pinnedBy(option.value)}
                    >
                      <LockIcon aria-hidden {...stylex.props(styles.optionLockIcon)} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{format(m.itemsOptionHeldDetermined)}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Checkbox
                checked={option.enabled}
                aria-label={option.label}
                onCheckedChange={(next) =>
                  write(
                    options.map((one) =>
                      one.value === option.value ? { ...one, enabled: next === true } : one,
                    ),
                  )
                }
              />
            )}
            <Input
              wrapperXstyle={styles.optionInput}
              value={option.label}
              disabled={!option.enabled}
              aria-label={choiceLabel(source, option.value, locale)}
              onChange={(event) =>
                write(
                  options.map((one) =>
                    one.value === option.value ? { ...one, label: event.target.value } : one,
                  ),
                )
              }
            />
          </div>
        ))}
        {options.some((option) => option.enabled && pinnedBy(option.value) !== null) && (
          <p {...stylex.props(styles.heldHint)} data-testid="options-held-hint">
            {format(m.itemsOptionsHeldHint)}
          </p>
        )}
      </div>
    )
  }

  if (kind === 'date') {
    const held = admitted as {
      [DATE_MINIMUM]?: string
      [DATE_MAXIMUM]?: string
      [IN_MATERIAL_RANGE]?: boolean
    }
    const bound = held[IN_MATERIAL_RANGE] === true
    const write = (next: { min?: string; max?: string; inMaterialRange?: boolean }) =>
      onRefinement(
        refinementOf(
          parameter,
          {
            min: next.min ?? held[DATE_MINIMUM] ?? '',
            max: next.max ?? held[DATE_MAXIMUM] ?? '',
            inMaterialRange: next.inMaterialRange ?? bound,
          },
          description,
        ),
      )
    return (
      <div {...stylex.props(styles.block)} data-testid="recognition-range" data-kind="date">
        <div {...stylex.props(styles.blockHead)}>
          <span {...stylex.props(styles.blockTitle)}>{heading}</span>
          <span {...stylex.props(styles.spacer)} />
          <button
            type="button"
            {...stylex.props(styles.linkButton)}
            disabled={!narrowed}
            onClick={() => onRefinement(refinementOf(parameter, {}, description))}
          >
            {format(m.itemsRestoreDefault)}
          </button>
        </div>
        <div {...stylex.props(styles.pair)}>
          <Field label={format(m.itemsFieldMinDate)}>
            {(id) => (
              <DatePicker
                id={id}
                value={held[DATE_MINIMUM] ?? null}
                clearLabel={words.clear}
                localeTag={locale}
                monthLabel={words.month}
                yearLabel={words.year}
                onChange={(next) => write({ min: next ?? '' })}
              />
            )}
          </Field>
          <Field label={format(m.itemsFieldMaxDate)}>
            {(id) => (
              <DatePicker
                id={id}
                value={held[DATE_MAXIMUM] ?? null}
                clearLabel={words.clear}
                localeTag={locale}
                monthLabel={words.month}
                yearLabel={words.year}
                onChange={(next) => write({ max: next ?? '' })}
              />
            )}
          </Field>
        </div>
        <FieldRow orientation="horizontal">
          <Checkbox
            checked={bound}
            data-testid="recognition-date-in-range"
            onCheckedChange={(next) => write({ inMaterialRange: next === true })}
          />
          <FieldContent>
            <FieldLabel>{format(m.itemsDateInRange)}</FieldLabel>
            <FieldDescription>{format(m.itemsDateInRangeHint)}</FieldDescription>
          </FieldContent>
        </FieldRow>
      </div>
    )
  }

  const problemMin = boundProblem(kind, 'min', typed.min, parameter)
  const problemMax = boundProblem(kind, 'max', typed.max, parameter)
  const placeholders = boundsTyped(parameter, parameter)
  const commit = (next: { min: string; max: string }) => {
    setTyped(next)
    if (boundProblem(kind, 'min', next.min, parameter) !== null) return
    if (boundProblem(kind, 'max', next.max, parameter) !== null) return
    onRefinement(
      refinementOf(
        parameter,
        kind === 'text'
          ? { minLength: next.min, maxLength: next.max }
          : { min: next.min, max: next.max },
        description,
      ),
    )
  }
  return (
    <div {...stylex.props(styles.block)} data-testid="recognition-range" data-kind={kind}>
      <div {...stylex.props(styles.blockHead)}>
        <span {...stylex.props(styles.blockTitle)}>{heading}</span>
        <span {...stylex.props(styles.spacer)} />
        <button
          type="button"
          {...stylex.props(styles.linkButton)}
          disabled={!narrowed}
          onClick={() => {
            setTyped(boundsTyped(parameter, parameter))
            onRefinement(refinementOf(parameter, {}, description))
          }}
        >
          {format(m.itemsRestoreDefault)}
        </button>
      </div>
      <div {...stylex.props(styles.pair)}>
        <Field label={format(kind === 'text' ? m.itemsFieldMinLength : m.itemsFieldMinValue)}>
          {(id) => (
            <Input
              id={id}
              value={typed.min}
              placeholder={placeholders.min}
              aria-invalid={problemMin !== null || undefined}
              inputMode={kind === 'decimal' ? 'decimal' : 'numeric'}
              onChange={(event) => commit({ ...typed, min: event.target.value })}
            />
          )}
        </Field>
        <Field label={format(kind === 'text' ? m.itemsFieldMaxLength : m.itemsFieldMaxValue)}>
          {(id) => (
            <Input
              id={id}
              value={typed.max}
              placeholder={placeholders.max}
              aria-invalid={problemMax !== null || undefined}
              inputMode={kind === 'decimal' ? 'decimal' : 'numeric'}
              onChange={(event) => commit({ ...typed, max: event.target.value })}
            />
          )}
        </Field>
      </div>
      {(problemMin !== null || problemMax !== null) && (
        <p {...stylex.props(styles.problem)} role="alert">
          {format(m.itemsProblemRefinementWidens)}
        </p>
      )}
    </div>
  )
}

/** the bounds a schema states, as the text a person would type for them */
const boundsTyped = (
  schema: AtomicSchema,
  parameter: AtomicSchema,
): { min: string; max: string } => {
  const kind = kindOf(parameter)
  const held = schema as unknown as Record<string, unknown>
  const say = (value: unknown) => (value === undefined ? '' : String(value))
  if (kind === 'integer') {
    return {
      min: held['minimum'] === Number.MIN_SAFE_INTEGER ? '' : say(held['minimum']),
      max: held['maximum'] === Number.MAX_SAFE_INTEGER ? '' : say(held['maximum']),
    }
  }
  if (kind === 'decimal') {
    return { min: say(held['x-qualy-minimum']), max: say(held['x-qualy-maximum']) }
  }
  if (kind === 'text') return { min: say(held['minLength']), max: say(held['maxLength']) }
  return { min: '', max: '' }
}
