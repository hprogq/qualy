import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'

const styles = stylex.create({
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: 16,
    rowGap: 8,
  },
  headerBanner: {
    paddingBlock: 4,
  },
  headerText: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  title: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    fontSize: '1.125rem',
    lineHeight: '1.75rem',
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  description: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  // capped at the header's own width so what a page puts here wraps
  // instead of running off the edge: a flex item that may not shrink is
  // sized to its content, and its own wrapping never gets a chance
  actions: {
    display: 'flex',
    maxWidth: '100%',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  panel: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: { default: 16, ':first-child': 0 },
  },
  panelHead: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  panelText: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  panelTitle: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 600,
  },
  panelDescription: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  panelBody: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 16,
  },
})

/**
 * What a page is, above what it shows.
 *
 * The shell says which application and which object; the page still has to
 * say which of that object's pages this is. Without it a section opens on
 * its own controls, which reads as a fragment of a screen rather than a
 * screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  variant = 'plain',
}: {
  /**
   * Usually the page's name. Takes a node so a heading that has something to
   * say beside the name - a standing, a chip - is still this heading rather
   * than a second one built to look like it: two headings assembled
   * separately drift apart by a few pixels, and in a band that hands over
   * from one to the other those pixels are a jump.
   */
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /**
   * The heading of a band that spans the content area, rather than a line of
   * text above it.
   *
   * Only the rhythm differs here - the band itself belongs to whoever draws
   * it edge to edge, because a header inset inside the page's own width is a
   * card pretending to be a header.
   */
  variant?: 'plain' | 'banner'
}) {
  return (
    <div {...stylex.props(styles.header, variant === 'banner' && styles.headerBanner)}>
      <div {...stylex.props(styles.headerText)}>
        <h1 {...stylex.props(styles.title)}>{title}</h1>
        {description !== undefined && description !== '' && (
          <p {...stylex.props(styles.description)}>{description}</p>
        )}
      </div>
      {actions && <div {...stylex.props(styles.actions)}>{actions}</div>}
    </div>
  )
}

/**
 * One part of a screen: a heading, what it says, and what it holds.
 *
 * A rule above it and nothing else. It used to be a card, and a screen of
 * five settings then read as five unrelated objects stacked on a page -
 * boxes inside a box, each with its own edge competing with the edges of the
 * rows inside it. What separates two parts of one thing is a line.
 */
export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.panelHead)}>
        <div {...stylex.props(styles.panelText)}>
          <h2 {...stylex.props(styles.panelTitle)}>{title}</h2>
          {description && <p {...stylex.props(styles.panelDescription)}>{description}</p>}
        </div>
        {actions}
      </div>
      <div {...stylex.props(styles.panelBody)}>{children}</div>
    </section>
  )
}
