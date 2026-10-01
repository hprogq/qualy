import { useLocale } from '@qualy/web-i18n'
import { type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Input } from '@qualy/ui/input'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { MAX_STAGES_PER_ROUTE } from '../../../api.ts'
import { assessmentApi } from '../../api.ts'

import { amountOf, trimAmount, unitsOf } from '../../entry/model.ts'
import { type ItemOptions } from '../options.ts'
import { type Placement } from '../paper.ts'
import { type StageDraft } from '../StageSheet.tsx'
import { countedEntries } from '../structure.ts'
import { EditorSection, SectionCount, Tag } from './Rows.tsx'
import {
  channelsOf,
  foldingOf,
  levelsAsked,
  stageSettled,
  type Draft,
  type EditorProblem,
} from './model.ts'
import { RouteReach } from './RouteReach.tsx'
import { problemWords, sentences } from './words.ts'
import * as m from '#messages'

// How many records one person may hold and how they fold into a score, then
// the steps a submission walks. The rules are one card of three cells - two
// to set, one that says what the two add up to. A route is a chain read top
// to bottom: where a record enters, every step it passes, where it leaves,
// strung on one line so that the order is something seen rather than read.
//
// A step is composed in its panel and only joins the chain once it is
// whole, so the chain never holds a step that cannot review anything. What
// the chain can still say about a whole step is that some unit at its level
// has nobody to do the reviewing - which is about the round's people, not
// about the step, and is said in amber without stopping the save.
//
// A step can be put anywhere: between any two of them there is a place to
// insert one, shown where a pointer rests or the keyboard lands, and always
// on a screen with nothing to point with.

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
  ceilingProse: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.55,
    color: tokens.mutedForeground,
    textWrap: 'pretty',
  },
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
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyleType: 'none' },
  rail: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  // the 2px line that strings the marks together; absent under the last
  line: { flexGrow: 1, width: 2, backgroundColor: tokens.border },
  // a step's mark sits across from its name, with the line running on
  // above it and below it
  lineAbove: { flexShrink: 0, width: 2, height: 12, backgroundColor: tokens.border },
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
  startDot: {
    width: 8,
    height: 8,
    borderRadius: '9999px',
    backgroundColor: tokens.mutedForeground,
  },
  markStep: {
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
  markStepWarn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: tokens.warning,
    color: tokens.warningForeground,
  },
  // ---- a place to insert a step ---------------------------------------
  // The gap between two steps, as a press. It holds its height whether or
  // not it is showing, so pointing at it moves nothing, and it is tall
  // enough for its mark: a mark taller than the gap sat on the cards
  // either side of it.
  insert: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '28px minmax(0, 1fr)',
    columnGap: 14,
    width: '100%',
    height: { default: 24, '@media (hover: none)': 32 },
    padding: 0,
    borderWidth: 0,
    fontFamily: 'inherit',
    color: 'inherit',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    // the ring is drawn round the mark and its words, not across the chain
    outline: 'none',
  },
  gap: { height: { default: 24, '@media (hover: none)': 32 } },
  // the mark and its words, one thing to point at and one thing ringed
  insertTag: {
    position: 'absolute',
    top: '50%',
    left: 4,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 18,
    paddingInlineEnd: { default: 8, '@media (hover: none)': 0 },
    borderRadius: '9999px',
    transform: 'translateY(-50%)',
    boxShadow: {
      default: 'none',
      [stylex.when.ancestor(':focus-visible')]: `0 0 0 2px ${tokens.focusRing}`,
    },
  },
  insertMark: {
    display: 'inline-flex',
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: `color-mix(in oklab, ${tokens.foreground} 30%, transparent)`,
    backgroundColor: tokens.background,
    color: tokens.mutedForeground,
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-visible')]: 1,
      '@media (hover: none)': 1,
    },
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  insertWords: {
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    // a thumb sees the mark and nothing more: words that come and go under
    // it would only be in the way of the step it is reaching for
    display: { default: 'block', '@media (hover: none)': 'none' },
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-visible')]: 1,
    },
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  icon12: { width: 12, height: 12 },
  addOff: { cursor: 'default' },
  addWordsOff: { color: tokens.mutedForeground, cursor: 'default' },
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
  warn: { color: tokens.warningForeground },
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
  method: { ref: string; label: string | null }
  problems: readonly EditorProblem[]
  onPatch: (next: Partial<Draft>) => void
  onOpenStage: (key: string) => void
  /** a new step, composed in its panel before it joins the chain at `at` */
  onAddStage: (chain: 'normal' | 'escalation', at?: number) => void
}) {
  const normal = draft.stages.filter((one) => one.chain === 'normal')
  const escalation = draft.stages.filter((one) => one.chain === 'escalation')
  const countsProblem = problems.find((one) => one.block === 'counts')
  // a question participants file with nowhere to hear an appeal: said here,
  // before a conclusion is reached, not when somebody looks for the button
  // (ruling of 2026-09-25 #17)
  const unappealable = channelsOf(draft).includes('participant') && escalation.length === 0
  const noAppeal = unappealable && (
    <p {...stylex.props(styles.note)} data-testid="no-appeal-route">
      {m.items_noAppealRoute()}
    </p>
  )

  return (
    <div {...stylex.props(styles.stack)}>
      <EditorSection title={m.items_rulesCounts()} testId="rules-counts" block="counts">
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
            reach={levelsAsked(draft, 'normal')}
            onOpen={onOpenStage}
            onAdd={(at) => onAddStage('normal', at)}
          />
          <StepChain
            batchId={batchId}
            chain="escalation"
            steps={escalation}
            options={options}
            problems={problems}
            reach={levelsAsked(draft, 'escalation')}
            onOpen={onOpenStage}
            onAdd={(at) => onAddStage('escalation', at)}
            note={noAppeal}
          />
        </>
      ) : (
        <EditorSection title={m.items_reviewChain()} testId="review-chain" block="review">
          <p {...stylex.props(styles.note)}>{m.items_directNote()}</p>
          {noAppeal}
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
  method: { ref: string; label: string | null }
  problem: EditorProblem | undefined
  onPatch: (next: Partial<Draft>) => void
}) {
  const locale = useLocale()
  const entries = draft.maxEntries.trim() === '' ? null : Number(draft.maxEntries)
  const folding = foldingOf(draft)
  const each = Number(draft.fixedValue.trim())
  const counted = countedEntries(folding, entries)
  const perEntryAmount = method.ref === 'fixed@1'
  const ceiling =
    !perEntryAmount || counted === null || !Number.isFinite(each)
      ? null
      : amountOf(unitsOf(draft.fixedValue.trim()) * counted)
  const methodName = method.label === null ? m.items_scoringMethodFixed() : method.label
  const chain = placement.sections
    .map((section) =>
      section.cap === null
        ? m.items_ceilingSectionFree({ name: section.name })
        : m.items_ceilingSectionCapped({
            name: section.name,
            value: trimAmount(section.cap),
          }),
    )
    .join(m.items_listSeparator())
  const value = trimAmount(draft.fixedValue.trim())
  const how = !perEntryAmount
    ? m.items_ceilingHowRule({ name: methodName })
    : folding.rule === 'max'
      ? m.items_ceilingHowMax({ value })
      : folding.rule === 'top-n'
        ? m.items_ceilingHowTopN({ value, count: counted ?? folding.n })
        : counted === null
          ? m.items_ceilingHowAny({ value })
          : m.items_ceilingHow({ value, count: counted })
  const unsupported = draft.scoring.language === 'unsupported'
  const entriesWrong = problem?.code === 'max-entries-invalid'
  const topNWrong = problem?.code === 'top-n-invalid'
  const foldings: readonly [Draft['folding'], string][] = [
    ['sum', m.items_foldingSum()],
    ['max', m.items_foldingMax()],
    ['top-n', m.items_foldingTopN()],
  ]

  return (
    <div {...stylex.props(styles.rules)}>
      {/* Both cells are the same kind of question - one of a few ways, and a
          number only when the way chosen has one - so both are asked the same
          way: a column of choices, with the number beside the choice it
          belongs to. A way with no number shows no box at all. */}
      <div {...stylex.props(styles.cell)}>
        <span {...stylex.props(styles.cellLabel)} id="item-entries-label">
          {m.items_fieldMax()}
        </span>
        <div
          role="radiogroup"
          aria-labelledby="item-entries-label"
          {...stylex.props(styles.radios)}
        >
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
              <span
                aria-hidden
                {...stylex.props(styles.radio, entries !== null && styles.radioOn)}
              />
              {m.items_maxEntriesSome()}
            </button>
            {entries !== null && (
              <span {...stylex.props(styles.amount)}>
                <Input
                  aria-label={m.items_fieldMax()}
                  aria-invalid={entriesWrong || undefined}
                  inputMode="numeric"
                  wrapperXstyle={styles.amountInput}
                  className={stylex.props(styles.mono).className}
                  value={draft.maxEntries}
                  onChange={(event) => onPatch({ maxEntries: event.target.value })}
                />
                {m.items_entriesUnit()}
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
              <span
                aria-hidden
                {...stylex.props(styles.radio, entries === null && styles.radioOn)}
              />
              {m.items_maxEntriesAny()}
            </button>
          </div>
        </div>
        {entriesWrong && (
          <p {...stylex.props(styles.problemLine)} role="alert" data-testid="counts-problem">
            {problemWords(problem)}
          </p>
        )}
      </div>

      <div {...stylex.props(styles.cell)}>
        <span {...stylex.props(styles.cellLabel)} id="item-folding-label">
          {m.items_folding()}
        </span>
        <div
          role="radiogroup"
          aria-labelledby="item-folding-label"
          {...stylex.props(styles.radios)}
        >
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
                  {...stylex.props(
                    styles.radioRow,
                    on && styles.radioRowOn,
                    unsupported && styles.radioRowOff,
                  )}
                >
                  <span aria-hidden {...stylex.props(styles.radio, on && styles.radioOn)} />
                  {label}
                </button>
                {rule === 'top-n' && on && (
                  <span {...stylex.props(styles.amount)}>
                    <Input
                      aria-label={m.items_foldingN()}
                      aria-invalid={topNWrong || undefined}
                      inputMode="numeric"
                      wrapperXstyle={styles.amountInput}
                      className={stylex.props(styles.mono).className}
                      value={draft.topN}
                      onChange={(event) => onPatch({ topN: event.target.value })}
                    />
                    {m.items_foldingNUnit()}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {(topNWrong || problem?.code === 'folding-refused') && (
          <p {...stylex.props(styles.problemLine)} role="alert" data-testid="counts-problem">
            {problemWords(problem)}
          </p>
        )}
      </div>

      <div
        {...stylex.props(styles.cell, styles.cellLast)}
        data-testid="item-ceiling"
        data-ceiling={!perEntryAmount ? 'by-rule' : (ceiling ?? 'unlimited')}
      >
        <span {...stylex.props(styles.cellLabel)}>{m.items_ceiling()}</span>
        <span {...stylex.props(styles.ceilingValue)}>
          {!perEntryAmount
            ? m.items_ceilingByRule()
            : ceiling === null
              ? m.items_ceilingOpen()
              : m.items_ceilingAmount({ value: ceiling })}
        </span>
        <p {...stylex.props(styles.ceilingProse)}>
          {sentences(
            [
              perEntryAmount ? m.items_ceilingHowLine({ how }) : how,
              chain === '' ? '' : m.items_ceilingNote({ chain }),
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
 * passes, the place to add another, and where it leaves - with one line
 * strung through the marks, and a place to insert a step between any two.
 */
function StepChain({
  batchId,
  chain,
  steps,
  options,
  problems,
  reach,
  onOpen,
  onAdd,
  note,
}: {
  batchId: string
  chain: 'normal' | 'escalation'
  steps: readonly StageDraft[]
  options: ItemOptions
  problems: readonly EditorProblem[]
  /** the unit kinds the route asks the roster for, where it can miss anybody */
  reach: readonly string[] | null
  onOpen: (key: string) => void
  /** a new step at this place in the route; the end when none is said */
  onAdd: (at?: number) => void
  /** a line said under the chain, when there is something to say about it */
  note?: ReactNode
}) {
  const query = useApiQuery(assessmentApi)
  // who covers each level, asked for the whole chain at once so that the
  // heading can count the steps that are short of reviewers
  // Asked once per distinct (level, roles): two steps anchored alike are one
  // question, and the same question twice is what the query observer warns of.
  const asked = steps.map((stage) => {
    const roleIds = stage.kind === 'roleAt' ? stage.roleIds : [stage.roleId]
    const askable = stage.kind === 'roleAt' && stage.nodeTypeId !== '' && roleIds.length > 0
    return askable
      ? {
          nodeTypeId: stage.nodeTypeId,
          roleIds,
          key: `${stage.nodeTypeId}|${[...roleIds].sort().join(',')}`,
        }
      : null
  })
  const distinct = [
    ...new Map(asked.flatMap((one) => (one === null ? [] : [[one.key, one] as const]))).values(),
  ]
  const answers = useQueries({
    queries: distinct.map((one) =>
      query.assessment.reviewCoverage.queryOptions({
        params: { batchId },
        query: { nodeTypeId: one.nodeTypeId, roleIds: one.roleIds },
      }),
    ),
  })
  const coverage = asked.map((one) =>
    one === null
      ? undefined
      : answers[distinct.findIndex((candidate) => candidate.key === one.key)],
  )
  const block = chain === 'normal' ? 'review' : 'escalation'
  const problemOf = (key: string) =>
    problems.find((one) => one.entity?.kind === 'stage' && one.entity.key === key)
  const chainProblem = problems.find((one) => one.block === block && one.entity === undefined)
  const uncoveredAt = (index: number) =>
    (coverage[index]?.data?.nodes ?? []).filter((node) => node.reviewers === 0).length
  const wrong = steps.filter((stage) => problemOf(stage.key)?.tone === 'error').length
  const waiting = steps.filter((stage) => problemOf(stage.key)?.tone === 'pending').length
  const short = steps.filter(
    (stage, index) => problemOf(stage.key) === undefined && uncoveredAt(index) > 0,
  ).length
  const title = (chain === 'normal' ? m.items_reviewChain : m.items_escalationTitle)()
  // a route holds so many steps and no more; past that there is nowhere to
  // put one, so no place offers itself (the save would be refused anyway)
  const full = steps.length >= MAX_STAGES_PER_ROUTE
  const nameOf = (stage: StageDraft) =>
    stage.label.trim() === '' ? m.items_stageUnnamed() : stage.label.trim()

  return (
    <EditorSection
      title={title}
      hint={(chain === 'normal' ? m.items_reviewChainLong : m.items_escalationLong)()}
      aside={
        wrong > 0 ? (
          <SectionCount tone="error">{m.items_stagesWrong({ count: wrong })}</SectionCount>
        ) : chainProblem !== undefined ? (
          <SectionCount tone={chainProblem.tone}>{problemWords(chainProblem)}</SectionCount>
        ) : waiting > 0 ? (
          <SectionCount tone="pending">{m.items_pendingCount({ count: waiting })}</SectionCount>
        ) : short > 0 ? (
          <SectionCount tone="pending">{m.items_stagesShort({ count: short })}</SectionCount>
        ) : undefined
      }
      testId={chain === 'normal' ? 'review-chain' : 'escalation-chain'}
      block={block}
    >
      {note}
      <div
        {...stylex.props(styles.chain)}
        data-testid={`chain-${chain}`}
        data-steps={steps.length}
        data-full={full}
      >
        <div {...stylex.props(styles.link)}>
          <div {...stylex.props(styles.rail)}>
            <span {...stylex.props(styles.mark, styles.markEnd)}>
              <span aria-hidden {...stylex.props(styles.startDot)} />
            </span>
          </div>
          <div {...stylex.props(styles.endWords)}>
            {(chain === 'normal' ? m.items_flowSubmitLine : m.items_escalationStartLine)()}
          </div>
        </div>

        <ol aria-label={title} {...stylex.props(styles.list)}>
          {steps.map((stage, index) => {
            const problem = problemOf(stage.key)
            const nodes = coverage[index]?.data?.nodes
            const uncovered = uncoveredAt(index)
            const bad = problem?.tone === 'error'
            const warn = !bad && (problem !== undefined || uncovered > 0)
            const named = stage.label.trim() !== ''
            const settled = stageSettled(stage, options)
            return (
              <li key={stage.key}>
                {full ? (
                  <Gap />
                ) : (
                  <button
                    type="button"
                    {...stylex.props(styles.insert, stylex.defaultMarker())}
                    onClick={() => onAdd(index)}
                    data-testid="chain-insert"
                    data-at={index}
                    aria-label={(chain === 'normal'
                      ? m.items_stageInsert
                      : m.items_escalationInsert)({ n: index + 1, name: nameOf(stage) })}
                  >
                    <span {...stylex.props(styles.rail)}>
                      <span aria-hidden {...stylex.props(styles.line)} />
                    </span>
                    <span aria-hidden {...stylex.props(styles.insertTag)} data-testid="insert-tag">
                      <span {...stylex.props(styles.insertMark)}>
                        <PlusIcon {...stylex.props(styles.icon12)} />
                      </span>
                      <span {...stylex.props(styles.insertWords)}>{m.items_stageInsertHere()}</span>
                    </span>
                  </button>
                )}
                <div {...stylex.props(styles.link)}>
                  <div {...stylex.props(styles.rail)}>
                    <span aria-hidden {...stylex.props(styles.lineAbove)} />
                    <span
                      aria-hidden
                      {...stylex.props(
                        styles.mark,
                        styles.markStep,
                        bad && styles.markStepBad,
                        warn && styles.markStepWarn,
                      )}
                    >
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
                    data-step-complete={problem?.tone !== 'error'}
                    data-problem={problem?.code}
                    data-tone={bad ? 'error' : warn ? 'pending' : 'ok'}
                    data-participation={stage.participation}
                    data-uncovered={uncovered}
                  >
                    <span {...stylex.props(styles.cardWords)}>
                      <span
                        {...stylex.props(styles.cardName, bad && styles.bad, warn && styles.warn)}
                      >
                        {/* the mark beside the card says which step this is; a
                            reader who cannot see it hears it first */}
                        <VisuallyHidden>
                          {m.items_stagePositionOption({ n: index + 1 })}{' '}
                        </VisuallyHidden>
                        {named ? stage.label.trim() : m.items_stageUnnamed()}
                      </span>
                      {settled && (
                        <span {...stylex.props(styles.cardWho)}>
                          <span>
                            {stage.kind === 'roleAt'
                              ? (options.orgTypes.find((one) => one.id === stage.nodeTypeId)
                                  ?.name ?? '')
                              : m.items_stageWalkUp()}
                          </span>
                          <span aria-hidden {...stylex.props(styles.rule)} />
                          <span {...stylex.props(styles.roles)}>
                            {options.roles
                              .filter((role) =>
                                stage.kind === 'roleAt'
                                  ? stage.roleIds.includes(role.id)
                                  : role.id === stage.roleId,
                              )
                              .map((role) => (
                                <Tag key={role.id}>{role.name}</Tag>
                              ))}
                          </span>
                          <span>
                            {(chain === 'escalation' && stage.participation === 'all'
                              ? m.items_stageRuleAll
                              : m.items_stageRuleAny)()}
                          </span>
                        </span>
                      )}
                      {problem !== undefined && (
                        <span
                          {...stylex.props(styles.coverage, bad ? styles.bad : styles.warn)}
                          role={bad ? 'alert' : undefined}
                          data-testid="step-problem"
                          data-code={problem.code}
                        >
                          {problemWords(problem)}
                        </span>
                      )}
                    </span>
                    {problem === undefined && nodes !== undefined && (
                      <span
                        {...stylex.props(styles.coverage, uncovered > 0 && styles.warn)}
                        data-testid="step-coverage"
                      >
                        {nodes.length === 0
                          ? m.items_reviewNoUnits()
                          : uncovered === 0
                            ? m.items_reviewCovered({ count: nodes.length })
                            : m.items_reviewUncoveredCount({ count: uncovered })}
                      </span>
                    )}
                    <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
        <Gap />

        <button
          type="button"
          {...stylex.props(styles.addButton, full && styles.addOff)}
          onClick={() => onAdd()}
          disabled={full}
          data-testid="chain-add"
        >
          <span {...stylex.props(styles.rail)}>
            <span {...stylex.props(styles.mark, styles.markAdd)}>
              <PlusIcon aria-hidden {...stylex.props(styles.icon13)} />
            </span>
            <span aria-hidden {...stylex.props(styles.line)} />
          </span>
          <span {...stylex.props(styles.addWords, full && styles.addWordsOff)}>
            {full
              ? m.items_problemStagesTooMany({ max: MAX_STAGES_PER_ROUTE })
              : (chain === 'normal' ? m.items_stageAdd : m.items_escalationAddStep)()}
          </span>
        </button>

        <div {...stylex.props(styles.link)}>
          <div {...stylex.props(styles.rail)}>
            <span {...stylex.props(styles.mark, styles.markEnd)}>
              <CheckIcon aria-hidden {...stylex.props(styles.icon14)} />
            </span>
          </div>
          <div {...stylex.props(styles.endWords, styles.endWordsLast)}>
            {(chain === 'normal' ? m.items_flowDoneLine : m.items_escalationDoneLine)()}
          </div>
        </div>
      </div>
      {reach !== null && <RouteReach batchId={batchId} chain={chain} levels={reach} />}
    </EditorSection>
  )
}

/** the room between two things on the chain, with the line running through it */
function Gap() {
  return (
    <div aria-hidden {...stylex.props(styles.link, styles.gap)}>
      <span {...stylex.props(styles.rail)}>
        <span {...stylex.props(styles.line)} />
      </span>
    </div>
  )
}
