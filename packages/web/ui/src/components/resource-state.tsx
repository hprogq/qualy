import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react'
import {
  CloudOffIcon,
  LockKeyholeIcon,
  SearchXIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { HeadingRank } from '../lib/heading-rank.ts'
import { a11yStyles } from '../lib/visually-hidden.tsx'
import { breakpoints } from '../theme/breakpoints.stylex.ts'
import { tokens } from '../theme/tokens.stylex.ts'

// What a screen, or one part of it, says when the thing it is about cannot
// be shown: it is not there, it is not the reader's to see, the server
// cannot be reached, the server cannot serve right now, or reading it
// failed.
//
// Each of those wants a different next step from the reader, so each is a
// kind with its own mark, and the words and the ways out are the caller's -
// this library carries no copy. What every kind shares is the shape: a
// heading that says what happened, one sentence that says what to do, and
// the actions under them.
//
// Two sizes. A page is the whole of what the reader came for, so it takes
// the room it is given, stands a little above the middle where the eye
// already is, and moves focus to its heading, so a screen reader starts
// there rather than on a link that no longer leads anywhere; the focus is
// the announcement, so it is not also a live region read out a second time.
// A section is one pane of a larger screen, in the room the pane would have
// had - inside the card or dialog around it, or on a card of its own on the
// bare page - and never takes focus away from what the reader is doing, so
// it is said instead: heard, without being moved to.
//
// Said through a region of its own that is already on the screen, empty,
// when the words go into it. A live region that arrives with its words
// already inside - the whole pane replacing a spinner - is not heard by
// every reader, and a region whose role changes over words it already
// holds is heard by almost none; so the words are put in a beat after the
// pane appears, and put in again, the same words, when its owner says they
// are news once more.

/** why the thing cannot be shown, which decides the mark and what may help */
export type ResourceStateKind = 'missing' | 'denied' | 'offline' | 'unavailable' | 'failed'

/**
 * A reading that failed, told the way a reader needs it: already worded,
 * and whether asking again can bring a different answer. Something that is
 * not there, or not the reader's, is not there on the second try either.
 */
export interface ResourceFailure {
  readonly kind: ResourceStateKind
  readonly title: string
  readonly description: string
  readonly retryable: boolean
}

const marks: Record<ResourceStateKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  missing: SearchXIcon,
  denied: LockKeyholeIcon,
  offline: WifiOffIcon,
  unavailable: CloudOffIcon,
  failed: TriangleAlertIcon,
}

const headings = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4' } as const

