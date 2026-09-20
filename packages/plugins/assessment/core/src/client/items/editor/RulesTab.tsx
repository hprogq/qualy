import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import type { MessageDescriptor, UiText } from '@qualy/i18n-contract'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { assessmentApi } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { amountOf, trimAmount, unitsOf } from '../../entry/model.ts'
import { Choice } from '../Choice.tsx'
import type { ItemOptions } from '../options.ts'
import type { Placement } from '../paper.ts'
import type { StageDraft } from '../StageSheet.tsx'
import { countedEntries, type Folding } from '../structure.ts'
import { EditorSection } from './Rows.tsx'
import { foldingOf, type Draft } from './model.ts'

// How many records one person may hold, how they fold into a score, and the
// steps a submission walks. The chain is a list read top to bottom, one step
// under another, with the place to add one between any two.

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 32 },
  controls: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 },
  w208: { width: 208 },
  w112: { width: 112 },
  w240: { width: 240 },
  w96: { width: 96 },
  fullWidth: { width: '100%' },
  inlineRow: { display: 'flex', alignItems: 'center', gap: 10 },
  anyLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  tabular: { fontVariantNumeric: 'tabular-nums' },
  band: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 14,
    paddingBlock: 12,
  },
  bandCell: { display: 'flex', flexShrink: 0, flexDirection: 'column', gap: 2 },
  bandLabel: { fontSize: 12, whiteSpace: 'nowrap', color: tokens.mutedForeground },
  bandValue: { fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  divider: { height: 28, width: 1, backgroundColor: tokens.border },
  prose: { fontSize: 12, lineHeight: 1.625, color: tokens.mutedForeground },
  note: { margin: 0, fontSize: 13, color: tokens.mutedForeground },
  chain: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 14,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
    overflow: 'hidden',
  },
  endRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingInline: 16,
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  endMark: {
    display: 'flex',
    width: 24,
    height: 24,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    color: tokens.mutedForeground,
  },
  startDot: { width: 6, height: 6, borderRadius: '9999px', backgroundColor: tokens.mutedForeground },
  gap: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    height: 28,
    paddingInline: 16,
  },
  gapLine: { width: 1, height: '100%', marginInline: 11.5, backgroundColor: tokens.border },
  gapAdd: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 24,
    paddingInline: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: { default: tokens.border, ':hover': tokens.foreground },
    backgroundColor: tokens.background,
    fontFamily: 'inherit',
    fontSize: 12,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  stepMark: {
    display: 'flex',
    width: 24,
    height: 24,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    fontSize: 12,
    fontWeight: 500,
  },
  stepMarkDone: { backgroundColor: tokens.foreground, color: tokens.background },
  stepMarkUnset: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `color-mix(in oklab, ${tokens.danger} 60%, transparent)`,
    color: tokens.danger,
  },
  stepBody: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 4 },
  stepName: {
    minWidth: 0,
    textAlign: 'left',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    color: 'inherit',
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: 'pointer',
    overflowWrap: 'break-word',
    textUnderlineOffset: 4,
    textDecorationLine: { default: 'none', ':hover': 'underline' },
  },
  stepNameBad: { color: tokens.danger },
  stepWho: { fontSize: 12, overflowWrap: 'break-word', color: tokens.mutedForeground },
  coverageOk: { fontSize: 12, color: tokens.mutedForeground },
  coverageBad: { fontSize: 12, color: tokens.danger },
  stepControls: { display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 },
  mutedControl: { color: tokens.mutedForeground },
  inlineFlex: { display: 'inline-flex' },
  icon12: { width: 12, height: 12 },
})

