import { useLayoutEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

// Where somebody stands, said from the end.
//
// The last step is the answer - which class, which office - and the steps
// before it only say how to get there, so when the cell is too narrow it is
// the front that gives way: the unit itself always shows, then its parent if
// there is room, then the one before, and a mark at the front says something
// was left off. Nothing is ever cut in the middle of a name.
//
// The steps are laid out in reverse and allowed to wrap onto lines that are
// clipped away, which is how "as many whole steps as fit, counted from the
// end" is said without measuring every name: whatever does not fit the first
// line is simply not on it. Whether anything wrapped is the one thing read
// back from the layout, to decide whether the mark is shown.
//
// Each step is a way to look at that unit's roster, so a path is also the
// quickest filter on the screen.

const LINE = 20

const styles = stylex.create({
  seat: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 4 },
  // the same hairline a divided cell draws, for a fact that is not one
  divided: {
    '::before': {
      content: { default: 'none', [breakpoints.phone]: '"|"' },
      marginInlineEnd: 8,
      color: `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
    },
  },
  more: { flexShrink: 0, fontSize: 12.5, color: tokens.mutedForeground },
  // said, not offered: no hand, no hover, and the quiet of the facts beside it
  told: {
    cursor: 'default',
    fontWeight: 400,
    color: tokens.mutedForeground,
    backgroundColor: 'transparent',
    textDecorationLine: 'none',
  },
  steps: {
    display: 'flex',
    minWidth: 0,
    height: LINE,
    flexGrow: 1,
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    columnGap: 4,
    overflow: 'hidden',
  },
  step: {
    display: 'inline-flex',
    maxWidth: '100%',
    height: LINE,
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
    fontSize: 12.5,
  },
  slash: { flexShrink: 0, color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)` },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: tokens.mutedForeground,
    cursor: 'pointer',
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
  },
  last: { color: tokens.foreground },
})

export interface PathStep {
  readonly id: string
  readonly name: string
}

export function UnitPath({
  steps,
  onPick,
  pickLabel,
  divided = false,
  plain = false,
}: {
  /** root first, the unit itself last */
  steps: readonly PathStep[]
  onPick: (unitId: string) => void
  /** spoken before a step's name: what pressing it does */
  pickLabel: string
  /** a hairline before it, where it shares a line with the facts before it */
  divided?: boolean
  /**
   * The address as words rather than as doors.
   *
   * On a roster narrow enough that the whole row opens somebody's page, a
   * unit drawn as a control is a second thing to press inside a row that is
   * already one press - and it is the only dark word in a line of grey
   * facts, which reads as the thing to press.
   */
  plain?: boolean
}) {
  const seat = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)
  const whole = steps.map((step) => step.name).join(' / ')

  useLayoutEffect(() => {
    const node = seat.current
    if (node === null) return
    const read = () => setClipped(node.scrollHeight > node.clientHeight + 1)
    read()
    const watch = new ResizeObserver(read)
    watch.observe(node)
    return () => watch.disconnect()
  }, [whole])

  return (
    <span
      {...stylex.props(styles.seat, divided && styles.divided)}
      title={whole}
      data-testid="unit-path"
      data-clipped={clipped}
    >
      {clipped && (
        <span aria-hidden {...stylex.props(styles.more)}>
          …
        </span>
      )}
      <span ref={seat} {...stylex.props(styles.steps)}>
        {[...steps].reverse().map((step, fromEnd) => (
          <span key={step.id} {...stylex.props(styles.step)}>
            {/* the slash belongs to the step after it, so a step that is
                left off takes its slash along */}
            {fromEnd !== steps.length - 1 && (
              <span aria-hidden {...stylex.props(styles.slash)}>
                /
              </span>
            )}
            {plain ? (
              <span
                data-path-step={step.id}
                {...stylex.props(styles.name, styles.told)}
              >
                {step.name}
              </span>
            ) : (
              <button
                type="button"
                aria-label={`${pickLabel} ${step.name}`}
                data-path-step={step.id}
                {...stylex.props(styles.name, fromEnd === 0 && styles.last)}
                onClick={() => onPick(step.id)}
              >
                {step.name}
              </button>
            )}
          </span>
        ))}
      </span>
    </span>
  )
}
