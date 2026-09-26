'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, XIcon } from 'lucide-react'
import { tokens } from '../theme/tokens.stylex.ts'
import { useIsMobile } from '../hooks/use-mobile.ts'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './sheet.tsx'
import { Button } from './button.tsx'

// Where somebody stands, said from the end.
//
// The last step is the answer - which class, which office - and the steps
// before it only say how to get there, so when the line is too narrow it is
// the front that gives way: the unit itself always shows, then its parent if
// there is room, then the one before, and a mark at the front says something
// was left off. Nothing is ever cut in the middle of a name, except the unit
// itself when even it alone is wider than the line.
//
// The steps are laid out in reverse and allowed to wrap onto lines that are
// clipped away, which is how "as many whole steps as fit, counted from the
// end" is said without measuring every name: whatever does not fit the first
// line is simply not on it. Whether anything wrapped is the one thing read
// back from the layout, to decide whether the mark is shown.
//
// Three ways to hold one: said and nothing more; each step a way to look at
// that unit; or the whole chain a press away, every level on a line of its
// own - a popover beside a pointer, a sheet from the foot on a phone.

const LINE = 20

const styles = stylex.create({
  seat: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
    fontSize: 12.5,
    lineHeight: `${String(LINE)}px`,
  },
  more: { flexShrink: 0, color: tokens.mutedForeground },
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
  },
  slash: {
    flexShrink: 0,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  // a step that is a way in: the same words, with a hand and a hover
  pick: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    cursor: 'pointer',
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
  },
  last: { color: tokens.foreground },
  // The whole path as one control. Quiet at rest, the way a fact is, and
  // plainly pressable under a pointer or the keyboard: an underline on the
  // words and the mark at its end.
  trigger: {
    display: 'flex',
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'center',
    gap: 2,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: 4,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `0 0 0 2px ${tokens.focusRing}` },
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textDecorationColor: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
    textUnderlineOffset: 3,
  },
  triggerPath: { minWidth: 0, flexGrow: 1 },
  triggerMark: {
    width: 12,
    height: 12,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  // ---- the chain, one level to a line ----
  chainHead: {
    margin: 0,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  chain: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  level: {
    position: 'relative',
    display: 'flex',
    minHeight: 30,
    alignItems: 'center',
    gap: 10,
    paddingInlineStart: 2,
    fontSize: 13.5,
    lineHeight: '1.25rem',
    color: tokens.surfaceMutedForeground,
    overflowWrap: 'anywhere',
  },
  // the rule between one level's mark and the next, drawn by the level above
  joint: {
    position: 'absolute',
    insetInlineStart: 5.5,
    top: 19,
    bottom: -11,
    width: 1,
    backgroundColor: tokens.border,
  },
  dot: {
    position: 'relative',
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.surfaceElevated,
  },
  levelHere: { fontWeight: 600, color: tokens.foreground },
  dotHere: { borderColor: tokens.foreground, backgroundColor: tokens.foreground },
  sheetBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingInline: 24,
    paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
})

export interface UnitPathProps {
  /** root first, the unit itself last; whether the root is on it is the caller's to say */
  steps: readonly string[]
  /** the hint the whole path is given by; the steps joined when absent */
  title?: string
  /** each step as a way to look at that unit, by its place in `steps` */
  onPick?: (index: number) => void
  /** spoken before a step's name, where steps can be pressed */
  pickLabel?: string
  /**
   * Whether the unit itself is said darker than the steps above it; so by
   * default where the steps can be pressed, and not where they are only
   * said, beside facts said just as quietly.
   */
  emphasis?: 'last' | 'none'
  /**
   * The whole chain, a press away. The path becomes one control that opens
   * every level on a line of its own, the unit itself marked. `label` names
   * the control and heads the panel; `closeLabel` names the way out on a
   * phone, where the panel rises from the foot. `levels` is the chain the
   * panel lists where it holds more than the line says - the root a whole
   * roster shares, left off the line and not off the chain. Steps are not
   * pressable one by one while the whole path is.
   */
  chain?: { label: string; closeLabel: string; levels?: readonly string[] }
  /** the formal StyleX extension seat, on the line */
  xstyle?: stylex.StyleXStyles
}

const SEPARATOR = ' / '

export function UnitPath({
  steps,
  title,
  onPick,
  pickLabel,
  emphasis,
  chain,
  xstyle,
}: UnitPathProps) {
  const whole = steps.join(SEPARATOR)
  if (chain !== undefined) {
    return <ChainTrigger steps={steps} chain={chain} xstyle={xstyle} />
  }
  return (
    <PathLine
      steps={steps}
      title={title ?? whole}
      onPick={onPick}
      pickLabel={pickLabel}
      emphasis={emphasis ?? (onPick === undefined ? 'none' : 'last')}
      xstyle={xstyle}
    />
  )
}

