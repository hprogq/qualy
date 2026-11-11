import { formatDateTime, useLocale } from '@qualy/web-i18n'
import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { AtWidth } from '@qualy/ui/at-width'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Badge } from '@qualy/ui/badge'
import { Ticker } from '@qualy/ui/ticker'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
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
import { batchProgressControl, countdownColors } from './countdown.stylex.ts'

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
  // Each candidate is laid out by CSS, including in the server HTML.
  // The zero-width strut owns the first line. A candidate too wide to fit
  // starts below that line and is clipped in its entirety. A fitting row
  // covers the simpler rows under it, on the same ground as the control.
  contextLine: {
    display: 'inline-grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    height: CONTEXT_LINE_HEIGHT,
    minWidth: 0,
    maxWidth: '100%',
    isolation: 'isolate',
  },
  contextLayer: {
    gridArea: '1 / 1',
    // Positioned descendants (notably the stage badge) must stay below
    // the next fitting row, including its opaque background.
    isolation: 'isolate',
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignContent: 'start',
    overflow: 'clip',
    height: CONTEXT_LINE_HEIGHT,
    pointerEvents: 'none',
  },
  contextStrut: { flexBasis: 0, flexShrink: 0, height: CONTEXT_LINE_HEIGHT },
  contextPaint: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 0,
    minWidth: 'max-content',
    height: CONTEXT_LINE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: { default: 12, [breakpoints.phone]: 6 },
    whiteSpace: 'nowrap',
    pointerEvents: 'auto',
    backgroundColor: {
      default: tokens.background,
      [stylex.when.ancestor(':is(:hover, :focus-visible)', batchProgressControl)]:
        tokens.surfaceMuted,
    },
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  contextPaintPlain: { justifyContent: 'flex-start' },
  contextStage: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: { default: 12, [breakpoints.phone]: 6 },
  },
  contextWords: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  contextStart: {
    minWidth: 0,
    height: CONTEXT_LINE_HEIGHT,
    overflow: 'clip',
    flexWrap: 'wrap-reverse',
    flexDirection: 'row-reverse',
    alignContent: 'flex-start',
    rowGap: 8,
  },
  startTime: {
    display: 'inline-flex',
    height: CONTEXT_LINE_HEIGHT,
    alignItems: 'center',
    order: -1,
    whiteSpace: 'nowrap',
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

function StageName({ name, plain }: { name: string; plain: boolean }) {
  return plain ? (
    <span title={name} {...stylex.props(styles.stagePlain)}>
      {name}
    </span>
  ) : (
    <Badge variant="secondary" className={stylex.props(styles.stageBadge).className}>
      <span title={name} {...stylex.props(styles.stageName)}>
        {name}
      </span>
    </Badge>
  )
}

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
  if (progress.kind === 'starts') {
    return (
      <span
        {...clockFacts(progress)}
        {...stylex.props(
          styles.root,
          styles.clock,
          styles.contextStart,
          countdownColors.calm,
          xstyle,
        )}
      >
        <span {...stylex.props(styles.plannedLabel)}>{m.batch_plannedStart()}</span>
        <span {...stylex.props(styles.startTime)}>
          <BatchLocalTime at={progress.at}>{primary}</BatchLocalTime>
        </span>
      </span>
    )
  }

  const label = stage !== null && !plain ? m.batch_currentStage() : null
  const fraction = progress.kind === 'until' ? progress.fraction : null
  const options = [
    { words: primary, stage: null, label: null, form: 'single' },
    ...(full === null ? [] : [{ words: full, stage: null, label: null, form: 'full' }]),
    ...(stage === null
      ? []
      : [
          { words: primary, stage, label: null, form: 'single' },
          ...(label === null ? [] : [{ words: primary, stage, label, form: 'single' }]),
          ...(full === null ? [] : [{ words: full, stage, label: null, form: 'full' }]),
          ...(full === null || label === null ? [] : [{ words: full, stage, label, form: 'full' }]),
        ]),
  ]
  const rows = options.flatMap((option) =>
    fraction === null
      ? [{ ...option, ring: false }]
      : [
          { ...option, ring: false },
          { ...option, ring: true },
        ],
  )
  return (
    <span {...clockFacts(progress)} {...stylex.props(styles.contextLine, xstyle)}>
      <VisuallyHidden>
        {stage === null ? (full ?? primary) : `${stage}，${full ?? primary}`}
      </VisuallyHidden>
      {rows.map((row) => (
        <span
          key={`${row.form}:${String(row.stage !== null)}:${String(row.label !== null)}:${String(row.ring)}`}
          aria-hidden
          {...stylex.props(styles.contextLayer)}
        >
          <span {...stylex.props(styles.contextStrut)} />
          <span
            data-slot="context-clock-row"
            data-form={row.form}
            {...stylex.props(styles.contextPaint, plain && styles.contextPaintPlain)}
          >
            {row.stage !== null && (
              <span data-slot="context-stage" {...stylex.props(styles.contextStage)}>
                <span {...stylex.props(styles.stageSeat)}>
                  {row.label !== null && (
                    <span data-slot="current-stage-label" {...stylex.props(styles.stageLabel)}>
                      {row.label}
                    </span>
                  )}
                  <StageName name={row.stage} plain={plain} />
                </span>
                <span {...stylex.props(styles.rule)} />
              </span>
            )}
            <span {...stylex.props(styles.clock, countdownColors[toneOf(progress)])}>
              {row.ring && fraction !== null && <Ring fraction={fraction} />}
              <span data-slot="context-clock-text" {...stylex.props(styles.contextWords)}>
                {row.words}
              </span>
            </span>
          </span>
        </span>
      ))}
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

  const tone = countdownColors[toneOf(progress)]
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
