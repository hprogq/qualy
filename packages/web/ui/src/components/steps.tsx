import { CheckIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'

// Where you are in a short guided form. Presentational only: the owner keeps
// the index, because it is the owner that knows when a step is complete.

const styles = stylex.create({
  list: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  item: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
    gap: 12,
  },
  connector: {
    height: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    backgroundColor: tokens.border,
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    borderRadius: tokens.radiusMd,
    outline: 'none',
    boxShadow: {
      default: 'none',
      ':focus-visible': `0 0 0 2px ${tokens.focusRing}`,
    },
  },
  dot: {
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
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  dotDone: {
    borderColor: tokens.primary,
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
  dotActive: {
    borderColor: tokens.primary,
    color: tokens.foreground,
  },
  check: { width: 14, height: 14 },
  words: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  wordsActive: {
    fontWeight: 500,
    color: tokens.foreground,
  },
})

export function Steps({
  steps,
  current,
  onSelect,
  className,
}: {
  steps: readonly string[]
  current: number
  /** given, each step becomes a way back to that part of the form */
  onSelect?: (index: number) => void
  className?: string
}) {
  const sx = stylex.props(styles.list)
  return (
    <ol {...sx} className={clsx(sx.className, className)}>
      {steps.map((label, index) => {
        const done = index < current
        const active = index === current
        return (
          <li key={label} {...stylex.props(styles.item)}>
            <StepLabel
              index={index}
              label={label}
              done={done}
              active={active}
              {...(onSelect ? { onSelect } : {})}
            />
            {index < steps.length - 1 && <span aria-hidden {...stylex.props(styles.connector)} />}
          </li>
        )
      })}
    </ol>
  )
}

function StepLabel({
  index,
  label,
  done,
  active,
  onSelect,
}: {
  index: number
  label: string
  done: boolean
  active: boolean
  onSelect?: (index: number) => void
}) {
  const body = (
    <>
      <span
        aria-hidden
        {...stylex.props(styles.dot, done && styles.dotDone, active && styles.dotActive)}
      >
        {done ? <CheckIcon {...stylex.props(styles.check)} /> : index + 1}
      </span>
      <span {...stylex.props(styles.words, active && styles.wordsActive)}>{label}</span>
    </>
  )
  if (!onSelect) {
    return (
      <span aria-current={active ? 'step' : undefined} {...stylex.props(styles.label)}>
        {body}
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-current={active ? 'step' : undefined}
      {...stylex.props(styles.label, styles.button)}
      onClick={() => onSelect(index)}
    >
      {body}
    </button>
  )
}
