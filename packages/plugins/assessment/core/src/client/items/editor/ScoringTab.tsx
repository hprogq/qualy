import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, InfoIcon, PlusIcon } from 'lucide-react'
import { UiSlot } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { inputOrder, type AtomicSchema } from '@qualy/value-schema'
import { AtomicValueField } from '@qualy/web-value-form/InputValueForm'
import { draftFromValue, type FieldDraft as ValueDraft } from '@qualy/web-value-form/model'
import type { UiText } from '@qualy/i18n-contract'
import { Feedback } from '@qualy/ui/admin'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { calculatorEditorSlot } from '../../../surfaces.ts'
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
  PendingMark,
  Tag,
} from './Rows.tsx'
import { rowWords } from './shared-styles.ts'
import {
  admittedSchemaOf,
  linkOf,
  parameterSchemaOf,
  parameterTitle,
  recognitionRows,
  type BindingDraft,
  type Contract,
  type Draft,
  type EditorProblem,
} from './model.ts'
import { TYPE_LABEL, boundsWords, fieldBoundsWords, kindWords } from './words.ts'

// The arithmetic and the form it is fed from, as three lists under one
// method: what the formula takes, what a reviewer determines, what a
// participant fills in. Under "takes effect on submission" the middle list
// folds into the third, and under automatic scoring only the first is left.

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 32 },
  methodCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 12,
    borderRadius: 12,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  methodRow: { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 },
  methodName: { flexGrow: 1, minWidth: 0, fontSize: 14, fontWeight: 500 },
  methodPick: { width: 208, flexShrink: 0 },
  status: { fontSize: 13, color: tokens.mutedForeground },
  sourceCell: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' },
  sourcePick: { width: 132, flexShrink: 0 },
  sourcePickUnset: {
    width: 132,
    flexShrink: 0,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.warning} 70%, transparent)`,
    borderRadius: tokens.radiusMd,
  },
  valueSeat: { minWidth: 0, flexGrow: 1, maxWidth: 220 },
  summary: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingInline: 16,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: tokens.surfaceInset,
  },
  summaryHead: { display: 'flex', alignItems: 'center', gap: 8 },
  summaryTitle: { fontSize: 13, fontWeight: 600 },
  spacer: { flexGrow: 1 },
  linkButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 500,
    color: tokens.foreground,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: 'pointer',
  },
  summaryLine: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' },
  summaryName: { fontWeight: 500 },
  summarySlash: { color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)` },
  summaryHint: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  note: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: tokens.foreground },
  noteIcon: { width: 15, height: 15, flexShrink: 0, color: tokens.mutedForeground },
  requirement: { fontSize: 13 },
  linkedName: { fontWeight: 500 },
})