export function RulesTab({
  draft,
  batchId,
  options,
  placement,
  method,
  onPatch,
  onOpenStage,
  onAddStage,
  onMoveStage,
  onRemoveStage,
}: {
  draft: Draft
  batchId: string
  options: ItemOptions
  placement: Placement
  method: { ref: string; label: UiText | null }
  onPatch: (next: Partial<Draft>) => void
  onOpenStage: (key: string) => void
  onAddStage: (chain: 'normal' | 'escalation', at: number) => void
  onMoveStage: (key: string, delta: -1 | 1) => void
  onRemoveStage: (key: string) => void
}) {
  const { format } = useI18n()
  const entries = draft.maxEntries.trim() === '' ? null : Number(draft.maxEntries)
  const each = Number(draft.fixedValue.trim())
  const counted = countedEntries(foldingOf(draft), entries)
  const ceiling =
    counted === null || !Number.isFinite(each) ? null : amountOf(unitsOf(draft.fixedValue.trim()) * counted)
  const normal = draft.stages.filter((one) => one.chain === 'normal')
  const escalation = draft.stages.filter((one) => one.chain === 'escalation')

  return (
    <div {...stylex.props(styles.stack)}>
      <EditorSection title={format(m.itemsRulesCounts)} testId="rules-counts">
        <div {...stylex.props(styles.controls)}>
          <div {...stylex.props(styles.w240)}>
            <Field label={format(m.itemsFieldMax)}>
              {(id) => (
                <div {...stylex.props(styles.inlineRow)}>
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    className={stylex.props(styles.w96, styles.tabular).className}
                    disabled={entries === null}
                    value={draft.maxEntries}
                    onChange={(event) => onPatch({ maxEntries: event.target.value })}
                  />
                  <label {...stylex.props(styles.anyLabel)}>
                    <Checkbox
                      checked={entries === null}
                      onCheckedChange={(next) => onPatch({ maxEntries: next === true ? '' : '1' })}
                    />
                    {format(m.itemsMaxEntriesAny)}
                  </label>
                </div>
              )}
            </Field>
          </div>
          <div {...stylex.props(styles.w208)}>
            <Field label={format(m.itemsFolding)} hint={format(m.itemsFoldingHint)}>
              {(id) => (
                <Choice
                  id={id}
                  xstyle={styles.fullWidth}
                  value={draft.folding}
                  disabled={draft.scoring.language === 'unsupported'}
                  options={[
                    { value: 'sum', label: format(m.itemsFoldingSum), description: format(m.itemsFoldingSumHint) },
                    { value: 'max', label: format(m.itemsFoldingMax), description: format(m.itemsFoldingMaxHint) },
                    {
                      value: 'top-n',
                      label: format(m.itemsFoldingTopN),
                      description: format(m.itemsFoldingTopNHint),
                    },
                  ]}
                  onChange={(next) => onPatch({ folding: next as Draft['folding'] })}
                />
              )}
            </Field>
          </div>
          {draft.folding === 'top-n' && (
            <div {...stylex.props(styles.w112)}>
              <Field label={format(m.itemsFoldingN)}>
                {(id) => (
                  <Input
                    id={id}
                    className={stylex.props(styles.tabular).className}
                    value={draft.topN}
                    onChange={(event) => onPatch({ topN: event.target.value })}
                  />
                )}
              </Field>
            </div>
          )}
        </div>
        <ScoringSummary
          ceiling={ceiling}
          counted={counted}
          folding={foldingOf(draft)}
          each={draft.fixedValue}
          method={method}
          placement={placement}
        />
      </EditorSection>

      {draft.mode === 'review' ? (
        <>
          <EditorSection
            title={format(m.itemsReviewChain)}
            hint={format(m.itemsReviewChainHint)}
            testId="review-chain"
          >
            <StepList
              batchId={batchId}
              chain="normal"
              steps={normal}
              options={options}
              onOpen={onOpenStage}
              onAdd={(at) => onAddStage('normal', at)}
              onMove={onMoveStage}
              onRemove={onRemoveStage}
            />
          </EditorSection>
          <EditorSection
            title={format(m.itemsEscalationTitle)}
            hint={format(escalation.length === 0 ? m.itemsEscalationEmpty : m.itemsEscalationHint)}
            testId="escalation-chain"
          >
            <StepList
              batchId={batchId}
              chain="escalation"
              steps={escalation}
              options={options}
              onOpen={onOpenStage}
              onAdd={(at) => onAddStage('escalation', at)}
              onMove={onMoveStage}
              onRemove={onRemoveStage}
            />
          </EditorSection>
        </>
      ) : (
        <EditorSection title={format(m.itemsReviewChain)} testId="review-chain">
          <p {...stylex.props(styles.note)}>{format(m.itemsDirectNote)}</p>
        </EditorSection>
      )}
    </div>
  )
}

