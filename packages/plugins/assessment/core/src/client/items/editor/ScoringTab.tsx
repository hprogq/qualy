import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, InfoIcon, PlusIcon } from 'lucide-react'
import { UiSlot } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { choiceLabel, inputOrder, kindOf, type AtomicSchema, type ChoiceSchema } from '@qualy/value-schema'
import { draftFromValue, type FieldDraft as ValueDraft } from '@qualy/web-value-form/model'
import type { MessageDescriptor, UiText } from '@qualy/i18n-contract'
import { Feedback } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DatePicker } from '@qualy/ui/date-picker'
import { Input } from '@qualy/ui/input'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { calculatorEditorSlot, calculatorSummarySlot } from '../../../surfaces.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { trimAmount } from '../../entry/model.ts'
import { Choice } from '../Choice.tsx'
import type { Placement } from '../paper.ts'
import {
  DragHandle,
  EditorSection,
  EmptyRow,
  FooterAction,
  ListCard,
  ListHead,
  ListRow,
  SectionCount,
  Tag,
  TakesCell,
} from './Rows.tsx'
import { ScoringMethodDialog } from './ScoringMethodDialog.tsx'
import { rowWords } from './shared-styles.ts'
import { SummarySection } from './SummarySection.tsx'
import {
  admittedSchemaOf,
  linkOf,
  parameterDescription,
  parameterSchemaOf,
  parameterTitle,
  recognitionRows,
  type BindingDraft,
  type Contract,
  type Draft,
  type EditorBlock,
  type EditorProblem,
} from './model.ts'
import { TYPE_LABEL, fieldTakesOf, kindWords, problemWords, sentences, takesOf } from './words.ts'

// The arithmetic and the form it is fed from, as three lists under one
// method: what the formula takes, what a reviewer determines, what a
// participant fills in - and under the form, which of its fields name a
// record in a list. Under "takes effect on submission" the middle list
// folds into the third, and under automatic scoring only the first is left.
//
// What is wrong is said where it is wrong: a value the formula refuses has
// its box outlined and one red line under it, a row that cannot stand says
// why in its last column, and the heading of each list counts what is left.
// The sentence is the same whether this screen found the fault or the
// server did, because a reader cannot act differently on the two.

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 32 },
  methodCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    minWidth: 0,
    minHeight: 56,
    paddingInline: 16,
    paddingBlock: 10,
    borderRadius: 12,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  methodCardBad: { boxShadow: `0 0 0 1px ${tokens.danger}, 0 1px 2px rgb(0 0 0 / 0.04)` },
  methodWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 3 },
  methodName: { fontSize: 14, fontWeight: 600 },
  methodNote: { fontSize: 12, color: tokens.mutedForeground },
  methodAmount: { paddingTop: 6 },
  methodChange: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: 'pointer',
  },
  problemLine: { margin: 0, fontSize: 12, color: tokens.danger },
  status: { margin: 0, fontSize: 13, color: tokens.mutedForeground },
  // the value column: how the value is come by, then the value itself
  valueColumn: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 6 },
  valueLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  sourcePick: { width: 104, height: 34, flexShrink: 0 },
  sourcePickWide: { width: 132, height: 34, flexShrink: 0 },
  valueSeat: { display: 'flex', minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  valueControl: { width: '100%', height: 34 },
  valueMono: { fontFamily: MONO, fontSize: 13 },
  // yes or no as two segments: chosen, not ticked, so an unanswered one is
  // visibly neither
  segments: {
    display: 'inline-flex',
    flexShrink: 0,
    height: 34,
    overflow: 'hidden',
    borderRadius: 8,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  segmentsBad: { boxShadow: `inset 0 0 0 1px ${tokens.danger}` },
  segment: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 34,
    paddingInline: 14,
    fontFamily: 'inherit',
    fontSize: 13,
    color: tokens.mutedForeground,
    backgroundColor: 'transparent',
    borderWidth: 0,
    cursor: 'pointer',
  },
  segmentOn: { backgroundColor: tokens.foreground, color: tokens.background, fontWeight: 500 },
  dateBad: { borderRadius: 8, boxShadow: `0 0 0 1px ${tokens.danger}` },
  pendingLine: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: tokens.warningForeground,
    whiteSpace: 'nowrap',
  },
  pendingDot: { width: 6, height: 6, borderRadius: '9999px', backgroundColor: tokens.warning },
  note: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: tokens.foreground },
  noteIcon: { width: 15, height: 15, flexShrink: 0, color: tokens.mutedForeground },
  required: { fontSize: 13, fontWeight: 500 },
  optional: { fontSize: 13, color: tokens.mutedForeground },
  linkedLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8, fontSize: 13 },
  linkedName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  },
  linkedNote: { flexShrink: 0, fontSize: 12, color: tokens.mutedForeground },
  unlinked: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
})

