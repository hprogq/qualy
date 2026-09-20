import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { assessmentMessages as m } from '../../i18n.ts'
import { Dot } from './Rows.tsx'
import type { EditorProblem } from './model.ts'
import { AREA_LABEL, BLOCK_LABEL, problemWords } from './words.ts'

// Everything still standing between the question and a save, as a capsule at
// the end of the tab row: how many, and - opened - one line per thing saying
// where it is and what it is. Pressing one goes there.
//
// Amber while things are only waiting to be set; red once something set is
// wrong, and red with the words "not saved" once a save has been refused.
// The same list whoever found the fault: a thing the server refused sits in
// it beside a thing this screen noticed, in one sentence each.

const styles = stylex.create({
  capsule: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 28,
    marginBottom: 5,
    paddingInline: 10,
    borderRadius: '9999px',
    borderWidth: 0,
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  capsulePending: { color: tokens.warningForeground },
  capsuleError: { color: tokens.danger },
  capsuleOk: { color: tokens.mutedForeground, cursor: 'default', fontWeight: 400 },
  panel: { padding: 0 },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingInline: 14,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  headTitle: { fontSize: 13.5, fontWeight: 600 },
  spacer: { flexGrow: 1 },
  headHint: { fontSize: 12, color: tokens.mutedForeground },
  icon12: { width: 12, height: 12 },
})

const rowStyles = stylex.create({
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    minHeight: 40,
    paddingInline: 14,
    paddingBlock: 8,
    borderWidth: 0,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
    cursor: 'pointer',
  },
  where: { flexShrink: 0, fontSize: 12.5, color: tokens.mutedForeground, whiteSpace: 'nowrap' },
  what: {
    minWidth: 0,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
  },
  subject: { fontWeight: 500 },
  go: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 3,
    fontSize: 12.5,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  icon12: { width: 12, height: 12 },
})

/** one problem as a line: where it is, what it is, and the way to it */
export function ProblemRows({
  problems,
  onGo,
}: {
  problems: readonly EditorProblem[]
  onGo: (problem: EditorProblem) => void
}) {
  const { format } = useI18n()
  return (
    <div data-testid="pending-list">
      {problems.map((problem, index) => {
        const words = problemWords(problem, format)
        return (
          <button
            key={`${problem.code}:${index}`}
            type="button"
            {...stylex.props(rowStyles.row)}
            data-testid="pending-row"
            data-code={problem.code}
            data-tone={problem.tone}
            onClick={() => onGo(problem)}
          >
            <span {...stylex.props(rowStyles.where)}>
              {format(AREA_LABEL[problem.area])}
              {problem.block !== undefined && problem.block !== 'basics' && (
                <>
                  {'　'}
                  {format(BLOCK_LABEL[problem.block])}
                </>
              )}
            </span>
            <span {...stylex.props(rowStyles.what)} title={words}>
              {problem.subject !== undefined && problem.subject !== '' && (
                <span {...stylex.props(rowStyles.subject)}>{problem.subject} </span>
              )}
              {words}
            </span>
            <span {...stylex.props(rowStyles.go)}>
              {format(m.itemsGo)}
              <ChevronRightIcon aria-hidden {...stylex.props(rowStyles.icon12)} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function PendingList({
  problems,
  failed,
  onGo,
}: {
  problems: readonly EditorProblem[]
  /** a save was refused, and what it was refused for is still unfixed */
  failed: boolean
  onGo: (problem: EditorProblem) => void
}) {
  const { format } = useI18n()
  const [open, setOpen] = useState(false)
  if (problems.length === 0) {
    return (
      <span {...stylex.props(styles.capsule, styles.capsuleOk)} data-testid="pending-none">
        <Dot tone="ok" />
        {format(m.itemsPendingNone)}
      </span>
    )
  }
  const wrong = problems.filter((one) => one.tone === 'error').length
  const tone = wrong > 0 ? 'error' : 'pending'
  const words = failed
    ? format(m.itemsSaveFailedCount, { count: problems.length })
    : wrong > 0
      ? format(m.itemsFixCount, { count: problems.length })
      : format(m.itemsPendingCount, { count: problems.length })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...stylex.props(
            styles.capsule,
            tone === 'error' ? styles.capsuleError : styles.capsulePending,
          )}
          data-testid="pending-trigger"
          data-count={problems.length}
          data-tone={tone}
          data-failed={failed}
        >
          <Dot tone={tone} />
          {words}
          <ChevronDownIcon aria-hidden {...stylex.props(styles.icon12)} />
        </button>
      </PopoverTrigger>
      <PopoverContent width={520} xstyle={styles.panel}>
        <div {...stylex.props(styles.head)}>
          <Dot tone={tone} />
          <span {...stylex.props(styles.headTitle)}>{words}</span>
          <span {...stylex.props(styles.spacer)} />
          <span {...stylex.props(styles.headHint)}>{format(m.itemsPendingHint)}</span>
        </div>
        <ProblemRows
          problems={problems}
          onGo={(problem) => {
            setOpen(false)
            onGo(problem)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
