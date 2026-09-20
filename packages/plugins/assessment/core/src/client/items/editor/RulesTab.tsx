import { useQueries } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import type { UiText } from '@qualy/i18n-contract'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Input } from '@qualy/ui/input'
import { assessmentApi } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { amountOf, trimAmount, unitsOf } from '../../entry/model.ts'
import type { ItemOptions } from '../options.ts'
import type { Placement } from '../paper.ts'
import type { StageDraft } from '../StageSheet.tsx'
import { countedEntries } from '../structure.ts'
import { EditorSection, SectionCount, Tag } from './Rows.tsx'
import { foldingOf, stageSettled, type Draft, type EditorProblem } from './model.ts'
import { problemWords, sentences } from './words.ts'

// How many records one person may hold and how they fold into a score, then
// the steps a submission walks. The rules are one card of three cells - two
// to set, one that says what the two add up to. A route is a chain read top
// to bottom: where a record enters, every step it passes, where it leaves,
// strung on one line so that the order is something seen rather than read.
//
// A step is composed in its panel and only joins the chain once it is
// whole, so the chain never holds a step that cannot review anything. What
// the chain can still say is wrong about a whole step is that some unit at
// its level has nobody to do the reviewing - which is about the round's
// people, not about the step, and is said without stopping the save.

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 32 },
  rules: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr)',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  cell: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
    paddingInline: 20,
    paddingBlock: 16,
    borderRightWidth: { default: 1, [breakpoints.phone]: 0 },
    borderRightStyle: 'solid',
    borderRightColor: tokens.divider,
    borderBottomWidth: { default: 0, [breakpoints.phone]: 1 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  cellLast: {
    gap: 8,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    backgroundColor: tokens.surfaceInset,
  },
  cellLabel: { fontSize: 12.5, fontWeight: 500, color: tokens.mutedForeground },
  mono: { fontFamily: MONO, fontSize: 13 },
  radios: { display: 'flex', flexDirection: 'column', gap: 2 },
  // a choice, and to its right the number that choice asks for. Every line
  // is as tall as the box, chosen or not, so choosing moves nothing.
  choiceLine: { display: 'flex', alignItems: 'center', gap: 12, minHeight: 36, flexWrap: 'wrap' },
  amount: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  amountInput: { width: 56 },
  radioRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    minHeight: 20,
    padding: 0,
    fontFamily: 'inherit',
    fontSize: 13.5,
    textAlign: 'start',
    color: tokens.mutedForeground,
    backgroundColor: 'transparent',
    borderWidth: 0,
    cursor: 'pointer',
  },
  radioRowOn: { color: tokens.foreground },
  radioRowOff: { cursor: 'default', opacity: 0.55 },
  radio: {
    display: 'inline-flex',
    flexShrink: 0,
    width: 16,
    height: 16,
    borderRadius: '9999px',
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.foreground} 22%, transparent)`,
  },
  radioOn: { boxShadow: `inset 0 0 0 5px ${tokens.foreground}` },
  problemLine: { margin: 0, fontSize: 12, color: tokens.danger },
  ceilingValue: { fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' },
  ceilingProse: { margin: 0, fontSize: 12, lineHeight: 1.55, color: tokens.mutedForeground, textWrap: 'pretty' },
  note: { margin: 0, fontSize: 13, color: tokens.mutedForeground },
  // ---- the chain -------------------------------------------------------
  chain: {
    display: 'flex',
    flexDirection: 'column',
    paddingInline: 16,
    paddingBlock: 8,
    borderRadius: 14,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  link: { display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', columnGap: 14 },
  rail: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  // the 2px line that strings the marks together; absent under the last
  line: { flexGrow: 1, width: 2, backgroundColor: tokens.border },
  mark: {
    display: 'inline-flex',
    flexShrink: 0,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
  },
  markEnd: { backgroundColor: tokens.surfaceMuted, color: tokens.mutedForeground },
  startDot: { width: 8, height: 8, borderRadius: '9999px', backgroundColor: tokens.mutedForeground },
  markStep: {
    marginTop: 6,
    backgroundColor: tokens.foreground,
    color: tokens.background,
    fontSize: 12.5,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  markStepBad: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: tokens.danger,
    color: tokens.danger,
  },
  markAdd: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: `color-mix(in oklab, ${tokens.foreground} 22%, transparent)`,
    color: tokens.mutedForeground,
  },
  endWords: {
    display: 'flex',
    alignItems: 'center',
    minHeight: 28,
    marginBottom: 12,
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  endWordsLast: { marginBottom: 0 },
  addWords: {
    display: 'flex',
    alignItems: 'center',
    minHeight: 28,
    marginBottom: 12,
    padding: 0,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    textAlign: 'start',
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    backgroundColor: 'transparent',
    borderWidth: 0,
    cursor: 'pointer',
  },
  addButton: {
    display: 'grid',
    gridTemplateColumns: '28px minmax(0, 1fr)',
    columnGap: 14,
    width: '100%',
    padding: 0,
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    backgroundColor: 'transparent',
    borderWidth: 0,
    cursor: 'pointer',
  },
  card: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 14,
    marginTop: -6,
    marginBottom: 12,
    paddingInline: 14,
    paddingBlock: 12,
    width: '100%',
    borderRadius: 10,
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    borderWidth: 0,
    backgroundColor: {
      default: tokens.surfaceInset,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 80%, transparent)`,
    },
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
    cursor: 'pointer',
    flexWrap: { default: 'nowrap', [breakpoints.phone]: 'wrap' },
  },
  cardWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 4 },
  cardName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 600,
  },
  bad: { color: tokens.danger },
  cardWho: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  rule: { width: 1, height: 10, flexShrink: 0, backgroundColor: tokens.border },
  roles: { display: 'inline-flex', flexWrap: 'wrap', gap: 4 },
  coverage: { flexShrink: 0, fontSize: 12, color: tokens.mutedForeground },
  chevron: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
  icon13: { width: 13, height: 13 },
  icon14: { width: 14, height: 14 },
})