/** the arithmetic behind the number, so nobody has to reconstruct it */
function ScoringSummary({
  ceiling,
  counted,
  folding,
  each,
  method,
  placement,
}: {
  ceiling: string | null
  counted: number | null
  folding: Folding
  each: string
  method: { ref: string; label: UiText | null }
  placement: Placement
}) {
  const { format, formatText } = useI18n()
  const perEntryAmount = method.ref === 'fixed@1'
  const methodName =
    method.label === null ? format(m.itemsScoringMethodFixed) : formatText(method.label)
  const chain = placement.sections
    .map((section) =>
      section.cap === null
        ? format(m.itemsCeilingSectionFree, { name: section.name })
        : format(m.itemsCeilingSectionCapped, { name: section.name, value: trimAmount(section.cap) }),
    )
    .join(format(m.listSeparator))
  return (
    <div {...stylex.props(styles.band)}>
      <div {...stylex.props(styles.bandCell)}>
        <p {...stylex.props(styles.bandLabel)}>{format(m.itemsCeiling)}</p>
        <p
          {...stylex.props(styles.bandValue)}
          data-testid="item-ceiling"
          data-ceiling={!perEntryAmount ? 'by-rule' : (ceiling ?? 'unlimited')}
        >
          {!perEntryAmount
            ? format(m.itemsCeilingByRule)
            : ceiling === null
              ? format(m.structureUnlimited)
              : ceiling}
        </p>
      </div>
      <div aria-hidden {...stylex.props(styles.divider)} />
      <p {...stylex.props(styles.prose)}>
        {!perEntryAmount
          ? format(m.itemsCeilingHowRule, { name: methodName })
          : folding.rule === 'max'
            ? format(m.itemsCeilingHowMax, { value: trimAmount(each.trim()) })
            : folding.rule === 'top-n'
              ? format(m.itemsCeilingHowTopN, { value: trimAmount(each.trim()), count: counted ?? folding.n })
              : counted === null
                ? format(m.itemsCeilingHowAny)
                : format(m.itemsCeilingHow, { value: trimAmount(each.trim()), count: counted })}
        {` ${format(m.itemsCeilingSource, { name: methodName })}`}
        {chain !== '' && ` ${format(m.itemsCeilingNote, { chain })}`}
      </p>
    </div>
  )
}

/**
 * One route, read top to bottom: where a submission enters, every step it
 * passes, where it leaves. The place to add a step sits between any two,
 * always on show: somebody who does not yet know where steps come from
 * cannot know where to hover.
 */
function StepList({
  batchId,
  chain,
  steps,
  options,
  onOpen,
  onAdd,
  onMove,
  onRemove,
}: {
  batchId: string
  chain: 'normal' | 'escalation'
  steps: readonly StageDraft[]
  options: ItemOptions
  onOpen: (key: string) => void
  onAdd: (at: number) => void
  onMove: (key: string, delta: -1 | 1) => void
  onRemove: (key: string) => void
}) {
  const { format } = useI18n()
  const addLabel = format(chain === 'normal' ? m.itemsStageAdd : m.itemsEscalationAddStep)
  return (
    <div {...stylex.props(styles.chain)} data-testid={`chain-${chain}`}>
      <div {...stylex.props(styles.endRow)}>
        <span {...stylex.props(styles.endMark)}>
          <span aria-hidden {...stylex.props(styles.startDot)} />
        </span>
        <span>
          {format(chain === 'normal' ? m.itemsFlowSubmit : m.itemsEscalated)}
          {' '}
          {format(chain === 'normal' ? m.itemsFlowSubmitBy : m.itemsEscalationBy)}
        </span>
      </div>
      {steps.map((step, index) => (
        <div key={step.key}>
          <Gap label={addLabel} onAdd={() => onAdd(index)} />
          <StepRow
            batchId={batchId}
            stage={step}
            index={index}
            options={options}
            removable={chain === 'escalation' || steps.length > 1}
            atStart={index === 0}
            atEnd={index === steps.length - 1}
            onOpen={() => onOpen(step.key)}
            onMove={(delta) => onMove(step.key, delta)}
            onRemove={() => onRemove(step.key)}
          />
        </div>
      ))}
      <Gap label={addLabel} onAdd={() => onAdd(steps.length)} />
      <div {...stylex.props(styles.endRow)}>
        <span {...stylex.props(styles.endMark)}>
          <CheckIcon aria-hidden {...stylex.props(styles.icon12)} />
        </span>
        <span>
          {format(chain === 'normal' ? m.itemsFlowDone : m.itemsEscalationSettled)}
          {' '}
          {format(chain === 'normal' ? m.itemsFlowDoneSub : m.itemsEscalationSettledSub)}
        </span>
      </div>
    </div>
  )
}

