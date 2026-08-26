import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  CircleArrowUpIcon,
} from 'lucide-react'
import { usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Kbd } from '@qualy/ui/kbd'
import { GlideAcross } from '@qualy/ui/reveal'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { assessmentMessages as m } from '../i18n.ts'
import { useBeside, useFinePointer } from './pointer.ts'
import type { ReviewDto } from './model.ts'
import { PART_LABEL, WORKBENCH_PARTS, type WorkbenchPart } from './Pane.tsx'

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
    <div className="hidden shrink-0 items-center gap-3 border-b bg-muted/40 px-4 py-2 lg:flex">
      <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {format(m.reviewRunPosition, { at, count: total })}
      </p>
      <span className="flex min-w-0 flex-1 gap-1">
        {Array.from({ length: Math.min(total, 60) }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              index < done ? 'bg-foreground' : index === at - 1 ? 'bg-foreground/45' : 'bg-border',
            )}
          />
        ))}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-xs text-muted-foreground"
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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 lg:gap-2.5 lg:px-4">
      {/* The door back, for every width where the queue rail is not beside:
          a small key, the way the rail's own header key is small, because
          the person being judged owns this bar. On a phone the system back
          key is the reader's other way out. */}
      <Button
        variant="outline"
        size="sm"
        data-testid="queue-key"
        className="h-8 shrink-0 gap-1 px-2 text-xs min-[84rem]:hidden"
        onClick={onBack}
      >
        <ChevronLeftIcon aria-hidden className="size-3.5" />
        {format(m.reviewQueueKey)}
        <span className="text-muted-foreground tabular-nums max-lg:hidden">{of}</span>
      </Button>
      <Avatar className="size-8 lg:size-9">
        <AvatarFallback className="text-sm font-semibold">
          {review.participantName.slice(0, 1)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-px">
        <div className="flex items-baseline gap-2 lg:gap-2.5">
          <h2 className="text-[15px] font-semibold whitespace-nowrap lg:text-base">
            {review.participantName}
          </h2>
          {review.businessNo !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">{review.businessNo}</span>
          )}
          {review.unitName !== null && (
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">
              {review.unitName}
            </span>
          )}
        </div>
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {round !== null && round !== undefined
            ? `${round} › ${review.itemTitle}`
            : review.itemTitle}
        </p>
      </div>
      <span className="flex-1" />
      {review.chain.route === 'escalation' && (
        // at every width: the mode must survive the narrowest header. In the
        // theme's own ink rather than a borrowed hue - the workbench is
        // greyscale but for the two verdict colours, and a third colour on
        // it reads as something pasted on from another product
        <Badge
          variant="outline"
          data-testid="escalation-light"
          className="shrink-0 border-amber-300 bg-amber-50 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200"
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
        <Badge variant="outline" className="hidden shrink-0 whitespace-nowrap lg:inline-flex">
          <AlertCircleIcon aria-hidden />
          {format(m.reviewHadSupplements)}
        </Badge>
      )}
      {/* the keys hint belongs to a keyboard; without one the letters are
          not mounted and the panel would document controls that do not
          exist here */}
      {fine && (
        <span className="hidden shrink-0 text-xs font-medium whitespace-nowrap lg:inline">
          {format(m.reviewKeysHint)}
        </span>
      )}
      {at !== null && (
        <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {format(m.reviewRunPosition, { at, count: of })}
        </p>
      )}
      <span className="hidden gap-1 lg:flex">
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
      className={cn(
        'shrink-0 overflow-hidden border-b transition-[height] duration-200 ease-linear',
        beside ? 'h-0 border-b-0' : 'h-9',
      )}
      {...(beside ? { inert: true, 'aria-hidden': true } : {})}
    >
      <div ref={row} className="relative flex h-9 items-center justify-center gap-0.5 px-2">
        {mark !== null && (
          <GlideAcross
            left={mark.left}
            width={mark.width}
            className="top-[5px] h-[26px] rounded-md bg-muted"
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
            className={cn(
              'relative flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap transition-colors',
              part === at ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className="relative flex items-baseline gap-1.5">
              {format(PART_LABEL[part])}
              {/* the chip that is up says where in the thing it is: the
                  round for the flow, the version for the filing */}
              {part === at && part === 'flow' && (
                <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                  {format(m.reviewStateRound, { round })}
                </span>
              )}
              {part === at && part === 'filing' && (
                <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                  {format(m.reviewFiledVersionShort, { no: revision })}
                </span>
              )}
              {/* something on that face is worth this reader's look and has
                  not had one: a fact dot, not a notification */}
              {attention.has(part) && part !== at && (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-2 size-1.5 rounded-full bg-foreground/70"
                />
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
        <span className="sr-only">{label}</span>
      </Button>
    )
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button variant="outline" size="icon-sm" disabled className="pointer-events-none">
              {children}
              <span className="sr-only">{label}</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