export function RulesTab({
  draft,
  batchId,
  options,
  placement,
  method,
  problems,
  onPatch,
  onOpenStage,
  onAddStage,
}: {
  draft: Draft
  batchId: string
  options: ItemOptions
  placement: Placement
  method: { ref: string; label: UiText | null }
  problems: readonly EditorProblem[]
  onPatch: (next: Partial<Draft>) => void
  onOpenStage: (key: string) => void
  /** a new step, composed in its panel before it joins the chain */
  onAddStage: (chain: 'normal' | 'escalation') => void
}) {
  const { format } = useI18n()
  const normal = draft.stages.filter((one) => one.chain === 'normal')
  const escalation = draft.stages.filter((one) => one.chain === 'escalation')
  const countsProblem = problems.find((one) => one.block === 'counts')

  return (
    <div {...stylex.props(styles.stack)}>
      <EditorSection title={format(m.itemsRulesCounts)} testId="rules-counts" block="counts">
        <RulesCard
          draft={draft}
          placement={placement}
          method={method}
          problem={countsProblem}
          onPatch={onPatch}
        />
      </EditorSection>

      {draft.mode === 'review' ? (
        <>
          <StepChain
            batchId={batchId}
            chain="normal"
            steps={normal}
            options={options}
            problems={problems}
            onOpen={onOpenStage}
            onAdd={() => onAddStage('normal')}
          />
          <StepChain
            batchId={batchId}
            chain="escalation"
            steps={escalation}
            options={options}
            problems={problems}
            onOpen={onOpenStage}
            onAdd={() => onAddStage('escalation')}
          />
        </>
      ) : (
        <EditorSection title={format(m.itemsReviewChain)} testId="review-chain" block="review">
          <p {...stylex.props(styles.note)}>{format(m.itemsDirectNote)}</p>
        </EditorSection>
      )}
    </div>
  )
}

