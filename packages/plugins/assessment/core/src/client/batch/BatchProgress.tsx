import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Ticker } from '@qualy/ui/ticker'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { assessmentMessages as m } from '../i18n.ts'
import {
  displayKey,
  progressOf,
  spanMessage,
  tickOf,
  toneOf,
  type TimelineLike,
} from './progress.ts'

// Where a batch is right now, in one line: the stage it is in, and how long
// until the next one - or, when nothing follows it yet, how long it has been
// running.
//
// It re-reads the clock rather than the server: nothing about the answer
// depends on anything the server would say differently a second later, and a
// bar that polls once a second to tell you a second has passed is a bar that
// costs a request per second. The interval follows the unit shown, so days
// tick by the minute and seconds by the second.
//
// Everything it draws is one line of text, with a small ring for how far
// through the stage is. The batch is the subject of the screen below; this
// only says where it has got to, so it is sized and coloured to be read after
// everything else - the colour arrives when the time does, not before.

// it breathes only once the time is short: an animation that never stops is
// decoration, and decoration is what people stop seeing
const breathe = stylex.keyframes({
  '50%': { opacity: 0.5 },
})

const styles = stylex.create({
  root: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: {
      default: 12,
      '@media (max-width: 639.98px)': 6,
    },
  },
  stageSeat: {
    display: {
      default: 'inline-flex',
      '@media (max-width: 767.98px)': 'none',
    },
    minWidth: 0,
    alignItems: 'baseline',
    gap: 6,
  },
  stageLabel: {
    display: {
      default: 'inline',
      '@media (max-width: 1023.98px)': 'none',
    },
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  stageBadge: {
    position: 'relative',
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    paddingInline: 8,
    paddingBlock: 2,
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: tokens.foreground,
  },
  breath: {
    position: 'absolute',
    inset: 0,
    display: {
      default: 'block',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 10%, transparent)`,
    animationName: breathe,
    animationDuration: '2.8s',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.6, 1)',
    animationIterationCount: 'infinite',
  },
  stageName: {
    position: 'relative',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rule: {
    display: {
      default: 'block',
      '@media (max-width: 767.98px)': 'none',
    },
    height: 14,
    width: 1,
    flexShrink: 0,
    backgroundColor: tokens.border,
  },
  clock: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    fontWeight: 500,
  },
  toneCalm: {
    color: tokens.mutedForeground,
  },
  toneSoon: {
    color: tokens.warningForeground,
  },
  toneUrgent: {
    color: tokens.danger,
  },
  ring: {
    width: 12,
    height: 12,
    flexShrink: 0,
    transform: 'rotate(-90deg)',
  },
  plannedLabel: {
    color: tokens.mutedForeground,
  },
})

// Only the clock takes a colour. The stage name is a fact that does not
// change when the time runs short, and a name that turns red says the stage
// itself is wrong.
const TONES = {
  calm: styles.toneCalm,
  soon: styles.toneSoon,
  urgent: styles.toneUrgent,
} as const

/**
 * How far through, as a ring rather than a bar.
 *
 * A bar under the line has to be as wide as the line, which makes a rule
 * across the top of the page out of a detail; a ring is the size of the text
 * beside it and stays a detail.
 */
function Ring({ fraction }: { fraction: number }) {
  const radius = 5
  const circumference = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 14 14" {...stylex.props(styles.ring)} aria-hidden>
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.2"
      />
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
      />
    </svg>
  )
}

export function BatchProgress({
  timeline,
  showStage = false,
  dense = false,
  xstyle,
}: {
  timeline: readonly TimelineLike[]
  /** the bar names the stage; a card has already said it on the line above */
  showStage?: boolean
  /** one unit, whatever the window: the row it sits in is out of room */
  dense?: boolean
  xstyle?: stylex.StyleXStyles
}) {
  const { format, locale } = useI18n()
  // One threshold: under a tablet the bar has no room for the stage, so the
  // stage goes and the clock takes its name instead - "3 hours left in stage"
  // rather than a number beside nothing.
  const tight = useIsBelow(768)
  const form = dense || tight ? 'bare' : 'full'
  const [now, setNow] = useState(() => Date.now())
  const progress = progressOf(timeline, now)
  const tick = tickOf(progress)
  // the clock is read on the interval; the component is only told about it
  // when the reading would look different
  const shown = useRef(displayKey(progress))
  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now()
      const key = displayKey(progressOf(timeline, at))
      if (key === shown.current) return
      shown.current = key
      setNow(at)
    }, tick)
    return () => clearInterval(timer)
  }, [tick, timeline])

  const current = timeline.find((entry) => entry.status === 'current')
  const stage = showStage ? (current?.displayName ?? null) : null

  const said =
    progress.kind === 'until' || progress.kind === 'since'
      ? // one call, not two: it is pure, but it is also called on every tick
        // of every card in the list
        ((span) => format(span.message as never, span.values as never))(
          spanMessage(m, progress, form),
        )
      : progress.kind === 'starts'
        ? new Date(progress.at).toLocaleString(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : null

  if (stage === null && said === null) return null

  const tone = TONES[toneOf(progress)]
  const filled = progress.kind === 'until' ? progress.fraction : null

  return (
    <span {...stylex.props(styles.root, xstyle)}>
      {stage !== null && (
        // "审核期" on its own is a word, not a fact about this batch: whoever
        // reads it has to already know that the bar names the stage the batch
        // is in. The label is narrower than the name it introduces, so it is
        // the first thing dropped when the bar runs out of room.
        <span data-slot="stage" {...stylex.props(styles.stageSeat)}>
          <span {...stylex.props(styles.stageLabel)}>{format(m.currentStage)}</span>
          <Badge variant="secondary" className={stylex.props(styles.stageBadge).className}>
            {toneOf(progress) === 'urgent' && <span aria-hidden {...stylex.props(styles.breath)} />}
            <span {...stylex.props(styles.stageName)}>{stage}</span>
          </Badge>
        </span>
      )}
      {stage !== null && said !== null && (
        // a rule rather than more space: the two halves answer different
        // questions, and at a glance the gap alone read as one long phrase
        <span aria-hidden {...stylex.props(styles.rule)} />
      )}
      {said !== null && (
        <span
          // What the clock says, as a fact rather than as a sentence: the
          // kind of span and its own number, so a test about "39 minutes
          // left" asks for 39 rather than for the phrasing around it.
          data-testid="stage-clock"
          data-span={progress.kind}
          data-form={form}
          {...(progress.kind === 'until' || progress.kind === 'since'
            ? {
                'data-unit': progress.span.unit,
                'data-count': String(progress.span.value),
                'data-rest': String(progress.span.rest),
              }
            : {})}
          {...stylex.props(styles.clock, tone)}
        >
          {filled !== null && <Ring fraction={filled} />}
          {progress.kind === 'starts' && (
            <span {...stylex.props(styles.plannedLabel)}>{format(m.plannedStart)}</span>
          )}
          <Ticker value={said} />
        </span>
      )}
    </span>
  )
}