const styles = stylex.create({
  page: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    flexDirection: 'column',
    alignItems: 'center',
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingBlock: 40,
    textAlign: 'center',
  },
  // The room above and below, one part to two: the words stand a third of
  // the way down rather than dead centre, where a lone line of text reads
  // as having slipped.
  above: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  below: { flexGrow: 2, flexShrink: 1, flexBasis: 0 },
  // the room the pane would have had, with nothing drawn around it: a pane
  // usually stands inside a card or a dialog already, and a second edge
  // inside the first reads as a box dropped into the page
  section: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    minHeight: '12rem',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingBlock: 32,
    textAlign: 'center',
  },
  // standing on the page's own ground instead: the card every screen sets
  // its content on, so the pane is still a pane rather than a hole
  framed: {
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  body: {
    display: 'flex',
    width: '100%',
    maxWidth: '28rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  // a line drawing in grey with no tile under it, as the empty state draws
  // its own: the tile made the mark the heaviest thing on the screen
  mark: {
    flexShrink: 0,
    marginBottom: 8,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 75%, transparent)`,
  },
  markPage: { width: 36, height: 36 },
  markSection: { width: 28, height: 28 },
  title: {
    margin: 0,
    color: tokens.foreground,
    fontWeight: 600,
    textWrap: 'balance',
    overflowWrap: 'anywhere',
    // focused by the screen rather than by a person, and not something a
    // person can press: a ring around it would only look like a control
    outline: 'none',
  },
  titlePage: { fontSize: 20, lineHeight: 1.4 },
  // a step below the card or dialog title the pane stands under, never above it
  titleSection: { fontSize: 14, lineHeight: 1.4 },
  description: {
    margin: 0,
    maxWidth: '26rem',
    color: tokens.mutedForeground,
    textWrap: 'pretty',
    overflowWrap: 'anywhere',
  },
  descriptionPage: { fontSize: 14, lineHeight: 1.6 },
  descriptionSection: { fontSize: 13, lineHeight: 1.5 },
  actions: {
    display: 'flex',
    width: { default: 'auto', [breakpoints.phone]: '100%' },
    flexDirection: { default: 'row', [breakpoints.phone]: 'column' },
    flexWrap: 'wrap',
    alignItems: { default: 'center', [breakpoints.phone]: 'stretch' },
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  // one action: on a phone it spans the column, so a thumb finds it anywhere
  // along the width, and the first one stands on top
  action: {
    display: 'flex',
    flexDirection: 'column',
  },
})

export function ResourceState({
  kind,
  title,
  description,
  actions = [],
  size = 'page',
  framed = false,
  focusOnMount = size === 'page',
  headingLevel,
  live = 'polite',
  announcement = 0,
  xstyle,
  className,
  ...rest
}: {
  kind: ResourceStateKind
  /**
   * What happened, as the state's heading. A section may go without one and
   * say its one sentence in `description` alone; a page always has one.
   */
  title?: string
  description?: ReactNode
  /** the ways out, the one most readers want first */
  actions?: readonly ReactNode[]
  /** the whole of a screen, or one pane of it */
  size?: 'page' | 'section'
  /** a pane on the page's bare ground, rather than inside a card or a dialog */
  framed?: boolean
  /** move focus to the heading when it first appears; pages do by default */
  focusOnMount?: boolean
  /**
   * The heading's rank in the outline around it: 1 for a page; for a pane,
   * one under the title of what it stands on - 2 on a page, 3 in a dialog or
   * a sheet, which say so themselves. Given only where the surface cannot
   * say, as inside a card with a title of its own.
   */
  headingLevel?: 1 | 2 | 3 | 4
  /**
   * How an assistive reader hears a section appear, since it takes no
   * focus: politely, or interrupting, for a failure worth it. A page is
   * heard through the focus it takes instead.
   */
  live?: 'polite' | 'assertive'
  /**
   * Says the section again, as news, whenever it changes: a retry answered
   * with the same failure is a new answer in words already on the screen.
   */
  announcement?: number
  xstyle?: StyleXStyles
  className?: string
} & { [data: `data-${string}`]: string | undefined }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const said = useRef<HTMLParagraphElement>(null)
  const around = useContext(HeadingRank)
  useEffect(() => {
    if (focusOnMount) heading.current?.focus({ preventScroll: true })
  }, [focusOnMount])
  const Mark = marks[kind]
  const page = size === 'page'
  const speaks = !page && !focusOnMount
  const [spoken, setSpoken] = useState<Spoken | null>(null)
  // read when the words go in, so an answer that came back with them is said
  // at the urgency it came back with, without making the urgency news itself
  const urgency = useRef(live)
  useLayoutEffect(() => {
    urgency.current = live
  })
  useEffect(() => {
    if (!speaks) return
    setSpoken(null)
    const say = setTimeout(() => {
      setSpoken({
        live: urgency.current,
        title: heading.current?.textContent ?? '',
        description: said.current?.textContent ?? '',
      })
    }, SAY_AFTER_MS)
    // and taken out again once heard, so a reader moving through the page
    // meets the words once, where they are shown
    const quiet = setTimeout(() => setSpoken(null), SAY_AFTER_MS + HEARD_MS)
    return () => {
      clearTimeout(say)
      clearTimeout(quiet)
    }
  }, [speaks, announcement])
  const Heading = headings[headingLevel ?? (page ? 1 : ((around + 1) as 2 | 3 | 4))]
  const sx = stylex.props(
    page ? styles.page : styles.section,
    !page && framed && styles.framed,
    xstyle,
  )
  return (
    <div
      data-slot="resource-state"
      data-state={kind}
      data-size={size}
      {...rest}
      {...sx}
      className={clsx(sx.className, className)}
    >
      {page && <span aria-hidden {...stylex.props(styles.above)} />}
      <div {...stylex.props(styles.body)}>
        <Mark
          aria-hidden
          strokeWidth={1.5}
          {...stylex.props(styles.mark, page ? styles.markPage : styles.markSection)}
        />
        {title !== undefined && (
          <Heading
            ref={heading}
            tabIndex={-1}
            {...stylex.props(styles.title, page ? styles.titlePage : styles.titleSection)}
          >
            {title}
          </Heading>
        )}
        {description !== undefined && (
          <p
            ref={said}
            {...stylex.props(
              styles.description,
              page ? styles.descriptionPage : styles.descriptionSection,
            )}
          >
            {description}
          </p>
        )}
        {actions.length > 0 && (
          <div data-slot="resource-state-actions" {...stylex.props(styles.actions)}>
            {actions.map((action, index) => (
              <div key={index} {...stylex.props(styles.action)}>
                {action}
              </div>
            ))}
          </div>
        )}
      </div>
      {page && <span aria-hidden {...stylex.props(styles.below)} />}
      {speaks &&
        (['polite', 'assertive'] as const).map((region) => (
          <span
            key={region}
            data-slot="resource-state-live"
            data-live={region}
            aria-live={region}
            aria-atomic
            {...stylex.props(a11yStyles.visuallyHidden)}
          >
            {spoken?.live === region && (
              <>
                <span>{spoken.title}</span> <span>{spoken.description}</span>
              </>
            )}
          </span>
        ))}
    </div>
  )
}

interface Spoken {
  readonly live: 'polite' | 'assertive'
  readonly title: string
  readonly description: string
}

/** how long an empty region stands before its words go in */
const SAY_AFTER_MS = 150
/** how long the words stay in it once they are there */
const HEARD_MS = 7000