function Gap({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div {...stylex.props(styles.gap)}>
      <span aria-hidden {...stylex.props(styles.gapLine)} />
      <button type="button" aria-label={label} title={label} {...stylex.props(styles.gapAdd)} onClick={onAdd}>
        <PlusIcon aria-hidden {...stylex.props(styles.icon12)} />
        {label}
      </button>
    </div>
  )
}

function StepRow({
  batchId,
  stage,
  index,
  options,
  removable,
  atStart,
  atEnd,
  onOpen,
  onMove,
  onRemove,
}: {
  batchId: string
  stage: StageDraft
  index: number
  options: ItemOptions
  removable: boolean
  atStart: boolean
  atEnd: boolean
  onOpen: () => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const { format } = useI18n()
  const settled = settledStage(stage, options)
  const named = stage.label.trim() !== ''
  return (
    <div
      {...stylex.props(styles.step)}
      data-testid="chain-step"
      data-stage-key={stage.key}
      data-step-complete={named && settled}
    >
      <span {...stylex.props(styles.stepMark, named && settled ? styles.stepMarkDone : styles.stepMarkUnset)}>
        {index + 1}
      </span>
      <div {...stylex.props(styles.stepBody)}>
        <button
          type="button"
          {...stylex.props(styles.stepName, (!named || !settled) && styles.stepNameBad)}
          onClick={onOpen}
        >
          {named ? stage.label.trim() : format(m.itemsStageUnnamed)}
        </button>
        {settled && <p {...stylex.props(styles.stepWho)}>{whoReviews(stage, options, format)}</p>}
        {settled ? (
          <StageCoverage batchId={batchId} stage={stage} />
        ) : (
          <p {...stylex.props(styles.coverageOk)}>{format(m.itemsStageUnsetHint)}</p>
        )}
      </div>
      <span {...stylex.props(styles.stepControls)}>
        <Button
          variant="ghost"
          size="icon-xs"
          className={stylex.props(styles.mutedControl).className}
          disabled={atStart}
          onClick={() => onMove(-1)}
          aria-label={format(m.itemsStageMoveEarlier)}
        >
          <ChevronUpIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={stylex.props(styles.mutedControl).className}
          disabled={atEnd}
          onClick={() => onMove(1)}
          aria-label={format(m.itemsStageMoveLater)}
        >
          <ChevronDownIcon aria-hidden />
        </Button>
        {removable ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className={stylex.props(styles.mutedControl).className}
            onClick={onRemove}
            aria-label={format(m.itemsStageRemove)}
          >
            <XIcon aria-hidden />
            <VisuallyHidden>{format(m.itemsStageRemove)}</VisuallyHidden>
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span {...stylex.props(styles.inlineFlex)}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={stylex.props(styles.mutedControl).className}
                    disabled
                    aria-label={format(m.itemsStageRemove)}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{format(m.itemsStageKeepOne)}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
    </div>
  )
}

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

function StageCoverage({ batchId, stage }: { batchId: string; stage: StageDraft }) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const roleIds = stage.kind === 'roleAt' ? stage.roleIds : [stage.roleId]
  const coverage = useQuery({
    ...query.assessment.reviewCoverage.queryOptions({
      params: { batchId },
      query: { nodeTypeId: stage.nodeTypeId, roleIds },
    }),
    enabled: stage.kind === 'roleAt' && stage.nodeTypeId !== '' && roleIds.length > 0,
  })
  if (coverage.data === undefined) return null
  const uncovered = coverage.data.nodes.filter((node) => node.reviewers === 0)
  return (
    <p {...stylex.props(uncovered.length > 0 ? styles.coverageBad : styles.coverageOk)}>
      {coverage.data.nodes.length === 0
        ? format(m.itemsReviewNoUnits)
        : uncovered.length === 0
          ? format(m.itemsReviewCovered, { count: coverage.data.nodes.length })
          : format(m.itemsReviewUncoveredCount, { count: uncovered.length })}
    </p>
  )
}