/** the three cells: how many, how they fold, and what the two come to */
function RulesCard({
  draft,
  placement,
  method,
  problem,
  onPatch,
}: {
  draft: Draft
  placement: Placement
  method: { ref: string; label: UiText | null }
  problem: EditorProblem | undefined
  onPatch: (next: Partial<Draft>) => void
}) {
  const { format, formatText, locale } = useI18n()
  const entries = draft.maxEntries.trim() === '' ? null : Number(draft.maxEntries)
  const folding = foldingOf(draft)
  const each = Number(draft.fixedValue.trim())
  const counted = countedEntries(folding, entries)
  const perEntryAmount = method.ref === 'fixed@1'
  const ceiling =
    !perEntryAmount || counted === null || !Number.isFinite(each)
      ? null
      : amountOf(unitsOf(draft.fixedValue.trim()) * counted)
  const methodName =
    method.label === null ? format(m.itemsScoringMethodFixed) : formatText(method.label)
  const chain = placement.sections
    .map((section) =>
      section.cap === null
        ? format(m.itemsCeilingSectionFree, { name: section.name })
        : format(m.itemsCeilingSectionCapped, { name: section.name, value: trimAmount(section.cap) }),
    )
    .join(format(m.listSeparator))
  const value = trimAmount(draft.fixedValue.trim())
  const how = !perEntryAmount
    ? format(m.itemsCeilingHowRule, { name: methodName })
    : folding.rule === 'max'
      ? format(m.itemsCeilingHowMax, { value })
      : folding.rule === 'top-n'
        ? format(m.itemsCeilingHowTopN, { value, count: counted ?? folding.n })
        : counted === null
          ? format(m.itemsCeilingHowAny, { value })
          : format(m.itemsCeilingHow, { value, count: counted })
  const unsupported = draft.scoring.language === 'unsupported'
  const entriesWrong = problem?.code === 'max-entries-invalid'
  const topNWrong = problem?.code === 'top-n-invalid'
  const foldings: readonly [Draft['folding'], string][] = [
    ['sum', format(m.itemsFoldingSum)],
    ['max', format(m.itemsFoldingMax)],
    ['top-n', format(m.itemsFoldingTopN)],
  ]

  return (
    <div {...stylex.props(styles.rules)}>
      {/* Both cells are the same kind of question - one of a few ways, and a
          number only when the way chosen has one - so both are asked the same
          way: a column of choices, with the number beside the choice it
          belongs to. A way with no number shows no box at all. */}
      <div {...stylex.props(styles.cell)}>
        <span {...stylex.props(styles.cellLabel)} id="item-entries-label">
          {format(m.itemsFieldMax)}
        </span>
        <div role="radiogroup" aria-labelledby="item-entries-label" {...stylex.props(styles.radios)}>
          <div {...stylex.props(styles.choiceLine)}>
            <button
              type="button"
              role="radio"
              aria-checked={entries !== null}
              data-entries="some"
              onClick={() => {
                if (entries === null) onPatch({ maxEntries: '1' })
              }}
              {...stylex.props(styles.radioRow, entries !== null && styles.radioRowOn)}
            >
              <span aria-hidden {...stylex.props(styles.radio, entries !== null && styles.radioOn)} />
              {format(m.itemsMaxEntriesSome)}
            </button>
            {entries !== null && (
              <span {...stylex.props(styles.amount)}>
                <Input
                  aria-label={format(m.itemsFieldMax)}
                  aria-invalid={entriesWrong || undefined}
                  inputMode="numeric"
                  wrapperXstyle={styles.amountInput}
                  className={stylex.props(styles.mono).className}
                  value={draft.maxEntries}
                  onChange={(event) => onPatch({ maxEntries: event.target.value })}
                />
                {format(m.itemsEntriesUnit)}
              </span>
            )}
          </div>
          <div {...stylex.props(styles.choiceLine)}>
            <button
              type="button"
              role="radio"
              aria-checked={entries === null}
              data-entries="any"
              onClick={() => onPatch({ maxEntries: '' })}
              {...stylex.props(styles.radioRow, entries === null && styles.radioRowOn)}
            >
              <span aria-hidden {...stylex.props(styles.radio, entries === null && styles.radioOn)} />
              {format(m.itemsMaxEntriesAny)}
            </button>
          </div>
        </div>
        {entriesWrong && (
          <p {...stylex.props(styles.problemLine)} role="alert" data-testid="counts-problem">
            {problemWords(problem, format)}
          </p>
        )}
      </div>

      <div {...stylex.props(styles.cell)}>
        <span {...stylex.props(styles.cellLabel)} id="item-folding-label">
          {format(m.itemsFolding)}
        </span>
        <div role="radiogroup" aria-labelledby="item-folding-label" {...stylex.props(styles.radios)}>
          {foldings.map(([rule, label]) => {
            const on = draft.folding === rule
            return (
              <div key={rule} {...stylex.props(styles.choiceLine)}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={unsupported}
                  data-folding={rule}
                  onClick={() => onPatch({ folding: rule })}
                  {...stylex.props(styles.radioRow, on && styles.radioRowOn, unsupported && styles.radioRowOff)}
                >
                  <span aria-hidden {...stylex.props(styles.radio, on && styles.radioOn)} />
                  {label}
                </button>
                {rule === 'top-n' && on && (
                  <span {...stylex.props(styles.amount)}>
                    <Input
                      aria-label={format(m.itemsFoldingN)}
                      aria-invalid={topNWrong || undefined}
                      inputMode="numeric"
                      wrapperXstyle={styles.amountInput}
                      className={stylex.props(styles.mono).className}
                      value={draft.topN}
                      onChange={(event) => onPatch({ topN: event.target.value })}
                    />
                    {format(m.itemsFoldingNUnit)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {(topNWrong || problem?.code === 'folding-refused') && (
          <p {...stylex.props(styles.problemLine)} role="alert" data-testid="counts-problem">
            {problemWords(problem, format)}
          </p>
        )}
      </div>

      <div
        {...stylex.props(styles.cell, styles.cellLast)}
        data-testid="item-ceiling"
        data-ceiling={!perEntryAmount ? 'by-rule' : (ceiling ?? 'unlimited')}
      >
        <span {...stylex.props(styles.cellLabel)}>{format(m.itemsCeiling)}</span>
        <span {...stylex.props(styles.ceilingValue)}>
          {!perEntryAmount
            ? format(m.itemsCeilingByRule)
            : ceiling === null
              ? format(m.itemsCeilingOpen)
              : format(m.itemsCeilingAmount, { value: ceiling })}
        </span>
        <p {...stylex.props(styles.ceilingProse)}>
          {sentences(
            [
              perEntryAmount ? format(m.itemsCeilingHowLine, { how }) : how,
              chain === '' ? '' : format(m.itemsCeilingNote, { chain }),
            ],
            locale,
          )}
        </p>
      </div>
    </div>
  )
}

/**
 * One route, read top to bottom: where a record enters, every step it
 * passes, the place to add another, and where it leaves - with one 12px
 * rhythm between them and one line strung through the marks.
 */
function StepChain({
  batchId,
  chain,
  steps,
  options,
  problems,
  onOpen,
  onAdd,
}: {
  batchId: string
  chain: 'normal' | 'escalation'
  steps: readonly StageDraft[]
  options: ItemOptions
  problems: readonly EditorProblem[]
  onOpen: (key: string) => void
  onAdd: () => void
}) {
  const { format } = useI18n()
  const query = useApiQuery(assessmentApi)
  // who covers each level, asked for the whole chain at once so that the
  // heading can count the steps that are short of reviewers
  // Asked once per distinct (level, roles): two steps anchored alike are one
  // question, and the same question twice is what the query observer warns of.
  const asked = steps.map((stage) => {
    const roleIds = stage.kind === 'roleAt' ? stage.roleIds : [stage.roleId]
    const askable = stage.kind === 'roleAt' && stage.nodeTypeId !== '' && roleIds.length > 0
    return askable ? { nodeTypeId: stage.nodeTypeId, roleIds, key: `${stage.nodeTypeId}|${[...roleIds].sort().join(',')}` } : null
  })
  const distinct = [...new Map(asked.flatMap((one) => (one === null ? [] : [[one.key, one] as const]))).values()]
  const answers = useQueries({
    queries: distinct.map((one) =>
      query.assessment.reviewCoverage.queryOptions({
        params: { batchId },
        query: { nodeTypeId: one.nodeTypeId, roleIds: one.roleIds },
      }),
    ),
  })
  const coverage = asked.map((one) =>
    one === null ? undefined : answers[distinct.findIndex((candidate) => candidate.key === one.key)],
  )
  const block = chain === 'normal' ? 'review' : 'escalation'
  const problemOf = (key: string) =>
    problems.find((one) => one.entity?.kind === 'stage' && one.entity.key === key)
  const chainProblem = problems.find((one) => one.block === block && one.entity === undefined)
  const short = steps.filter((_stage, index) =>
    (coverage[index]?.data?.nodes ?? []).some((node) => node.reviewers === 0),
  ).length
  const wrong = steps.filter((stage) => problemOf(stage.key) !== undefined).length + short

  return (
    <EditorSection
      title={format(chain === 'normal' ? m.itemsReviewChain : m.itemsEscalationTitle)}
      hint={format(chain === 'normal' ? m.itemsReviewChainLong : m.itemsEscalationLong)}
      aside={
        wrong > 0 ? (
          <SectionCount tone="error">{format(m.itemsStagesWrong, { count: wrong })}</SectionCount>
        ) : chainProblem !== undefined ? (
          <SectionCount tone={chainProblem.tone}>{problemWords(chainProblem, format)}</SectionCount>
        ) : undefined
      }
      testId={chain === 'normal' ? 'review-chain' : 'escalation-chain'}
      block={block}
    >
      <div {...stylex.props(styles.chain)} data-testid={`chain-${chain}`}>
        <div {...stylex.props(styles.link)}>
          <div {...stylex.props(styles.rail)}>
            <span {...stylex.props(styles.mark, styles.markEnd)}>
              <span aria-hidden {...stylex.props(styles.startDot)} />
            </span>
            <span aria-hidden {...stylex.props(styles.line)} />
          </div>
          <div {...stylex.props(styles.endWords)}>
            {format(chain === 'normal' ? m.itemsFlowSubmitLine : m.itemsEscalationStartLine)}
          </div>
        </div>

        {steps.map((stage, index) => {
          const problem = problemOf(stage.key)
          const nodes = coverage[index]?.data?.nodes
          const uncovered = (nodes ?? []).filter((node) => node.reviewers === 0).length
          const bad = problem !== undefined || uncovered > 0
          const named = stage.label.trim() !== ''
          const settled = stageSettled(stage, options)
          return (
            <div key={stage.key} {...stylex.props(styles.link)}>
              <div {...stylex.props(styles.rail)}>
                <span {...stylex.props(styles.mark, styles.markStep, bad && styles.markStepBad)}>
                  {index + 1}
                </span>
                <span aria-hidden {...stylex.props(styles.line)} />
              </div>
              <button
                type="button"
                {...stylex.props(styles.card)}
                onClick={() => onOpen(stage.key)}
                data-testid="chain-step"
                data-stage-key={stage.key}
                data-step-complete={problem === undefined}
                data-uncovered={uncovered}
              >
                <span {...stylex.props(styles.cardWords)}>
                  <span {...stylex.props(styles.cardName, bad && styles.bad)}>
                    {named ? stage.label.trim() : format(m.itemsStageUnnamed)}
                  </span>
                  {settled && (
                    <span {...stylex.props(styles.cardWho)}>
                      <span>
                        {stage.kind === 'roleAt'
                          ? (options.orgTypes.find((one) => one.id === stage.nodeTypeId)?.name ?? '')
                          : format(m.itemsStageWalkUp)}
                      </span>
                      <span aria-hidden {...stylex.props(styles.rule)} />
                      <span {...stylex.props(styles.roles)}>
                        {options.roles
                          .filter((role) =>
                            stage.kind === 'roleAt' ? stage.roleIds.includes(role.id) : role.id === stage.roleId,
                          )
                          .map((role) => (
                            <Tag key={role.id}>{role.name}</Tag>
                          ))}
                      </span>
                      <span>
                        {format(stage.participation === 'all' ? m.itemsStageRuleAll : m.itemsStageRuleAny)}
                      </span>
                    </span>
                  )}
                  {problem !== undefined && (
                    <span {...stylex.props(styles.coverage, styles.bad)} role="alert" data-testid="step-problem">
                      {problemWords(problem, format)}
                    </span>
                  )}
                </span>
                {problem === undefined && nodes !== undefined && (
                  <span {...stylex.props(styles.coverage, uncovered > 0 && styles.bad)} data-testid="step-coverage">
                    {nodes.length === 0
                      ? format(m.itemsReviewNoUnits)
                      : uncovered === 0
                        ? format(m.itemsReviewCovered, { count: nodes.length })
                        : format(m.itemsReviewUncoveredCount, { count: uncovered })}
                  </span>
                )}
                <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
              </button>
            </div>
          )
        })}

        <button type="button" {...stylex.props(styles.addButton)} onClick={onAdd} data-testid="chain-add">
          <span {...stylex.props(styles.rail)}>
            <span {...stylex.props(styles.mark, styles.markAdd)}>
              <PlusIcon aria-hidden {...stylex.props(styles.icon13)} />
            </span>
            <span aria-hidden {...stylex.props(styles.line)} />
          </span>
          <span {...stylex.props(styles.addWords)}>
            {format(chain === 'normal' ? m.itemsStageAdd : m.itemsEscalationAddStep)}
          </span>
        </button>

        <div {...stylex.props(styles.link)}>
          <div {...stylex.props(styles.rail)}>
            <span {...stylex.props(styles.mark, styles.markEnd)}>
              <CheckIcon aria-hidden {...stylex.props(styles.icon14)} />
            </span>
          </div>
          <div {...stylex.props(styles.endWords, styles.endWordsLast)}>
            {format(chain === 'normal' ? m.itemsFlowDoneLine : m.itemsEscalationDoneLine)}
          </div>
        </div>
      </div>
    </EditorSection>
  )
}
