import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import {
  CheckIcon,
  MoreVerticalIcon,
  PlayIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import { Spinner } from '@qualy/ui/spinner'
import { formulaMessages as m } from './i18n.ts'
import { exampleStyles } from './example-grid.ts'
import type { InputFact } from './report-words.ts'

// One example, as a line of the table under the editor.
//
// A formula collects dozens of these, so the line is dense: its name, what it
// was asked under the titles its parameters declared, what it should come to
// and what it came to, and the verdict. Pressing it opens the case in a sheet
// beside the editor, where its fields have room; everything else a case can
// be asked to do - run on its own, fill the try-run with its input, be
// duplicated or removed - sits in its menu rather than on the line. A phone
// has no room for six columns, so there the same facts are a card.

/** how many parameters a line shows before it counts the rest */
const FACTS_SHOWN = 2

const styles = stylex.create({
  case: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    cursor: 'pointer',
    backgroundColor: { default: null, ':hover': tokens.surfaceInset },
  },
  caseOpen: { backgroundColor: tokens.selectedSurface },
  name: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    height: 19,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
  },
  unnamed: { color: tokens.mutedForeground },
  facts: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 1, paddingBlock: 1 },
  fact: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
    fontSize: 11.5,
    lineHeight: '17px',
  },
  factLabel: {
    flexShrink: 0,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  factValue: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.surfaceMutedForeground,
  },
  rest: {
    fontSize: 11,
    lineHeight: '16px',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 65%, transparent)`,
  },
  number: {
    height: 19,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'right',
    fontSize: 12.5,
    fontVariantNumeric: 'tabular-nums',
  },
  expected: { color: tokens.mutedForeground },
  absent: { color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)` },
  wrong: { color: tokens.danger },
  verdictCell: { display: 'flex', height: 19, alignItems: 'center' },
  verdict: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  verdictPassed: { color: tokens.successForeground },
  verdictFailed: { color: tokens.danger },
  verdictFix: { color: tokens.warningForeground },
  dot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  dotPassed: { backgroundColor: tokens.success },
  dotFailed: { backgroundColor: tokens.danger },
  dotFix: { backgroundColor: tokens.warning },
  menu: { display: 'inline-flex', alignItems: 'center', gap: 4, justifySelf: 'end' },
  quickRunGood: {
    borderColor: tokens.success,
    backgroundColor: `color-mix(in oklab, ${tokens.success} 14%, ${tokens.surface})`,
    color: { default: tokens.successForeground, ':disabled': tokens.successForeground },
  },
  quickRunBad: {
    borderColor: tokens.danger,
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 12%, ${tokens.surface})`,
    color: { default: tokens.danger, ':disabled': tokens.danger },
  },
  quickSpinner: { width: 12, height: 12 },
  quickRemoveArmed: {
    borderColor: tokens.danger,
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.danger} 12%, ${tokens.surface})`,
      ':hover': `color-mix(in oklab, ${tokens.danger} 20%, ${tokens.surface})`,
    },
    color: { default: tokens.danger, ':disabled': tokens.mutedForeground },
  },
  quickRun: {
    display: 'inline-flex',
    width: 22,
    height: 22,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: 6,
    padding: 0,
    backgroundColor: { default: tokens.surface, ':hover': tokens.surfaceMuted },
    color: { default: tokens.surfaceMutedForeground, ':disabled': tokens.mutedForeground },
    cursor: { default: 'pointer', ':disabled': 'default' },
  },

  card: { display: 'flex', flexDirection: 'column', gap: 6, paddingBlock: 12, paddingInline: 16 },
  cardLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  cardName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  cardFacts: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 12,
    rowGap: 3,
    fontSize: 11.5,
    lineHeight: '17px',
  },
  cardFact: { display: 'inline-flex', alignItems: 'baseline', gap: 5 },
  cardNumbers: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 14,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  spring: { flexGrow: 1 },
})

/** where a case stands, as the table's last column says it */
export type Verdict = 'passed' | 'failed' | 'unexpected' | 'fix' | 'not-run'

export interface ExampleOutcome {
  readonly passed?: boolean
  readonly actual?: string
  readonly refusal?: string
  readonly defect?: string
  /** ran, but against code or a case that has changed since */
  readonly stale: boolean
}