export type ContractState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'refused' }
  | { kind: 'unavailable' }
  | { kind: 'ready' }

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
  onCalculatorPicked,
  onCalculatorChange,
  onSource,
  onConstant,
  onOpenRecognition,
  onOpenField,
  onAddField,
  onReorderFields,
  onOpenSummary,
}: {
  draft: Draft
  batchId: string
  itemId: string | null
  contract: Contract | null
  contractState: ContractState
  calculators: readonly { ref: string; label: UiText }[]
  chosenCalculator: { ref: string; config: unknown }
  placement: Placement
  problems: readonly EditorProblem[]
  onCalculatorPicked: (ref: string) => void
  onCalculatorChange: (next: { ref: string; config: unknown }) => void
  /** what feeds a parameter: a determination, a fixed value, or the form itself */
  onSource: (parameter: string, source: 'recognition' | 'constant' | 'filed') => void
  onConstant: (parameter: string, draft: ValueDraft) => void
  onOpenRecognition: (handle: string) => void
  onOpenField: (key: string) => void
  onAddField: () => void
  onReorderFields: (orderedKeys: readonly string[]) => void
  onOpenSummary: () => void
}) {
  const { format, formatText, locale } = useI18n()
  const listJoin = useList()
  const words = usePickerWords()
  const automatic = draft.mode === 'automatic'
  const review = draft.mode === 'review'
  const versioned = draft.scoring.language === 'v2'
  const parameters = contract === null ? [] : inputOrder(contract.inputSchema)
  const chosenLabel = calculators.find((one) => one.ref === chosenCalculator.ref)?.label
  const methodName =
    chosenLabel === undefined ? format(m.itemsCalculatorFixed) : formatText(chosenLabel)
  const problemOf = (parameter: string) =>
    problems.find((one) => one.entity?.kind === 'parameter' && one.entity.parameter === parameter)

  return (
    <div {...stylex.props(styles.stack)}>
      <EditorSection title={format(m.itemsScoringMethod)} testId="scoring-method">
        <div {...stylex.props(styles.methodCard)}>
          <div {...stylex.props(styles.methodRow)}>
            <span {...stylex.props(styles.methodName)} data-testid="scoring-method-name">
              {methodName}
            </span>
            {calculators.length > 1 && draft.scoring.language !== 'unsupported' && (
              <div {...stylex.props(styles.methodPick)}>
                <Choice
                  value={chosenCalculator.ref}
                  options={calculators.map((option) => ({
                    value: option.ref,
                    label: formatText(option.label),
                  }))}
                  onChange={onCalculatorPicked}
                />
              </div>
            )}
          </div>
          {draft.scoring.language === 'unsupported' ? (
            <Feedback message={format(m.itemsScoringUnsupported)} />
          ) : (
            <UiSlot
              token={calculatorEditorSlot}
              context={{
                batchId,
                itemId,
                calculator: chosenCalculator,
                amountPer: automatic ? ('item' as const) : ('entry' as const),
                disabled: false,
                onChange: onCalculatorChange,
              }}
            />
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
        </div>
      </EditorSection>

      {versioned && contract !== null && (
        <EditorSection
          title={format(m.itemsParameters)}
          hint={review ? format(m.itemsParametersHint) : undefined}
          testId="scoring-parameters"
        >
          <ListCard>
            <ListHead
              columns={[
                format(m.itemsColumnParameter),
                format(m.itemsColumnTypeRange),
                format(automatic ? m.itemsColumnValue : m.itemsColumnSource),
              ]}
            />
            {parameters.length === 0 && <EmptyRow>{format(m.itemsParametersNone)}</EmptyRow>}
            {parameters.map((parameter) => {
              const schema = parameterSchemaOf(contract, parameter)!
              const binding = draft.scoring.language === 'v2' ? draft.scoring.bindings[parameter] : undefined
              const problem = problemOf(parameter)
              return (
                <ListRow
                  key={parameter}
                  name={parameterTitle(contract, parameter, locale)}
                  takes={
                    <span {...stylex.props(rowWords.pair)}>
                      <span>{kindWords(schema, format)}</span>
                      <span>{boundsWords(schema, locale, format, listJoin)}</span>
                    </span>
                  }
                  third={
                    <ParameterSource
                      parameter={parameter}
                      schema={schema}
                      binding={binding}
                      mode={draft.mode}
                      locale={locale}
                      words={words}
                      unset={problem !== undefined && problem.code === 'parameter-unset'}
                      onSource={(source) => onSource(parameter, source)}
                      onConstant={(next) => onConstant(parameter, next)}
                    />
                  }
                  testId="parameter-row"
                  data={{
                    'parameter-row': parameter,
                    source: binding === undefined ? 'unset' : binding.kind,
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
          testId="scoring-recognitions"
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
              return (
                <ListRow
                  key={handle}
                  name={recognition.label.trim() === '' ? format(m.itemsFieldUnnamed) : recognition.label}
                  takes={boundsWords(admitted, locale, format, listJoin)}
                  third={
                    field === undefined ? (
                      <span {...stylex.props(rowWords.quiet)}>{format(m.itemsUnlinkedRow)}</span>
                    ) : (
                      <span {...stylex.props(rowWords.pair)}>
                        <span {...stylex.props(styles.linkedName)}>{recognition.label}</span>
                        <span {...stylex.props(rowWords.quiet)}>{format(m.itemsLinked)}</span>
                      </span>
                    )
                  }
                  onOpen={() => onOpenRecognition(handle)}
                  testId="recognition-row"
                  data={{ handle, linked: field !== undefined }}
                />
              )
            })}
          </ListCard>
        </EditorSection>
      )}

      {!automatic && (
        <EditorSection title={format(m.itemsForm)} hint={format(m.itemsFormHint)} testId="scoring-form">
          <ListCard>
            <ListHead
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
              onOpenField={onOpenField}
              onReorder={onReorderFields}
            />
            <FooterAction
              icon={<PlusIcon aria-hidden {...stylex.props(rowWords.icon14)} />}
              label={format(m.itemsFieldAdd)}
              onClick={onAddField}
            />
            <SummaryBlock draft={draft} contract={contract} onOpen={onOpenSummary} />
          </ListCard>
        </EditorSection>
      )}

      {automatic && (
        <div {...stylex.props(styles.note)} data-testid="automatic-note">
          <InfoIcon aria-hidden {...stylex.props(styles.noteIcon)} />
          <span>
            {[
              format(m.itemsAutomaticNote),
              chosenCalculator.ref === 'fixed@1' && draft.fixedValue.trim() !== ''
                ? format(m.itemsAutomaticResult, { value: trimAmount(draft.fixedValue.trim()) })
                : '',
              placement.sections[0] !== undefined && placement.sections[0].cap !== null
                ? format(m.itemsAutomaticCap, {
                    group: placement.sections[0].name,
                    cap: trimAmount(placement.sections[0].cap),
                  })
                : '',
            ]
              .filter((one) => one !== '')
              .join(' ')}
          </span>
        </div>
      )}
    </div>
  )
}

/** what feeds one parameter, chosen in the row itself */
function ParameterSource({
  parameter,
  schema,
  binding,
  mode,
  locale,
  words,
  unset,
  onSource,
  onConstant,
}: {
  parameter: string
  schema: AtomicSchema
  binding: BindingDraft | undefined
  mode: Draft['mode']
  locale: string
  words: ReturnType<typeof usePickerWords>
  unset: boolean
  onSource: (source: 'recognition' | 'constant' | 'filed') => void
  onConstant: (draft: ValueDraft) => void
}) {
  const { format } = useI18n()
  const constantSeat =
    binding?.kind === 'constant' ? (
      <div {...stylex.props(styles.valueSeat)} data-testid="parameter-value">
        <AtomicValueField
          hideLabel
          words={words}
          schema={schema}
          name={parameter}
          draft={binding.draft ?? draftFromValue(schema, binding.value)}
          locale={locale}
          label={parameterTitle(null, parameter, locale)}
          onDraft={onConstant}
        />
      </div>
    ) : null
  if (mode === 'automatic') {
    // no choosing under automatic scoring: every parameter is a fixed value,
    // and a leftover determination is said as a problem, not as a control
    return (
      <div {...stylex.props(styles.sourceCell)}>
        {binding?.kind === 'constant' ? (
          constantSeat
        ) : (
          <PendingMark>{format(m.itemsProblemRecognitionAutomatic)}</PendingMark>
        )}
      </div>
    )
  }
  const chosen = binding === undefined ? '' : binding.kind === 'constant' ? 'constant' : mode === 'direct' ? 'filed' : 'recognition'
  return (
    <div {...stylex.props(styles.sourceCell)}>
      <Choice
        value={chosen}
        placeholder={format(m.itemsSourceUnset)}
        xstyle={chosen === '' ? styles.sourcePickUnset : styles.sourcePick}
        options={[
          mode === 'direct'
            ? { value: 'filed', label: format(m.itemsSourceFiled) }
            : { value: 'recognition', label: format(m.itemsSourceRecognition) },
          { value: 'constant', label: format(m.itemsSourceConstant) },
        ]}
        onChange={(next) => onSource(next as 'recognition' | 'constant' | 'filed')}
      />
      {constantSeat}
      {unset && <PendingMark>{format(m.itemsSourceUnset)}</PendingMark>}
    </div>
  )
}

/** the submission form's rows, reordered by dragging their handles */
function FormRows({
  draft,
  contract,
  locale,
  onOpenField,
  onReorder,
}: {
  draft: Draft
  contract: Contract | null
  locale: string
  onOpenField: (key: string) => void
  onReorder: (orderedKeys: readonly string[]) => void
}) {
  const { format } = useI18n()
  const listJoin = useList()
  const [held, setHeld] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ key: string; edge: 'before' | 'after' } | null>(null)
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
        const name =
          link === undefined
            ? field.label.trim() === ''
              ? format(m.itemsFieldUnnamed)
              : field.label
            : link.recognition.label.trim() === ''
              ? format(m.itemsFieldUnnamed)
              : link.recognition.label
        return (
          <ListRow
            key={field.key}
            name={name}
            tag={
              link === undefined ? undefined : (
                <Tag testId="field-link-tag">
                  {format(draft.mode === 'direct' ? m.itemsParameterTag : m.itemsLinkedTag)}
                </Tag>
              )
            }
            takes={
              <span {...stylex.props(rowWords.pair)}>
                <span>
                  {admitted === null ? format(TYPE_LABEL[field.type]) : kindWords(admitted, format)}
                </span>
                <span>
                  {admitted === null
                    ? fieldBoundsWords(field, format, listJoin)
                    : boundsWords(admitted, locale, format, listJoin)}
                </span>
              </span>
            }
            third={
              <span {...stylex.props(styles.requirement)}>
                {format(field.required ? m.itemsFieldRequired : m.itemsOptional)}
              </span>
            }
            handle={<DragHandle onPress={() => setHeld(field.key)} onRelease={() => setHeld(null)} />}
            onOpen={() => onOpenField(field.key)}
            lifted={held === field.key}
            mark={drop?.key === field.key ? drop.edge : null}
            testId="form-field-row"
            data={{ key: field.key, linked: link !== undefined, required: field.required }}
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

/** which fields name a record in a list, said under the form they come from */
function SummaryBlock({
  draft,
  contract,
  onOpen,
}: {
  draft: Draft
  contract: Contract | null
  onOpen: () => void
}) {
  const { format } = useI18n()
  const nameOf = (id: string) => {
    const field = draft.fields.find((one) => one.id === id)
    if (field === undefined) return null
    const link = linkOf(draft, contract, field.id)
    const label = link === undefined ? field.label : link.recognition.label
    return label.trim() === '' ? format(m.itemsFieldUnnamed) : label
  }
  const chosen = draft.summaryFieldIds.map(nameOf).filter((one): one is string => one !== null)
  return (
    <div {...stylex.props(styles.summary)} data-testid="summary-block" data-custom={chosen.length > 0}>
      <div {...stylex.props(styles.summaryHead)}>
        <span {...stylex.props(styles.summaryTitle)}>{format(m.itemsSummaryBlock)}</span>
        <Tag>{format(chosen.length > 0 ? m.itemsSummaryCustom : m.itemsSummaryAuto)}</Tag>
        <span {...stylex.props(styles.spacer)} />
        <button type="button" {...stylex.props(styles.linkButton)} onClick={onOpen}>
          {format(m.itemsSummaryCustom)}
          <ChevronRightIcon aria-hidden {...stylex.props(rowWords.icon12)} />
        </button>
      </div>
      {chosen.length > 0 ? (
        <div {...stylex.props(styles.summaryLine)}>
          {chosen.map((name, index) => (
            <span key={`${index}:${name}`} {...stylex.props(styles.summaryLine)}>
              {index > 0 && <span {...stylex.props(styles.summarySlash)}>/</span>}
              <span {...stylex.props(styles.summaryName)}>{name}</span>
            </span>
          ))}
        </div>
      ) : (
        <p {...stylex.props(styles.summaryHint)}>{format(m.itemsSummaryAutoHint)}</p>
      )}
      <p {...stylex.props(styles.summaryHint)}>{format(m.itemsSummaryBlockHint)}</p>
    </div>
  )
}
