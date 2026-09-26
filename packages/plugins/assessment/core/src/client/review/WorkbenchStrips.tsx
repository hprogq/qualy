import { Kbd } from '@qualy/ui/kbd'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ListIcon,
  ChevronUpIcon,
  CircleArrowUpIcon,
} from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { GlideAcross } from '@qualy/ui/reveal'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { UnitPath } from '@qualy/ui/unit-path'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { namedChainOf } from '../roster/unit-path.ts'
import { useBeside, useFinePointer } from './pointer.ts'
import type { ReviewDto } from './model.ts'
import { PART_LABEL, WORKBENCH_PARTS, type WorkbenchPart } from './Pane.tsx'

const lg = '@media (min-width: 1024px)'
const belowLg = '@media (max-width: 1023.98px)'

const styles = stylex.create({
  // ---- where the run stands, drawn along the bar's own lower edge ----
  runTrack: {
    pointerEvents: 'none',
    position: 'absolute',
    insetInline: 0,
    bottom: -1,
    display: 'flex',
    height: 2,
    gap: 2,
  },
  runSegment: {
    height: 2,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    transitionProperty: 'background-color',
    transitionDuration: '200ms',
  },
  runSegmentDone: {
    backgroundColor: tokens.foreground,
  },
  runSegmentAt: {
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 45%, transparent)`,
  },
  runSegmentAhead: {
    backgroundColor: tokens.border,
  },
  // ---- the person bar ----
  // One line of who across a desk. Narrower, where they stand takes a line
  // of its own under the name, so the bar grows by that line rather than
  // squeezing the unit to a mark between the number and the queue key.
  personBar: {
    position: 'relative',
    display: 'flex',
    height: { default: 'auto', [lg]: 56 },
    minHeight: 56,
    flexShrink: 0,
    alignItems: 'center',
    gap: {
      default: 8,
      [lg]: 10,
    },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: {
      default: 8,
      [lg]: 16,
    },
    paddingBlock: { default: 6, [lg]: 0 },
  },
  queueKey: {
    display: 'inline-flex',
    height: 32,
    flexShrink: 0,
    gap: 4,
    paddingInline: 8,
    fontSize: 12,
  },
  queueKeyIcon: {
    width: 14,
    height: 14,
  },
  queueKeyCount: {
    display: {
      default: null,
      [belowLg]: 'none',
    },
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  // the initial is a face for the bar, and on a phone the name's own room
  // is worth more than a face: the name and the number keep the line
  avatar: {
    display: { default: null, [breakpoints.phone]: 'none' },
    width: {
      default: 32,
      [lg]: 36,
    },
    height: {
      default: 32,
      [lg]: 36,
    },
  },
  avatarFace: {
    fontSize: 14,
    fontWeight: 600,
  },
  // Who, where and what. Across a desk the unit stands on the name's line,
  // taking what the name leaves it, and the question runs under both;
  // narrower, each takes a line of its own. The words take whatever the
  // bar's keys leave them.
  personWords: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: { default: 'column', [lg]: 'row' },
    flexWrap: { default: 'nowrap', [lg]: 'wrap' },
    alignItems: { default: 'stretch', [lg]: 'baseline' },
    columnGap: 10,
    rowGap: 1,
  },
  personLine: {
    display: 'flex',
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'baseline',
    gap: {
      default: 8,
      [lg]: 10,
    },
  },
  // a name longer than the bar ends in an ellipsis rather than running
  // under the keys beside it; the number after it stays whole
  personName: {
    minWidth: 0,
    maxWidth: { default: 'none', [lg]: '16rem' },
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontSize: {
      default: 15,
      [lg]: 16,
    },
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  businessNo: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  unitName: {
    minWidth: 0,
    flexGrow: { default: 0, [lg]: 1 },
    flexShrink: 1,
    flexBasis: { default: 'auto', [lg]: '0%' },
    maxWidth: { default: '100%', [lg]: '22rem' },
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  // where they stand, said from its own end in whatever its line has left,
  // and the whole chain a press away; at every width, since a phone has the
  // sheet the chain rises in
  unitSeat: {
    display: 'flex',
    minWidth: 0,
    flexGrow: { default: 0, [lg]: 1 },
    flexShrink: 1,
    flexBasis: { default: 'auto', [lg]: '0%' },
    maxWidth: { default: '100%', [lg]: '22rem' },
  },
  itemLine: {
    flexBasis: { default: 'auto', [lg]: '100%' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  escalationLight: {
    flexShrink: 0,
    borderColor: `color-mix(in oklab, ${tokens.warning} 45%, ${tokens.background})`,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 12%, ${tokens.background})`,
    fontSize: 12,
    color: tokens.warningForeground,
  },
  hadSupplements: {
    display: {
      default: 'none',
      [lg]: 'inline-flex',
    },
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  keysHint: {
    display: { default: 'none', [lg]: 'inline-flex' },
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  runAtWords: { display: { default: null, [breakpoints.phone]: 'none' } },
  runAtFigures: { display: { default: 'none', [breakpoints.phone]: 'inline' } },
  runAt: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  edgeKeys: {
    display: {
      default: 'none',
      [lg]: 'flex',
    },
    gap: 4,
  },
  // ---- the part strip over a stacked workbench ----
  partStrip: {
    flexShrink: 0,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    transitionProperty: 'height',
    transitionDuration: '200ms',
    transitionTimingFunction: 'linear',
  },
  partStripFolded: {
    height: 0,
    borderBottomWidth: 0,
  },
  partStripUp: {
    height: 36,
  },
  partRow: {
    position: 'relative',
    display: 'flex',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingInline: 8,
  },
  glideMark: {
    top: 5,
    height: 26,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
  },
  partChip: {
    position: 'relative',
    display: 'flex',
    height: 26,
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    borderRadius: tokens.radiusMd,
    paddingInline: 10,
    fontSize: 12,
    whiteSpace: 'nowrap',
    transitionProperty: 'color',
  },
  partChipAt: {
    fontWeight: 500,
    color: tokens.foreground,
  },
  partChipOff: {
    color: tokens.mutedForeground,
  },
  chipWords: {
    position: 'relative',
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
  },
  chipDetail: {
    fontSize: 11,
    fontWeight: 400,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  attentionDot: {
    position: 'absolute',
    top: -2,
    right: -8,
    width: 6,
    height: 6,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 70%, transparent)`,
  },
  // ---- the edge buttons ----
  noPointer: {
    pointerEvents: 'none',
  },
})

/**
 * Who is being judged, this round's standing at a glance, and where the run
 * stands.
 *
 * The run is said once, on the run's own terms: which filing of the whole
 * sitting this is, the ones dealt with behind it included. It used to be
 * said twice - a strip above counting the sitting and this bar counting
 * what was left - and "4/12" over "1/9" on one screen read as two runs. Its
 * segments ride the bar's lower edge, filled behind the reader and marked
 * at the one they are on, rather than taking a band of their own.
 */
export function PersonStrip({
  review,
  run,
  remaining,
  canPrev,
  canNext,
  onMove,
  onBack,
  onQueue,
  onKeys,
}: {
  review: ReviewDto
  /** which filing of the run is on screen, counting from one, of how many, and how many are dealt with */
  run: { at: number; total: number; done: number } | null
  /** how many of the run are still to be dealt with, this one included */
  remaining: number
  canPrev: boolean
  canNext: boolean
  onMove: (step: 1 | -1) => void
  /** the way out: back to the queue, where it was left */
  onBack: () => void
  /** who else is waiting, brought out from the side */
  onQueue: () => void
  /** brings the keyboard's panel, and takes it away */
  onKeys: () => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const round = review.context?.worth.groupName
  // a unit that has left the organization since is said to have gone,
  // rather than drawn with the mark the line uses for levels it leaves off
  const { levels, gone } = namedChainOf(review.unitPath, format(m.reviewUnitGone))
  return (
    <header {...stylex.props(styles.personBar)}>
      {/* The one way out of the run, at every width: a small key, because
          the person being judged owns this bar, named on hover for a reader
          who cannot guess where a bare arrow goes. On a phone the system
          back key is the other way out. */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={format(m.reviewBackToQueue)}
              data-testid="queue-back"
              onClick={onBack}
            >
              <ChevronLeftIcon aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{format(m.reviewBackToQueue)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Avatar className={stylex.props(styles.avatar).className}>
        <AvatarFallback className={stylex.props(styles.avatarFace).className}>
          {review.participantName.slice(0, 1)}
        </AvatarFallback>
      </Avatar>
      <div {...stylex.props(styles.personWords)}>
        <div {...stylex.props(styles.personLine)}>
          <h2 title={review.participantName} {...stylex.props(styles.personName)}>
            {review.participantName}
          </h2>
          {review.businessNo !== null && (
            <span {...stylex.props(styles.businessNo)}>{review.businessNo}</span>
          )}
        </div>
        {review.unitPath.length > 0 ? (
          <span data-testid="review-unit" data-gone={gone} {...stylex.props(styles.unitSeat)}>
            <UnitPath
              // the root everybody on the round shares is left off the
              // line, and kept on the chain
              steps={levels.length > 1 ? levels.slice(1) : levels}
              chain={{
                label: format(m.rosterUnits),
                closeLabel: format(commonMessages.close),
                levels,
              }}
            />
          </span>
        ) : (
          review.unitName !== null && (
            <span {...stylex.props(styles.unitName)}>{review.unitName}</span>
          )
        )}
        <p {...stylex.props(styles.itemLine)}>
          {round !== null && round !== undefined
            ? `${round} › ${review.itemTitle}`
            : review.itemTitle}
        </p>
      </div>
      {review.chain.route === 'escalation' && (
        // at every width: the mode must survive the narrowest header. In the
        // theme's own ink rather than a borrowed hue - the workbench is
        // greyscale but for the two verdict colours, and a third colour on
        // it reads as something pasted on from another product
        <Badge
          variant="outline"
          data-testid="escalation-light"
          className={stylex.props(styles.escalationLight).className}
        >
          {/* the same mark the notice below carries: the filing climbed a
              level, and one glyph says it in both places */}
          <CircleArrowUpIcon aria-hidden />
          {format(m.reviewRouteEscalation)}
        </Badge>
      )}
      {/* this filing has been round the supplement loop before: worth knowing
          before reading it, and only the round itself can say so */}
      {review.supplements.length > 0 && (
        <Badge variant="outline" className={stylex.props(styles.hadSupplements).className}>
          <AlertCircleIcon aria-hidden />
          {format(m.reviewHadSupplements)}
        </Badge>
      )}
      {/* who else is waiting: looked up when the reviewer wants to jump, so
          it sits with the other ways of moving about rather than by the name */}
      <Button
        variant="ghost"
        size="sm"
        data-testid="queue-key"
        data-count={remaining}
        className={stylex.props(styles.queueKey).className}
        onClick={onQueue}
      >
        <ListIcon aria-hidden className={stylex.props(styles.queueKeyIcon).className} />
        {format(m.reviewQueueKey)}
        <span {...stylex.props(styles.queueKeyCount)}>{remaining}</span>
        {fine && <Kbd>Q</Kbd>}
      </Button>
      {/* the keys panel belongs to a keyboard; without one the letters are
          not mounted and the panel would document controls that do not
          exist here */}
      {fine && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="keys-open"
          className={stylex.props(styles.keysHint).className}
          onClick={onKeys}
        >
          {format(m.reviewKeysTitle)}
          <Kbd>?</Kbd>
        </Button>
      )}
      {run !== null && (
        <p
          data-testid="run-position"
          data-at={run.at}
          data-total={run.total}
          data-done={run.done}
          {...stylex.props(styles.runAt)}
        >
          {/* a phone's bar has the name's line to keep: there the place is
              said as figures alone, and in words where there is room */}
          <span {...stylex.props(styles.runAtWords)}>
            {format(m.reviewRunPosition, { at: run.at, count: run.total })}
          </span>
          <span {...stylex.props(styles.runAtFigures)}>
            {format(m.reviewRunPositionShort, { at: run.at, count: run.total })}
          </span>
        </p>
      )}
      <span {...stylex.props(styles.edgeKeys)}>
        <EdgeButton
          can={canPrev}
          why={format(m.reviewFirstOne)}
          label="K"
          onPress={() => onMove(-1)}
        >
          <ChevronUpIcon aria-hidden />
        </EdgeButton>
        <EdgeButton can={canNext} why={format(m.reviewLastOne)} label="J" onPress={() => onMove(1)}>
          <ChevronDownIcon aria-hidden />
        </EdgeButton>
      </span>
      {run !== null && run.total > 1 && (
        <span aria-hidden data-testid="run-track" {...stylex.props(styles.runTrack)}>
          {Array.from({ length: Math.min(run.total, 60) }, (_, index) => (
            <span
              key={index}
              {...stylex.props(
                styles.runSegment,
                index < run.done
                  ? styles.runSegmentDone
                  : index === run.at - 1
                    ? styles.runSegmentAt
                    : styles.runSegmentAhead,
              )}
            />
          ))}
        </span>
      )}
    </header>
  )
}

/**
 * Where the reader is in a workbench that has become one page.
 *
 * Stacked, the three parts run one after another and nothing says which is
 * which once the headings have scrolled past. This names them, marks the one
 * being read, and scrolls to any of them - a position, not a set of tabs:
 * every part stays on the page, and the back key still leaves for the queue
 * rather than stepping between them.
 *
 * Beside each other there is nothing to say, so it folds to nothing rather
 * than disappearing: crossing the width is the strip closing over, not the
 * work below it jumping up.
 */
export function PartStrip({
  pager,
  round,
  revision,
  drillKey,
  attention,
  onReading,
  bind,
}: {
  /** the horizontal pager this strip drives and listens to */
  pager: HTMLElement | null
  /** which round this is, said on the flow chip */
  round: number
  /** which version is being read, said on the filing chip */
  revision: number
  /** a new filing opens on the filing page again, whatever the last was on */
  drillKey: string
  /** faces holding something worth a look that has not had one */
  attention: ReadonlySet<WorkbenchPart>
  /** the face under the reader, whenever it changes */
  onReading: (part: WorkbenchPart) => void
  /** hands the parent the way to a face, for links that live outside the strip */
  bind: (go: (part: WorkbenchPart) => void) => void
}) {
  const { format } = useI18n()
  const beside = useBeside()
  const [at, setAt] = useState<WorkbenchPart>('filing')
  // While a press is travelling to its face, the spy would call every face
  // it passes the one being read and drag the mark backwards through them.
  // The press says where it is going; the spy is believed again once it
  // agrees, or once the reader takes over by swiping somewhere else.
  const going = useRef<WorkbenchPart | null>(null)
  const said = useRef<WorkbenchPart | null>(null)
  const tell = (part: WorkbenchPart) => {
    if (said.current === part) return
    said.current = part
    onReading(part)
  }

  useEffect(() => {
    setAt('filing')
    going.current = null
    said.current = null
  }, [drillKey])

  useEffect(() => {
    if (pager === null || beside) return
    // the pager opens on the filing - the judged material is the visual
    // centre - positioned here, before the first spy reading, or that
    // reading would call the flow face read when nobody has read anything
    pager.scrollLeft = pager.clientWidth * WORKBENCH_PARTS.indexOf('filing')
    const spy = () => {
      const width = pager.clientWidth
      if (width === 0) return
      const index = Math.min(
        WORKBENCH_PARTS.length - 1,
        Math.max(0, Math.round(pager.scrollLeft / width)),
      )
      const reading = WORKBENCH_PARTS[index]!
      if (going.current !== null && going.current !== reading) return
      going.current = null
      setAt(reading)
      tell(reading)
    }
    spy()
    pager.addEventListener('scroll', spy, { passive: true })
    const watch = new ResizeObserver(spy)
    watch.observe(pager)
    return () => {
      pager.removeEventListener('scroll', spy)
      watch.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pager, beside, drillKey])

  // Where the mark stands, measured off the chip it marks. One persistent
  // element carried between chips: the layoutId handoff drew both chips
  // half-faded mid-flight, which over a white row read as a blink of white
  // at the place the mark had just left.
  const row = useRef<HTMLDivElement | null>(null)
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null)
  useEffect(() => {
    const strip = row.current
    if (strip === null || beside) return
    const place = () => {
      const chip = strip.querySelector<HTMLElement>(`[data-part="${at}"]`)
      if (chip !== null) setMark({ left: chip.offsetLeft, width: chip.offsetWidth })
    }
    place()
    const watch = new ResizeObserver(place)
    watch.observe(strip)
    return () => watch.disconnect()
  }, [at, beside])

  const goTo = useCallback(
    (part: WorkbenchPart) => {
      if (pager === null) return
      going.current = part
      setAt(part)
      tell(part)
      pager.scrollTo({
        left: WORKBENCH_PARTS.indexOf(part) * pager.clientWidth,
        behavior: 'smooth',
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pager],
  )
  useEffect(() => {
    bind(goTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo])

  return (
    <div
      // folded rather than removed, the way the shell folds its own bars
      {...stylex.props(styles.partStrip, beside ? styles.partStripFolded : styles.partStripUp)}
      {...(beside ? { inert: true, 'aria-hidden': true } : {})}
    >
      <div ref={row} {...stylex.props(styles.partRow)}>
        {mark !== null && (
          <GlideAcross
            left={mark.left}
            width={mark.width}
            className={stylex.props(styles.glideMark).className}
          />
        )}
        {WORKBENCH_PARTS.map((part) => (
          <button
            key={part}
            type="button"
            data-testid="workbench-anchor"
            data-part={part}
            data-reading={part === at ? 'yes' : 'no'}
            data-attention={attention.has(part) && part !== at ? 'yes' : 'no'}
            onClick={() => goTo(part)}
            {...stylex.props(styles.partChip, part === at ? styles.partChipAt : styles.partChipOff)}
          >
            <span {...stylex.props(styles.chipWords)}>
              {format(PART_LABEL[part])}
              {/* the chip that is up says where in the thing it is: the
                  round for the flow, the version for the filing */}
              {part === at && part === 'flow' && (
                <span {...stylex.props(styles.chipDetail)}>
                  {format(m.reviewStateRound, { round })}
                </span>
              )}
              {part === at && part === 'filing' && (
                <span {...stylex.props(styles.chipDetail)}>
                  {format(m.reviewFiledVersionShort, { no: revision })}
                </span>
              )}
              {/* something on that face is worth this reader's look and has
                  not had one: a fact dot, not a notification */}
              {attention.has(part) && part !== at && (
                <span aria-hidden {...stylex.props(styles.attentionDot)} />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * A pager that stays where it is at the edge: disabled with the reason on
 * hover, because a vanished control reads as a broken screen. The disabled
 * button swallows pointer events, so the tooltip hangs on the span around it.
 */
function EdgeButton({
  can,
  why,
  label,
  onPress,
  children,
}: {
  can: boolean
  why: string
  label: string
  onPress: () => void
  children: ReactNode
}) {
  if (can) {
    return (
      <Button variant="outline" size="icon-sm" onClick={onPress}>
        {children}
        <VisuallyHidden>{label}</VisuallyHidden>
      </Button>
    )
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button
              variant="outline"
              size="icon-sm"
              disabled
              className={stylex.props(styles.noPointer).className}
            >
              {children}
              <VisuallyHidden>{label}</VisuallyHidden>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