export function ExampleRow({
  index,
  name,
  facts,
  expected,
  outcome,
  verdict,
  legal,
  open,
  onOpen,
  locked,
  running,
  runningHere = false,
  narrow = false,
  onRun,
  onLoadIntoTry,
  onDuplicate,
  onRemove,
}: {
  readonly index: number
  readonly name: string
  /** the case's input, parameter by parameter, in the contract's order */
  readonly facts: readonly InputFact[]
  readonly expected: string
  readonly outcome: ExampleOutcome | undefined
  readonly verdict: Verdict
  readonly legal: boolean
  /** its sheet is the one showing */
  readonly open: boolean
  readonly onOpen: () => void
  /** the formula is archived: nothing about a case may change */
  readonly locked: boolean
  readonly running: boolean
  /** this line is the one being run now */
  readonly runningHere?: boolean
  readonly narrow?: boolean
  readonly onRun: () => void
  readonly onLoadIntoTry: () => void
  readonly onDuplicate: () => void
  readonly onRemove: () => void
}) {
  const { format } = useI18n()
  // Removing a line takes two presses: the first arms the mark, the second
  // takes the line. A press elsewhere, or a moment's pause, disarms it, so a
  // dense table cannot lose a case to one stray click.
  const [arming, setArming] = useState(false)
  const armed = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (armed.current !== null) clearTimeout(armed.current)
    },
    [],
  )
  const arm = () => {
    if (arming) {
      if (armed.current !== null) clearTimeout(armed.current)
      setArming(false)
      onRemove()
      return
    }
    setArming(true)
    if (armed.current !== null) clearTimeout(armed.current)
    armed.current = setTimeout(() => setArming(false), 3_000)
  }
  // what the run this line started came to, kept a moment so the press is
  // answered where it was made
  const [settled, setSettled] = useState<'passed' | 'failed' | null>(null)
  const wasRunning = useRef(false)
  const verdictRef = useRef<Verdict>(verdict)
  verdictRef.current = verdict
  useEffect(() => {
    if (runningHere) {
      wasRunning.current = true
      setSettled(null)
      return
    }
    if (!wasRunning.current) return
    wasRunning.current = false
    setSettled(verdictRef.current === 'passed' ? 'passed' : 'failed')
    const timer = setTimeout(() => setSettled(null), 1_400)
    return () => clearTimeout(timer)
  }, [runningHere])
  const fresh = outcome !== undefined && !outcome.stale
  const actual = fresh ? outcome.actual : undefined
  const words = {
    passed: m.resultPassed,
    failed: m.reportFailed,
    unexpected: m.conclusionNoExpectation,
    fix: m.conclusionNeedsFix,
    'not-run': m.conclusionNotRun,
  }[verdict]
  const verdictLook = {
    passed: [styles.verdictPassed, styles.dotPassed],
    failed: [styles.verdictFailed, styles.dotFailed],
    unexpected: [null, null],
    fix: [styles.verdictFix, styles.dotFix],
    'not-run': [null, null],
  }[verdict]
  const shown = facts.slice(0, FACTS_SHOWN)
  const rest = facts.length - shown.length

  const verdictWords = (
    <span
      data-testid={outcome === undefined ? undefined : 'formula-case-result'}
      data-passed={outcome !== undefined && fresh ? outcome.passed : undefined}
      data-stale={outcome !== undefined && !fresh ? true : undefined}
      title={outcome === undefined || fresh ? undefined : format(m.resultStale)}
      {...stylex.props(styles.verdict, verdictLook[0])}
    >
      <span aria-hidden {...stylex.props(styles.dot, verdictLook[1])} />
      {format(words)}
    </span>
  )

  const actions = (
    <span onClick={(event) => event.stopPropagation()} {...stylex.props(styles.menu)}>
      <button
        type="button"
        data-testid="formula-test-run"
        data-state={runningHere ? 'running' : (settled ?? 'idle')}
        aria-label={format(m.runThisExample)}
        title={format(m.runThisExample)}
        disabled={locked || running}
        onClick={onRun}
        {...stylex.props(
          styles.quickRun,
          settled === 'passed' && styles.quickRunGood,
          settled === 'failed' && styles.quickRunBad,
        )}
      >
        {runningHere ? (
          <Spinner aria-hidden xstyle={styles.quickSpinner} />
        ) : settled === 'passed' ? (
          <CheckIcon size={13} aria-hidden />
        ) : settled === 'failed' ? (
          <XIcon size={13} aria-hidden />
        ) : (
          <PlayIcon size={13} aria-hidden />
        )}
      </button>
      <button
        type="button"
        data-testid="formula-test-remove"
        data-arming={arming ? true : undefined}
        aria-label={format(arming ? m.removeConfirm : m.removeTest)}
        title={format(arming ? m.removeConfirm : m.removeTest)}
        disabled={locked}
        onClick={arm}
        onBlur={() => setArming(false)}
        {...stylex.props(styles.quickRun, arming && styles.quickRemoveArmed)}
      >
        {arming ? (
          <TriangleAlertIcon size={13} aria-hidden />
        ) : (
          <Trash2Icon size={13} aria-hidden />
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={format(m.exampleMenu)}
            data-testid="formula-test-menu"
          >
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={locked || running} onSelect={onRun}>
            {format(m.run)}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={locked} onSelect={onLoadIntoTry}>
            {format(m.loadIntoTry)}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={locked} onSelect={onDuplicate}>
            {format(m.copyTest)}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={locked} onSelect={onRemove}>
            {format(m.removeTest)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )

  const named = (
    <span {...stylex.props(narrow ? styles.cardName : styles.name, name === '' && styles.unnamed)}>
      {name === '' ? format(m.exampleUnnamed) : name}
    </span>
  )

  const marks = {
    'data-testid': 'formula-test-case',
    'data-legal': legal,
    'data-verdict': verdict,
    'data-index': index,
    role: 'button' as const,
    tabIndex: 0,
    'aria-haspopup': 'dialog' as const,
    onClick: onOpen,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen()
    },
  }

  if (narrow)
    return (
      <div {...marks} {...stylex.props(styles.case, styles.card, open && styles.caseOpen)}>
        <div {...stylex.props(styles.cardLine)}>
          {named}
          <span {...stylex.props(styles.spring)} />
          {verdictWords}
          {actions}
        </div>
        <span {...stylex.props(styles.cardFacts)}>
          {shown.map((fact) => (
            <span key={fact.label} {...stylex.props(styles.cardFact)}>
              <span {...stylex.props(styles.factLabel)}>{fact.label}</span>
              <span {...stylex.props(styles.factValue)}>{fact.value}</span>
            </span>
          ))}
          {rest > 0 ? (
            <span {...stylex.props(styles.rest)}>{format(m.inputMore, { count: rest })}</span>
          ) : null}
        </span>
        <span {...stylex.props(styles.cardNumbers)}>
          <span>
            {expected === '' ? format(m.expectedNone) : format(m.expectedIs, { value: expected })}
          </span>
          <span {...stylex.props(outcome?.passed === false && fresh && styles.wrong)}>
            {actual === undefined ? format(m.actualNone) : format(m.actualIs, { value: actual })}
          </span>
        </span>
      </div>
    )

  return (
    <div
      {...marks}
      {...stylex.props(
        exampleStyles.columns,
        exampleStyles.row,
        styles.case,
        open && styles.caseOpen,
      )}
    >
      {named}
      <span {...stylex.props(styles.facts)}>
        {shown.map((fact) => (
          <span key={fact.label} {...stylex.props(styles.fact)}>
            <span {...stylex.props(styles.factLabel)}>{fact.label}</span>
            <span {...stylex.props(styles.factValue)}>{fact.value}</span>
          </span>
        ))}
        {rest > 0 ? (
          <span {...stylex.props(styles.rest)}>{format(m.inputMore, { count: rest })}</span>
        ) : null}
      </span>
      <span {...stylex.props(styles.number, styles.expected, expected === '' && styles.absent)}>
        {expected === '' ? format(m.expectedNone) : expected}
      </span>
      <span
        {...stylex.props(
          styles.number,
          actual === undefined && styles.absent,
          outcome?.passed === false && fresh && styles.wrong,
        )}
      >
        {actual ?? format(m.actualNone)}
      </span>
      <span {...stylex.props(styles.verdictCell)}>{verdictWords}</span>
      {actions}
    </div>
  )
}
