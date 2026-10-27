import { useLocale } from '@qualy/web-i18n'
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { PageLink } from '@qualy/web-runtime'
import { Button } from '@qualy/ui/button'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'

import { dotDay, dotMoment } from './dates.ts'
import { BatchZone } from './BatchZone.tsx'
import { marked, useBatchZone, useZoneMark } from './zone.ts'
import { lastDay } from '../entry/model.ts'
import { styles, phone } from './card.stylex.ts'
import { StatusBadge } from './StatusBadge.tsx'
import { BatchProgress } from './BatchProgress.tsx'
import { progressOf, type TimelineLike } from './progress.ts'
import {
  ownLineAsks,
  type AgendaRow as AgendaKind,
  type BatchAgenda,
  type BatchCardRow,
  type HeroFrame,
  type OwnState,
} from './hero.ts'
import * as m from '#messages'

// The batch that is running, as the thing the page leads with.
//
// One card, the width of the page, in two columns. The left says which
// round this is and how far along: the name, the material window, the run
// of stages as a bar with the current one lit and a mark for today, and
// the way in. The right says what this reader has to do about it: the
// stage that is open and when it closes, then at most two lines of work -
// what is waiting on them for other people first, their own second,
// because a queue that blocks somebody else outranks one that blocks only
// oneself. A reader with nothing to do sees the stage alone.
//
// When several rounds run at once the card shows one of them and says
// which: arrows for a few, a name to pick from once there are many. It
// never turns on its own - a page that rearranges itself while somebody
// reads it is a page nobody trusts.

/**
 * The plan along the bar: where today falls, and the dates at its ends.
 *
 * The lanes are equal, so today's place is the current stage's index plus
 * how far through that stage the clock is - measured against the next
 * stage's planned start when there is one, and taken as halfway when
 * nothing after it has a date yet. A plan that has not begun has no today.
 */
function planOf(timeline: readonly TimelineLike[], now: number) {
  const dates = timeline.map((entry) =>
    entry.entry.at === null ? null : Date.parse(entry.entry.at),
  )
  const dated = dates.filter((date): date is number => date !== null)
  const start = dates[0] ?? null
  const end = dated.length > 0 ? dated[dated.length - 1]! : null
  const current = timeline.findIndex((entry) => entry.status === 'current')
  let today: number | null = null
  if (current !== -1 && timeline.length > 0) {
    const from = dates[current] ?? null
    const until = dates[current + 1] ?? null
    const share =
      from !== null && until !== null && until > from
        ? Math.min(1, Math.max(0, (now - from) / (until - from)))
        : 0.5
    today = (current + share) / timeline.length
  }
  return { start, end, today }
}

interface LaneFit {
  /** the name is no wider than its lane */
  readonly fits: readonly boolean[]
  /** the current stage's name runs over this lane */
  readonly covered: readonly boolean[]
}

/**
 * Which names their lanes can hold, and which the current name runs over.
 *
 * Measured, not guessed: six lanes on a tablet are narrower than a
 * six-character name, and the current name is drawn whole whatever its
 * lane's width. Its extent is read from a range over its text, because
 * with overflow visible the element's own box is still only the lane.
 * Re-read whenever the bar is resized.
 */