function PathLine({
  steps,
  title,
  onPick,
  pickLabel,
  emphasis,
  xstyle,
}: {
  steps: readonly string[]
  title: string | undefined
  onPick: ((index: number) => void) | undefined
  pickLabel: string | undefined
  emphasis: 'last' | 'none'
  xstyle: stylex.StyleXStyles | undefined
}) {
  const seat = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)
  const whole = steps.join(SEPARATOR)

  useLayoutEffect(() => {
    const node = seat.current
    if (node === null) return
    const read = () => setClipped(node.scrollHeight > node.clientHeight + 1)
    read()
    const watch = new ResizeObserver(read)
    watch.observe(node)
    return () => watch.disconnect()
  }, [whole])

  const last = steps.length - 1
  return (
    <span
      {...stylex.props(styles.seat, xstyle)}
      title={title}
      data-testid="unit-path"
      data-clipped={clipped}
      data-steps={steps.length}
    >
      {clipped && (
        <span aria-hidden {...stylex.props(styles.more)}>
          …
        </span>
      )}
      <span ref={seat} {...stylex.props(styles.steps)}>
        {steps
          .map((name, index) => ({ name, index }))
          .reverse()
          .map(({ name, index }) => (
            <span key={index} data-path-step={index} {...stylex.props(styles.step)}>
              {/* the slash belongs to the step after it, so a step that is
                  left off takes its slash along */}
              {index !== 0 && (
                <span aria-hidden {...stylex.props(styles.slash)}>
                  /
                </span>
              )}
              {onPick === undefined ? (
                <span
                  {...stylex.props(
                    styles.name,
                    emphasis === 'last' && index === last && styles.last,
                  )}
                >
                  {name}
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={pickLabel === undefined ? name : `${pickLabel} ${name}`}
                  {...stylex.props(
                    styles.name,
                    styles.pick,
                    emphasis === 'last' && index === last && styles.last,
                  )}
                  onClick={() => onPick(index)}
                >
                  {name}
                </button>
              )}
            </span>
          ))}
      </span>
    </span>
  )
}

function ChainTrigger({
  steps,
  chain,
  xstyle,
}: {
  steps: readonly string[]
  chain: { label: string; closeLabel: string; levels?: readonly string[] }
  xstyle: stylex.StyleXStyles | undefined
}) {
  const phone = useIsMobile()
  const levels = chain.levels ?? steps
  const [open, setOpen] = useState(false)
  const line = (
    <span {...stylex.props(styles.triggerPath)}>
      <PathLine
        steps={steps}
        title={undefined}
        onPick={undefined}
        pickLabel={undefined}
        emphasis="last"
        xstyle={xstyle}
      />
    </span>
  )
  const trigger = (
    <button
      type="button"
      // the words on the line may be cut at the front; the name says all of it
      aria-label={`${chain.label} ${levels.join(SEPARATOR)}`}
      data-testid="unit-chain-open"
      {...stylex.props(styles.trigger)}
      {...(phone ? { onClick: () => setOpen(true), 'aria-haspopup': 'dialog' as const } : {})}
    >
      {line}
      <ChevronDownIcon aria-hidden {...stylex.props(styles.triggerMark)} />
    </button>
  )
  if (phone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" showCloseButton={false} data-testid="unit-chain">
            <SheetHeader className={stylex.props(styles.sheetHead).className}>
              <SheetTitle>{chain.label}</SheetTitle>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={chain.closeLabel}
                onClick={() => setOpen(false)}
              >
                <XIcon aria-hidden />
              </Button>
            </SheetHeader>
            <div {...stylex.props(styles.sheetBody)}>
              <ChainList steps={levels} />
            </div>
          </SheetContent>
        </Sheet>
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" width={320}>
        <div data-testid="unit-chain" role="group" aria-label={chain.label}>
          <p {...stylex.props(styles.chainHead)}>{chain.label}</p>
          <ChainList steps={levels} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** every level, from the top down, the unit itself marked as where they are */
function ChainList({ steps }: { steps: readonly string[] }) {
  const last = steps.length - 1
  return (
    <ol {...stylex.props(styles.chain)}>
      {steps.map((name, index) => (
        <li
          key={index}
          data-level={index}
          aria-current={index === last ? 'true' : undefined}
          {...stylex.props(styles.level, index === last && styles.levelHere)}
        >
          {index !== last && <span aria-hidden {...stylex.props(styles.joint)} />}
          <span aria-hidden {...stylex.props(styles.dot, index === last && styles.dotHere)} />
          <span>{name}</span>
        </li>
      ))}
    </ol>
  )
}
