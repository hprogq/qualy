import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  CircleArrowUpIcon,
} from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { visuallyHidden } from '@qualy/ui/visually-hidden'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { GlideAcross } from '@qualy/ui/reveal'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { useBeside, useFinePointer } from './pointer.ts'
import type { ReviewDto } from './model.ts'
import { PART_LABEL, WORKBENCH_PARTS, type WorkbenchPart } from './Pane.tsx'

const lg = '@media (min-width: 1024px)'
const belowLg = '@media (max-width: 1023.98px)'
const wide = '@media (min-width: 84rem)'

const styles = stylex.create({
  // ---- the run's own strip ----
  runStrip: {
    display: {
      default: 'none',
      [lg]: 'flex',
    },
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    paddingInline: 16,
    paddingBlock: 8,
  },
  runPosition: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  runTrack: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    gap: 4,
  },
  runSegment: {
    height: 4,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    borderRadius: '9999px',
    transitionProperty: 'background-color',
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
  runExit: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  // ---- the person bar ----
  personBar: {
    display: 'flex',
    height: 56,
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
  },
  queueKey: {
    display: {
      default: 'inline-flex',
      [wide]: 'none',
    },
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
  avatar: {
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
  personWords: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 1,
  },
  personLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: {
      default: 8,
      [lg]: 10,
    },
  },
  personName: {
    fontSize: {
      default: 15,
      [lg]: 16,
    },
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  businessNo: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  unitName: {
    display: {
      default: 'none',
      [lg]: 'block',
    },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  itemLine: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
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
    display: {
      default: 'none',
      [lg]: 'inline',
    },
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  runAt: {
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
 * Where the run stands: one segment per filing, filled behind the reader and
 * marked at the one they are on.
 *
 * It used to light only what was finished, so the segment for the filing on
 * screen stayed grey until it had been dealt with - the bar was always one
 * behind what the reader was looking at.
 */
export function RunStrip({
  at,
  total,
  done,
  batchId,
}: {
  /** which filing of the run is on screen, counting from one */
  at: number
  total: number
  /** how many have been dealt with this sitting */
  done: number
  batchId: string
}) {
  const { format } = useI18n()
  const navigate = usePageNavigate()
  return (
    <div {...stylex.props(styles.runStrip)}>
      <p {...stylex.props(styles.runPosition)}>
        {format(m.reviewRunPosition, { at, count: total })}
      </p>
      <span {...stylex.props(styles.runTrack)}>
        {Array.from({ length: Math.min(total, 60) }, (_, index) => (
          <span
            key={index}
            {...stylex.props(
              styles.runSegment,
              index < done
                ? styles.runSegmentDone
                : index === at - 1
                  ? styles.runSegmentAt
                  : styles.runSegmentAhead,
            )}
          />
        ))}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className={stylex.props(styles.runExit).className}
        onClick={() => navigate('assessment/batch-reviews', { params: { batchId } })}
      >
        {format(m.reviewRunExit)}
      </Button>
    </div>
  )
}

/** who is being judged, and this round's standing at a glance */
export function PersonStrip({
  review,
  at,
  of,
  canPrev,
  canNext,
  onMove,
  onBack,
}: {
  review: ReviewDto
  at: number | null
  of: number
  canPrev: boolean
  canNext: boolean
  onMove: (step: 1 | -1) => void
  /** the way out, where the queue rail is not there to hold one */
  onBack: () => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const round = review.context?.worth.groupName
  return (
    <header {...stylex.props(styles.personBar)}>
      {/* The door back, for every width where the queue rail is not beside:
          a small key, the way the rail's own header key is small, because
          the person being judged owns this bar. On a phone the system back
          key is the reader's other way out. */}
      <Button
        variant="outline"
        size="sm"
        data-testid="queue-key"
        className={stylex.props(styles.queueKey).className}
        onClick={onBack}
      >
        <ChevronLeftIcon aria-hidden className={stylex.props(styles.queueKeyIcon).className} />
        {format(m.reviewQueueKey)}
        <span {...stylex.props(styles.queueKeyCount)}>{of}</span>
      </Button>
      <Avatar className={stylex.props(styles.avatar).className}>
        <AvatarFallback className={stylex.props(styles.avatarFace).className}>
          {review.participantName.slice(0, 1)}
        </AvatarFallback>
      </Avatar>
      <div {...stylex.props(styles.personWords)}>
        <div {...stylex.props(styles.personLine)}>
          <h2 {...stylex.props(styles.personName)}>{review.participantName}</h2>
          {review.businessNo !== null && (
            <span {...stylex.props(styles.businessNo)}>{review.businessNo}</span>
          )}
          {review.unitName !== null && (
            <span {...stylex.props(styles.unitName)}>{review.unitName}</span>
          )}
        </div>
        <p {...stylex.props(styles.itemLine)}>
          {round !== null && round !== undefined
            ? `${round} › ${review.itemTitle}`
            : review.itemTitle}
        </p>
      </div>
      <span {...stylex.props(styles.spacer)} />
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
      {/* the keys hint belongs to a keyboard; without one the letters are
          not mounted and the panel would document controls that do not
          exist here */}
      {fine && <span {...stylex.props(styles.keysHint)}>{format(m.reviewKeysHint)}</span>}
      {at !== null && (
        <p {...stylex.props(styles.runAt)}>{format(m.reviewRunPosition, { at, count: of })}</p>
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
        <span {...stylex.props(visuallyHidden.text)}>{label}</span>
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
              <span {...stylex.props(visuallyHidden.text)}>{label}</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
