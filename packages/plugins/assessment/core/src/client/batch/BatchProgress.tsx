import { formatDateTime, useLocale } from '@qualy/web-i18n'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import * as stylex from '@stylexjs/stylex'
import { AtWidth } from '@qualy/ui/at-width'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Badge } from '@qualy/ui/badge'
import { Ticker } from '@qualy/ui/ticker'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { useDocumentNow } from '@qualy/web-runtime'

import { useBatchZone } from './zone.ts'
import { BatchLocalTime } from './BatchZone.tsx'
import {
  displayKey,
  progressOf,
  spanMessage,
  tickOf,
  toneOf,
  type TimelineLike,
  type Progress,
} from './progress.ts'
import { type Message } from '@qualy/i18n-contract'
import * as m from '#messages'

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
const CONTEXT_LINE_HEIGHT = 28
const RING_SIZE = 12
const CLOCK_GAP = 6
const LABEL_GAP = 6

const styles = stylex.create({
  root: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: {
      default: 12,
      [breakpoints.phone]: 6,
    },
  },
  stageSeat: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: LABEL_GAP,
  },
  stageLabel: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  // the stage as a line of text rather than as chrome: where the strip has
  // a ground of its own, a badge inside it is a second ground and the name
  // stops reading as the first thing on the line
  stagePlain: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    // the line's own size, so the name and the time beside it read as one
    fontSize: 'inherit',
    fontWeight: 500,
    color: tokens.foreground,
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
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rule: {
    display: 'block',
    height: 14,
    width: 1,
    flexShrink: 0,
    backgroundColor: tokens.border,
  },
  clock: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: CLOCK_GAP,
    fontWeight: 500,
  },
  // Until the available width has been read, let the stage and separator
  // wrap out of the painted line as a pair. The time always goes first.
  contextLine: {
    position: 'relative',
    height: CONTEXT_LINE_HEIGHT,
    maxWidth: '100%',
    overflow: 'clip',
    flexDirection: 'row-reverse',
    flexWrap: 'wrap-reverse',
    alignContent: 'flex-start',
    rowGap: 8,
  },
  contextStage: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: { default: 12, [breakpoints.phone]: 6 },
  },
  contextClock: {
    minWidth: 0,
    maxWidth: '100%',
    order: -1,
    height: CONTEXT_LINE_HEIGHT,
    flexDirection: 'row-reverse',
    flexWrap: 'wrap-reverse',
    alignContent: 'flex-start',
    overflow: 'clip',
    rowGap: 8,
  },
  contextWords: {
    display: 'inline-flex',
    order: -1,
    height: CONTEXT_LINE_HEIGHT,
    alignItems: 'center',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  contextBudget: {
    position: 'absolute',
    insetInlineStart: 0,
    width: '100cqi',
    height: 0,
    visibility: 'hidden',
    pointerEvents: 'none',
  },
  contextProbe: {
    position: 'absolute',
    insetInlineStart: 0,
    insetBlockStart: 0,
    visibility: 'hidden',
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: 'max-content',
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
    width: RING_SIZE,
    height: RING_SIZE,
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

type Clock = Exclude<Progress, { kind: 'none' }>

function clockFacts(progress: Clock) {
  return {
    'data-testid': 'stage-clock',
    'data-span': progress.kind,
    ...(progress.kind === 'until' || progress.kind === 'since'
      ? {
          'data-unit': progress.span.unit,
          'data-count': String(progress.span.value),
          'data-rest': String(progress.span.rest),
        }
      : {}),
  }
}

function StageName({ name, plain, urgent }: { name: string; plain: boolean; urgent: boolean }) {
  return plain ? (
    <span title={name} {...stylex.props(styles.stagePlain)}>
      {name}
    </span>
  ) : (
    <Badge variant="secondary" className={stylex.props(styles.stageBadge).className}>
      {urgent && <span aria-hidden {...stylex.props(styles.breath)} />}
      <span title={name} {...stylex.props(styles.stageName)}>
        {name}
      </span>
    </Badge>
  )
}

type Fit = { form: 'single' | 'full'; stage: boolean; label: boolean; ring: boolean }

function ContextProgress({
  progress,
  primary,
  full,
  stage,
  plain,
  xstyle,
}: {
  progress: Clock
  primary: string
  full: string | null
  stage: string | null
  plain: boolean
  xstyle: stylex.StyleXStyles | undefined
}) {
  const budget = useRef<HTMLSpanElement>(null)
  const probes = useRef<HTMLSpanElement>(null)
  const [fit, setFit] = useState<Fit | null>(null)
  const lastFit = useRef<Fit | null>(null)
  const hasRing = progress.kind === 'until' && progress.fraction !== null
  const label = stage !== null && !plain ? m.batch_currentStage() : null
  const planned = progress.kind === 'starts' ? m.batch_plannedStart() : null

  // Measurements cannot affect the server render or the initial hydration
  // render. The probes have the same fonts and chrome as the visible line
  // and never depend on the choices we make from their widths.
  useLayoutEffect(() => {
    const lane = budget.current
    const probe = probes.current
    if (!lane || !probe) return
    const [one, two, name, prefix, start] = Array.from(probe.children)
    const measure = (resized: boolean) => {
      const line = lane.parentElement!
      const control = line.parentElement
      const padding = !plain && control ? getComputedStyle(control) : null
      const room =
        lane.getBoundingClientRect().width -
        (padding ? parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight) : 0)
      const gap = parseFloat(getComputedStyle(line).columnGap)
      if (room <= 0 || !Number.isFinite(gap)) return
      const width = (node: Element | undefined) => node?.getBoundingClientRect().width ?? 0
      const stageWidth = width(name) + gap
      const showStage = stage !== null && width(one) + stageWidth <= room
      const stageCost = showStage ? stageWidth : 0
      const showTwo = full !== null && width(two) + stageCost <= room
      const used = (showTwo ? width(two) : width(one)) + stageCost
      const labelCost = showStage ? width(prefix) + LABEL_GAP : width(start) + CLOCK_GAP
      const showLabel = showStage
        ? label !== null && used + labelCost <= room
        : planned !== null && used + labelCost <= room
      const ring = hasRing && used + (showLabel ? labelCost : 0) + RING_SIZE + CLOCK_GAP <= room
      const next: Fit = {
        form: showTwo ? 'full' : 'single',
        stage: showStage,
        label: showLabel,
        ring,
      }
      const before = lastFit.current
      if (
        before !== null &&
        before.form === next.form &&
        before.stage === next.stage &&
        before.label === next.label &&
        before.ring === next.ring
      )
        return
      lastFit.current = next
      // A resize can invalidate a previously visible two-unit string.
      // Commit before the observer's paint, not one frame after the clip.
      if (resized) flushSync(() => setFit(next))
      else setFit(next)
    }
    measure(false)
    const observer = new ResizeObserver(() => measure(true))
    observer.observe(lane)
    for (const child of probe.children) observer.observe(child)
    return () => observer.disconnect()
  }, [stage, primary, full, label, planned, hasRing, plain])

  const tone = toneOf(progress)
  const stagePart = (prefix: ReactNode, urgent: boolean) =>
    stage !== null && (
      <span data-slot="context-stage" {...stylex.props(styles.contextStage)}>
        <span {...stylex.props(styles.stageSeat)}>
          {prefix}
          <StageName name={stage} plain={plain} urgent={urgent} />
        </span>
        <span aria-hidden {...stylex.props(styles.rule)} />
      </span>
    )
  const words = fit?.form === 'full' ? (full ?? primary) : primary
  return (
    <span {...stylex.props(styles.root, styles.contextLine, xstyle)}>
      <span ref={budget} aria-hidden {...stylex.props(styles.contextBudget)} />
      <span ref={probes} aria-hidden {...stylex.props(styles.contextProbe)}>
        <span {...stylex.props(styles.contextWords, styles.clock)}>{primary}</span>
        <span {...stylex.props(styles.contextWords, styles.clock)}>{full}</span>
        <span>{stagePart(null, false)}</span>
        <span {...stylex.props(styles.stageLabel)}>{label}</span>
        <span {...stylex.props(styles.clock, styles.plannedLabel)}>{planned}</span>
      </span>
      {(fit?.stage ?? true) &&
        stagePart(
          fit?.label ? (
            <span data-slot="current-stage-label" {...stylex.props(styles.stageLabel)}>
              {label}
            </span>
          ) : null,
          tone === 'urgent',
        )}
      <span
        {...clockFacts(progress)}
        data-form={fit?.form ?? 'single'}
        {...stylex.props(styles.clock, styles.contextClock, TONES[tone])}
      >
        {fit?.label && planned && <span {...stylex.props(styles.plannedLabel)}>{planned}</span>}
        {progress.kind === 'until' && progress.fraction !== null && (fit?.ring ?? true) && (
          <Ring fraction={progress.fraction} />
        )}
        <span data-slot="context-clock-text" {...stylex.props(styles.contextWords)}>
          {progress.kind === 'starts' ? (
            <BatchLocalTime at={progress.at}>{words}</BatchLocalTime>
          ) : (
            words
          )}
        </span>
      </span>
    </span>
  )
}

export function BatchProgress({
  timeline,
  dense = false,
  single = false,
  context,
  xstyle,
}: {
  timeline: readonly TimelineLike[]
  /** one unit, whatever the window: the row it sits in is out of room */
  dense?: boolean
  /** the larger unit alone, in a sentence: "12 days left", never the hours */
  single?: boolean
  /** The flow strip uses plain stage text and omits the stage label. */
  context?: 'bar' | 'flow-strip'
  xstyle?: stylex.StyleXStyles
}) {
  const locale = useLocale()
  const zone = useBatchZone()
  // The list and phase views keep their existing phrasing. The batch bar
  // fits its own variants independently of the viewport breakpoint.
  const tight = useIsMobile()
  const byWidth = !dense && !single
  const form = dense ? 'bare' : single ? 'single' : tight ? 'bare' : 'full'
  // read once, as a server-drawn page says it while the page takes it over
  const documentNow = useDocumentNow()
  const [now, setNow] = useState(documentNow)
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

  const sayIn = (as: typeof form) =>
    progress.kind === 'until' || progress.kind === 'since'
      ? ((span) => (span.message as Message)(span.values))(spanMessage(progress, as))
      : null
  const planned =
    progress.kind === 'starts'
      ? formatDateTime(new Date(progress.at), locale, 'date-time', zone)
      : null
  if (progress.kind === 'none') {
    // The desktop control still opens the plan when a current stage has no
    // recorded time. The flow strip already has its own explicit control.
    return context === 'bar' ? (
      <span aria-hidden {...stylex.props(styles.root, styles.contextWords, xstyle)}>
        {m.flow_full()}
      </span>
    ) : null
  }
  if (context !== undefined) {
    const stage = timeline.find((entry) => entry.status === 'current')?.displayName ?? null
    return (
      <ContextProgress
        progress={progress}
        primary={planned ?? sayIn('single') ?? ''}
        full={progress.kind !== 'starts' && progress.span.rest > 0 ? sayIn('full') : null}
        stage={stage}
        plain={context === 'flow-strip'}
        xstyle={xstyle}
      />
    )
  }

  const tone = TONES[toneOf(progress)]
  const said = planned ?? (byWidth ? null : sayIn(form))
  return (
    <span {...stylex.props(styles.root, xstyle)}>
      <span {...clockFacts(progress)} data-form={form} {...stylex.props(styles.clock, tone)}>
        {progress.kind === 'until' && progress.fraction !== null && (
          <Ring fraction={progress.fraction} />
        )}
        {progress.kind === 'starts' ? (
          <>
            <span {...stylex.props(styles.plannedLabel)}>{m.batch_plannedStart()}</span>
            <BatchLocalTime at={progress.at}>{planned}</BatchLocalTime>
          </>
        ) : said !== null ? (
          <Ticker value={said} />
        ) : (
          <>
            <AtWidth as="span" below={768}>
              <Ticker value={sayIn('bare') ?? ''} />
            </AtWidth>
            <AtWidth as="span" from={768}>
              <Ticker value={sayIn('full') ?? ''} />
            </AtWidth>
          </>
        )}
      </span>
    </span>
  )
}
