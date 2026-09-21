import { CheckIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '../theme/tokens.stylex.ts'
import { breakpoints } from '../theme/breakpoints.stylex.ts'

// Where you are in a short guided form. Presentational only: the owner keeps
// the index, because it is the owner that knows when a step is complete.

const styles = stylex.create({
  list: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    gap: { default: 12, [breakpoints.phone]: 8 },
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
    minWidth: 8,
    height: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    backgroundColor: tokens.border,
  },
  label: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    // no word beside the dot on a phone, so no gap either
    gap: { default: 8, [breakpoints.phone]: 0 },
  },
  labelActive: { gap: 8 },
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
    // Five named steps do not fit across a phone, and the strip was simply
    // cut off at the fourth. Narrow, only the step being filled in says its
    // name; the others stay as numbered dots, which is still the whole
    // shape of the form and where in it the reader is.
    display: { default: null, [breakpoints.phone]: 'none' },
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  wordsActive: {
    display: { default: null, [breakpoints.phone]: 'inline' },
    fontWeight: 500,
    color: tokens.foreground,
  },
})

export function Steps({
  steps,
  current,
  onSelect,
  xstyle,
}: {
  steps: readonly string[]
  current: number
  /** given, each step becomes a way back to that part of the form */
  onSelect?: (index: number) => void
  xstyle?: StyleXStyles
}) {
  return (
    <ol {...stylex.props(styles.list, xstyle)}>
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
      <span
        aria-current={active ? 'step' : undefined}
        {...stylex.props(styles.label, active && styles.labelActive)}
      >
        {body}
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-current={active ? 'step' : undefined}
      {...stylex.props(styles.label, active && styles.labelActive, styles.button)}
      onClick={() => onSelect(index)}
    >
      {body}
    </button>
  )
}