export type ContractState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'refused' }
  | { kind: 'unavailable' }
  | { kind: 'ready' }

/** how many things in one block are wrong, and how many only wait */
const countsOf = (problems: readonly EditorProblem[], block: EditorBlock) => ({
  errors: problems.filter((one) => one.block === block && one.tone === 'error').length,
  pending: problems.filter((one) => one.block === block && one.tone === 'pending').length,
})

export function ScoringTab({
  draft,
  batchId,
  itemId,
  contract,
  contractState,
  calculators,
  chosenCalculator,
  placement,
  problems,
  onCalculatorApply,
  onSource,
  onConstant,
  onOpenRecognition,
  onOpenField,
  onAddField,
  onReorderFields,
  onSummary,
}: {
  draft: Draft
  batchId: string
  itemId: string | null
  contract: Contract | null
  contractState: ContractState
  calculators: readonly { ref: string; label: UiText; confirms?: 'itself' }[]
  chosenCalculator: { ref: string; config: unknown }
  placement: Placement
  problems: readonly EditorProblem[]
  /** the arithmetic chosen and configured, in one act */
  onCalculatorApply: (next: { ref: string; config: unknown }) => void
  /** what feeds a parameter: a determination, a fixed value, or the form itself */
  onSource: (parameter: string, source: 'recognition' | 'constant' | 'filed') => void
  onConstant: (parameter: string, draft: ValueDraft) => void
  onOpenRecognition: (handle: string) => void
  onOpenField: (key: string) => void
  onAddField: () => void
  onReorderFields: (orderedKeys: readonly string[]) => void
  /** which fields name a record in a list, in order */
  onSummary: (fieldIds: string[]) => void
}) {
  const { format, formatText, locale } = useI18n()
  const words = usePickerWords()
  const [choosing, setChoosing] = useState(false)
  const automatic = draft.mode === 'automatic'
  const review = draft.mode === 'review'
  const versioned = draft.scoring.language === 'v2'
  const fixed = chosenCalculator.ref === 'fixed@1'
  const parameters = contract === null ? [] : inputOrder(contract.inputSchema)
  const chosenLabel = calculators.find((one) => one.ref === chosenCalculator.ref)?.label
  const methodName =
    chosenLabel === undefined ? format(m.itemsCalculatorFixed) : formatText(chosenLabel)
  const separator = format(m.listSeparator)
  const slotContext = { batchId, itemId, calculator: chosenCalculator }

  const parameterProblem = (parameter: string) =>
    problems.find((one) => one.entity?.kind === 'parameter' && one.entity.parameter === parameter)
  const recognitionProblem = (handle: string) =>
    problems.find((one) => one.entity?.kind === 'recognition' && one.entity.handle === handle)
  const fieldProblem = (key: string) =>
    problems.find((one) => one.entity?.kind === 'field' && one.entity.key === key)
  const methodProblem = problems.find(
    (one) => one.block === 'method' && one.tone === 'error' && one.code !== 'contract-refused',
  )
  const summaryProblem = problems.find((one) => one.block === 'summary')

  const asideOf = (block: EditorBlock, wrong: MessageDescriptor = m.itemsBlockFix) => {
    const counted = countsOf(problems, block)
    if (counted.errors > 0) {
      return <SectionCount tone="error">{format(wrong, { count: counted.errors })}</SectionCount>
    }
    if (counted.pending > 0) {
      return (
        <SectionCount tone="pending">{format(m.itemsBlockPending, { count: counted.pending })}</SectionCount>
      )
    }
    return undefined
  }

  return (
    <div {...stylex.props(styles.stack)}>
      <EditorSection title={format(m.itemsScoringMethod)} testId="scoring-method" block="method">
        {draft.scoring.language === 'unsupported' ? (
          <Feedback message={format(m.itemsScoringUnsupported)} />
        ) : (
          <div
            {...stylex.props(styles.methodCard, methodProblem !== undefined && styles.methodCardBad)}
            data-invalid={methodProblem === undefined ? undefined : true}
          >
            {fixed ? (
              <div {...stylex.props(styles.methodWords)}>
                <span {...stylex.props(styles.methodName)} data-testid="scoring-method-name">
                  {methodName}
                </span>
                <span {...stylex.props(styles.methodNote)}>{format(m.itemsScoringFixedNote)}</span>
                {/* the amount is the whole configuration of a fixed method,
                    so it is edited right here rather than behind a dialog */}
                <div {...stylex.props(styles.methodAmount)}>
                  <UiSlot
                    token={calculatorEditorSlot}
                    context={{
                      ...slotContext,
                      amountPer: automatic ? ('item' as const) : ('entry' as const),
                      disabled: false,
                      onChange: onCalculatorApply,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div {...stylex.props(styles.methodWords)} data-testid="scoring-method-name">
                {/* whoever owns the arithmetic says what it is */}
                <UiSlot
                  token={calculatorSummarySlot}
                  context={slotContext}
                  fallback={<span {...stylex.props(styles.methodName)}>{methodName}</span>}
                />
              </div>
            )}
            {calculators.length > 1 && (
              <button
                type="button"
                {...stylex.props(styles.methodChange)}
                onClick={() => setChoosing(true)}
              >
                {format(m.itemsScoringChange)}
                <ChevronRightIcon aria-hidden {...stylex.props(rowWords.icon12)} />
              </button>
            )}
          </div>
        )}
        {methodProblem !== undefined && (
          <p {...stylex.props(styles.problemLine)} role="alert" data-testid="method-problem">
            {problemWords(methodProblem, format)}
          </p>
        )}
        {versioned && contractState.kind === 'pending' && (
          <p {...stylex.props(styles.status)} data-testid="contract-pending">
            {format(m.itemsContractPending)}
          </p>
        )}
        {versioned && contractState.kind === 'refused' && (
          <Feedback message={format(m.itemsScoringUnreadable)} />
        )}
        {versioned && contractState.kind === 'unavailable' && (
          <Feedback message={format(m.itemsContractRetrying)} />
        )}
      </EditorSection>

      {choosing && (
        <ScoringMethodDialog
          batchId={batchId}
          itemId={itemId}
          calculators={calculators}
          chosen={chosenCalculator}
          amountPer={automatic ? 'item' : 'entry'}
          onApply={(next) => {
            onCalculatorApply(next)
            setChoosing(false)
          }}
          onClose={() => setChoosing(false)}
        />
      )}

      {versioned && contract !== null && (
        <EditorSection
          title={format(m.itemsParameters)}
          hint={review ? format(m.itemsParametersHint) : undefined}
          aside={asideOf('parameters', m.itemsParametersWrong)}
          testId="scoring-parameters"
          block="parameters"
        >
          <ListCard>
            <ListHead
              layout="values"
              columns={[
                format(m.itemsColumnParameter),
                format(m.itemsColumnTypeRange),
                format(automatic ? m.itemsColumnValue : m.itemsColumnSource),
              ]}
            />
            {parameters.length === 0 && <EmptyRow>{format(m.itemsParametersNone)}</EmptyRow>}
            {parameters.map((parameter) => {
              const schema = parameterSchemaOf(contract, parameter)!
              const binding =
                draft.scoring.language === 'v2' ? draft.scoring.bindings[parameter] : undefined
              const problem = parameterProblem(parameter)
              return (
                <ListRow
                  key={parameter}
                  layout="values"
                  name={parameterTitle(contract, parameter, locale)}
                  // what the parameter IS is said under its name: it
                  // describes the parameter, never the value typed beside it
                  description={parameterDescription(contract, parameter, locale)}
                  takes={
                    <TakesCell
                      wrap
                      kind={kindWords(schema, format)}
                      separator={separator}
                      {...takesOf(schema, locale, format)}
                    />
                  }
                  third={
                    <ParameterSource
                      parameter={parameter}
                      schema={schema}
                      binding={binding}
                      mode={draft.mode}
                      locale={locale}
                      words={words}
                      problem={problem}
                      onSource={(source) => onSource(parameter, source)}
                      onConstant={(next) => onConstant(parameter, next)}
                    />
                  }
                  testId="parameter-row"
                  data={{
                    'parameter-row': parameter,
                    source: binding === undefined ? 'unset' : binding.kind,
                    problem: problem?.code,
                  }}
                />
              )
            })}
          </ListCard>
        </EditorSection>
      )}

      {review && versioned && contract !== null && (
        <EditorSection
          title={format(m.itemsRecognitions)}
          hint={format(m.itemsRecognitionsHint)}
          aside={asideOf('recognitions')}
          testId="scoring-recognitions"
          block="recognitions"
        >
          <ListCard>
            <ListHead
              columns={[
                format(m.itemsColumnField),
                format(m.itemsColumnRange),
                format(m.itemsColumnLinkedField),
              ]}
            />
            {recognitionRows(draft, contract).length === 0 && (
              <EmptyRow>{format(m.itemsRecognitionsEmpty)}</EmptyRow>
            )}
            {recognitionRows(draft, contract).map(({ parameter, handle, recognition }) => {
              const schema = parameterSchemaOf(contract, parameter)!
              const admitted = admittedSchemaOf(recognition, schema)
              const field = draft.fields.find((one) => one.id === recognition.fieldId)
              const problem = recognitionProblem(handle)
              // a choice narrowed says how far, as kept over offered: the
              // names may be cut short, the count never is
              const offered = kindOf(schema) === 'choice' ? (schema as ChoiceSchema).enum.length : 0
              const kept = kindOf(admitted) === 'choice' ? (admitted as ChoiceSchema).enum.length : 0
              const unnamed = recognition.label.trim() === ''
              return (
                <ListRow
                  key={handle}
                  name={unnamed ? format(m.itemsFieldUnnamed) : recognition.label}
                  unnamed={unnamed}
                  takes={
                    <TakesCell
                      kind={kindWords(admitted, format)}
                      separator={separator}
                      {...takesOf(admitted, locale, format)}
                      count={
                        offered > 0 && kept < offered
                          ? format(m.itemsNarrowedCount, { kept, total: offered })
                          : undefined
                      }
                    />
                  }
                  third={
                    field === undefined ? (
                      <span {...stylex.props(styles.unlinked)} title={format(m.itemsUnlinkedRow)}>
                        {format(m.itemsUnlinkedRow)}
                      </span>
                    ) : (
                      <span {...stylex.props(styles.linkedLine)}>
                        {/* the field's own name: what a participant is
                            asked and what a reviewer determines may be
                            worded differently */}
                        <span
                          {...stylex.props(styles.linkedName)}
                          title={field.label}
                          data-testid="linked-field-name"
                        >
                          {field.label.trim() === '' ? format(m.itemsFieldUnnamed) : field.label}
                        </span>
                        <span {...stylex.props(styles.linkedNote)}>{format(m.itemsLinked)}</span>
                      </span>
                    )
                  }
                  problem={problem === undefined ? undefined : problemWords(problem, format)}
                  onOpen={() => onOpenRecognition(handle)}
                  testId="recognition-row"
                  data={{ handle, linked: field !== undefined, problem: problem?.code }}
                />
              )
            })}
          </ListCard>
        </EditorSection>
      )}

      {!automatic && (
        <EditorSection
          title={format(m.itemsForm)}
          hint={format(m.itemsFormHint)}
          aside={asideOf('form')}
          testId="scoring-form"
          block="form"
        >
          <ListCard>
            <ListHead
              layout="drag"
              columns={[
                format(m.itemsColumnField),
                format(m.itemsColumnTypeRange),
                format(m.itemsColumnRequirement),
              ]}
            />
            {draft.fields.length === 0 && (
              <EmptyRow testId="form-empty">{format(m.itemsFormNone)}</EmptyRow>
            )}
            <FormRows
              draft={draft}
              contract={contract}
              locale={locale}
              problemOf={fieldProblem}
              onOpenField={onOpenField}
              onReorder={onReorderFields}
            />
            <FooterAction
              icon={<PlusIcon aria-hidden {...stylex.props(rowWords.icon14)} />}
              label={format(m.itemsFieldAdd)}
              onClick={onAddField}
            />
          </ListCard>
        </EditorSection>
      )}

      {!automatic && (
        <SummarySection
          candidates={draft.fields.map((field) => ({
            id: field.id,
            name: field.label.trim() === '' ? format(m.itemsFieldUnnamed) : field.label,
            type: field.type,
          }))}
          elected={draft.summaryFieldIds}
          problem={summaryProblem === undefined ? undefined : problemWords(summaryProblem, format)}
          onChange={onSummary}
        />
      )}

      {automatic && (
        <div {...stylex.props(styles.note)} data-testid="automatic-note">
          <InfoIcon aria-hidden {...stylex.props(styles.noteIcon)} />
          <span>
            {sentences(
              [
                format(m.itemsAutomaticNote),
                fixed && draft.fixedValue.trim() !== ''
                  ? format(m.itemsAutomaticResult, { value: trimAmount(draft.fixedValue.trim()) })
                  : '',
                placement.sections[0] !== undefined && placement.sections[0].cap !== null
                  ? format(m.itemsAutomaticCap, {
                      group: placement.sections[0].name,
                      cap: trimAmount(placement.sections[0].cap),
                    })
                  : '',
              ],
              locale,
            )}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * What feeds one parameter, chosen in the row itself: how the value is come
 * by, and - for a fixed one - the value, on one line. What is wrong with it
 * is one red line underneath, and nothing else about the row changes.
 */
function ParameterSource({
  parameter,
  schema,
  binding,
  mode,
  locale,
  words,
  problem,
  onSource,
  onConstant,
}: {
  parameter: string
  schema: AtomicSchema
  binding: BindingDraft | undefined
  mode: Draft['mode']
  locale: string
  words: ReturnType<typeof usePickerWords>
  problem: EditorProblem | undefined
  onSource: (source: 'recognition' | 'constant' | 'filed') => void
  onConstant: (draft: ValueDraft) => void
}) {
  const { format } = useI18n()
  const wrong = problem !== undefined && problem.tone === 'error'
  const valueWrong = wrong && problem.code.startsWith('constant-')
  const constantSeat =
    binding?.kind === 'constant' ? (
      <ConstantValue
        parameter={parameter}
        schema={schema}
        typed={binding.draft ?? draftFromValue(schema, binding.value)}
        invalid={valueWrong}
        locale={locale}
        words={words}
        onChange={onConstant}
      />
    ) : null
  const line = wrong ? (
    <span {...stylex.props(styles.problemLine)} role="alert" data-testid="parameter-problem">
      {problemWords(problem, format)}
    </span>
  ) : null
  if (mode === 'automatic') {
    // no choosing under automatic scoring: every parameter is a fixed value,
    // and a leftover determination is said as a problem, not as a control
    return (
      <div {...stylex.props(styles.valueColumn)}>
        {constantSeat !== null && <div {...stylex.props(styles.valueLine)}>{constantSeat}</div>}
        {line}
      </div>
    )
  }
  const chosen =
    binding === undefined
      ? ''
      : binding.kind === 'constant'
        ? 'constant'
        : mode === 'direct'
          ? 'filed'
          : 'recognition'
  return (
    <div {...stylex.props(styles.valueColumn)}>
      <div {...stylex.props(styles.valueLine)}>
        <Choice
          aria-label={format(m.itemsColumnSource)}
          value={chosen}
          placeholder={words.unanswered}
          invalid={wrong && !valueWrong}
          xstyle={mode === 'direct' ? styles.sourcePickWide : styles.sourcePick}
          options={[
            mode === 'direct'
              ? { value: 'filed', label: format(m.itemsSourceFiled) }
              : { value: 'recognition', label: format(m.itemsSourceRecognition) },
            { value: 'constant', label: format(m.itemsSourceConstant) },
          ]}
          onChange={(next) => onSource(next as 'recognition' | 'constant' | 'filed')}
        />
        {constantSeat}
        {/* a row that only waits is not tinted: the placeholder and these
            amber words are the whole of it */}
        {problem !== undefined && problem.tone === 'pending' && (
          <span {...stylex.props(styles.pendingLine)} data-testid="parameter-pending">
            <span aria-hidden {...stylex.props(styles.pendingDot)} />
            {format(m.itemsSourceUnset)}
          </span>
        )}
      </div>
      {line}
    </div>
  )
}

/** the fixed value itself: a number in the fixed-width face, a choice, a date, or yes and no */
function ConstantValue({
  parameter,
  schema,
  typed,
  invalid,
  locale,
  words,
  onChange,
}: {
  parameter: string
  schema: AtomicSchema
  typed: ValueDraft | undefined
  invalid: boolean
  locale: string
  words: ReturnType<typeof usePickerWords>
  onChange: (draft: ValueDraft) => void
}) {
  const { format } = useI18n()
  const kind = kindOf(schema)
  const label = parameterTitle(null, parameter, locale)
  if (kind === 'boolean') {
    const answers = [
      { value: false, label: format(m.itemsNo) },
      { value: true, label: format(m.itemsYes) },
    ] as const
    return (
      <span
        role="radiogroup"
        aria-label={label}
        data-testid="parameter-value"
        {...stylex.props(styles.segments, invalid && styles.segmentsBad)}
      >
        {answers.map((answer) => (
          <button
            key={String(answer.value)}
            type="button"
            role="radio"
            aria-checked={typed === answer.value}
            {...stylex.props(styles.segment, typed === answer.value && styles.segmentOn)}
            onClick={() => onChange(answer.value)}
          >
            {answer.label}
          </button>
        ))}
      </span>
    )
  }
  if (kind === 'choice') {
    const choice = schema as ChoiceSchema
    return (
      <span {...stylex.props(styles.valueSeat)} data-testid="parameter-value">
        <Choice
          aria-label={label}
          value={typeof typed === 'string' ? typed : ''}
          placeholder={words.unanswered}
          invalid={invalid}
          xstyle={styles.valueControl}
          options={choice.enum.map((value) => ({ value, label: choiceLabel(choice, value, locale) }))}
          onChange={(next) => onChange(next)}
        />
      </span>
    )
  }
  if (kind === 'date') {
    return (
      <span {...stylex.props(styles.valueSeat, invalid && styles.dateBad)} data-testid="parameter-value">
        <DatePicker
          value={typeof typed === 'string' && typed !== '' ? typed : null}
          placeholder={words.unanswered}
          clearLabel={words.clear}
          localeTag={locale}
          monthLabel={words.month}
          yearLabel={words.year}
          onChange={(next) => onChange(next ?? '')}
        />
      </span>
    )
  }
  return (
    <span {...stylex.props(styles.valueSeat)} data-testid="parameter-value">
      <Input
        aria-label={label}
        aria-invalid={invalid || undefined}
        wrapperXstyle={styles.valueControl}
        className={stylex.props(kind === 'text' ? null : styles.valueMono).className}
        value={typeof typed === 'string' ? typed : typed === undefined ? '' : String(typed)}
        inputMode={kind === 'integer' ? 'numeric' : kind === 'decimal' ? 'decimal' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  )
}

/** the submission form's rows, reordered by dragging their handles */
function FormRows({
  draft,
  contract,
  locale,
  problemOf,
  onOpenField,
  onReorder,
}: {
  draft: Draft
  contract: Contract | null
  locale: string
  problemOf: (key: string) => EditorProblem | undefined
  onOpenField: (key: string) => void
  onReorder: (orderedKeys: readonly string[]) => void
}) {
  const { format } = useI18n()
  const [held, setHeld] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ key: string; edge: 'before' | 'after' } | null>(null)
  const separator = format(m.listSeparator)
  const edgeOf = (event: React.DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY < box.top + box.height / 2 ? ('before' as const) : ('after' as const)
  }
  const move = (dragged: string, target: string, edge: 'before' | 'after') => {
    if (dragged === target) return
    const order = draft.fields.map((one) => one.key).filter((key) => key !== dragged)
    const at = order.indexOf(target)
    order.splice(edge === 'before' ? at : at + 1, 0, dragged)
    onReorder(order)
  }
  return (
    <>
      {draft.fields.map((field) => {
        const link = linkOf(draft, contract, field.id)
        const parameter = link === undefined ? undefined : parameterSchemaOf(contract, link.parameter)
        const admitted =
          link === undefined || parameter === undefined
            ? null
            : admittedSchemaOf(link.recognition, parameter)
        const unnamed = field.label.trim() === ''
        const required = field.required || (link !== undefined && draft.mode === 'direct')
        const problem = problemOf(field.key)
        return (
          <ListRow
            key={field.key}
            layout="drag"
            // the field's own name, linked or not: the determination it
            // feeds is named on its own row
            name={unnamed ? format(m.itemsFieldUnnamed) : field.label}
            unnamed={unnamed}
            tag={
              link === undefined ? undefined : (
                <Tag testId="field-link-tag">
                  {format(draft.mode === 'direct' ? m.itemsParameterTag : m.itemsLinkedTag)}
                </Tag>
              )
            }
            takes={
              admitted === null ? (
                <TakesCell
                  kind={format(TYPE_LABEL[field.type])}
                  separator={separator}
                  {...fieldTakesOf(field, format)}
                />
              ) : (
                <TakesCell
                  kind={kindWords(admitted, format)}
                  separator={separator}
                  {...takesOf(admitted, locale, format)}
                />
              )
            }
            third={
              <span {...stylex.props(required ? styles.required : styles.optional)}>
                {format(required ? m.itemsFieldRequired : m.itemsOptional)}
              </span>
            }
            problem={problem === undefined ? undefined : problemWords(problem, format)}
            handle={<DragHandle onPress={() => setHeld(field.key)} onRelease={() => setHeld(null)} />}
            onOpen={() => onOpenField(field.key)}
            lifted={held === field.key}
            mark={drop?.key === field.key ? drop.edge : null}
            testId="form-field-row"
            data={{
              key: field.key,
              linked: link !== undefined,
              required: field.required,
              problem: problem?.code,
            }}
            dragProps={{
              draggable: held === field.key,
              onDragStart: (event) => {
                event.dataTransfer.setData('qualy/form-field', field.key)
                event.dataTransfer.effectAllowed = 'move'
              },
              onDragEnd: () => {
                setHeld(null)
                setDrop(null)
              },
              onDragOver: (event) => {
                if (!event.dataTransfer.types.includes('qualy/form-field')) return
                event.preventDefault()
                setDrop({ key: field.key, edge: edgeOf(event) })
              },
              onDragLeave: () => setDrop((mark) => (mark?.key === field.key ? null : mark)),
              onDrop: (event) => {
                event.preventDefault()
                setDrop(null)
                const dragged = event.dataTransfer.getData('qualy/form-field')
                if (dragged !== '') move(dragged, field.key, edgeOf(event))
              },
            }}
          />
        )
      })}
    </>
  )
}
