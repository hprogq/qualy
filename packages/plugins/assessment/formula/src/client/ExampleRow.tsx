import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { MoreVerticalIcon, PencilLineIcon } from 'lucide-react'
import { formulaMessages as m } from './i18n.ts'
import { exampleStyles } from './example-grid.ts'

// One example, as a line of the table under the editor.
//
// A formula collects dozens of these, so the line is dense: its name, its
// input in brief, what it should come to and what it came to, and the
// verdict. Pressing it opens the case in a sheet beside the editor, where
// its fields have room; everything else a case can be asked to do - run on
// its own, fill the try-run with its input, be duplicated or removed - sits
// in its menu rather than on the line.

const styles = stylex.create({
  case: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  line: {
    minHeight: 34,
    cursor: 'pointer',
    backgroundColor: { default: null, ':hover': tokens.surfaceInset },
  },
  lineOpen: { backgroundColor: tokens.selectedSurface },
  toggle: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    height: 34,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 13,
    color: tokens.foreground,
    textAlign: 'left',
    cursor: 'pointer',
  },
  pen: { flexShrink: 0, color: tokens.mutedForeground },
  name: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  unnamed: { color: tokens.mutedForeground },
  summary: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 11.5,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  number: {
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
  menu: { justifySelf: 'end' },
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
  inputSummary,
  expected,
  outcome,
  verdict,
  legal,
  open,
  onOpen,
  locked,
  running,
  onRun,
  onLoadIntoTry,
  onDuplicate,
  onRemove,
}: {
  readonly index: number
  readonly name: string
  readonly inputSummary: string
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
  readonly onRun: () => void
  readonly onLoadIntoTry: () => void
  readonly onDuplicate: () => void
  readonly onRemove: () => void
}) {
  const { format } = useI18n()
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
  const said = (
    <>
      <span aria-hidden {...stylex.props(styles.dot, verdictLook[1])} />
      {format(words)}
    </>
  )

  return (
    <div
      {...stylex.props(styles.case)}
      data-testid="formula-test-case"
      data-legal={legal}
      data-verdict={verdict}
      data-index={index}
    >
      <div
        onClick={onOpen}
        {...stylex.props(exampleStyles.columns, styles.line, open && styles.lineOpen)}
      >
        <button
          type="button"
          aria-haspopup="dialog"
          data-testid="formula-test-open"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
          {...stylex.props(styles.toggle)}
        >
          <PencilLineIcon size={13} aria-hidden {...stylex.props(styles.pen)} />
          <span {...stylex.props(styles.name, name === '' && styles.unnamed)}>
            {name === '' ? format(m.exampleUnnamed) : name}
          </span>
        </button>
        <span {...stylex.props(styles.summary, exampleStyles.wide)} title={inputSummary}>
          {inputSummary}
        </span>
        <span
          {...stylex.props(
            styles.number,
            styles.expected,
            expected === '' && styles.absent,
            exampleStyles.wide,
          )}
        >
          {expected === '' ? '—' : expected}
        </span>
        <span
          {...stylex.props(
            styles.number,
            actual === undefined && styles.absent,
            outcome?.passed === false && fresh && styles.wrong,
            exampleStyles.wide,
          )}
        >
          {actual ?? '—'}
        </span>
        {outcome === undefined ? (
          <span {...stylex.props(styles.verdict, verdictLook[0])}>{said}</span>
        ) : (
          <span
            data-testid="formula-case-result"
            data-passed={fresh ? outcome.passed : undefined}
            data-stale={fresh ? undefined : true}
            title={fresh ? undefined : format(m.resultStale)}
            {...stylex.props(styles.verdict, verdictLook[0])}
          >
            {said}
          </span>
        )}
        <span onClick={(event) => event.stopPropagation()} {...stylex.props(styles.menu)}>
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
      </div>
    </div>
  )
}
