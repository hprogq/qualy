import { useEffect, useRef, type ComponentType, type ReactNode, type SVGProps } from 'react'
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
// there rather than on a link that no longer leads anywhere. A section is
// one pane of a larger screen, in the room the pane would have had - inside
// the card or dialog around it, or on a card of its own on the bare page -
// and never takes focus away from what the reader is doing.

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

const PHONE = '@media (max-width: 479.98px)'

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
    paddingInline: { default: 24, [PHONE]: 16 },
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
    paddingInline: { default: 24, [PHONE]: 16 },
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
  titleSection: { fontSize: 15, lineHeight: 1.4 },
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
    width: { default: 'auto', [PHONE]: '100%' },
    flexDirection: { default: 'row', [PHONE]: 'column' },
    flexWrap: 'wrap',
    alignItems: { default: 'center', [PHONE]: 'stretch' },
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
  xstyle,
  className,
  ...rest
}: {
  kind: ResourceStateKind
  title: string
  description?: ReactNode
  /** the ways out, the one most readers want first */
  actions?: readonly ReactNode[]
  /** the whole of a screen, or one pane of it */
  size?: 'page' | 'section'
  /** a pane on the page's bare ground, rather than inside a card or a dialog */
  framed?: boolean
  /** move focus to the heading when it first appears; pages do by default */
  focusOnMount?: boolean
  xstyle?: StyleXStyles
  className?: string
  role?: 'alert' | 'status'
} & { [data: `data-${string}`]: string | undefined }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnMount) heading.current?.focus({ preventScroll: true })
  }, [focusOnMount])
  const Mark = marks[kind]
  const page = size === 'page'
  const Heading = page ? 'h1' : 'h2'
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
        <Heading
          ref={heading}
          tabIndex={-1}
          {...stylex.props(styles.title, page ? styles.titlePage : styles.titleSection)}
        >
          {title}
        </Heading>
        {description !== undefined && (
          <p
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
    </div>
  )
}