function useLaneFit(lanes: RefObject<HTMLDivElement | null>, count: number): LaneFit {
  const [fit, setFit] = useState<LaneFit>({ fits: [], covered: [] })
  useLayoutEffect(() => {
    const root = lanes.current
    if (root === null) return
    const measure = () => {
      const names = [...root.querySelectorAll<HTMLElement>('[data-lane-name]')]
      const fits = names.map((name) => name.scrollWidth <= name.clientWidth + 1)
      const current = names.find((name) => name.hasAttribute('data-current'))
      let reach: DOMRect | null = null
      if (current !== undefined) {
        const range = document.createRange()
        range.selectNodeContents(current)
        reach = range.getBoundingClientRect()
      }
      const covered = names.map((name) => {
        if (reach === null || name === current) return false
        const box = name.getBoundingClientRect()
        return box.left < reach.right + 4 && box.right > reach.left - 4
      })
      setFit((prev) =>
        prev.fits.length === fits.length &&
        prev.fits.every((value, index) => value === fits[index]) &&
        prev.covered.every((value, index) => value === covered[index])
          ? prev
          : { fits, covered },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [lanes, count])
  return fit
}

function StageLanes({ timeline, now }: { timeline: readonly TimelineLike[]; now: number }) {
  const zone = useBatchZone()
  const locale = useLocale()
  const markOf = useZoneMark(locale)
  const plan = planOf(timeline, now)
  // Each end of the axis is marked with the batch's offset on its own day:
  // the first date says whose clock the axis is on, and the last says it
  // again only where that clock has moved its offset in between.
  const startMark = plan.start === null ? null : markOf(plan.start)
  const end = plan.start !== null && plan.end !== null && plan.end > plan.start ? plan.end : null
  const endMark = end === null ? null : markOf(end)
  const endOwnMark = endMark === startMark ? null : endMark
  const at = (fraction: number) => `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(2)}%`
  const lanesRef = useRef<HTMLDivElement>(null)
  const fit = useLaneFit(lanesRef, timeline.length)
  return (
    <div {...stylex.props(styles.plan)}>
      <TooltipProvider>
        <div ref={lanesRef} {...stylex.props(styles.lanes)}>
          {timeline.map((entry, index) => {
            const current = entry.status === 'current'
            const covered = !current && (fit.covered[index] ?? false)
            const whole = current || ((fit.fits[index] ?? true) && !covered)
            const lane = (
              <div
                key={entry.displayName + String(index)}
                data-lane
                data-stage-status={entry.status}
                data-named={whole ? '' : undefined}
                {...stylex.props(styles.lane)}
              >
                <span
                  data-lane-name
                  data-current={current ? '' : undefined}
                  {...stylex.props(
                    styles.laneName,
                    current && styles.laneNameCurrent,
                    covered && styles.laneNameCovered,
                  )}
                >
                  {entry.displayName}
                </span>
                <span
                  {...stylex.props(
                    styles.segment,
                    entry.status === 'ended' && styles.segmentEnded,
                    current && styles.segmentCurrent,
                    entry.status === 'future' && styles.segmentFuture,
                  )}
                />
              </div>
            )
            return whole ? (
              lane
            ) : (
              <Tooltip key={entry.displayName + String(index)}>
                <TooltipTrigger asChild>{lane}</TooltipTrigger>
                <TooltipContent>{entry.displayName}</TooltipContent>
              </Tooltip>
            )
          })}
          {plan.today !== null && (
            <span aria-hidden {...stylex.props(styles.todayMark(at(plan.today)))} />
          )}
        </div>
      </TooltipProvider>
      {plan.start !== null && (
        <div
          data-testid="stage-axis"
          {...(startMark === null ? {} : { 'data-zone-mark': startMark })}
          {...(endOwnMark === null ? {} : { 'data-end-zone-mark': endOwnMark })}
          {...stylex.props(styles.axis)}
        >
          {/* the axis is one clock, so its first date says whose */}
          <span {...stylex.props(styles.axisStart)}>
            {marked(dotDay(plan.start, zone), startMark)}
          </span>
          {plan.today !== null && (
            <span {...stylex.props(styles.axisToday(at(plan.today)))}>{m.batch_today()}</span>
          )}
          {end !== null && (
            <span {...stylex.props(styles.axisEnd)}>{marked(dotDay(end, zone), endOwnMark)}</span>
          )}
        </div>
      )}
    </div>
  )
}

function Frame({ frame, current }: { frame: HeroFrame; current: string }) {
  if (frame.kind === 'single') return null
  if (frame.kind === 'picker') {
    return (
      <Select value={current} onValueChange={frame.onPick}>
        <SelectTrigger aria-label={m.batch_pick()} xstyle={styles.picker}>
          <SelectValue placeholder={m.batch_pick()} />
        </SelectTrigger>
        <SelectContent>
          {frame.options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return (
    <div {...stylex.props(styles.frame)}>
      <button
        type="button"
        aria-label={m.batch_previous()}
        onClick={frame.onPrevious}
        {...stylex.props(styles.frameArrow)}
      >
        <ChevronLeftIcon size={14} aria-hidden />
      </button>
      <span
        data-testid="hero-position"
        data-index={String(frame.index + 1)}
        data-total={String(frame.total)}
        {...stylex.props(styles.frameCount)}
      >
        {`${String(frame.index + 1)} / ${String(frame.total)}`}
      </span>
      <button
        type="button"
        aria-label={m.batch_next()}
        onClick={frame.onNext}
        {...stylex.props(styles.frameArrow)}
      >
        <ChevronRightIcon size={14} aria-hidden />
      </button>
    </div>
  )
}

/**
 * One agenda line, in words.
 *
 * `action` is what the reader would go and do, and `null` where there is
 * nowhere to go: an empty queue holds nothing to look at, and the line
 * that says so is the whole answer.
 *
 * Every line leads somewhere, because every line is about something the
 * reader has a place for: a queue, their own filings. A block in which
 * some lines that look alike can be pressed and others cannot is a block
 * whose rule nobody can state.
 *
 * `quiet` carries the difference instead: a line that asks nothing is
 * drawn in the weight of a fact rather than of an instruction, so it
 * neither calls out nor stands in the way.
 */
function wordsOf(row: AgendaKind): {
  label: string
  value: string
  /** why, where the state alone does not say what to do about it */
  note: string | null
  action: string
  quiet: boolean
  page: 'assessment/batch-reviews' | 'assessment/batch-my-entries'
  state: string
} {
  if (row.kind === 'review') {
    return {
      label: m.batch_awaitingReview(),
      value:
        row.waiting > 0 ? m.batch_submissionsCount({ count: row.waiting }) : m.batch_reviewsClear(),
      note: null,
      action: row.waiting > 0 ? m.batch_startReview() : m.batch_view(),
      quiet: row.waiting === 0,
      page: 'assessment/batch-reviews',
      state: row.waiting > 0 ? 'waiting' : 'clear',
    }
  }
  const count = { count: row.count }
  const asks = ownLineAsks(row)
  const words: Record<OwnState, () => readonly [string, string]> = {
    toAnswer: () => [m.batch_toAnswer(count), m.batch_answerAsk()],
    // once filing has closed these only say what was left
    toFix: () => [m.batch_toRevise(count), (asks ? m.batch_continueEntries : m.batch_view)()],
    draft: () => [m.batch_toSubmit(count), (asks ? m.batch_continueDraft : m.batch_view)()],
    rejected: () => [m.batch_notAccepted(count), m.batch_seeWhy()],
    submitted: () => [m.batch_underReview(count), m.batch_view()],
    approved: () => [m.batch_accepted(count), m.batch_view()],
    none: () => [m.batch_entriesNone(), m.batch_startEntries()],
    upcoming: () => [m.batch_filingUpcoming(), m.batch_view()],
    missed: () => [m.batch_filingMissed(), m.batch_view()],
    // the same answer every question gives on the reader's own page, said
    // once for the batch instead of an invitation to file
    unreachable: () => [m.batch_filingUnreachable(), m.batch_view()],
  }
  const [value, action] = words[row.state]()
  return {
    label: m.batch_myEntries(),
    value,
    note: row.state === 'unreachable' ? m.batch_filingUnreachableHint() : null,
    action,
    quiet: !asks,
    page: 'assessment/batch-my-entries',
    state: row.state,
  }
}

function AgendaRow({ row, batchId }: { row: AgendaKind; batchId: string }) {
  const { label, value, note, action, quiet, page, state } = wordsOf(row)
  const softly = quiet && styles.agendaActionIdle
  return (
    <div
      data-testid="hero-agenda"
      data-agenda={page}
      data-agenda-state={state}
      data-agenda-asks={!quiet}
      {...stylex.props(styles.agendaRow, styles.cell)}
    >
      <div {...stylex.props(styles.agendaWords)}>
        <span {...stylex.props(styles.agendaLabel)}>{label}</span>
        <span {...stylex.props(styles.agendaValue, quiet && styles.agendaValueIdle)}>{value}</span>
        {note !== null && (
          <span data-agenda-note="" {...stylex.props(styles.agendaNote)}>
            {note}
          </span>
        )}
      </div>
      <PageLink
        page={page}
        params={{ batchId }}
        className={stylex.props(styles.agendaAction, softly).className}
        unavailable={<span {...stylex.props(styles.agendaAction, softly)}>{action}</span>}
      >
        {action}
        <ArrowRightIcon size={13} aria-hidden />
      </PageLink>
    </div>
  )
}

/** one line of work, the whole of it a way to that work */
function PhoneAgendaRow({ row, batchId }: { row: AgendaKind; batchId: string }) {
  const { label, value, note, quiet, page, state } = wordsOf(row)
  const words = (
    <>
      <span {...stylex.props(phone.agendaWords)}>
        <span {...stylex.props(phone.agendaLabel)}>{label}</span>
        <span {...stylex.props(phone.agendaValue, quiet && phone.agendaValueIdle)}>{value}</span>
        {note !== null && (
          <span data-agenda-note="" {...stylex.props(phone.agendaNote)}>
            {note}
          </span>
        )}
      </span>
      <ArrowRightIcon
        size={16}
        aria-hidden
        {...stylex.props(phone.agendaGlyph, quiet && phone.agendaGlyphIdle)}
      />
    </>
  )
  const marks = {
    'data-testid': 'hero-agenda',
    'data-agenda': page,
    'data-agenda-state': state,
    'data-agenda-asks': !quiet,
  }
  return (
    <PageLink
      page={page}
      params={{ batchId }}
      {...marks}
      className={stylex.props(phone.agendaRow).className}
      unavailable={
        <span {...marks} {...stylex.props(phone.agendaRow)}>
          {words}
        </span>
      }
    >
      {words}
    </PageLink>
  )
}

interface BatchCardProps {
  row: BatchCardRow
  agenda: BatchAgenda
  frame: HeroFrame
  /** which way the card was stepped to, for the slide that says so; a card
   * the page opened with arrives with the page and does not slide */
  entered?: 'forward' | 'backward' | null
  /** the clock, for a test that wants to hold it still */
  now?: number
}

/** one round, every time on it read on that round's own clock */
export function BatchCard(props: BatchCardProps): ReactNode {
  return (
    <BatchZone zone={props.row.timezone}>
      <CardBody {...props} />
    </BatchZone>
  )
}

function CardBody({
  row,
  agenda,
  frame,
  entered = null,
  now = Date.now(),
}: BatchCardProps): ReactNode {
  const locale = useLocale()
  const zone = useBatchZone()
  const markOf = useZoneMark(locale)
  // the card's own shape changes, not just its width, so the choice is made
  // here rather than in a media query
  const narrow = useIsMobile()
  const at = row.timeline.findIndex((entry) => entry.status === 'current')
  // asked of the clock rather than worked out here: a stage ends when the
  // next one begins, and this card used to say so in its own words - the
  // same reasoning written a second time, and only one of the two knew
  // what to do with a round that is unscheduled or has not begun
  const where = progressOf(row.timeline, now)
  // the close on the batch's clock, spelled once for the sentence and the
  // fact beside it
  const closes = where.kind === 'until' ? dotMoment(where.at, zone) : null
  const mark = where.kind === 'until' ? markOf(where.at) : null

  // The phone card is a different order, not a narrower one: what the
  // reader has to do moves above the run of stages. Two orders cannot be
  // one tree reflowed, because the work belongs to the right-hand column
  // on a wide window and to the middle of the card on a narrow one.
  if (narrow) {
    return (
      <article
        data-testid="batch-hero"
        data-batch={row.id}
        {...stylex.props(
          phone.card,
          entered === 'forward' && styles.arriveForward,
          entered === 'backward' && styles.arriveBackward,
        )}
      >
        <div {...stylex.props(phone.head)}>
          <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} />
          <h2 {...stylex.props(phone.title)}>{row.name}</h2>
        </div>

        {/* the reader's own business, and only that: somebody the round is
            neither about nor answerable to gets no block at all rather
            than a sentence made up to fill one */}
        {agenda.rows.length > 0 && (
          <div {...stylex.props(phone.agenda)}>
            {agenda.rows.map((line) => (
              <PhoneAgendaRow key={line.kind} row={line} batchId={row.id} />
            ))}
          </div>
        )}

        <div {...stylex.props(phone.foot)}>
          {row.timeline.length > 0 && (
            <div {...stylex.props(phone.plan)}>
              <div {...stylex.props(phone.lanes)} aria-hidden>
                {row.timeline.map((entry, index) => (
                  <span
                    key={entry.displayName + String(index)}
                    {...stylex.props(
                      phone.lane,
                      entry.status === 'ended'
                        ? phone.laneEnded
                        : entry.status === 'current'
                          ? phone.laneCurrent
                          : phone.laneFuture,
                    )}
                  />
                ))}
              </div>
              {/* Where the round stands, in one line under the bar it
                  belongs to: which stage of how many, its name, and the
                  clock. The clock is the shared one - it tells a stage
                  that has not been scheduled from one that has not begun,
                  and it turns amber and then red as the close comes up,
                  which is the thing on this card worth noticing. */}
              <div {...stylex.props(phone.meta)}>
                <span {...stylex.props(phone.metaWhere)}>
                  {/* the bar above has just drawn the stages, so the count
                      needs no noun after it */}
                  <span {...stylex.props(phone.metaAt)}>
                    {at === -1
                      ? m.batch_stageCount({ total: row.timeline.length })
                      : m.batch_stageAt({ current: at + 1, total: row.timeline.length })}
                  </span>
                  {row.currentPhaseName !== null && (
                    <span {...stylex.props(phone.metaStage)}>{row.currentPhaseName}</span>
                  )}
                </span>
                <BatchProgress timeline={row.timeline} single xstyle={phone.metaClock} />
              </div>
            </div>
          )}

          <Button asChild className={stylex.props(phone.enter).className}>
            <PageLink page="assessment/batch" params={{ batchId: row.id }}>
              {m.batch_enter()}
              <ArrowRightIcon aria-hidden />
            </PageLink>
          </Button>
        </div>
      </article>
    )
  }

  return (
    <div {...stylex.props(styles.seat)}>
      <article
        data-testid="batch-hero"
        data-batch={row.id}
        {...stylex.props(
          styles.card,
          entered === 'forward' && styles.arriveForward,
          entered === 'backward' && styles.arriveBackward,
        )}
      >
        <div {...stylex.props(styles.main)}>
          <div {...stylex.props(styles.head)}>
            <div {...stylex.props(styles.headRow)}>
              <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} />
              <Frame frame={frame} current={row.id} />
            </div>
            <h2 {...stylex.props(styles.title)}>{row.name}</h2>
            <div {...stylex.props(styles.facts)}>
              <span
                data-testid="material-window"
                data-from={row.materialRange.start}
                data-until={lastDay(row.materialRange.end)}
              >
                {m.batch_materialWindow({
                  from: dotDay(row.materialRange.start),
                  // stored with its end outside the window; the card says
                  // the last day that counts
                  until: dotDay(lastDay(row.materialRange.end)),
                })}
              </span>
              {row.timeline.length > 0 && (
                <span>
                  {at === -1
                    ? m.batch_stageCount({ total: row.timeline.length })
                    : m.batch_stagePosition({ current: at + 1, total: row.timeline.length })}
                </span>
              )}
            </div>
          </div>

          {row.timeline.length > 0 && <StageLanes timeline={row.timeline} now={now} />}

          <div {...stylex.props(styles.actions)}>
            <Button asChild>
              <PageLink page="assessment/batch" params={{ batchId: row.id }}>
                {m.batch_enter()}
                <ArrowRightIcon aria-hidden />
              </PageLink>
            </Button>
          </div>
        </div>

        <aside {...stylex.props(styles.side)}>
          <div {...stylex.props(styles.stage, styles.cell, styles.cellFirst)}>
            <span {...stylex.props(styles.stageLabel)}>{m.batch_currentStage()}</span>
            <span {...stylex.props(styles.stageName)}>
              {row.currentPhaseName ?? m.plan_notScheduled()}
            </span>
            <span {...stylex.props(styles.stageClock)}>
              {/* the close and what is left to it, one unit: "03.01 23:59
                截止 　 12 days left"; a stage with no close only says how
                long it has run */}
              {closes !== null && (
                <span
                  data-testid="stage-deadline"
                  data-moment={closes}
                  {...(mark === null ? {} : { 'data-zone-mark': mark })}
                  {...stylex.props(styles.stageWhen)}
                >
                  {m.batch_stageDeadline({ when: marked(closes, mark) })}
                </span>
              )}
              <BatchProgress timeline={row.timeline} single />
            </span>
          </div>
          {agenda.rows.map((line) => (
            <AgendaRow key={line.kind} row={line} batchId={row.id} />
          ))}
        </aside>
      </article>
    </div>
  )
}
