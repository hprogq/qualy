import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { assessmentMessages as m } from '../../i18n.ts'
import { Dot } from './Rows.tsx'
import type { EditorProblem } from './model.ts'
import { AREA_LABEL, problemWords } from './words.ts'

// Everything still standing between the question and a save, opened from
// the tab bar: one line per thing, saying what it is, why, and which tab
// it is on. Pressing one goes there.

const styles = stylex.create({
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 36,
    fontFamily: 'inherit',
    fontSize: 13,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  triggerPending: { color: tokens.warningForeground },
  triggerOk: { color: tokens.mutedForeground, cursor: 'default' },
  panel: { padding: 0 },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  headTitle: { fontSize: 13.5, fontWeight: 600 },
  spacer: { flexGrow: 1 },
  headHint: { fontSize: 12, color: tokens.mutedForeground },
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingInline: 16,
    paddingBlock: 6,
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
    borderWidth: 0,
    cursor: 'pointer',
  },
  words: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 2 },
  subject: {
    fontSize: 13.5,
    lineHeight: 1.3,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  reason: { fontSize: 12, lineHeight: 1.3, color: tokens.mutedForeground },
  area: { fontSize: 12, color: tokens.mutedForeground, whiteSpace: 'nowrap' },
  icon13: { width: 13, height: 13 },
  icon14: { width: 14, height: 14, color: tokens.mutedForeground },
})

export function PendingList({
  problems,
  onGo,
}: {
  problems: readonly EditorProblem[]
  onGo: (problem: EditorProblem) => void
}) {
  const { format } = useI18n()
  const [open, setOpen] = useState(false)
  if (problems.length === 0) {
    return (
      <span {...stylex.props(styles.trigger, styles.triggerOk)} data-testid="pending-none">
        <Dot tone="ok" />
        {format(m.itemsPendingNone)}
      </span>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...stylex.props(styles.trigger, styles.triggerPending)}
          data-testid="pending-trigger"
          data-count={problems.length}
        >
          <Dot tone="pending" />
          {format(m.itemsPendingCount, { count: problems.length })}
          <ChevronDownIcon aria-hidden {...stylex.props(styles.icon13)} />
        </button>
      </PopoverTrigger>
      <PopoverContent width={440} xstyle={styles.panel}>
        <div {...stylex.props(styles.head)}>
          <Dot tone="pending" />
          <span {...stylex.props(styles.headTitle)}>
            {format(m.itemsPendingCount, { count: problems.length })}
          </span>
          <span {...stylex.props(styles.spacer)} />
          <span {...stylex.props(styles.headHint)}>{format(m.itemsPendingHint)}</span>
        </div>
        <div data-testid="pending-list">
          {problems.map((problem, index) => (
            <button
              key={`${problem.code}:${index}`}
              type="button"
              {...stylex.props(styles.row)}
              data-testid="pending-row"
              data-code={problem.code}
              onClick={() => {
                setOpen(false)
                onGo(problem)
              }}
            >
              <span {...stylex.props(styles.words)}>
                <span {...stylex.props(styles.subject)}>
                  {problem.subject !== undefined && problem.subject !== ''
                    ? problem.subject
                    : format(AREA_LABEL[problem.area])}
                </span>
                <span {...stylex.props(styles.reason)}>{problemWords(problem, format)}</span>
              </span>
              <span {...stylex.props(styles.area)}>{format(AREA_LABEL[problem.area])}</span>
              <ChevronRightIcon aria-hidden {...stylex.props(styles.icon14)} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
